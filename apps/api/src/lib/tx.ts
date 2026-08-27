import type { Pool, PoolClient } from 'pg';

import { AppError, isDatabaseError } from './errors.js';

/**
 * Transaction plumbing shared by every writer (05 §5.6). These lived inside
 * modules/bookings/service.ts until the admin surface became a second writer; the canonical
 * lock ORDER each writer walks is documented at the top of its own service file.
 */

export type RequestMeta = { ip: string | null; requestId: string };

export type AuditEntry = {
  actorId: string | null;
  action: string;
  /** audit_logs.entity_type: 'booking' | 'user' | 'department' | 'room' | 'settings' | 'auth'. */
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip: string | null;
  requestId: string;
};

/** Spec §0: 40P01/40001 (deadlock/serialization) → retry the whole tx once, then 503. */
export async function withTx<T>(pool: Pool, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // the connection is going back to the pool either way
      }
      const transient =
        isDatabaseError(error) && (error.code === '40P01' || error.code === '40001');
      if (!transient) {
        throw error;
      }
      if (attempt > 0) {
        throw new AppError('INTERNAL', 'Transient database conflict; please retry', {
          status: 503,
          cause: error,
        });
      }
    } finally {
      client.release();
    }
  }
}

/**
 * Per-room advisory locks, ordered by hashtext so two writers never deadlock. Ids are
 * lower-cased first: hashtext() is byte-wise, so a request carrying an upper-case UUID would
 * otherwise take a DIFFERENT lock than the writer holding the canonical one and walk straight
 * past the barrier (C2-04/CF-03). Postgres normalises uuid columns, so this is a no-op for
 * every id that came out of a query.
 */
export async function lockRooms(tx: PoolClient, roomIds: readonly string[]): Promise<void> {
  const ids = [...new Set(roomIds.map((id) => id.toLowerCase()))];
  const hashes = await tx.query<{ id: string; h: number }>(
    'SELECT x AS id, hashtext(x) AS h FROM unnest($1::text[]) AS x',
    [ids],
  );
  for (const row of hashes.rows.sort((a, b) => a.h - b.h)) {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [row.id]);
  }
}

/** Taken once, after all locks; used for every guard and every timestamp written. */
export async function decisionTime(tx: PoolClient): Promise<Date> {
  const result = await tx.query<{ t: Date }>('SELECT clock_timestamp() AS t');
  return (result.rows[0] as { t: Date }).t;
}

export async function insertAudit(tx: PoolClient, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, reason, ip, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.reason ?? null,
      entry.ip,
      entry.requestId,
    ],
  );
}

/** Same-tx outbox: one row per recipient, ON CONFLICT DO NOTHING against notifications_dedupe. */
export async function enqueueEmails(
  tx: PoolClient,
  input: {
    /** NULL for account mail, which belongs to a user rather than a booking. */
    bookingId: string | null;
    templateKey: string;
    dedupeKey: string;
    recipients: readonly string[];
    payload: unknown;
  },
): Promise<void> {
  const payload = JSON.stringify(input.payload);
  for (const email of new Set(input.recipients.map((value) => value.toLowerCase()))) {
    await tx.query(
      `INSERT INTO notifications (booking_id, template_key, dedupe_key, recipient_email, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT ON CONSTRAINT notifications_dedupe DO NOTHING`,
      [input.bookingId, input.templateKey, input.dedupeKey, email, payload],
    );
  }
}
