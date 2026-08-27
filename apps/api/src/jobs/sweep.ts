import type { PoolClient } from 'pg';
import type { Logger } from 'pino';

import type { Settings } from '../lib/settings.js';

type ReleasedRow = {
  id: string;
  owner_id: string;
  version: number;
  title: string;
  description: string | null;
  start_at: Date;
  end_at: Date;
  headcount: number | null;
  room_id: string;
};

/** Same row convention as bookings/service.ts enqueueEmails: one row per recipient. */
async function enqueue(
  client: PoolClient,
  input: {
    bookingId: string;
    templateKey: string;
    dedupeKey: string;
    recipients: readonly string[];
    payload: unknown;
  },
): Promise<void> {
  const payload = JSON.stringify(input.payload);
  for (const email of new Set(input.recipients.map((value) => value.toLowerCase()))) {
    await client.query(
      `INSERT INTO notifications (booking_id, template_key, dedupe_key, recipient_email, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT ON CONSTRAINT notifications_dedupe DO NOTHING`,
      [input.bookingId, input.templateKey, input.dedupeKey, email, payload],
    );
  }
}

/** actor_id NULL = a job did it. */
async function insertJobAudit(
  client: PoolClient,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after)
     VALUES (NULL, $1, 'booking', $2, $3, $4)`,
    [action, entityId, before === null ? null : JSON.stringify(before), JSON.stringify(after)],
  );
}

/**
 * The three sweep steps, in mandatory order — auto-release BEFORE complete, so AUTO_RELEASED
 * wins at the LEAST() boundary (C2-03) — inside the caller's transaction. Uses now() (one
 * value per tx), never clock_timestamp: the sweep holds no per-room advisory locks; every
 * statement only moves rows out of the live set, and row locks order any race with API txes.
 */
export async function runSweepOnce(
  client: PoolClient,
  settings: Settings,
  logger: Logger,
): Promise<void> {
  // Step 1 — auto-release no-shows (updated_at is set by the set_updated_at() trigger).
  if (settings.auto_release_enabled) {
    const released = await client.query<ReleasedRow>(
      `UPDATE bookings
          SET status = 'AUTO_RELEASED', auto_released_at = now(), reason_code = 'NO_SHOW',
              version = version + 1
        WHERE status = 'CONFIRMED' AND checked_in_at IS NULL
          AND LEAST(end_at, start_at + make_interval(mins => $1::int)) <= now()
        RETURNING id, owner_id, version, title, description, start_at, end_at, headcount,
                  room_id`,
      [settings.checkin_grace_minutes],
    );
    if (released.rows.length > 0) {
      const admins = await client.query<{ email: string }>(
        `SELECT email FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`,
      );
      for (const booking of released.rows) {
        const room = await client.query<{ code: string; name: string }>(
          'SELECT code, name FROM rooms WHERE id = $1',
          [booking.room_id],
        );
        const owner = await client.query<{ email: string; full_name: string }>(
          'SELECT email, full_name FROM users WHERE id = $1',
          [booking.owner_id],
        );
        const attendees = await client.query<{ email: string; name: string | null }>(
          'SELECT email, name FROM booking_attendees WHERE booking_id = $1 ORDER BY email',
          [booking.id],
        );
        const ownerRow = owner.rows[0] as { email: string; full_name: string };
        // The emailPayload shape from bookings/service.ts, with the POST-bump version.
        const payload = {
          booking_id: booking.id,
          title: booking.title,
          description: booking.description,
          start_at: booking.start_at.toISOString(),
          end_at: booking.end_at.toISOString(),
          headcount: booking.headcount,
          version: booking.version,
          room: room.rows[0] as { code: string; name: string },
          owner: { email: ownerRow.email, name: ownerRow.full_name },
          attendees: attendees.rows,
        };
        await enqueue(client, {
          bookingId: booking.id,
          templateKey: 'booking.auto_released',
          dedupeKey: String(booking.version),
          recipients: [ownerRow.email, ...attendees.rows.map((attendee) => attendee.email)],
          payload,
        });
        // Different template_key, so an admin who is also owner/attendee gets both (C2-02).
        await enqueue(client, {
          bookingId: booking.id,
          templateKey: 'booking.auto_released_admin',
          dedupeKey: String(booking.version),
          recipients: admins.rows.map((admin) => admin.email),
          payload,
        });
        await insertJobAudit(
          client,
          'booking.auto_release',
          booking.id,
          { status: 'CONFIRMED' },
          { status: 'AUTO_RELEASED', version: booking.version },
        );
      }
      logger.info({ released: released.rows.length }, 'auto-released no-show bookings');
    }
  }

  // Step 2 — complete. No email (§2.6 matrix / IR-02): audit only.
  const completed = await client.query<{ id: string; version: number }>(
    `UPDATE bookings SET status = 'COMPLETED', version = version + 1
      WHERE status IN ('CHECKED_IN', 'CONFIRMED') AND end_at <= now()
      RETURNING id, version`,
  );
  for (const booking of completed.rows) {
    await insertJobAudit(client, 'booking.complete', booking.id, null, {
      status: 'COMPLETED',
      version: booking.version,
    });
  }
  if (completed.rows.length > 0) {
    logger.info({ completed: completed.rows.length }, 'completed ended bookings');
  }

  // Step 3 — owner reminder. Dedupe on epoch(start_at): a reschedule re-arms the reminder,
  // a re-run of the sweep does not. Payload mirrors emailPayload so the drain renders every
  // booking.* template from one shape; jsonb timestamps serialize as ISO 8601.
  await client.query(
    `INSERT INTO notifications (booking_id, template_key, dedupe_key, recipient_email, payload)
     SELECT b.id, 'booking.reminder', extract(epoch FROM b.start_at)::bigint::text, u.email,
            jsonb_build_object(
              'booking_id', b.id, 'title', b.title, 'description', b.description,
              'start_at', b.start_at, 'end_at', b.end_at, 'headcount', b.headcount,
              'version', b.version,
              'room', jsonb_build_object('code', r.code, 'name', r.name),
              'owner', jsonb_build_object('email', u.email, 'name', u.full_name),
              'attendees', '[]'::jsonb)
       FROM bookings b
       JOIN users u ON u.id = b.owner_id
       JOIN rooms r ON r.id = b.room_id
      WHERE b.status = 'CONFIRMED' AND b.start_at > now()
        AND b.start_at <= now() + make_interval(mins => $1::int)
     ON CONFLICT ON CONSTRAINT notifications_dedupe DO NOTHING`,
    [settings.reminder_minutes_before],
  );
}
