import type { Pool, PoolClient } from 'pg';

import { AppError, isDatabaseError } from '../../lib/errors.js';
import { bangkokDateStart, bangkokParts, toBangkokIso } from '../../lib/time.js';
import {
  decisionTime,
  enqueueEmails,
  insertAudit,
  lockRooms,
  type RequestMeta,
  withTx,
} from '../../lib/tx.js';
import { occupancyRange } from '../../lib/window.js';
import type { BookingRow } from './serialize.js';

/**
 * Every booking writer in this file walks the canonical lock ORDER (05 §5.6):
 * (0) idempotency advisory lock → (2) users FOR SHARE ordered by id → (3) room advisory
 * locks ordered by hashtext → (e) binding room re-read FOR SHARE → (4) decision_time =
 * clock_timestamp() after all locks. Outbox + audit rows join the same transaction.
 * Constraint A (bookings_no_overlap_confirmed, 23P01) stays the final arbiter.
 * withTx/lockRooms/decisionTime/insertAudit/enqueueEmails live in lib/tx.ts — the admin
 * writers walk the same steps.
 */

export type Attendee = { email: string; name: string | null };

export type { RequestMeta };

/** (2): FOR SHARE on every involved ACTIVE user, ordered by id. Returns id → identity. */
async function lockUsersActive(
  tx: PoolClient,
  userIds: readonly string[],
): Promise<Map<string, { email: string; fullName: string }>> {
  const ids = [...new Set(userIds)].sort();
  const result = await tx.query<{ id: string; email: string; full_name: string }>(
    `SELECT id, email, full_name FROM users
      WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'
      ORDER BY id FOR SHARE`,
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, { email: row.email, fullName: row.full_name }]));
}

