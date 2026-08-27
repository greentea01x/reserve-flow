import { and, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { type AuthDependencies, createRequireAuth } from '../../auth/middleware.js';
import { schema } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';
import { toBangkokIso } from '../../lib/time.js';

const { features, roomFeatures, rooms } = schema;

const listQuerySchema = z.object({
  capacity_min: z.coerce.number().int().min(1).optional(),
  features: z.string().optional(),
  include_inactive: z.enum(['true', 'false']).optional(),
});

export type RoomFeature = { key: string; name: string; icon: string | null; quantity: number };

export function parseFeatureKeys(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');
}

/** feature rows grouped per room, sorted by key so the payload is deterministic. */
export async function loadRoomFeatures(
  db: AuthDependencies['db'],
): Promise<Map<string, RoomFeature[]>> {
  const rows = await db
    .select({
      roomId: roomFeatures.roomId,
      key: roomFeatures.featureKey,
      quantity: roomFeatures.quantity,
      name: features.name,
      icon: features.icon,
    })
    .from(roomFeatures)
    .innerJoin(features, eq(features.key, roomFeatures.featureKey))
    .orderBy(roomFeatures.featureKey);

  const byRoom = new Map<string, RoomFeature[]>();
  for (const row of rows) {
    const list = byRoom.get(row.roomId) ?? [];
    list.push({ key: row.key, name: row.name, icon: row.icon, quantity: row.quantity });
    byRoom.set(row.roomId, list);
  }
  return byRoom;
}

/**
 * Content type from the MAGIC BYTES, never from the client's Content-Type (S-12). One
 * function guards the upload and labels the download, so a row can only ever hold one of the
 * three formats it claims to.
 * ponytail: no server-side re-encode — sharp is a new dependency and the 5 MB cap is the
 * ceiling. Add resizing if rooms ever outgrow a handful.
 */
export function sniffImageType(
  bytes: Uint8Array,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const starts = (offset: number, magic: readonly number[]): boolean =>
    bytes.length >= offset + magic.length && magic.every((byte, i) => bytes[offset + i] === byte);

  if (starts(0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (starts(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (starts(0, [0x52, 0x49, 0x46, 0x46]) && starts(8, [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }
  return null;
}

export const roomColumns = {
  id: rooms.id,
  code: rooms.code,
  name: rooms.name,
  floor: rooms.floor,
  location: rooms.location,
  description: rooms.description,
  capacity: rooms.capacity,
  active: rooms.active,
  createdAt: rooms.createdAt,
  updatedAt: rooms.updatedAt,
  hasPhoto: sql<boolean>`(${rooms.photo} IS NOT NULL)`,
};

export type RoomRow = {
  id: string;
  code: string;
  name: string;
  floor: string | null;
  location: string | null;
  description: string | null;
  capacity: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  hasPhoto: boolean;
};

export function serializeRoom(row: RoomRow, roomFeatureList: RoomFeature[]) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    floor: row.floor,
    location: row.location,
    description: row.description,
    capacity: row.capacity,
    photo_url: row.hasPhoto ? `/api/v1/rooms/${row.id}/photo` : null,
    active: row.active,
    features: roomFeatureList,
    created_at: toBangkokIso(row.createdAt),
    updated_at: toBangkokIso(row.updatedAt),
  };
}

export function createRoomsRouter(dependencies: AuthDependencies) {
  const { db } = dependencies;
  const router = new Hono();
  const requireAuth = createRequireAuth(dependencies);

  router.get('/', requireAuth, async (context) => {
    const parsed = listQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid rooms query', {
        details: parsed.error.issues,
      });
    }
    const includeInactive = parsed.data.include_inactive === 'true';
    if (includeInactive && context.get('actor').role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', 'include_inactive requires the ADMIN role');
    }

    const conditions = [
      ...(includeInactive ? [] : [eq(rooms.active, true)]),
      ...(parsed.data.capacity_min === undefined
        ? []
        : [gte(rooms.capacity, parsed.data.capacity_min)]),
    ];
    const rows = await db
      .select(roomColumns)
      .from(rooms)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(rooms.capacity, rooms.name);
    const featuresByRoom = await loadRoomFeatures(db);

    const wanted = parseFeatureKeys(parsed.data.features);
    const data = rows
      .filter((row) => {
        const keys = new Set((featuresByRoom.get(row.id) ?? []).map((feature) => feature.key));
        return wanted.every((key) => keys.has(key));
      })
      .map((row) => serializeRoom(row, featuresByRoom.get(row.id) ?? []));

    return context.json({ data });
  });

  router.get('/:id', requireAuth, async (context) => {
    const row = await findVisibleRoom(context.req.param('id'), context.get('actor').role);
    const featuresByRoom = await loadRoomFeatures(db);
    return context.json(serializeRoom(row, featuresByRoom.get(row.id) ?? []));
  });

  router.get('/:id/photo', requireAuth, async (context) => {
    const row = await findVisibleRoom(context.req.param('id'), context.get('actor').role);
    if (!row.hasPhoto) {
      throw new AppError('NOT_FOUND', 'Room has no photo');
    }
    const [photoRow] = await db
      .select({ photo: rooms.photo })
      .from(rooms)
      .where(eq(rooms.id, row.id))
      .limit(1);
    if (photoRow?.photo == null) {
      throw new AppError('NOT_FOUND', 'Room has no photo');
    }
    // Served straight from the row, labelled by what the bytes actually are: the upload
    // stores exactly what it validated, so the sniff here agrees with the sniff there.
    const bytes = new Uint8Array(photoRow.photo);
    return context.body(bytes, 200, {
      'content-type': sniffImageType(bytes) ?? 'application/octet-stream',
    });
  });

  /** Inactive rooms are hidden from employees: 404, never 403 (C-15 flavour of soft delete). */
  async function findVisibleRoom(id: string, role: string): Promise<RoomRow> {
    if (!z.uuid().safeParse(id).success) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    const [row] = await db.select(roomColumns).from(rooms).where(eq(rooms.id, id)).limit(1);
    if (row === undefined || (!row.active && role !== 'ADMIN')) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    return row;
  }

  return router;
}
