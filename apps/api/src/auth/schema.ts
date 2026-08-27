/**
 * Drizzle schema for the tables better-auth owns (T-008 spike output).
 *
 * The Drizzle *property keys* must equal the physical column names: the drizzle
 * adapter resolves a better-auth field to `schemaTable[fieldName]`, where
 * `fieldName` is what we declare in `user.fields` / `additionalFields` below.
 * So `full_name`, not `fullName`.
 *
 * `departments` is declared here only because `users.department_id` references
 * it. T-009 owns the real master-data schema and should move it.
 */

import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  customType,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: citext('code').notNull().unique(),
  name: text('name').notNull(),
  created_at: tstz('created_at').notNull().defaultNow(),
  updated_at: tstz('updated_at').notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    // better-auth core
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    full_name: text('full_name').notNull(),
    email: citext('email').notNull().unique(),
    email_verified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    created_at: tstz('created_at').notNull().defaultNow(),
    updated_at: tstz('updated_at').notNull().defaultNow(),
    // better-auth admin plugin
    role: text('role').notNull().default('EMPLOYEE'),
    banned: boolean('banned').notNull().default(false),
    ban_reason: text('ban_reason'),
    ban_expires: tstz('ban_expires'),
    // ours (user.additionalFields)
    employee_code: citext('employee_code').notNull().unique(),
    department_id: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    job_title: text('job_title').notNull().default('พนักงาน'),
    mobile: text('mobile'),
    status: text('status').notNull().default('INVITED'),
    failed_logins: smallint('failed_logins').notNull().default(0),
    locked_until: tstz('locked_until'),
    last_login_at: tstz('last_login_at'),
    disabled_at: tstz('disabled_at'),
    created_by: uuid('created_by').references((): AnyPgColumn => users.id),
  },
  (t) => [
    check('users_role_check', sql`${t.role} IN ('EMPLOYEE','ADMIN','FACILITY')`),
    check('users_job_title_length', sql`length(${t.job_title}) BETWEEN 1 AND 100`),
    check('users_status_check', sql`${t.status} IN ('INVITED','ACTIVE','DISABLED')`),
    check(
      'users_disabled_consistent',
      sql`(${t.status} = 'DISABLED') = (${t.disabled_at} IS NOT NULL)`,
    ),
    check('users_banned_mirror', sql`${t.banned} = (${t.status} = 'DISABLED')`),
    index('users_department_idx').on(t.department_id),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expires_at: tstz('expires_at').notNull(),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    impersonated_by: uuid('impersonated_by'),
    created_at: tstz('created_at').notNull().defaultNow(),
    updated_at: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.user_id), index('sessions_expires_idx').on(t.expires_at)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SPEC DELTA (§6.2): better-auth 1.7 added a required `issuer` column plus a
    // UNIQUE (issuer, account_id). The spec's `accounts` DDL has neither.
    issuer: text('issuer').notNull(),
    account_id: text('account_id').notNull(),
    provider_id: text('provider_id').notNull(),
    password: text('password'),
    access_token: text('access_token'),
    refresh_token: text('refresh_token'),
    id_token: text('id_token'),
    access_token_expires_at: tstz('access_token_expires_at'),
    refresh_token_expires_at: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    created_at: tstz('created_at').notNull().defaultNow(),
    updated_at: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('accounts_user_idx').on(t.user_id)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expires_at: tstz('expires_at').notNull(),
    created_at: tstz('created_at').notNull().defaultNow(),
    updated_at: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/** Ours, not better-auth's (D-29 / C2-06). */
export const password_setup_tokens = pgTable(
  'password_setup_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token_hash: text('token_hash').notNull().unique(),
    purpose: text('purpose').notNull(),
    expires_at: tstz('expires_at').notNull(),
    used_at: tstz('used_at'),
    created_by: uuid('created_by').references(() => users.id),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [check('pst_purpose_check', sql`${t.purpose} IN ('INVITE','RESET','FORGOT')`)],
);

export const authSchema = { users, sessions, accounts, verifications };
