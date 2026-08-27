import { createHash } from 'node:crypto';

import { POLICY_DEFAULTS } from '@reserveflow/shared';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { type Db, schema } from '../db/index.js';
import { bangkokParts } from './time.js';

/** The §5.10 policy keys, snake_case exactly as stored in `settings.key`. */
export type Settings = {
  slot_increment_minutes: number;
  min_duration_minutes: number;
  max_duration_minutes: number | null;
  buffer_minutes: number;
  max_advance_days: number;
  min_lead_minutes: number;
  checkin_open_before_minutes: number;
  checkin_grace_minutes: number;
  auto_release_enabled: boolean;
  reminder_minutes_before: number;
};

const DEFAULTS: Settings = {
  slot_increment_minutes: POLICY_DEFAULTS.slotIncrementMinutes,
  min_duration_minutes: POLICY_DEFAULTS.minDurationMinutes,
  max_duration_minutes: POLICY_DEFAULTS.maxDurationMinutes,
  buffer_minutes: POLICY_DEFAULTS.bufferMinutes,
  max_advance_days: POLICY_DEFAULTS.maxAdvanceDays,
  // ponytail: minLeadMinutes is still missing from shared POLICY_DEFAULTS. Moving it there
  // means editing packages/shared AND its exact-match contracts test for a value nothing
  // outside this file reads — do it when the SPA needs the same default.
  min_lead_minutes: 0,
  checkin_open_before_minutes: POLICY_DEFAULTS.checkInOpensMinutesBefore,
  checkin_grace_minutes: POLICY_DEFAULTS.checkInGraceMinutes,
  auto_release_enabled: POLICY_DEFAULTS.autoReleaseEnabled,
  reminder_minutes_before: POLICY_DEFAULTS.reminderMinutesBefore,
};

/** Key order here is the serialisation order of every settings payload, ETag included. */
export const SETTINGS_KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

/**
 * §5.10 write validation. Ranges are per-key; the multiples are cross-key and therefore run
 * in a superRefine, where slot_increment_minutes is already known.
 *
 * checkin_grace_minutes is deliberately NOT tied to min_duration_minutes (C2-03): the real
 * deadline is LEAST(end_at, start_at + grace), so a grace longer than the meeting is
 * harmless rather than invalid.
 */
export const SettingsSchema = z
  .strictObject({
    slot_increment_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    min_duration_minutes: z.number().int().min(1).max(720),
    max_duration_minutes: z.number().int().min(1).max(720).nullable(),
    buffer_minutes: z.number().int().min(0).max(720),
    max_advance_days: z.number().int().min(1).max(365),
    min_lead_minutes: z.number().int().min(0).max(1440),
    checkin_open_before_minutes: z.number().int().min(0).max(120),
    checkin_grace_minutes: z.number().int().min(1).max(120),
    auto_release_enabled: z.boolean(),
    reminder_minutes_before: z.number().int().min(0).max(1440),
  })
  .superRefine((value, context) => {
    const step = value.slot_increment_minutes;
    if (value.min_duration_minutes < step || value.min_duration_minutes % step !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['min_duration_minutes'],
        message: `must be a multiple of slot_increment_minutes (${step}) and at least one increment`,
      });
    }
    if (
      value.max_duration_minutes !== null &&
      (value.max_duration_minutes % step !== 0 ||
        value.max_duration_minutes < value.min_duration_minutes)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['max_duration_minutes'],
        message: `must be a multiple of ${step} and at least min_duration_minutes`,
      });
    }
    // §5.10: "0 หรือ multiple ของ increment". The business default is 0 (BR-02), but the knob
    // is real — occupancyRange() widens both the availability grid and the create/reschedule
    // probe by it, so a non-zero value produces the gap it promises.
    if (value.buffer_minutes % step !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['buffer_minutes'],
        message: `must be 0 or a multiple of slot_increment_minutes (${step})`,
      });
    }
  });

export type BusinessHour = {
  weekday: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
};

/** Exactly what GET /settings serves, minus server_time — see readSettingsDocument. */
export type SettingsDocument = {
  settings: Settings;
  business_hours: BusinessHour[];
  holidays: { date: string; name: string }[];
};

/** Pool and PoolClient both satisfy this. */
type Queryable = Pick<PoolClient, 'query'>;

function overlay(rows: readonly { key: string; value: unknown }[]): Settings {
  const value: Settings = { ...DEFAULTS };
  for (const row of rows) {
    if (Object.hasOwn(value, row.key)) {
      (value as Record<string, unknown>)[row.key] = row.value;
    }
  }
  return value;
}

const CACHE_MS = 60_000;
const cache = new WeakMap<Db, { at: number; value: Settings }>();

/**
 * DB rows overlaid on the shared defaults, cached 60 s (§5.10). Operational keys
 * (check-in window, grace, auto-release, reminder) are read through here on every sweep round
 * and every check-in, so a committed change moves live deadlines within the cache window —
 * which is exactly why PUT /admin/settings is If-Match guarded. Window keys are read only by
 * validateWindow at create/reschedule: committed bookings are never re-validated.
 */
export async function loadSettings(db: Db): Promise<Settings> {
  const hit = cache.get(db);
  if (hit !== undefined && Date.now() - hit.at < CACHE_MS) {
    return hit.value;
  }

  const rows = await db.select().from(schema.settings);
  const value = overlay(rows);

  cache.set(db, { at: Date.now(), value });
  return value;
}

/** Called right after a settings write commits, or the change is invisible for up to 60 s
 * in this process — including to the next GET /settings, whose stale ETag would then 409 the
 * admin's own follow-up save. */
export function invalidateSettings(db: Db): void {
  cache.delete(db);
}

/**
 * The §8 document, read straight from the database. ONE reader for both GET /settings and the
 * If-Match check inside PUT /admin/settings, so the two ETags can never disagree over key
 * order or a date's rendering. Dates and times are cast to text because the pg driver hands
 * back a Date for `date` columns while drizzle hands back a string.
 */
export async function readSettingsDocument(client: Queryable): Promise<SettingsDocument> {
  const year = Number(bangkokParts(new Date()).date.slice(0, 4));
  const settingsRows = await client.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM settings',
  );
  const hours = await client.query<BusinessHour>(
    `SELECT weekday, is_open, open_time::text AS open_time, close_time::text AS close_time
       FROM business_hours ORDER BY weekday`,
  );
  const holidays = await client.query<{ date: string; name: string }>(
    'SELECT day::text AS date, name FROM holidays WHERE day BETWEEN $1 AND $2 ORDER BY day',
    [`${year}-01-01`, `${year + 1}-12-31`],
  );

  return {
    settings: overlay(settingsRows.rows),
    business_hours: hours.rows,
    holidays: holidays.rows,
  };
}

/**
 * Covers settings + business_hours + holidays together, not settings alone: a pending save
 * that would silently revert somebody else's holiday edit is the same C2-08 bug as one that
 * reverts a policy key.
 */
export function settingsEtag(document: SettingsDocument): string {
  return `"${createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 16)}"`;
}