/** Identity of a user regardless of status — a mail address, never an authorisation answer. */
async function readUserIdentity(
  tx: PoolClient,
  userId: string,
): Promise<{ email: string; fullName: string } | undefined> {
  const result = await tx.query<{ email: string; full_name: string }>(
    'SELECT email, full_name FROM users WHERE id = $1 FOR SHARE',
    [userId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : { email: row.email, fullName: row.full_name };
}

type RoomPolicy = { active: boolean; capacity: number; name: string; code: string };

/** (e): the binding room read, under the advisory lock. */
async function readRoomForShare(tx: PoolClient, roomId: string): Promise<RoomPolicy | undefined> {
  const result = await tx.query<RoomPolicy>(
    'SELECT active, capacity, name, code FROM rooms WHERE id = $1 FOR SHARE',
    [roomId],
  );
  return result.rows[0];
}

async function loadAttendees(tx: PoolClient, bookingId: string): Promise<Attendee[]> {
  const result = await tx.query<Attendee>(
    'SELECT email, name FROM booking_attendees WHERE booking_id = $1 ORDER BY email',
    [bookingId],
  );
  return result.rows;
}

/** Snapshot for the template + .ics at enqueue time (outbox convention). Exported because
 * the deactivate cascade (modules/users) enqueues booking.cancelled with the same shape. */
export function emailPayload(input: {
  booking: {
    id: string;
    title: string;
    description: string | null;
    start_at: Date;
    end_at: Date;
    headcount: number | null;
    version: number;
  };
  room: { code: string; name: string };
  owner: { email: string; fullName: string };
  attendees: readonly Attendee[];
  /** booking.cancelled only: the admin's note, which §2.6 requires the mail to show (S-15). */
  reason?: string | null;
}) {
  return {
    booking_id: input.booking.id,
    title: input.booking.title,
    description: input.booking.description,
    start_at: input.booking.start_at.toISOString(),
    end_at: input.booking.end_at.toISOString(),
    headcount: input.booking.headcount,
    version: input.booking.version,
    room: { code: input.room.code, name: input.room.name },
    owner: { email: input.owner.email, name: input.owner.fullName },
    attendees: input.attendees,
    ...(input.reason == null ? {} : { reason: input.reason }),
  };
}

/**
 * Alternatives are computed OUTSIDE the rolled-back tx: active rooms with no holding booking
 * overlapping the same window, ordered by capacity then name (PROPOSED point 1).
 */
export async function slotUnavailableError(
  pool: Pool,
  input: {
    roomId: string;
    startAt: Date;
    endAt: Date;
    isAdmin: boolean;
    /** §5.10 buffer_minutes — searched with the same widened range the create probe uses, or
     * the suggested alternative would be refused for the buffer the moment it is picked. */
    bufferMinutes: number;
  },
): Promise<AppError> {
  const range = occupancyRange(input.startAt, input.endAt, {
    buffer_minutes: input.bufferMinutes,
  });
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const alternatives = await pool.query<{ room_id: string; code: string; name: string }>(
    `SELECT r.id AS room_id, r.code, r.name FROM rooms r
      WHERE r.active
        AND NOT EXISTS (SELECT 1 FROM bookings b
                         WHERE b.room_id = r.id AND b.status IN ('CONFIRMED','CHECKED_IN')
                           AND b.slot && tstzrange($1::timestamptz, $2::timestamptz, '[)'))
      ORDER BY r.capacity, r.name`,
    [from, to],
  );

  let conflictingBookingId: string | undefined;
  if (input.isAdmin) {
    const conflict = await pool.query<{ id: string }>(
      `SELECT id FROM bookings
        WHERE room_id = $1 AND status IN ('CONFIRMED','CHECKED_IN')
          AND slot && tstzrange($2::timestamptz, $3::timestamptz, '[)')
        ORDER BY start_at LIMIT 1`,
      [input.roomId, from, to],
    );
    conflictingBookingId = conflict.rows[0]?.id;
  }

  return new AppError('SLOT_UNAVAILABLE', 'The room is already booked for this window', {
    details: {
      room_id: input.roomId,
      start_at: toBangkokIso(input.startAt),
      end_at: toBangkokIso(input.endAt),
      alternatives: alternatives.rows,
      ...(conflictingBookingId === undefined
        ? {}
        : { conflicting_booking_id: conflictingBookingId }),
    },
  });
}

export function isSlotConflict(error: unknown): boolean {
  return (
    // Constraint A, and — when buffer_minutes is non-zero — the in-tx buffer probe, which
    // fails on a gap the constraint cannot see. Both reach the caller as the same 409 with
    // alternatives.
    (error instanceof AppError && error.code === 'SLOT_UNAVAILABLE') ||
    (isDatabaseError(error) &&
      error.code === '23P01' &&
      error.constraint === 'bookings_no_overlap_confirmed')
  );
}

/**
 * §5.10 buffer_minutes. Constraint A arbitrates literal overlap only, so a non-zero gap has
 * to be enforced by a read — safe here because the caller already holds the room's advisory
 * lock, which serialises every writer for that room.
 */
async function assertBufferClear(
  tx: PoolClient,
  input: {
    roomId: string;
    startAt: Date;
    endAt: Date;
    bufferMinutes: number;
    excludeBookingId?: string;
  },
): Promise<void> {
  if (input.bufferMinutes <= 0) {
    return;
  }
  const range = occupancyRange(input.startAt, input.endAt, {
    buffer_minutes: input.bufferMinutes,
  });
  const clash = await tx.query(
    `SELECT 1 FROM bookings
      WHERE room_id = $1 AND status IN ('CONFIRMED','CHECKED_IN')
        AND slot && tstzrange($2::timestamptz, $3::timestamptz, '[)')
        AND ($4::uuid IS NULL OR id <> $4::uuid)
      LIMIT 1`,
    [
      input.roomId,
      range.from.toISOString(),
      range.to.toISOString(),
      input.excludeBookingId ?? null,
    ],
  );
  if ((clash.rowCount ?? 0) > 0) {
    throw new AppError('SLOT_UNAVAILABLE', 'The room is not free for the required buffer');
  }
}

/** The one SELECT every booking view is built from ($1 is always the viewer's email). */
export const BOOKING_VIEW_SELECT = `
  SELECT b.id, b.room_id, b.start_at, b.end_at, b.status, b.is_private, b.title,
         b.description, b.special_request, b.headcount, b.version, b.owner_id,
         b.checked_in_at, b.checkin_method, b.created_at, b.updated_at,
         b.reason_code, b.reason, b.cancelled_at,
         cb.id AS cancelled_by_id, cb.full_name AS cancelled_by_name,
         u.full_name AS owner_full_name,
         d.id AS department_id, d.code AS department_code, d.name AS department_name,
         u.email AS owner_email,
         (SELECT count(*)::int FROM booking_attendees a WHERE a.booking_id = b.id)
           AS attendee_count,
         EXISTS (SELECT 1 FROM booking_attendees a
                  WHERE a.booking_id = b.id AND a.email = $1) AS viewer_is_attendee,
         (SELECT coalesce(json_agg(json_build_object('email', a.email, 'name', a.name)
                                   ORDER BY a.email), '[]'::json)
            FROM booking_attendees a WHERE a.booking_id = b.id) AS attendees
    FROM bookings b
    JOIN users u ON u.id = b.owner_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN users cb ON cb.id = b.cancelled_by`;

/**
 * T1 step (0) outside the tx: a committed booking for (actor, key) short-circuits the
 * route BEFORE validation — time-dependent guards must never 4xx a legitimate retry of an
 * already-committed create (CF-01). The in-tx check stays the arbiter for races.
 */
export async function findPriorBookingId(
  pool: Pool,
  actorId: string,
  idempotencyKey: string,
): Promise<string | undefined> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM bookings WHERE created_by = $1 AND idempotency_key = $2',
    [actorId, idempotencyKey],
  );
  return result.rows[0]?.id;
}

