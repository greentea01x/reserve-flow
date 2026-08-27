import { Hono } from 'hono';
import { z } from 'zod';

import { type AuthDependencies, createRequireAdmin } from '../../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { bangkokDateParam, bangkokDateStart, toBangkokIso } from '../../lib/time.js';

/**
 * The read side of the append-only trail every mutation already writes in its own transaction
 * (FR-015). There is no write endpoint here and there must never be one: `audit_logs` is
 * protected twice over — the UPDATE/DELETE trigger in 0000_functions.sql and
 * `REVOKE UPDATE, DELETE ON audit_logs FROM rf_app` in 0006_grants.sql. Purging is a quarterly
 * runbook run as the schema owner with `SET LOCAL rf.audit_purge = 'on'`.
 *
 * ADMIN only (404 for everyone else, C-15). Employees see their own booking's events through
 * `GET /bookings/:id` → `history`, which is derived from these same rows.
 */

const DAY_MS = 86_400_000;
/** Beyond this the exact row count stops being worth a full scan — see the list handler. */
/** Exported: the notifications list caps its total the same way, for the same reason. */
export const TOTAL_CAP = 10_000;

const listSchema = z.object({
  entity_type: z
    // 'notification' joins §6.3.10's list because POST /admin/notifications/emails/:id/retry
    // writes rows with it — a filter that cannot reach them would hide the trail.
    .enum(['booking', 'user', 'room', 'department', 'settings', 'auth', 'notification'])
    .optional(),
  entity_id: z.string().max(200).optional(),
  actor_id: z.uuid().optional(),
  action: z.string().max(100).optional(),
  from: bangkokDateParam.optional(),
  to: bangkokDateParam.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * S-12 belt: `before`/`after` are written already redacted, so this should never fire — but
 * the audit screen is the one place a leaked field would be shown verbatim to a human.
 */
const REDACTED = new Set(['mobile', 'password', 'password_hash']);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !REDACTED.has(key))
      .map(([key, nested]) => [key, redact(nested)]),
  );
}

type AuditRow = {
  id: string;
  created_at: Date;
  actor_id: string | null;
  actor_full_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  request_id: string | null;
};

export function createAuditRouter(dependencies: AuthDependencies) {
  const pool = dependencies.db.$client;
  const router = new Hono();
  const requireAdmin = createRequireAdmin(dependencies);

  router.get('/', requireAdmin, async (context) => {
    const parsed = listSchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid audit query', {
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
    if (query.entity_type !== undefined) {
      conditions.push(`l.entity_type = ${bind(query.entity_type)}`);
    }
    if (query.entity_id !== undefined) {
      conditions.push(`l.entity_id = ${bind(query.entity_id)}`);
    }
    if (query.actor_id !== undefined) {
      conditions.push(`l.actor_id = ${bind(query.actor_id)}::uuid`);
    }
    if (query.action !== undefined) {
      conditions.push(`l.action = ${bind(query.action)}`);
    }
    // Date params are Bangkok days (§6.1); `to` is inclusive.
    if (query.from !== undefined) {
      conditions.push(
        `l.created_at >= ${bind(bangkokDateStart(query.from).toISOString())}::timestamptz`,
      );
    }
    if (query.to !== undefined) {
      const toEnd = new Date(bangkokDateStart(query.to).getTime() + DAY_MS);
      conditions.push(`l.created_at < ${bind(toEnd.toISOString())}::timestamptz`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // A bare count(*) here scans the whole table, and this is the table that grows fastest
    // (a row per sign-in attempt). Stop counting at TOTAL_CAP: below it the number is exact,
    // at it the response says so with `total_is_capped` and the UI shows "10,000+". §C-06's
    // envelope keeps its three keys either way.
    const total = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM (SELECT 1 FROM audit_logs l ${where} LIMIT ${TOTAL_CAP + 1}) capped`,
      params,
    );
    const counted = total.rows[0]?.count ?? 0;
    const rows = await pool.query<AuditRow>(
      `SELECT l.id::text AS id, l.created_at, l.actor_id, u.full_name AS actor_full_name,
              l.action, l.entity_type, l.entity_id, l.before, l.after, l.reason,
              l.ip::text AS ip, l.request_id
         FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
         ${where}
        -- id is a monotonic identity column, so it is already created_at order — and unlike
        -- (created_at DESC, id DESC) the primary key index serves it, which matters on the
        -- unfiltered screen because auth.login/auth.login_failed grow this table fastest.
        ORDER BY l.id DESC
        LIMIT ${bind(query.page_size)} OFFSET ${bind((query.page - 1) * query.page_size)}`,
      params,
    );

    return context.json({
      data: rows.rows.map((row) => ({
        id: Number(row.id),
        created_at: toBangkokIso(row.created_at),
        actor: row.actor_id === null ? null : { id: row.actor_id, full_name: row.actor_full_name },
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        before: redact(row.before),
        after: redact(row.after),
        // Not in §6.3.10's field list, but the reason an admin typed is the entire point of
        // S-15 and this screen is where it belongs.
        reason: row.reason,
        ip: row.ip,
        request_id: row.request_id,
      })),
      page: {
        page: query.page,
        page_size: query.page_size,
        total: Math.min(counted, TOTAL_CAP),
        ...(counted > TOTAL_CAP ? { total_is_capped: true } : {}),
      },
    });
  });

  return router;
}
