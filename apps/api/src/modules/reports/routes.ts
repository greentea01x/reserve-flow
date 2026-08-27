import { Hono } from 'hono';
import { z } from 'zod';

import { type AuthDependencies, createRequireAdmin } from '../../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { bangkokDateParam } from '../../lib/time.js';

/**
 * Read-only oversight (FR-012). No audit rows, no notifications, one query per endpoint —
 * 3 rooms × ~30 bookings/day read straight off `bookings_room_start_idx`, no materialized
 * view (05 §5.9).
 *
 * DOCUMENTED INTENDED LIMITATION (C1-30): the utilization divisor is built from the CURRENT
 * business_hours / holidays / rooms.created_at — there is no effective-dated history. Editing
 * business hours retroactively changes last month's number. The report page says so
 * ("คำนวณด้วยเวลาทำการปัจจุบัน"); a pinned figure is what the 1.1 CSV export is for.
 * ponytail: no capacity-facts table; add one when business hours change more than yearly.
 */

const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 366;

/** Every report takes the same window: Bangkok dates, inclusive, at most 366 days. */
const rangeSchema = z
  .object({
    from: bangkokDateParam,
    to: bangkokDateParam,
    room_id: z.uuid().optional(),
    group_by: z.enum(['room', 'month']).default('room'),
  })
  .superRefine((query, context) => {
    if (query.to < query.from) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'must not be before `from`' });
      return;
    }
    const span =
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / DAY_MS + 1;
    if (span > MAX_SPAN_DAYS) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: `range must span at most ${MAX_SPAN_DAYS} days`,
      });
    }
  });

/** Bangkok-local half-open [from 00:00, to+1 00:00) over start_at — index-friendly. */
const IN_RANGE = `b.start_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
   AND b.start_at <  ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
   AND ($3::uuid IS NULL OR b.room_id = $3::uuid)`;

/**
 * 05 §5.9 verbatim, plus the period column that `group_by` switches on. The two clips are
 * load-bearing: LEAST(close, now()) keeps a mid-month figure from being divided by time that
 * has not happened, GREATEST(open, rooms.created_at) + `windows_nonempty` keep a room created
 * on the 16th from getting the 1st–31st divisor (C2-09) — see `bounds` for why the range is
 * built from clamped bounds rather than by filtering afterwards.
 */
