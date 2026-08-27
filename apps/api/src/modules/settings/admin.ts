import { Hono } from 'hono';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { type AuthDependencies, createRequireAdmin } from '../../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { clientIp, parseBody, readJson } from '../../lib/http.js';
import {
  type BusinessHour,
  invalidateSettings,
  readSettingsDocument,
  SETTINGS_KEYS,
  SettingsSchema,
  settingsEtag,
} from '../../lib/settings.js';
import { toBangkokIso } from '../../lib/time.js';
import { insertAudit, withTx } from '../../lib/tx.js';

/**
 * The three admin-editable master-data documents. All of them are whole-document PUTs — there
 * is no per-key patch — and all three take one advisory lock so a 7-row or 20-row write can
 * never interleave with another admin's.
 *
 * RETROACTIVITY, once, for all three (§5.5, D-26/BR-11): a committed booking is NEVER
 * re-validated. Window keys (increment/min/max/advance/lead/buffer) are read only by
 * validateWindow at create and reschedule. Closing a weekday or declaring a holiday shuts the
 * day for NEW requests; the meetings already booked on it stay CONFIRMED and keep working,
 * check-in included. Only the operational keys (check-in window, grace, auto-release,
 * reminder) move live deadlines, because the sweep and the check-in handler read them fresh.
 */

const SETTINGS_LOCK = "SELECT pg_advisory_xact_lock(hashtext('settings'))";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const businessHoursSchema = z
  .array(
    z.strictObject({
      weekday: z.number().int().min(1).max(7),
      is_open: z.boolean(),
      open_time: z.string().regex(HHMM).nullable().optional(),
      close_time: z.string().regex(HHMM).nullable().optional(),
    }),
  )
  .length(7)
  .superRefine((rows, context) => {
    if (new Set(rows.map((row) => row.weekday)).size !== 7) {
      context.addIssue({ code: 'custom', message: 'each weekday 1-7 must appear exactly once' });
    }
    for (const [index, row] of rows.entries()) {
      if (!row.is_open) {
        continue;
      }
      if (row.open_time == null || row.close_time == null) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: 'an open day needs both open_time and close_time',
        });
        continue;
      }
      if (normalizeTime(row.open_time) >= normalizeTime(row.close_time)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: 'open_time must precede close_time',
        });
      }
    }
  });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Wire format is Gregorian ISO only (C1-34) — the UI converts พ.ศ. itself. */
