import { Hono } from 'hono';
import { z } from 'zod';

import { type AuthDependencies, createRequireAdmin } from '../../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { clientIp } from '../../lib/http.js';
import { bangkokDateParam, bangkokDateStart, toBangkokIso } from '../../lib/time.js';
import { insertAudit, withTx } from '../../lib/tx.js';
import { TOTAL_CAP } from '../audit/routes.js';

/**
 * §6.3.9, the two MVP admin routes over the transactional outbox: read the queue, and put a
 * dead-lettered row back on it. The runbook in §09 is the consumer — "which mail did not go
 * out, and why" — so `last_error` is served verbatim and never redacted.
 *
 * There is no send-from-here and no delete: the drain job (jobs/drain.ts) owns delivery, and
 * retry only moves a row back into the state that job already knows how to claim.
 */

const DAY_MS = 86_400_000;
const STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;

const listSchema = z.object({
  booking_id: z.uuid().optional(),
  /** Comma-separated (C-06), e.g. `status=PENDING,FAILED`. */
  status: z.string().max(100).optional(),
  template_key: z.string().max(100).optional(),
  recipient: z.string().max(254).optional(),
  from: bangkokDateParam.optional(),
  to: bangkokDateParam.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});

type EmailRow = {
  id: string;
  booking_id: string | null;
  template_key: string;
  recipient_email: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  sent_at: Date | null;
  created_at: Date;
};

export function createAdminNotificationsRouter(
  dependencies: AuthDependencies & { kickOutbox?: (() => void) | undefined },
) {
  const pool = dependencies.db.$client;
  const router = new Hono();
  const requireAdmin = createRequireAdmin(dependencies);

  router.get('/emails', requireAdmin, async (context) => {
    const parsed = listSchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid notifications query', {
        details: parsed.error.issues,
      });
    }
    const query = parsed.data;

    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions: string[] = [];
    if (query.booking_id !== undefined) {
      conditions.push(`n.booking_id = ${bind(query.booking_id)}::uuid`);
    }
    if (query.status !== undefined) {
      const wanted = query.status
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '');
      for (const status of wanted) {
        if (!(STATUSES as readonly string[]).includes(status)) {
          throw new AppError('VALIDATION_FAILED', `Unknown status: ${status}`);
        }
      }
      if (wanted.length > 0) {
        conditions.push(`n.status = ANY(${bind(wanted)}::text[])`);
      }
    }
    if (query.template_key !== undefined) {
      conditions.push(`n.template_key = ${bind(query.template_key)}`);
    }
    if (query.recipient !== undefined) {
      // citext column, so this is already case-insensitive.
      conditions.push(`n.recipient_email = ${bind(query.recipient)}`);
    }
    // Bangkok days (§C-05); `to` is inclusive.
    if (query.from !== undefined) {
      conditions.push(
        `n.created_at >= ${bind(bangkokDateStart(query.from).toISOString())}::timestamptz`,
      );
    }
    if (query.to !== undefined) {
      const toEnd = new Date(bangkokDateStart(query.to).getTime() + DAY_MS);
      conditions.push(`n.created_at < ${bind(toEnd.toISOString())}::timestamptz`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Capped exactly like GET /admin/audit-logs: `status=FAILED` has no index behind it, so a
    // bare count(*) is a second full pass over a table that keeps 12 months of rows.
    const total = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM (SELECT 1 FROM notifications n ${where} LIMIT ${TOTAL_CAP + 1}) capped`,
      params,
    );
    const counted = total.rows[0]?.count ?? 0;
    const rows = await pool.query<EmailRow>(
      `SELECT n.id::text AS id, n.booking_id, n.template_key, n.recipient_email::text
                AS recipient_email, n.status, n.attempts, n.last_error, n.next_attempt_at,
              n.sent_at, n.created_at
         FROM notifications n
         ${where}
        ORDER BY n.id DESC
        LIMIT ${bind(query.page_size)} OFFSET ${bind((query.page - 1) * query.page_size)}`,
      params,
    );

    return context.json({
      data: rows.rows.map((row) => ({
        id: Number(row.id),
        template_key: row.template_key,
        booking_id: row.booking_id,
        recipient_email: row.recipient_email,
        status: row.status,
        attempts: row.attempts,
        last_error: row.last_error,
        next_attempt_at: toBangkokIso(row.next_attempt_at),
        sent_at: toBangkokIso(row.sent_at),
        created_at: toBangkokIso(row.created_at),
      })),
      page: {
        page: query.page,
        page_size: query.page_size,
        total: Math.min(counted, TOTAL_CAP),
        ...(counted > TOTAL_CAP ? { total_is_capped: true } : {}),
      },
    });
  });

  router.post('/emails/:id/retry', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const raw = context.req.param('id');
    // bigint identity, not a uuid — anything else is simply not a row we have. 18 digits, not
    // 19: a 19-digit id can overflow bigint, and Postgres answers 22003 (a 500) where the
    // caller should just get the 404 every other unknown id gets.
    if (raw === undefined || !/^\d{1,18}$/.test(raw)) {
      throw new AppError('NOT_FOUND', 'Notification not found');
    }

    await withTx(pool, async (tx) => {
      const current = await tx.query<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM notifications WHERE id = $1 FOR UPDATE',
        [raw],
      );
      const row = current.rows[0];
      if (row === undefined) {
        throw new AppError('NOT_FOUND', 'Notification not found');
      }
      if (row.status !== 'FAILED') {
        throw new AppError('INVALID_STATUS_TRANSITION', 'Only a failed email can be retried', {
          details: { status: row.status, action: 'RETRY' },
        });
      }
      // Back to exactly what the drain contract claims: PENDING with attempts reset, due now,
      // so it is picked up by the next round rather than by the 8-attempt backoff schedule it
      // dead-lettered on.
      await tx.query(
        `UPDATE notifications
            SET status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error = NULL
          WHERE id = $1`,
        [raw],
      );
      await insertAudit(tx, {
        actorId: actor.id,
        action: 'notification.retry',
        entityType: 'notification',
        entityId: raw,
        before: { status: 'FAILED', attempts: row.attempts },
        after: { status: 'PENDING', attempts: 0 },
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
    });
    dependencies.kickOutbox?.(); // the retry tx committed with the row due now

    return context.json({ queued: 1 }, 202);
  });

  return router;
}