function utilizationSql(byMonth: boolean): string {
  const windowPeriod = byMonth ? "to_char(d.day, 'YYYY-MM')" : 'NULL::text';
  const bookingPeriod = byMonth
    ? "to_char(b.start_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')"
    : 'NULL::text';
  // group_by=room lists every room in scope, even one with no data in the window; month rows
  // exist only where there is a divisor or an outcome to show.
  const keys = byMonth
    ? 'SELECT room_id, period FROM avail UNION SELECT room_id, period FROM outcomes'
    : `SELECT r.id AS room_id, NULL::text AS period FROM rooms r
         WHERE ($3::uuid IS NULL OR r.id = $3::uuid)`;

  return `
    WITH days AS (
      SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d
       WHERE NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = d::date)
    ), room_hours AS (
      SELECT r.id AS room_id, r.created_at AS room_created_at,
             bh.weekday, bh.is_open, bh.open_time, bh.close_time
        FROM rooms r CROSS JOIN business_hours bh
       WHERE ($3::uuid IS NULL OR r.id = $3::uuid)
    ), bounds AS (
      SELECT rh.room_id, ${windowPeriod} AS period,
             GREATEST((d.day + rh.open_time) AT TIME ZONE 'Asia/Bangkok',
                      rh.room_created_at) AS lo,
             LEAST((d.day + rh.close_time) AT TIME ZONE 'Asia/Bangkok', now()) AS hi
        FROM days d
        JOIN room_hours rh ON rh.weekday = extract(isodow FROM d.day)::int AND rh.is_open
    ), windows_nonempty AS (
      -- The two clips cross on every day the room did not exist for (and on days not open
      -- yet), and tstzrange() RAISES on lower > upper instead of returning an empty range —
      -- a room created mid-month used to 500 the whole report. GREATEST keeps the
      -- constructor total whatever order the planner evaluates it in; the hi > lo predicate
      -- is what drops the day from the divisor (C2-09).
      SELECT room_id, period, tstzrange(lo, GREATEST(lo, hi), '[)') AS win
        FROM bounds
       WHERE hi > lo
    ), avail AS (
      SELECT room_id, period, sum(extract(epoch FROM upper(win) - lower(win))) / 3600 AS hours
        FROM windows_nonempty GROUP BY room_id, period
    ), used AS (
      SELECT w.room_id, w.period,
             sum(extract(epoch FROM upper(b.slot * w.win) - lower(b.slot * w.win))) / 3600
               AS hours
        FROM bookings b
        JOIN windows_nonempty w ON w.room_id = b.room_id AND b.slot && w.win
       WHERE b.status IN ('COMPLETED','CHECKED_IN')
       GROUP BY w.room_id, w.period
    ), outcomes AS (
      SELECT b.room_id, ${bookingPeriod} AS period,
             (count(*) FILTER (WHERE b.status = 'COMPLETED'))::int     AS completed,
             (count(*) FILTER (WHERE b.status = 'CANCELLED'))::int     AS cancelled,
             (count(*) FILTER (WHERE b.status = 'AUTO_RELEASED'))::int AS auto_released,
             sum(extract(epoch FROM b.end_at - b.start_at))
               FILTER (WHERE b.status IN ('CONFIRMED','CHECKED_IN','COMPLETED')) / 3600
               AS booked_hours
        FROM bookings b
       WHERE ${IN_RANGE}
       GROUP BY b.room_id, ${bookingPeriod}
    ), keys AS (${keys})
    SELECT r.id AS room_id, r.code AS room_code, r.name AS room_name, k.period,
           round(coalesce(a.hours, 0)::numeric, 1)::float8                    AS available_hours,
           round(coalesce(u.hours, 0)::numeric, 1)::float8                    AS used_hours,
           round(coalesce(o.booked_hours, 0)::numeric, 1)::float8             AS booked_hours,
           round(100 * coalesce(u.hours, 0)::numeric / nullif(a.hours, 0), 1)::float8
             AS utilization_pct,
           coalesce(o.completed, 0)      AS completed,
           coalesce(o.cancelled, 0)      AS cancelled,
           coalesce(o.auto_released, 0)  AS auto_released,
           round(100.0 * o.auto_released / nullif(o.completed + o.auto_released, 0), 1)::float8
             AS no_show_pct
      FROM keys k
      JOIN rooms r ON r.id = k.room_id
      LEFT JOIN avail a    ON a.room_id = k.room_id AND a.period IS NOT DISTINCT FROM k.period
      LEFT JOIN used u     ON u.room_id = k.room_id AND u.period IS NOT DISTINCT FROM k.period
      LEFT JOIN outcomes o ON o.room_id = k.room_id AND o.period IS NOT DISTINCT FROM k.period
     ORDER BY coalesce(k.period, ''), utilization_pct DESC NULLS LAST, r.name`;
}

type UtilizationRow = {
  room_id: string;
  room_code: string;
  room_name: string;
  period: string | null;
  available_hours: number;
  used_hours: number;
  booked_hours: number;
  utilization_pct: number | null;
  completed: number;
  cancelled: number;
  auto_released: number;
  no_show_pct: number | null;
};

const OUTCOMES_SQL = `
  SELECT (b.start_at AT TIME ZONE 'Asia/Bangkok')::date::text AS date,
         count(*)::int                                             AS created,
         (count(*) FILTER (WHERE b.status = 'COMPLETED'))::int      AS completed,
         (count(*) FILTER (WHERE b.status = 'CANCELLED'
                             AND b.reason_code = 'OWNER_CANCELLED'))::int AS cancelled_by_owner,
         -- OWNER_DISABLED is the deactivate cascade: an admin action, folded in here.
         (count(*) FILTER (WHERE b.status = 'CANCELLED'
                             AND b.reason_code IN ('ADMIN_CANCELLED','OWNER_DISABLED')))::int
           AS cancelled_by_admin,
         (count(*) FILTER (WHERE b.status = 'AUTO_RELEASED'))::int  AS auto_released
    FROM bookings b
   WHERE ${IN_RANGE}
   GROUP BY 1 ORDER BY 1`;

