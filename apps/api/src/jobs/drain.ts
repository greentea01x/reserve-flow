import type { Transporter } from 'nodemailer';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { buildCalendarInvite, type CalendarMethod } from '../email/ics.js';
import { type MailerConfig, mailAddressFrom, sendOutboxMessage } from '../email/mailer.js';
import {
  type BookingEmailData,
  hasTemplate,
  renderTemplate,
  type TemplateKey,
} from '../email/templates.js';

export type DrainDeps = {
  transporter: Transporter;
  config: MailerConfig;
  publicBaseUrl: string;
  /** settings.checkin_grace_minutes at SEND time — the number the copy quotes. */
  checkInGraceMinutes: number;
  logger: Logger;
};

/**
 * The emailPayload shape snapshotted at enqueue time (bookings/service.ts + sweep). An
 * `account.set_password` row (booking_id NULL, dedupe_key = password_setup_tokens.id) has
 * none of the booking fields — its payload is `{ name, set_password_url }`.
 */
type OutboxPayload = {
  booking_id?: string;
  title?: string;
  description?: string | null;
  start_at?: string;
  end_at?: string;
  headcount?: number | null;
  version?: number;
  room?: { code: string; name: string };
  owner?: { email: string; name: string };
  attendees?: { email: string; name: string | null }[];
  reason?: string | null;
  // account.set_password only
  name?: string;
  set_password_url?: string;
};

type ClaimedRow = {
  id: string;
  booking_id: string | null;
  template_key: string;
  recipient_email: string;
  payload: OutboxPayload;
  attempts: number;
  booking_status: string | null;
  start_moved: boolean;
};

const ICS_METHOD: Readonly<Record<string, CalendarMethod | undefined>> = {
  'booking.confirmed': 'REQUEST',
  'booking.rescheduled': 'REQUEST',
  'booking.cancelled': 'CANCEL',
  'booking.auto_released': 'CANCEL',
};

/** Templates that must still go out once the booking is CANCELLED/AUTO_RELEASED (IR-03). */
const TERMINAL_OK = new Set([
  'booking.cancelled',
  'booking.auto_released',
  'booking.auto_released_admin',
]);

// start_moved compares as timestamptz, not string: the service writes JS toISOString while
// the sweep writes the jsonb timestamp rendering.
const CLAIM_SQL = `
  SELECT n.id::text, n.booking_id, n.template_key, n.recipient_email, n.payload, n.attempts,
         b.status AS booking_status,
         CASE WHEN n.template_key = 'booking.reminder'
              THEN (n.payload->>'start_at')::timestamptz IS DISTINCT FROM b.start_at
              ELSE false END AS start_moved
    FROM notifications n
    LEFT JOIN bookings b ON b.id = n.booking_id
   WHERE n.status = 'PENDING' AND n.next_attempt_at <= now()
   ORDER BY n.id
   LIMIT 1
   FOR UPDATE OF n SKIP LOCKED`;

/** One drain round: keep claiming until nothing is due (or another instance holds the lock). */
export async function runDrainOnce(pool: Pool, deps: DrainDeps): Promise<void> {
  while (await drainOne(pool, deps)) {
    // each iteration settles exactly one notification in its own transaction
  }
}

/**
 * Claim one due row and settle it. Sendable rows are LEASED first: the attempt increment and
 * the backoff push-out commit BEFORE the SMTP call, so a crash between the relay's 250 and the
 * SENT mark re-sends at most once per persisted attempt — the 8-attempt dead-letter cap is a
 * hard ceiling on duplicates (delivery is at-least-once; see README.md).
 */