export async function loadBookingRow(
  pool: Pool,
  bookingId: string,
  viewerEmail: string,
): Promise<BookingRow | undefined> {
  const result = await pool.query<BookingRow>(`${BOOKING_VIEW_SELECT} WHERE b.id = $2`, [
    viewerEmail,
    bookingId,
  ]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// POST /bookings — 05 §5.6 T1
// ---------------------------------------------------------------------------

export type CreateBookingInput = {
  actorId: string;
  ownerId: string;
  idempotencyKey: string;
  roomId: string;
  startAt: Date;
  endAt: Date;
  title: string;
  description: string | null;
  specialRequest: string | null;
  headcount: number | null;
  isPrivate: boolean;
  attendees: Attendee[];
  /** settings.buffer_minutes, read by the route from the same document availability uses. */
  bufferMinutes: number;
} & RequestMeta;

export async function createBooking(
  pool: Pool,
  input: CreateBookingInput,
): Promise<{ id: string; replayed: boolean }> {
  return withTx(pool, async (tx) => {
    // (0) idempotency: serialize concurrent retries of the same key, then look for a prior
    // booking. Same key + different payload still replays the original (CF-01).
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1::text || ':' || $2::text))", [
      input.actorId,
      input.idempotencyKey,
    ]);
    const prior = await tx.query<{ id: string }>(
      'SELECT id FROM bookings WHERE created_by = $1 AND idempotency_key = $2',
      [input.actorId, input.idempotencyKey],
    );
    const priorRow = prior.rows[0];
    if (priorRow !== undefined) {
      return { id: priorRow.id, replayed: true };
    }

    const users = await lockUsersActive(tx, [input.actorId, input.ownerId]);
    if (!users.has(input.actorId)) {
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    const owner = users.get(input.ownerId);
    if (owner === undefined) {
      throw new AppError('NOT_FOUND', 'Owner not found');
    }

    await lockRooms(tx, [input.roomId]);
    const room = await readRoomForShare(tx, input.roomId);
    if (room === undefined) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    if (!room.active) {
      throw new AppError('ROOM_INACTIVE', 'Room is inactive');
    }
    await assertBufferClear(tx, {
      roomId: input.roomId,
      startAt: input.startAt,
      endAt: input.endAt,
      bufferMinutes: input.bufferMinutes,
    });

    const now = await decisionTime(tx);

    const inserted = await tx.query<{ id: string; version: number }>(
      `INSERT INTO bookings (room_id, owner_id, created_by, title, description, special_request,
                             headcount, is_private, start_at, end_at, status, confirmed_at,
                             idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'CONFIRMED', $11, $12)
       ON CONFLICT ON CONSTRAINT bookings_idem_unique DO NOTHING
       RETURNING id, version`,
      [
        input.roomId,
        input.ownerId,
        input.actorId,
        input.title,
        input.description,
        input.specialRequest,
        input.headcount,
        input.isPrivate,
        input.startAt.toISOString(),
        input.endAt.toISOString(),
        now.toISOString(),
        input.idempotencyKey,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow === undefined) {
      // The key committed between our lock and the INSERT (5xx-after-commit retry): replay.
      const committed = await tx.query<{ id: string }>(
        'SELECT id FROM bookings WHERE created_by = $1 AND idempotency_key = $2',
        [input.actorId, input.idempotencyKey],
      );
      return { id: (committed.rows[0] as { id: string }).id, replayed: true };
    }

    for (const attendee of input.attendees) {
      await tx.query(
        `INSERT INTO booking_attendees (booking_id, email, name)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [insertedRow.id, attendee.email, attendee.name],
      );
    }

    await enqueueEmails(tx, {
      bookingId: insertedRow.id,
      templateKey: 'booking.confirmed',
      dedupeKey: String(insertedRow.version),
      recipients: [owner.email, ...input.attendees.map((attendee) => attendee.email)],
      payload: emailPayload({
        booking: {
          id: insertedRow.id,
          title: input.title,
          description: input.description,
          start_at: input.startAt,
          end_at: input.endAt,
          headcount: input.headcount,
          version: insertedRow.version,
        },
        room,
        owner: { email: owner.email, fullName: owner.fullName },
        attendees: input.attendees,
      }),
    });

    await insertAudit(tx, {
      actorId: input.actorId,
      action: 'booking.create',
      entityType: 'booking',
      entityId: insertedRow.id,
      after: {
        room_id: input.roomId,
        owner_id: input.ownerId,
        title: input.title,
        is_private: input.isPrivate,
        start_at: input.startAt.toISOString(),
        end_at: input.endAt.toISOString(),
        status: 'CONFIRMED',
      },
      ip: input.ip,
      requestId: input.requestId,
    });

    return { id: insertedRow.id, replayed: false };
  });
}

// ---------------------------------------------------------------------------
// PATCH /bookings/:id — 05 §5.6 T4 (CB-03: one UPDATE, colliding reschedule rolls back whole)
// ---------------------------------------------------------------------------

export type BookingHead = {
  id: string;
  room_id: string;
  owner_id: string;
  status: string;
  start_at: Date;
  end_at: Date;
  version: number;
  title: string;
  description: string | null;
  special_request: string | null;
  headcount: number | null;
  is_private: boolean;
};

export async function loadBookingHead(
  pool: Pool,
  bookingId: string,
): Promise<BookingHead | undefined> {
  const result = await pool.query<BookingHead>(
    `SELECT id, room_id, owner_id, status, start_at, end_at, version, title, description,
            special_request, headcount, is_private
       FROM bookings WHERE id = $1`,
    [bookingId],
  );
  return result.rows[0];
}

export type UpdateBookingInput = {
  actorId: string;
  isAdmin: boolean;
  bookingId: string;
  expectedVersion: number;
  /** Fully resolved target values (current value where the request omitted a field). */
  target: {
    roomId: string;
    startAt: Date;
    endAt: Date;
    title: string;
    description: string | null;
    specialRequest: string | null;
    headcount: number | null;
    isPrivate: boolean;
  };
  /** The room the pre-read saw — both rooms get locked. */
  previousRoomId: string;
  slotChanged: boolean;
  /** settings.buffer_minutes; probed only when the slot moves (D-26: a committed booking is
   * never re-validated against a policy that changed under it). */
  bufferMinutes: number;
} & RequestMeta;

export async function updateBooking(pool: Pool, input: UpdateBookingInput): Promise<void> {
  await withTx(pool, async (tx) => {
    const head = await loadHeadInTx(tx, input.bookingId);
    if (head === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }

    const users = await lockUsersActive(tx, [input.actorId, head.owner_id]);
    if (!users.has(input.actorId)) {
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    const owner = users.get(head.owner_id);
    if (owner === undefined) {
      throw new AppError('ACCOUNT_DISABLED', 'Owner account is disabled');
    }

    await lockRooms(tx, [input.previousRoomId, input.target.roomId]);

    // Re-read FOR UPDATE under the locks. ponytail: no retry loop — any room change since
    // the pre-read implies a version bump, so the guarded UPDATE below 0-rows into
    // VERSION_CONFLICT without ever writing outside our lock coverage.
    const fresh = await tx.query<{ room_id: string; status: string; version: number }>(
      'SELECT room_id, status, version FROM bookings WHERE id = $1 FOR UPDATE',
      [input.bookingId],
    );
    const freshRow = fresh.rows[0];
    if (freshRow === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }

    const room = await readRoomForShare(tx, input.target.roomId);
    if (room === undefined) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    if (!room.active) {
      throw new AppError('ROOM_INACTIVE', 'Room is inactive');
    }
    if (input.slotChanged) {
      await assertBufferClear(tx, {
        roomId: input.target.roomId,
        startAt: input.target.startAt,
        endAt: input.target.endAt,
        bufferMinutes: input.bufferMinutes,
        excludeBookingId: input.bookingId,
      });
    }

    const now = await decisionTime(tx);

    const updated = await tx.query<{ id: string; version: number }>(
      `UPDATE bookings
          SET room_id = $1, start_at = $2, end_at = $3, title = $4, description = $5,
              special_request = $6, headcount = $7, is_private = $8,
              confirmed_at = CASE WHEN $9 THEN $10::timestamptz ELSE confirmed_at END,
              version = version + 1, updated_at = $10
        WHERE id = $11 AND version = $12 AND status = 'CONFIRMED'
          AND (($13 AND end_at > $10) OR (owner_id = $14 AND start_at > $10))
        RETURNING id, version`,
      [
        input.target.roomId,
        input.target.startAt.toISOString(),
        input.target.endAt.toISOString(),
        input.target.title,
        input.target.description,
        input.target.specialRequest,
        input.target.headcount,
        input.target.isPrivate,
        input.slotChanged,
        now.toISOString(),
        input.bookingId,
        input.expectedVersion,
        input.isAdmin,
        input.actorId,
      ],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) {
      if (freshRow.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'Booking was modified by someone else', {
          details: { current_version: freshRow.version },
        });
      }
      throw new AppError('INVALID_STATUS_TRANSITION', 'Booking can no longer be edited', {
        details: { status: freshRow.status, action: 'EDIT' },
      });
    }

    if (input.slotChanged) {
      const attendees = await loadAttendees(tx, input.bookingId);
      await enqueueEmails(tx, {
        bookingId: input.bookingId,
        templateKey: 'booking.rescheduled',
        dedupeKey: String(updatedRow.version),
        recipients: [owner.email, ...attendees.map((attendee) => attendee.email)],
        payload: emailPayload({
          booking: {
            id: input.bookingId,
            title: input.target.title,
            description: input.target.description,
            start_at: input.target.startAt,
            end_at: input.target.endAt,
            headcount: input.target.headcount,
            version: updatedRow.version,
          },
          room,
          owner: { email: owner.email, fullName: owner.fullName },
          attendees,
        }),
      });
    }

    await insertAudit(tx, {
      actorId: input.actorId,
      action: input.slotChanged ? 'booking.reschedule' : 'booking.update',
      entityType: 'booking',
      entityId: input.bookingId,
      before: {
        room_id: head.room_id,
        start_at: head.start_at.toISOString(),
        end_at: head.end_at.toISOString(),
        version: input.expectedVersion,
      },
      after: {
        room_id: input.target.roomId,
        start_at: input.target.startAt.toISOString(),
        end_at: input.target.endAt.toISOString(),
        version: updatedRow.version,
      },
      ip: input.ip,
      requestId: input.requestId,
    });
  });
}

async function loadHeadInTx(tx: PoolClient, bookingId: string): Promise<BookingHead | undefined> {
  const result = await tx.query<BookingHead>(
    `SELECT id, room_id, owner_id, status, start_at, end_at, version, title, description,
            special_request, headcount, is_private
       FROM bookings WHERE id = $1`,
    [bookingId],
  );
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Demo check-in preparation — local development only. The router is not mounted unless the
// fail-closed environment guard enables it. This writer deliberately bypasses business-hours
// and lead-time validation, but keeps the normal ownership, lock, overlap and audit invariants.
// It never writes to the notification outbox.
// ---------------------------------------------------------------------------

const DATABASE_SLOT_MINUTES = 15;

type DemoCheckinTiming = {
  slotIncrementMinutes: number;
  openBeforeMinutes: number;
  graceMinutes: number;
};

function latestEligibleGridStart(
  nowMs: number,
  durationMs: number,
  timing: DemoCheckinTiming,
  gridMinutes: number,
): Date | undefined {
  const upperInclusive = nowMs + timing.openBeforeMinutes * 60_000;
  const lowerExclusive = nowMs - Math.min(durationMs, timing.graceMinutes * 60_000);
  const step = gridMinutes * 60_000;
  const candidate = Math.floor(upperInclusive / step) * step;
  return candidate > lowerExclusive ? new Date(candidate) : undefined;
}

/** Pick the latest start that makes self check-in legal now. Prefer the configured grid, then
 * fall back to the database's 15-minute floor when a 30/60-minute boundary is not in-window. */
export function demoCheckinReadyStart(
  now: Date,
  durationMs: number,
  timing: DemoCheckinTiming,
): Date {
  const preferred = latestEligibleGridStart(
    now.getTime(),
    durationMs,
    timing,
    timing.slotIncrementMinutes,
  );
  const candidate =
    preferred ?? latestEligibleGridStart(now.getTime(), durationMs, timing, DATABASE_SLOT_MINUTES);
  if (candidate === undefined) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The current check-in policy has no database-aligned instant available for the demo',
    );
  }
  return candidate;
}

export type DemoShiftBookingInput = {
  actorId: string;
  bookingId: string;
  expectedVersion: number;
  bufferMinutes: number;
  timing: DemoCheckinTiming;
} & RequestMeta;

export async function shiftBookingToDemoCheckin(
  pool: Pool,
  input: DemoShiftBookingInput,
): Promise<{ startAt: Date; endAt: Date; version: number }> {
  return withTx(pool, async (tx) => {
    const head = await loadHeadInTx(tx, input.bookingId);
    if (head === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }

    const users = await lockUsersActive(tx, [input.actorId, head.owner_id]);
    if (!users.has(input.actorId)) {
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (head.owner_id !== input.actorId) {
      throw new AppError('FORBIDDEN', 'Only the booking owner may use demo check-in preparation');
    }

    await lockRooms(tx, [head.room_id]);
    const fresh = await tx.query<BookingHead>(
      `SELECT id, room_id, owner_id, status, start_at, end_at, version, title, description,
              special_request, headcount, is_private
         FROM bookings WHERE id = $1 FOR UPDATE`,
      [input.bookingId],
    );
    const booking = fresh.rows[0];
    if (booking === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    if (booking.version !== input.expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'Booking was modified by someone else', {
        details: { current_version: booking.version },
      });
    }
    if (booking.owner_id !== input.actorId) {
      throw new AppError('FORBIDDEN', 'Only the booking owner may use demo check-in preparation');
    }

    const room = await readRoomForShare(tx, booking.room_id);
    if (room === undefined) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    if (!room.active) {
      throw new AppError('ROOM_INACTIVE', 'Room is inactive');
    }

    const now = await decisionTime(tx);
    if (booking.status !== 'CONFIRMED' || booking.start_at.getTime() <= now.getTime()) {
      throw new AppError('INVALID_STATUS_TRANSITION', 'Booking cannot be prepared for check-in', {
        details: { status: booking.status, action: 'DEMO_CHECKIN_READY' },
      });
    }

    const durationMs = booking.end_at.getTime() - booking.start_at.getTime();
    const startAt = demoCheckinReadyStart(now, durationMs, input.timing);
    const endAt = new Date(startAt.getTime() + durationMs);
    await assertBufferClear(tx, {
      roomId: booking.room_id,
      startAt,
      endAt,
      bufferMinutes: input.bufferMinutes,
      excludeBookingId: booking.id,
    });

    const updated = await tx.query<{ version: number }>(
      `UPDATE bookings
          SET start_at = $1, end_at = $2, confirmed_at = $3,
              version = version + 1, updated_at = $3
        WHERE id = $4 AND owner_id = $5 AND version = $6 AND status = 'CONFIRMED'
          AND start_at > $3
        RETURNING version`,
      [
        startAt.toISOString(),
        endAt.toISOString(),
        now.toISOString(),
        input.bookingId,
        input.actorId,
        input.expectedVersion,
      ],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) {
      throw new AppError('VERSION_CONFLICT', 'Booking changed while preparing the demo', {
        details: { current_version: booking.version },
      });
    }

    await insertAudit(tx, {
      actorId: input.actorId,
      action: 'booking.demo_shift',
      entityType: 'booking',
      entityId: input.bookingId,
      before: {
        room_id: booking.room_id,
        start_at: booking.start_at.toISOString(),
        end_at: booking.end_at.toISOString(),
        version: booking.version,
      },
      after: {
        room_id: booking.room_id,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        version: updatedRow.version,
      },
      reason: 'DEMO_CHECKIN_PREP',
      ip: input.ip,
      requestId: input.requestId,
    });

    return { startAt, endAt, version: updatedRow.version };
  });
}

// ---------------------------------------------------------------------------
// PUT /bookings/:id/attendees — spec §4: version-guarded replace, .ics REQUEST for
// added and CANCEL for removed, same-tx outbox + audit.
// ---------------------------------------------------------------------------

export type ReplaceAttendeesInput = {
  actorId: string;
  isAdmin: boolean;
  bookingId: string;
  expectedVersion: number;
  attendees: Attendee[];
} & RequestMeta;

export async function replaceAttendees(pool: Pool, input: ReplaceAttendeesInput): Promise<void> {
  await withTx(pool, async (tx) => {
    const head = await loadHeadInTx(tx, input.bookingId);
    if (head === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }

    const users = await lockUsersActive(tx, [input.actorId, head.owner_id]);
    if (!users.has(input.actorId)) {
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    const owner = users.get(head.owner_id);
    if (owner === undefined) {
      throw new AppError('ACCOUNT_DISABLED', 'Owner account is disabled');
    }

    await lockRooms(tx, [head.room_id]);
    const room = await readRoomForShare(tx, head.room_id);
    if (room === undefined) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }
    const now = await decisionTime(tx);
    const before = await loadAttendees(tx, input.bookingId);

    // Same editability predicate as PATCH: CONFIRMED, owner before start / admin before end.
    const updated = await tx.query<{ id: string; version: number }>(
      `UPDATE bookings SET version = version + 1, updated_at = $1
        WHERE id = $2 AND version = $3 AND status = 'CONFIRMED'
          AND (($4 AND end_at > $1) OR (owner_id = $5 AND start_at > $1))
        RETURNING id, version`,
      [now.toISOString(), input.bookingId, input.expectedVersion, input.isAdmin, input.actorId],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) {
      const fresh = await loadHeadInTx(tx, input.bookingId);
      if (fresh === undefined) {
        throw new AppError('NOT_FOUND', 'Booking not found');
      }
      if (fresh.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT', 'Booking was modified by someone else', {
          details: { current_version: fresh.version },
        });
      }
      throw new AppError('INVALID_STATUS_TRANSITION', 'Booking can no longer be edited', {
        details: { status: fresh.status, action: 'EDIT' },
      });
    }

    await tx.query(
      'DELETE FROM booking_attendees WHERE booking_id = $1 AND email <> ALL($2::citext[])',
      [input.bookingId, input.attendees.map((attendee) => attendee.email)],
    );
    for (const attendee of input.attendees) {
      await tx.query(
        `INSERT INTO booking_attendees (booking_id, email, name) VALUES ($1, $2, $3)
         ON CONFLICT (booking_id, email) DO UPDATE SET name = excluded.name`,
        [input.bookingId, attendee.email, attendee.name],
      );
    }

    const beforeEmails = new Set(before.map((attendee) => attendee.email));
    const nextEmails = new Set(input.attendees.map((attendee) => attendee.email));
    const added = input.attendees.filter((attendee) => !beforeEmails.has(attendee.email));
    const removed = before.filter((attendee) => !nextEmails.has(attendee.email));

    const payload = emailPayload({
      booking: {
        id: input.bookingId,
        title: head.title,
        description: head.description,
        start_at: head.start_at,
        end_at: head.end_at,
        headcount: head.headcount,
        version: updatedRow.version,
      },
      room,
      owner: { email: owner.email, fullName: owner.fullName },
      attendees: input.attendees,
    });
    if (added.length > 0) {
      // Renders with an .ics REQUEST — same template as the original invite.
      await enqueueEmails(tx, {
        bookingId: input.bookingId,
        templateKey: 'booking.confirmed',
        dedupeKey: String(updatedRow.version),
        recipients: added.map((attendee) => attendee.email),
        payload,
      });
    }
    if (removed.length > 0) {
      // Renders with an .ics METHOD:CANCEL for the removed attendee.
      await enqueueEmails(tx, {
        bookingId: input.bookingId,
        templateKey: 'booking.cancelled',
        dedupeKey: String(updatedRow.version),
        recipients: removed.map((attendee) => attendee.email),
        payload,
      });
    }

    await insertAudit(tx, {
      actorId: input.actorId,
      action: 'booking.update',
      entityType: 'booking',
      entityId: input.bookingId,
      before: { attendees: before.map((attendee) => attendee.email), version: head.version },
      after: {
        attendees: input.attendees.map((attendee) => attendee.email),
        version: updatedRow.version,
      },
      ip: input.ip,
      requestId: input.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// POST /bookings/:id/cancel — 05 §5.6 T5
// ---------------------------------------------------------------------------

export type CancelBookingInput = {
  actorId: string;
  isAdmin: boolean;
  bookingId: string;
  reason: string | null;
} & RequestMeta;

export async function cancelBooking(
  pool: Pool,
  input: CancelBookingInput,
): Promise<{ already: boolean }> {
  const head = await loadBookingHead(pool, input.bookingId);
  if (head === undefined) {
    throw new AppError('NOT_FOUND', 'Booking not found');
  }
  if (head.owner_id !== input.actorId && !input.isAdmin) {
    throw new AppError('FORBIDDEN', 'Only the owner or an admin may cancel this booking');
  }
  // C-11: the terminal-state check runs BEFORE every other guard — cancel is idempotent.
  if (head.status === 'CANCELLED') {
    return { already: true };
  }
  if (head.status === 'COMPLETED' || head.status === 'AUTO_RELEASED') {
    throw new AppError('INVALID_STATUS_TRANSITION', 'Booking can no longer be cancelled', {
      details: { status: head.status, action: 'CANCEL' },
    });
  }
  if (input.isAdmin && head.owner_id !== input.actorId && (input.reason ?? '').trim().length < 3) {
    throw new AppError('REASON_REQUIRED', "Cancelling someone else's booking requires a reason");
  }

  return withTx(pool, async (tx) => {
    const users = await lockUsersActive(tx, [input.actorId, head.owner_id]);
    if (!users.has(input.actorId)) {
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    // Only the ACTOR has to be ACTIVE. The owner row is read for the notification address,
    // not as an authorisation check: the deactivate cascade deliberately leaves a meeting
    // already under way alive (C2-11) and U-04 says an admin cancels that one by hand — so
    // refusing a DISABLED owner here would strand the room until end_at. updateBooking and
    // replaceAttendees keep refusing; only cancel has to survive a disabled owner.
    const owner = users.get(head.owner_id) ?? (await readUserIdentity(tx, head.owner_id));
    if (owner === undefined) {
      throw new AppError('NOT_FOUND', 'Booking owner not found');
    }

    await lockRooms(tx, [head.room_id]);
    const room = await readRoomForShare(tx, head.room_id);
    const now = await decisionTime(tx);

    const updated = await tx.query<{ id: string; version: number; title: string }>(
      `UPDATE bookings
          SET status = 'CANCELLED', cancelled_at = $1, cancelled_by = $2, reason = $3,
              reason_code = CASE WHEN $4 AND owner_id <> $2 THEN 'ADMIN_CANCELLED'
                                 ELSE 'OWNER_CANCELLED' END,
              version = version + 1, updated_at = $1
        WHERE id = $5 AND end_at > $1
          AND (status = 'CONFIRMED' OR ($4 AND status = 'CHECKED_IN'))
          AND (owner_id = $2 OR $4)
        RETURNING id, version, title`,
      [now.toISOString(), input.actorId, input.reason, input.isAdmin, input.bookingId],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) {
      const fresh = await loadHeadInTx(tx, input.bookingId);
      if (fresh === undefined) {
        throw new AppError('NOT_FOUND', 'Booking not found');
      }
      if (fresh.status === 'CANCELLED') {
        return { already: true };
      }
      const effective =
        fresh.end_at.getTime() <= now.getTime() &&
        (fresh.status === 'CONFIRMED' || fresh.status === 'CHECKED_IN')
          ? 'COMPLETED'
          : fresh.status;
      throw new AppError('INVALID_STATUS_TRANSITION', 'Booking can no longer be cancelled', {
        details: { status: effective, action: 'CANCEL' },
      });
    }

    const attendees = await loadAttendees(tx, input.bookingId);
    // §2.6 matrix: owner cancel notifies the attendees only — the owner pressed the button.
    // Owner + attendees is reserved for an ADMIN cancelling someone else's booking.
    const recipients =
      head.owner_id === input.actorId
        ? attendees.map((attendee) => attendee.email)
        : [owner.email, ...attendees.map((attendee) => attendee.email)];
    await enqueueEmails(tx, {
      bookingId: input.bookingId,
      templateKey: 'booking.cancelled',
      dedupeKey: String(updatedRow.version),
      recipients,
      payload: emailPayload({
        booking: {
          id: input.bookingId,
          title: updatedRow.title,
          description: head.description,
          start_at: head.start_at,
          end_at: head.end_at,
          headcount: head.headcount,
          version: updatedRow.version,
        },
        room: room ?? { active: false, capacity: 0, name: '', code: '' },
        owner: { email: owner.email, fullName: owner.fullName },
        attendees,
        reason: input.reason,
      }),
    });

    await insertAudit(tx, {
      actorId: input.actorId,
      action: 'booking.cancel',
      entityType: 'booking',
      entityId: input.bookingId,
      before: { status: head.status },
      after: {
        status: 'CANCELLED',
        reason_code:
          input.isAdmin && head.owner_id !== input.actorId ? 'ADMIN_CANCELLED' : 'OWNER_CANCELLED',
      },
      reason: input.reason,
      ip: input.ip,
      requestId: input.requestId,
    });

    return { already: false };
  });
}

// ---------------------------------------------------------------------------
// Check-in — 05 §5.6 T6 / T6-QR (CB-02)
// ---------------------------------------------------------------------------

export type CheckinWindow = { openBeforeMinutes: number; graceMinutes: number };

export type CheckinResult = { bookingId: string; already: boolean };

function windowClosedError(
  booking: { start_at: Date; end_at: Date },
  window: CheckinWindow,
  adminWindow: boolean,
): AppError {
  const opensAt = new Date(booking.start_at.getTime() - window.openBeforeMinutes * 60_000);
  const closesAt = adminWindow
    ? booking.end_at
    : new Date(
        Math.min(
          booking.end_at.getTime(),
          booking.start_at.getTime() + window.graceMinutes * 60_000,
        ),
      );
  return new AppError('CHECKIN_WINDOW_CLOSED', 'Check-in is not open for this booking', {
    details: { opens_at: toBangkokIso(opensAt), closes_at: toBangkokIso(closesAt) },
  });
}

export type CheckinByIdInput = {
  actorId: string;
  bookingId: string;
  /** SELF (owner/attendee — even an ADMIN, TC-CHK-019) or ADMIN (uninvolved admin). */
  method: 'SELF' | 'ADMIN';
  window: CheckinWindow;
  note: string | null;
} & RequestMeta;

export async function checkInById(pool: Pool, input: CheckinByIdInput): Promise<CheckinResult> {
  return withTx(pool, async (tx) => {
    const head = await loadHeadInTx(tx, input.bookingId);
    if (head === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }

    const users = await lockUsersActive(tx, [input.actorId, head.owner_id]);
    if (!users.has(input.actorId)) {
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    await lockRooms(tx, [head.room_id]);
    const now = await decisionTime(tx);
    const adminWindow = input.method === 'ADMIN';

    const updated = await tx.query<{ id: string }>(
      `UPDATE bookings
          SET status = 'CHECKED_IN', checked_in_at = $1, checked_in_by = $2,
              checkin_method = $3, version = version + 1, updated_at = $1
        WHERE id = $4 AND status = 'CONFIRMED'
          AND $1 >= start_at - make_interval(mins => $5::int)
          AND (($6 AND $1 < end_at)
               OR (NOT $6 AND $1 < LEAST(end_at, start_at + make_interval(mins => $7::int))))
        RETURNING id`,
      [
        now.toISOString(),
        input.actorId,
        input.method,
        input.bookingId,
        input.window.openBeforeMinutes,
        adminWindow,
        input.window.graceMinutes,
      ],
    );
    if (updated.rows[0] === undefined) {
      const fresh = await loadHeadInTx(tx, input.bookingId);
      if (fresh === undefined) {
        throw new AppError('NOT_FOUND', 'Booking not found');
      }
      if (fresh.status === 'CHECKED_IN') {
        return { bookingId: input.bookingId, already: true };
      }
      if (fresh.status !== 'CONFIRMED') {
        throw new AppError('INVALID_STATUS_TRANSITION', 'Booking cannot be checked in', {
          details: { status: fresh.status, action: 'CHECK_IN' },
        });
      }
      throw windowClosedError(fresh, input.window, adminWindow);
    }

    await insertAudit(tx, {
      actorId: input.actorId,
      action: 'booking.checkin',
      entityType: 'booking',
      entityId: input.bookingId,
      after: { status: 'CHECKED_IN', checkin_method: input.method },
      reason: input.method === 'ADMIN' ? input.note : null,
      ip: input.ip,
      requestId: input.requestId,
    });
    return { bookingId: input.bookingId, already: false };
  });
}

export type CheckinByRoomInput = {
  actorId: string;
  actorEmail: string;
  roomId: string;
  roomCode: string;
  window: CheckinWindow;
} & RequestMeta;

/** T6-QR: resolve the booking from scanner identity + room + time window, earliest start. */
export async function checkInByRoom(pool: Pool, input: CheckinByRoomInput): Promise<CheckinResult> {
  return withTx(pool, async (tx) => {
    const users = await lockUsersActive(tx, [input.actorId]);
    if (!users.has(input.actorId)) {
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    await lockRooms(tx, [input.roomId]);
    const now = await decisionTime(tx);

    const updated = await tx.query<{ id: string }>(
      `UPDATE bookings b
          SET status = 'CHECKED_IN', checked_in_at = $1, checked_in_by = $2,
              checkin_method = 'QR', version = version + 1, updated_at = $1
        WHERE b.id = (SELECT c.id FROM bookings c
                       WHERE c.room_id = $3 AND c.status = 'CONFIRMED'
                         AND $1 >= c.start_at - make_interval(mins => $4::int)
                         AND $1 < LEAST(c.end_at, c.start_at + make_interval(mins => $5::int))
                         AND (c.owner_id = $2 OR EXISTS (SELECT 1 FROM booking_attendees a
                                                          WHERE a.booking_id = c.id
                                                            AND a.email = $6))
                       ORDER BY c.start_at LIMIT 1)
        RETURNING b.id`,
      [
        now.toISOString(),
        input.actorId,
        input.roomId,
        input.window.openBeforeMinutes,
        input.window.graceMinutes,
        input.actorEmail,
      ],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow !== undefined) {
      await insertAudit(tx, {
        actorId: input.actorId,
        action: 'booking.checkin',
        entityType: 'booking',
        entityId: updatedRow.id,
        after: { status: 'CHECKED_IN', checkin_method: 'QR' },
        ip: input.ip,
        requestId: input.requestId,
      });
      return { bookingId: updatedRow.id, already: false };
    }

    // Diagnostics, per CB-02: (i) already checked in → idempotent success; (ii) a booking of
    // theirs in this room today but outside the window; (iii) nothing at all.
    const checkedIn = await tx.query<{ id: string }>(
      `SELECT id FROM bookings b
        WHERE b.room_id = $1 AND b.status = 'CHECKED_IN'
          AND $2 >= b.start_at - make_interval(mins => $3::int) AND $2 < b.end_at
          AND (b.owner_id = $4 OR EXISTS (SELECT 1 FROM booking_attendees a
                                           WHERE a.booking_id = b.id AND a.email = $5))
        ORDER BY b.start_at LIMIT 1`,
      [
        input.roomId,
        now.toISOString(),
        input.window.openBeforeMinutes,
        input.actorId,
        input.actorEmail,
      ],
    );
    const checkedInRow = checkedIn.rows[0];
    if (checkedInRow !== undefined) {
      return { bookingId: checkedInRow.id, already: true };
    }

    const dayStart = bangkokDateStart(bangkokParts(now).date);
    const todays = await tx.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM bookings b
        WHERE b.room_id = $1 AND b.status = 'CONFIRMED'
          AND b.start_at >= $2 AND b.start_at < $3
          AND (b.owner_id = $4 OR EXISTS (SELECT 1 FROM booking_attendees a
                                           WHERE a.booking_id = b.id AND a.email = $5))
        ORDER BY b.start_at LIMIT 1`,
      [
        input.roomId,
        dayStart.toISOString(),
        new Date(dayStart.getTime() + 86_400_000).toISOString(),
        input.actorId,
        input.actorEmail,
      ],
    );
    const todayRow = todays.rows[0];
    if (todayRow !== undefined) {
      throw windowClosedError(todayRow, input.window, false);
    }
    throw new AppError('NO_BOOKING_IN_WINDOW', 'No booking of yours is open in this room', {
      details: { room_code: input.roomCode },
    });
  });
}