type OutcomeDay = {
  date: string;
  created: number;
  completed: number;
  cancelled_by_owner: number;
  cancelled_by_admin: number;
  auto_released: number;
};

/**
 * §5.9's heatmap SQL counts; the response also wants hours. PROPOSED: used_hours is the
 * booking's WHOLE duration charged to its start hour — it matches the grouping key, needs one
 * sum(), and the UI renders a plain <table>. A 10:00–12:00 meeting is 2 h in the 10:00 cell,
 * not 1 h in each of two cells.
 */
const HEATMAP_SQL = `
  SELECT extract(isodow FROM b.start_at AT TIME ZONE 'Asia/Bangkok')::int AS weekday,
         extract(hour   FROM b.start_at AT TIME ZONE 'Asia/Bangkok')::int AS hour,
         count(*)::int AS bookings,
         round((sum(extract(epoch FROM b.end_at - b.start_at)) / 3600)::numeric, 1)::float8
           AS used_hours
    FROM bookings b
   WHERE b.status IN ('COMPLETED','CHECKED_IN') AND ${IN_RANGE}
   GROUP BY 1, 2 ORDER BY 1, 2`;

type HeatmapCell = { weekday: number; hour: number; bookings: number; used_hours: number };

export function createReportsRouter(dependencies: AuthDependencies) {
  const pool = dependencies.db.$client;
  const router = new Hono();
  const requireAdmin = createRequireAdmin(dependencies);

  /** from/to/room_id are the same three binds ($1,$2,$3) in all three queries. */
  function range(context: { req: { query: () => Record<string, string> } }) {
    const parsed = rangeSchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid report range', {
        details: parsed.error.issues,
      });
    }
    const query = parsed.data;
    return { query, params: [query.from, query.to, query.room_id ?? null] };
  }

  router.get('/utilization', requireAdmin, async (context) => {
    const { query, params } = range(context);
    const result = await pool.query<UtilizationRow>(
      utilizationSql(query.group_by === 'month'),
      params,
    );

    return context.json({
      from: query.from,
      to: query.to,
      group_by: query.group_by,
      rows: result.rows.map((row) => ({
        key: row.period === null ? row.room_id : `${row.room_id}:${row.period}`,
        room: { id: row.room_id, code: row.room_code, name: row.room_name },
        period: row.period,
        available_hours: row.available_hours,
        used_hours: row.used_hours,
        // Secondary figure: the FULL duration of everything holding the room in the window,
        // future CONFIRMED included — deliberately not clipped to business hours, so it is
        // never comparable to used_hours.
        booked_hours: row.booked_hours,
        utilization_pct: row.utilization_pct,
        completed: row.completed,
        cancelled: row.cancelled,
        auto_released: row.auto_released,
        no_show_pct: row.no_show_pct,
      })),
    });
  });

  router.get('/outcomes', requireAdmin, async (context) => {
    const { query, params } = range(context);
    const result = await pool.query<OutcomeDay>(OUTCOMES_SQL, params);

    const totals = {
      created: 0,
      completed: 0,
      cancelled_by_owner: 0,
      cancelled_by_admin: 0,
      auto_released: 0,
    };
    for (const day of result.rows) {
      totals.created += day.created;
      totals.completed += day.completed;
      totals.cancelled_by_owner += day.cancelled_by_owner;
      totals.cancelled_by_admin += day.cancelled_by_admin;
      totals.auto_released += day.auto_released;
    }
    const noShowDenominator = totals.completed + totals.auto_released;

    return context.json({
      from: query.from,
      to: query.to,
      totals,
      no_show_pct:
        noShowDenominator === 0
          ? null
          : Math.round((1000 * totals.auto_released) / noShowDenominator) / 10,
      by_day: result.rows,
    });
  });

  router.get('/heatmap', requireAdmin, async (context) => {
    const { query, params } = range(context);
    const result = await pool.query<HeatmapCell>(HEATMAP_SQL, params);
    return context.json({ from: query.from, to: query.to, cells: result.rows });
  });

  return router;
}