async function drainOne(pool: Pool, deps: DrainDeps): Promise<boolean> {
  const client = await pool.connect();
  let toSend: { row: ClaimedRow; key: TemplateKey } | undefined;
  try {
    await client.query('BEGIN');
    const lock = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('job:notify.send')) AS ok",
    );
    if (lock.rows[0]?.ok !== true) {
      await client.query('ROLLBACK');
      return false;
    }
    const claimed = await client.query<ClaimedRow>(CLAIM_SQL);
    const row = claimed.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      return false;
    }

    const terminal = row.booking_status === 'CANCELLED' || row.booking_status === 'AUTO_RELEASED';
    const staleReminder =
      row.template_key === 'booking.reminder' &&
      (row.booking_status !== 'CONFIRMED' || row.start_moved);
    const key = row.template_key;
    if (staleReminder || (terminal && !TERMINAL_OK.has(key))) {
      await client.query("UPDATE notifications SET status = 'SKIPPED' WHERE id = $1", [row.id]);
    } else if (!hasTemplate(key)) {
      // Dead-letters immediately; retryable from the admin screen once that ships.
      await client.query(
        `UPDATE notifications SET status = 'FAILED', attempts = attempts + 1,
                last_error = 'no renderer' WHERE id = $1`,
        [row.id],
      );
    } else {
      // Spec backoff: 30s, 1m, 2m, … capped at 32m — persisted here as the lease, so the row
      // is invisible to other claims until the backoff elapses even if we die mid-send.
      await client.query(
        `UPDATE notifications
            SET attempts = attempts + 1,
                next_attempt_at = now() + LEAST(2 ^ attempts, 64) * interval '30 seconds'
          WHERE id = $1`,
        [row.id],
      );
      toSend = { row, key };
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is going back to the pool either way
    }
    throw error;
  } finally {
    client.release();
  }
  if (toSend !== undefined) {
    await sendClaimed(pool, toSend.row, toSend.key, deps);
  }
  return true;
}

/** Runs AFTER the lease committed: sends, then settles the row in its own statement. */
async function sendClaimed(
  pool: Pool,
  row: ClaimedRow,
  key: TemplateKey,
  deps: DrainDeps,
): Promise<void> {
  const payload = row.payload;
  try {
    // account.set_password: the CTA is the set-password link and the recipient's name comes
    // from payload.name; the booking-shaped fields below stay unused by that renderer.
    const bookingUrl =
      key === 'account.set_password' && payload.set_password_url !== undefined
        ? payload.set_password_url
        : `${deps.publicBaseUrl}/bookings/${payload.booking_id ?? ''}`;
    const data: BookingEmailData = {
      bookingId: payload.booking_id ?? '',
      title: payload.title ?? '',
      roomName: payload.room?.name ?? '',
      ownerName: payload.owner?.name ?? payload.name ?? '',
      startAt: new Date(payload.start_at ?? 0),
      endAt: new Date(payload.end_at ?? 0),
      headcount: payload.headcount ?? null,
      checkInGraceMinutes: deps.checkInGraceMinutes,
      bookingUrl,
      ...(payload.reason == null ? {} : { reason: payload.reason }),
    };
    const rendered = renderTemplate(key, data);
    const method = ICS_METHOD[key];
    const calendar =
      method === undefined
        ? undefined
        : {
            method,
            content: buildCalendarInvite(
              {
                // ICS_METHOD only lists booking.* keys, so the booking fields are present.
                bookingId: payload.booking_id ?? '',
                version: payload.version ?? 1,
                summary: payload.title ?? '',
                description: payload.description ?? '',
                location: payload.room?.name ?? '',
                startAt: data.startAt,
                endAt: data.endAt,
                organizer: {
                  name: payload.owner?.name ?? '',
                  email: payload.owner?.email ?? mailAddressFrom(deps.config.from),
                },
                attendees: (payload.attendees ?? []).map((attendee) => ({
                  email: attendee.email,
                  name: attendee.name ?? attendee.email,
                })),
                sentBy: mailAddressFrom(deps.config.from),
                url: bookingUrl,
              },
              method,
              deps.config.domain,
            ),
          };

    const outcome = await sendOutboxMessage(deps.transporter, deps.config, {
      notificationId: row.id,
      to: row.recipient_email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      ...(calendar === undefined ? {} : { calendar }),
    });
    if (outcome.rejected.length > 0) {
      // One recipient per row, so `rejected` is all-or-nothing: permanent failure, no retry.
      await pool.query(
        `UPDATE notifications SET status = 'FAILED', last_error = left($2, 1000) WHERE id = $1`,
        [row.id, outcome.response],
      );
      return;
    }
    await pool.query(
      `UPDATE notifications SET status = 'SENT', sent_at = now(), provider_message_id = $2
        WHERE id = $1`,
      [row.id, outcome.messageId],
    );
  } catch (error) {
    deps.logger.error({ err: error, notification: row.id }, 'outbox send failed');
    // The lease already recorded the attempt + backoff; attempt 8 dead-letters (FAILED). The
    // admin retry button resets attempts; until Sentry lands, the log line above IS the alert.
    await pool.query(
      `UPDATE notifications
          SET last_error = left($2, 1000),
              status = CASE WHEN attempts >= 8 THEN 'FAILED' ELSE 'PENDING' END
        WHERE id = $1`,
      [row.id, error instanceof Error ? error.message : String(error)],
    );
  }
}