const holidaysSchema = z
  .strictObject({
    year: z.number().int().min(2000).max(2100),
    holidays: z
      .array(
        z.strictObject({
          date: z.string().regex(ISO_DATE),
          name: z.string().min(1).max(120),
        }),
      )
      .max(60),
  })
  .superRefine((body, context) => {
    const seen = new Set<string>();
    for (const [index, holiday] of body.holidays.entries()) {
      if (!holiday.date.startsWith(`${body.year}-`)) {
        context.addIssue({
          code: 'custom',
          path: ['holidays', index, 'date'],
          message: `must fall in ${body.year}`,
        });
      }
      // '2026-02-30' passes the regex and reaches Postgres as a 22008. Date.parse does not
      // reject it either (V8 rolls it into March), so compare the round trip.
      const parsed = new Date(`${holiday.date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== holiday.date) {
        context.addIssue({
          code: 'custom',
          path: ['holidays', index, 'date'],
          message: 'is not a real date',
        });
      }
      if (seen.has(holiday.date)) {
        context.addIssue({
          code: 'custom',
          path: ['holidays', index, 'date'],
          message: 'is listed twice',
        });
      }
      seen.add(holiday.date);
    }
  });

/** The DB column is `time`, which renders as HH:MM:SS — compare and store in that shape. */
function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

export function createAdminSettingsRouter(dependencies: AuthDependencies) {
  const { db } = dependencies;
  const pool = db.$client;
  const router = new Hono();
  const requireAdmin = createRequireAdmin(dependencies);

  router.put('/settings', requireAdmin, async (context) => {
    const actor = context.get('actor');
    // §5.2: the If-Match is what stops A's stale form from silently reverting the grace
    // window B just shortened on live meetings. No header, no write.
    const ifMatch = context.req.header('if-match')?.trim();
    if (ifMatch === undefined || ifMatch === '') {
      throw new AppError(
        'VALIDATION_FAILED',
        'If-Match with the current settings ETag is required',
      );
    }
    const body = parseBody(SettingsSchema, await readJson(context));

    const document = await withTx(pool, async (tx) => {
      await tx.query(SETTINGS_LOCK);
      const before = await readSettingsDocument(tx);
      if (settingsEtag(before) !== ifMatch) {
        throw new AppError('VERSION_CONFLICT', 'Settings changed since they were loaded', {
          details: { etag: settingsEtag(before) },
        });
      }

      for (const key of SETTINGS_KEYS) {
        // max_duration_minutes: null is stored as JSON null, never SQL NULL — loadSettings
        // reads settings.value straight into number | null.
        await tx.query(
          `INSERT INTO settings (key, value, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                  updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          [key, JSON.stringify(body[key]), actor.id],
        );
      }

      const after = await readSettingsDocument(tx);
      await insertAudit(tx, {
        actorId: actor.id,
        action: 'settings.update',
        entityType: 'settings',
        entityId: 'settings',
        before: before.settings,
        after: after.settings,
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
      return after;
    });

    invalidateSettings(db);
    context.header('ETag', settingsEtag(document));
    return context.json({ ...document, server_time: toBangkokIso(new Date()) });
  });

  router.put('/business-hours', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const body = parseBody(businessHoursSchema, await readJson(context));

    const rows = await withTx(pool, async (tx) => {
      await tx.query(SETTINGS_LOCK);
      const before = await readCurrentHours(tx);

      const written: BusinessHour[] = [];
      for (const row of [...body].sort((a, b) => a.weekday - b.weekday)) {
        const open = row.is_open ? normalizeTime(row.open_time as string) : null;
        const close = row.is_open ? normalizeTime(row.close_time as string) : null;
        const result = await tx.query<BusinessHour>(
          `INSERT INTO business_hours (weekday, is_open, open_time, close_time, updated_by, updated_at)
           VALUES ($1, $2, $3::time, $4::time, $5, now())
           ON CONFLICT (weekday) DO UPDATE SET is_open = excluded.is_open,
                  open_time = excluded.open_time, close_time = excluded.close_time,
                  updated_by = excluded.updated_by, updated_at = excluded.updated_at
           RETURNING weekday, is_open, open_time::text AS open_time, close_time::text AS close_time`,
          [row.weekday, row.is_open, open, close, actor.id],
        );
        written.push(result.rows[0] as BusinessHour);
      }

      await insertAudit(tx, {
        actorId: actor.id,
        action: 'settings.business_hours_update',
        entityType: 'settings',
        entityId: 'business_hours',
        before,
        after: written,
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
      return written;
    });

    return context.json(rows);
  });

  router.put('/holidays', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const body = parseBody(holidaysSchema, await readJson(context));
    const bounds = [`${body.year}-01-01`, `${body.year}-12-31`];

    const holidays = await withTx(pool, async (tx) => {
      await tx.query(SETTINGS_LOCK);
      const before = await readYearHolidays(tx, bounds);

      // Replace the whole year and nothing else: 2027 is a separate document.
      await tx.query('DELETE FROM holidays WHERE day BETWEEN $1 AND $2', bounds);
      for (const holiday of [...body.holidays].sort((a, b) => a.date.localeCompare(b.date))) {
        await tx.query('INSERT INTO holidays (day, name) VALUES ($1::date, $2)', [
          holiday.date,
          holiday.name,
        ]);
      }
      const after = await readYearHolidays(tx, bounds);

      await insertAudit(tx, {
        actorId: actor.id,
        action: 'settings.holidays_update',
        entityType: 'settings',
        entityId: `holidays:${body.year}`,
        before: { year: body.year, count: before.length },
        after: { year: body.year, count: after.length },
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
      return after;
    });

    return context.json({ holidays });
  });

  return router;
}

async function readCurrentHours(tx: PoolClient): Promise<BusinessHour[]> {
  const result = await tx.query<BusinessHour>(
    `SELECT weekday, is_open, open_time::text AS open_time, close_time::text AS close_time
       FROM business_hours ORDER BY weekday`,
  );
  return result.rows;
}

async function readYearHolidays(
  tx: PoolClient,
  bounds: string[],
): Promise<{ date: string; name: string }[]> {
  const result = await tx.query<{ date: string; name: string }>(
    'SELECT day::text AS date, name FROM holidays WHERE day BETWEEN $1 AND $2 ORDER BY day',
    bounds,
  );
  return result.rows;
}
