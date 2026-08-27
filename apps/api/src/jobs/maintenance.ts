import type { PoolClient } from 'pg';
import type { Logger } from 'pino';

/** §5.10 retention marker; doubles as the idempotence guard (title CHECK needs length ≥ 1). */
export const RETENTION_TITLE = '[ลบตามนโยบายเก็บรักษา]';

/**
 * `maintenance.daily` (§5.7 / §5.10), inside the caller's advisory-locked transaction:
 * purge expired better-auth sessions/verifications and our password-setup tokens, delete
 * attendee emails 12 months after the meeting, drop old outbox rows (payloads carry
 * names/emails), and blank the free text of bookings that ended over 24 months ago.
 * Statistical booking facts (room, time, status, owner) are kept forever. audit_logs is
 * NOT purged here — that is the quarterly rf_owner runbook; rf_app has no DELETE on it.
 */
export async function runMaintenanceOnce(client: PoolClient, logger: Logger): Promise<void> {
  const sessions = await client.query('DELETE FROM sessions WHERE expires_at < now()');
  const verifications = await client.query('DELETE FROM verifications WHERE expires_at < now()');
  const tokens = await client.query(
    'DELETE FROM password_setup_tokens WHERE expires_at < now() OR used_at IS NOT NULL',
  );
  const attendees = await client.query(
    `DELETE FROM booking_attendees a USING bookings b
      WHERE b.id = a.booking_id AND b.end_at < now() - interval '12 months'`,
  );
  const notifications = await client.query(
    `DELETE FROM notifications WHERE created_at < now() - interval '12 months'`,
  );
  // C2-07: the guard must cover EVERY free-text column — a row whose only text is a
  // special_request or a cancel reason still has to be scrubbed exactly once.
  const scrubbed = await client.query(
    `UPDATE bookings
        SET title = $1, description = NULL, special_request = NULL, reason = NULL
      WHERE end_at < now() - interval '24 months'
        AND (title <> $1 OR description IS NOT NULL
             OR special_request IS NOT NULL OR reason IS NOT NULL)`,
    [RETENTION_TITLE],
  );
  logger.info(
    {
      sessions: sessions.rowCount,
      verifications: verifications.rowCount,
      tokens: tokens.rowCount,
      attendees: attendees.rowCount,
      notifications: notifications.rowCount,
      bookings_scrubbed: scrubbed.rowCount,
    },
    'maintenance round done',
  );
}
