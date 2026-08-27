import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { type AuthDependencies, createRequireAdmin } from '../../auth/middleware.js';
import { schema } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';
import { clientIp, parseBody, readJson } from '../../lib/http.js';
import { insertAudit, lockRooms, withTx } from '../../lib/tx.js';
import { loadRoomFeatures, roomColumns, serializeRoom, sniffImageType } from './routes.js';

/**
 * Room master data — the admin side of §4. Two things here are load-bearing:
 *
 * 1. Every write takes pg_advisory_xact_lock(hashtext(room_id)) FIRST, the same lock
 *    createBooking takes at step (3) (C2-04/CF-03, TC-ROOM-028). Without it a create that
 *    already read active = true can commit a CONFIRMED booking into a room just closed.
 * 2. Deactivating a room does NOT cancel its future bookings and never will (§2.4/6.3.2).
 *    Nothing server-side happens to them: they stay CONFIRMED, keep their .ics, and their
 *    owners can still check in. active = false only hides the room from employees (404, not
 *    403), drops it out of availability, and refuses NEW bookings with ROOM_INACTIVE. The
 *    admin app shows its own warning by paging GET /bookings?scope=all&room_id=… — there is
 *    deliberately no /impact endpoint (C1-33).
 *
 * There is no DELETE /admin/rooms/:id: bookings reference rooms ON DELETE RESTRICT and
 * DELETE is not granted to rf_app on rooms. Closing a room is active = false.
 */

/** §4.4. The row IS the store (3 rooms, master.ts:31). */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * app.ts skips its global 64 KB cap for this path, so the ceiling lives here — mounted AFTER
 * requireAdmin so a non-admin's body is never read and the answer is a plain 404 either way.
 */
const photoBodyLimit = bodyLimit({
  maxSize: PHOTO_MAX_BYTES,
  onError: () => {
    throw new AppError('VALIDATION_FAILED', 'Photo must be 5 MB or smaller', { status: 413 });
  },
});

const featureSchema = z.strictObject({
  key: z.string().regex(/^[a-z_]{2,32}$/),
  quantity: z.number().int().min(1).max(99).default(1),
});

const featureListSchema = z
  .array(featureSchema)
  .max(30)
  .refine((list) => new Set(list.map((feature) => feature.key)).size === list.length, {
    message: 'feature keys must be unique',
  });

const roomFields = {
  name: z.string().min(1).max(80),
  floor: z.string().max(40).nullable(),
  location: z.string().max(200).nullable(),
  description: z.string().max(1000).nullable(),
  capacity: z.number().int().min(1).max(500),
  active: z.boolean(),
};

const createSchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9-]{2,32}$/),
  name: roomFields.name,
  floor: roomFields.floor.optional(),
  location: roomFields.location.optional(),
  description: roomFields.description.optional(),
  capacity: roomFields.capacity,
  active: roomFields.active.optional(),
  features: featureListSchema.optional(),
});

/**
 * `code` is absent on purpose (CB-02): it is printed on the door QR, so changing it would
 * invalidate physical signage. Retire the room and create a new one instead.
 */
