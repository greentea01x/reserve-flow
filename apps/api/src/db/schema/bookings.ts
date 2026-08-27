import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { citext, rowTimestamps, timestamptz, tstzrange } from './columns.js';
import { rooms } from './master.js';

/**
 * `0003_bookings.sql`. The EXCLUDE constraint that actually guarantees no double-booking is
 * added separately in `0004_bookings_exclude.sql` — Drizzle's DSL cannot express EXCLUDE.
 *
 * Every booking that commits is confirmed: first come, first served. There is no pending
 * state and no approval step, so nothing here needs a lock or a read-then-insert. Writers
 * INSERT or UPDATE and let the database decide; `23P01` means "taken" and the API turns it
 * into `409 SLOT_UNAVAILABLE`.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    /** Whose meeting it is: drives "My bookings", masking and check-in. */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Who pressed the button — same as owner unless an ADMIN booked on someone's behalf. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    description: text(),
    specialRequest: text('special_request'),
    headcount: integer(),
    isPrivate: boolean('is_private').notNull().default(false),
    startAt: timestamptz('start_at').notNull(),
    endAt: timestamptz('end_at').notNull(),
    /**
     * Half-open `[start, end)`, so 13:00–14:00 and 14:00–15:00 do not overlap under `&&` and
     * back-to-back meetings need no buffer. Generated, so it can never drift from the two
     * columns it is built from.
     */
    slot: tstzrange().generatedAlwaysAs(sql`tstzrange(start_at, end_at, '[)')`),
    status: text().notNull(),
    /** Bumped on every change, by a human or a job. Doubles as the .ics SEQUENCE and as the
     * optimistic lock for PATCH. */
    version: integer().notNull().default(1),
    /** From the Idempotency-Key header. No request hash: the same key always returns the
     * same booking (CF-01). */
    idempotencyKey: uuid('idempotency_key').notNull(),
    /** Set on INSERT and again on every successful reschedule. */
    confirmedAt: timestamptz('confirmed_at'),
    reasonCode: text('reason_code'),
    /** Free text an admin types when cancelling someone else's booking. */
    reason: text(),

    // check-in
    checkedInAt: timestamptz('checked_in_at'),
    checkedInBy: uuid('checked_in_by').references(() => users.id),
    /** QR = scanned the sign on the door, the primary route. */
    checkinMethod: text('checkin_method'),

    // release / cancel
    autoReleasedAt: timestamptz('auto_released_at'),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    ...rowTimestamps,
  },
  (t) => [
    index('bookings_room_start_idx').on(t.roomId, t.startAt),
    index('bookings_owner_idx').on(t.ownerId, t.startAt.desc()),
    // The sweep's three statements and the check-in window lookup all ride this one.
    index('bookings_live_idx')
      .on(t.startAt, t.endAt)
      .where(sql`status IN ('CONFIRMED','CHECKED_IN')`),
    // Second net under ON CONFLICT: one key can never produce a second booking.
    unique('bookings_idem_unique').on(t.createdBy, t.idempotencyKey),

    check('bookings_title_length', sql`length(${t.title}) BETWEEN 1 AND 200`),
    check('bookings_description_length', sql`length(${t.description}) <= 2000`),
    check('bookings_special_request_length', sql`length(${t.specialRequest}) <= 1000`),
    check('bookings_headcount_positive', sql`${t.headcount} >= 1`),
    check(
      'bookings_status_valid',
      sql`${t.status} IN ('CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','AUTO_RELEASED')`,
    ),
    check(
      'bookings_reason_code_valid',
      sql`${t.reasonCode} IN ('OWNER_CANCELLED','ADMIN_CANCELLED','OWNER_DISABLED','NO_SHOW')`,
    ),
    check('bookings_checkin_method_valid', sql`${t.checkinMethod} IN ('SELF','QR','ADMIN')`),

    // Policy values (min duration, increment, advance window) live in `settings` and are
    // enforced by the API. What is below is the floor the database will not go under.
    check('bookings_time_order', sql`${t.endAt} > ${t.startAt}`),
    // 15-minute grid, so settings.slot_increment_minutes ∈ {15,30,60} stays satisfiable.
    check(
      'bookings_15min_grid',
      sql`extract(epoch FROM ${t.startAt})::bigint % 900 = 0 AND extract(epoch FROM ${t.endAt})::bigint % 900 = 0`,
    ),
    // Hard 12h ceiling — this is what lets range queries use the btree on start_at.
    check('bookings_hard_max', sql`${t.endAt} - ${t.startAt} <= interval '12 hours'`),
    check(
      'bookings_confirm_ok',
      sql`${t.status} NOT IN ('CONFIRMED','CHECKED_IN','COMPLETED') OR ${t.confirmedAt} IS NOT NULL`,
    ),
    check(
      'bookings_checkin_ok',
      sql`${t.status} <> 'CHECKED_IN' OR (${t.checkedInAt} IS NOT NULL AND ${t.checkinMethod} IS NOT NULL)`,
    ),
    check(
      'bookings_cancel_ok',
      sql`${t.status} <> 'CANCELLED' OR (${t.cancelledAt} IS NOT NULL AND ${t.cancelledBy} IS NOT NULL)`,
    ),
    check(
      'bookings_release_ok',
      sql`${t.status} <> 'AUTO_RELEASED' OR ${t.autoReleasedAt} IS NOT NULL`,
    ),
    check(
      'bookings_terminal_why',
      sql`${t.status} NOT IN ('CANCELLED','AUTO_RELEASED') OR ${t.reasonCode} IS NOT NULL`,
    ),
  ],
);

/** Attendees are stored as plain emails — they need not be users. */
export const bookingAttendees = pgTable(
  'booking_attendees',
  {
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    email: citext().notNull(),
    name: text(),
  },
  (t) => [
    primaryKey({ columns: [t.bookingId, t.email] }),
    // "am I an attendee?" — the question that unmasks a private booking.
    index('booking_attendees_email_idx').on(t.email),
    check('booking_attendees_email_format', sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
  ],
);
