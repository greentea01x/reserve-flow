import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { bytea, rowTimestamps, timestamptz } from './columns.js';

/** `0002_master_data.sql` — the tables an admin edits and everything else reads. */

export const rooms = pgTable(
  'rooms',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    /** 'horizon'. Appears in URLs and on the printed door QR (/check-in/:roomCode). */
    code: text().notNull().unique(),
    name: text().notNull(),
    floor: text(),
    location: text(),
    description: text(),
    capacity: integer().notNull(),
    /**
     * ponytail: the image itself, webp, served straight from the row. Three rooms under 1MB
     * total does not justify an object store or a writable volume — swap to a storage key if
     * this ever holds more than a handful of rooms.
     */
    photo: bytea(),
    /** Soft delete. Bookings reference rooms with ON DELETE RESTRICT, so rows never leave. */
    active: boolean().notNull().default(true),
    ...rowTimestamps,
  },
  (t) => [
    check('rooms_code_format', sql`${t.code} ~ '^[a-z0-9-]{2,32}$'`),
    check('rooms_name_length', sql`length(${t.name}) BETWEEN 1 AND 80`),
    check('rooms_description_length', sql`length(${t.description}) <= 1000`),
    check('rooms_capacity_range', sql`${t.capacity} BETWEEN 1 AND 500`),
  ],
);

export const features = pgTable(
  'features',
  {
    /** 'projector' */
    key: text().primaryKey(),
    name: text().notNull(),
    /** lucide icon name */
    icon: text(),
  },
  (t) => [check('features_key_format', sql`${t.key} ~ '^[a-z_]{2,32}$'`)],
);

export const roomFeatures = pgTable(
  'room_features',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    featureKey: text('feature_key')
      .notNull()
      .references(() => features.key, { onDelete: 'restrict' }),
    quantity: integer().notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.featureKey] }),
    check('room_features_quantity_positive', sql`${t.quantity} >= 1`),
  ],
);

/**
 * Company opening hours: 7 rows, shared by every room. No per-room override (D-02) — if one
 * is ever needed, add a nullable room_id plus `UNIQUE NULLS NOT DISTINCT` in one migration.
 */
export const businessHours = pgTable(
  'business_hours',
  {
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: smallint().primaryKey(),
    isOpen: boolean('is_open').notNull(),
    openTime: time('open_time'),
    closeTime: time('close_time'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('business_hours_weekday_range', sql`${t.weekday} BETWEEN 1 AND 7`),
    check(
      'business_hours_valid',
      sql`NOT ${t.isOpen} OR (${t.openTime} IS NOT NULL AND ${t.closeTime} IS NOT NULL AND ${t.openTime} < ${t.closeTime})`,
    ),
  ],
);

export const holidays = pgTable('holidays', {
  day: date().primaryKey(),
  name: text().notNull(),
});

/**
 * One row per policy key (§5.10). `SettingsSchema` in packages/shared validates the whole set
 * on write *and* on read, including cross-key rules; the API caches it for 60 seconds.
 */
export const settings = pgTable(
  'settings',
  {
    key: text().primaryKey(),
    value: jsonb().notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('settings_key_format', sql`${t.key} ~ '^[a-z_]{3,48}$'`)],
);