const patchSchema = z
  .strictObject({
    name: roomFields.name.optional(),
    floor: roomFields.floor.optional(),
    location: roomFields.location.optional(),
    description: roomFields.description.optional(),
    capacity: roomFields.capacity.optional(),
    active: roomFields.active.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

type RoomAudit = {
  code: string;
  name: string;
  floor: string | null;
  location: string | null;
  description: string | null;
  capacity: number;
  active: boolean;
};

const ROOM_AUDIT_SELECT = `SELECT code, name, floor, location, description, capacity, active
                             FROM rooms WHERE id = $1`;

async function replaceFeatures(
  tx: PoolClient,
  roomId: string,
  list: readonly { key: string; quantity: number }[],
): Promise<void> {
  await tx.query('DELETE FROM room_features WHERE room_id = $1', [roomId]);
  for (const feature of [...list].sort((a, b) => a.key.localeCompare(b.key))) {
    await tx.query(
      'INSERT INTO room_features (room_id, feature_key, quantity) VALUES ($1, $2, $3)',
      [roomId, feature.key, feature.quantity],
    );
  }
}

export function createAdminRoomsRouter(dependencies: AuthDependencies) {
  const { db } = dependencies;
  const pool = db.$client;
  const router = new Hono();
  const requireAdmin = createRequireAdmin(dependencies);

  function roomId(context: { req: { param: (name: string) => string | undefined } }): string {
    const id = context.req.param('id');
    if (id === undefined || !z.uuid().safeParse(id).success) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    return id;
  }

  /** The public §6.3.2 Room, rebuilt after the write so admins and employees see one shape. */
  async function loadRoom(id: string) {
    const [row] = await db
      .select(roomColumns)
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id))
      .limit(1);
    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    const featuresByRoom = await loadRoomFeatures(db);
    return serializeRoom(row, featuresByRoom.get(id) ?? []);
  }

  async function readAudit(tx: PoolClient, id: string): Promise<RoomAudit> {
    const result = await tx.query<RoomAudit>(ROOM_AUDIT_SELECT, [id]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    return row;
  }

  router.post('/', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const body = parseBody(createSchema, await readJson(context));

    const id = await withTx(pool, async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO rooms (code, name, floor, location, description, capacity, active)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::boolean, true)) RETURNING id`,
        [
          body.code,
          body.name,
          body.floor ?? null,
          body.location ?? null,
          body.description ?? null,
          body.capacity,
          body.active ?? null,
        ],
      );
      const created = (inserted.rows[0] as { id: string }).id;
      await replaceFeatures(tx, created, body.features ?? []);
      await insertAudit(tx, {
        actorId: actor.id,
        action: 'room.create',
        entityType: 'room',
        entityId: created,
        after: { ...(await readAudit(tx, created)), features: body.features ?? [] },
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
      return created;
    });

    context.header('Location', `/api/v1/admin/rooms/${id}`);
    return context.json(await loadRoom(id), 201);
  });

  router.patch('/:id', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const id = roomId(context);
    const body = parseBody(patchSchema, await readJson(context));

    await withTx(pool, async (tx) => {
      await lockRooms(tx, [id]);
      const before = await readAudit(tx, id);

      const params: unknown[] = [id];
      const bind = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };
      // Column names come straight from patchSchema's strictObject, so the key set is a
      // fixed whitelist — anything else was rejected before this line.
      const sets = Object.entries(body).map(([column, value]) => `${column} = ${bind(value)}`);
      await tx.query(
        `UPDATE rooms SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );

      await insertAudit(tx, {
        actorId: actor.id,
        action: 'room.update',
        entityType: 'room',
        entityId: id,
        before,
        after: await readAudit(tx, id),
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
    });

    return context.json(await loadRoom(id));
  });

  router.put('/:id/features', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const id = roomId(context);
    const body = parseBody(featureListSchema, await readJson(context));

    await withTx(pool, async (tx) => {
      await lockRooms(tx, [id]);
      await readAudit(tx, id); // 404 before we delete anything
      const before = await tx.query(
        'SELECT feature_key AS key, quantity FROM room_features WHERE room_id = $1 ORDER BY feature_key',
        [id],
      );
      await replaceFeatures(tx, id, body);
      await insertAudit(tx, {
        actorId: actor.id,
        action: 'room.features_update',
        entityType: 'room',
        entityId: id,
        before: before.rows,
        after: body,
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
    });

    return context.json(await loadRoom(id));
  });

  router.post('/:id/photo', requireAdmin, photoBodyLimit, async (context) => {
    const actor = context.get('actor');
    const id = roomId(context);

    const file = (await context.req.parseBody()).file;
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', 'multipart/form-data field `file` is required');
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    // photoBodyLimit refuses an oversized body before it is buffered; this is the belt for a
    // multipart envelope whose parts add up differently to the declared Content-Length.
    if (bytes.byteLength > PHOTO_MAX_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'Photo must be 5 MB or smaller', { status: 413 });
    }
    const mime = sniffImageType(bytes);
    if (mime === null) {
      throw new AppError('VALIDATION_FAILED', 'Photo must be a JPEG, PNG or WebP image', {
        status: 415,
      });
    }

    await withTx(pool, async (tx) => {
      await readAudit(tx, id);
      await tx.query('UPDATE rooms SET photo = $2, updated_at = now() WHERE id = $1', [id, bytes]);
      await insertAudit(tx, {
        actorId: actor.id,
        action: 'room.photo_update',
        entityType: 'room',
        entityId: id,
        // Never the bytes themselves.
        after: { bytes: bytes.byteLength, mime },
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
    });

    return context.json({ photo_url: `/api/v1/rooms/${id}/photo` });
  });

  router.delete('/:id/photo', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const id = roomId(context);

    await withTx(pool, async (tx) => {
      await readAudit(tx, id);
      await tx.query('UPDATE rooms SET photo = NULL, updated_at = now() WHERE id = $1', [id]);
      await insertAudit(tx, {
        actorId: actor.id,
        action: 'room.photo_delete',
        entityType: 'room',
        entityId: id,
        after: { bytes: 0, mime: null },
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
    });

    return context.body(null, 204);
  });

  return router;
}
