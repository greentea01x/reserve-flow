import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  inet,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { bookings } from './bookings.js';
import { citext, timestamptz } from './columns.js';

/** `0005_outbox_audit.sql`. */

/**
 * Transactional outbox. Rows are written in the same transaction as the booking they belong
 * to, so an email can never be sent for a booking that rolled back — and a booking is never
 * rolled back because the mail relay was down. The `notify.send` job drains it.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: bigint({ mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    /** NULL for account.set_password, which belongs to a user rather than a booking. */
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    channel: text().notNull().default('EMAIL'),
    /** 'booking.confirmed', 'booking.cancelled', 'booking.auto_released', … */
    templateKey: text('template_key').notNull(),
    /**
     * What makes an enqueue idempotent: booking events use version, reminders use the epoch
     * of start_at, account.set_password uses the id of the token that was issued (so a newly
     * issued token always produces a new row — C1-05).
     */
    dedupeKey: text('dedupe_key').notNull().default(''),
    recipientEmail: citext('recipient_email').notNull(),
    /** Everything the template and the .ics need, snapshotted at enqueue time. */
    payload: jsonb().notNull(),
    status: text().notNull().default('PENDING'),
    attempts: smallint().notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    lastError: text('last_error'),
    /** Whatever id the relay returned on the 250 line. */
    providerMessageId: text('provider_message_id'),
    sentAt: timestamptz('sent_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Every enqueue is ON CONFLICT DO NOTHING against this. NULLS NOT DISTINCT matters:
    // booking_id is NULL for account mail, and NULLs must collide for dedupe to work.
    unique('notifications_dedupe')
      .on(t.bookingId, t.templateKey, t.recipientEmail, t.dedupeKey)
      .nullsNotDistinct(),
    index('notifications_pending_idx').on(t.nextAttemptAt).where(sql`status = 'PENDING'`),
    // Admin screen: "which emails went out for this booking?"
    index('notifications_booking_idx').on(t.bookingId, t.createdAt.desc()),
    check('notifications_channel_valid', sql`${t.channel} IN ('EMAIL')`),
    check('notifications_status_valid', sql`${t.status} IN ('PENDING','SENT','FAILED','SKIPPED')`),
  ],
);

/**
 * Append-only. `actor_id` NULL means a job did it. UPDATE and DELETE are blocked by a trigger
 * (`0000_functions.sql`) as well as by grants, so even the schema owner cannot rewrite history
 * without deliberately setting the retention GUC.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint({ mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    actorId: uuid('actor_id').references(() => users.id),
    /** 'booking.create', 'user.disable', 'settings.update', 'auth.login_failed', … */
    action: text().notNull(),
    /** 'booking', 'user', 'room', 'settings', 'auth' */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** Redacted before it gets here: never a password, never a mobile number. */
    before: jsonb(),
    after: jsonb(),
    /** The reason an admin typed (§09 S-15). */
    reason: text(),
    ip: inet(),
    requestId: text('request_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, t.createdAt.desc()),
    index('audit_logs_actor_idx').on(t.actorId, t.createdAt.desc()),
    // The admin screen sorts by id DESC (identity column = insertion order, and the primary
    // key serves the unfiltered page). These two cover the filters that had nothing: `action`
    // — the column auth.login/auth.login_failed make the hottest — carries id so the sort is
    // read straight off the index, and `created_at` supports the from/to range scan.
    index('audit_logs_action_idx').on(t.action, t.id.desc()),
    index('audit_logs_created_at_idx').on(t.createdAt.desc()),
  ],
);
