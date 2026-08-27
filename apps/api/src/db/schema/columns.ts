import { customType, timestamp } from 'drizzle-orm/pg-core';

/**
 * Types Postgres has and Drizzle does not (§5.11).
 *
 * Both live in the `extensions` schema on Supabase, which is why bootstrap.sql sets
 * `search_path = public, extensions` on rf_app — without it these type names do not
 * resolve at query time (trap T7).
 */

/** Case-insensitive text. Used for every identifier a human types: emails, employee codes. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/**
 * `tstzrange` — half-open `[start, end)` so 13:00–14:00 and 14:00–15:00 do not collide.
 * Only ever written by the generated `bookings.slot` column, so the TS side is read-only text.
 */
export const tstzrange = customType<{ data: string }>({
  dataType: () => 'tstzrange',
});

/** Raw bytes. Room photos live in the row (3 rooms, <1MB) — there is no object store. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Every timestamp in this schema is `timestamptz`. The server runs UTC and all day/hour
 * arithmetic goes through `AT TIME ZONE 'Asia/Bangkok'` at the query, never at the column.
 */
export const timestamptz = (name?: string) =>
  name ? timestamp(name, { withTimezone: true }) : timestamp({ withTimezone: true });

/** `created_at`/`updated_at` pair carried by every table that has a set_updated_at() trigger. */
export const rowTimestamps = {
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
};
