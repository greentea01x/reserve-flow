import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, rowTimestamps, timestamptz } from './columns.js';

/**
 * `0001_departments_auth.sql`.
 *
 * `users`, `sessions`, `accounts` and `verifications` are better-auth's tables. Their column
 * names are load-bearing: the adapter SELECTs them by the names given in the field map in
 * `src/auth/index.ts`, so a column removed here fails at sign-in with `42703`, not at build.
 * Do not drop a column because it looks unused — the OAuth columns on `accounts` are unused
 * in the MVP and still mandatory.
 */

export const departments = pgTable(
  'departments',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    code: text().notNull().unique(),
    name: text().notNull(),
    active: boolean().notNull().default(true),
    ...rowTimestamps,
  },
  (t) => [
    check('departments_code_format', sql`${t.code} ~ '^[A-Z0-9_]{2,16}$'`),
    check('departments_name_length', sql`length(${t.name}) BETWEEN 1 AND 100`),
  ],
);

export const users = pgTable(
  'users',
  {
    // better-auth core (user.modelName='users'; user.fields.name='full_name')
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    fullName: text('full_name').notNull(),
    email: citext().notNull().unique(),
    /** true only once the invite link is redeemed — not when an admin creates the row (C1-20). */
    emailVerified: boolean('email_verified').notNull().default(false),
    /** Unused; better-auth requires it to exist. */
    image: text(),
    ...rowTimestamps,

    // better-auth admin plugin (defaultRole 'EMPLOYEE', adminRoles ['ADMIN'])
    role: text().notNull().default('EMPLOYEE'),
    /**
     * Mirror of `status = 'DISABLED'`, kept honest by `users_banned_mirror`. Never write it
     * on its own: the single writer is POST /admin/users/:id/deactivate, which sets both in
     * one UPDATE. This is why the plugin's banUser/unbanUser routes are not exposed — they
     * write `banned` without touching `status` and fail with `23514`.
     */
    banned: boolean().notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: timestamptz('ban_expires'),

    // ours (user.additionalFields)
    /** The only public login identity; resolved to the internal email credential. */
    employeeCode: citext('employee_code').notNull().unique(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    /** Human job title; separate from the RBAC role above. */
    jobTitle: text('job_title').notNull().default('พนักงาน'),
    /** Contact and account recovery only — never a login factor. Redact in logs and audit. */
    mobile: text(),
    /** INVITED = created but has not set a password yet. */
    status: text().notNull().default('INVITED'),
    /** Lockout is 5 failures per 15 minutes (§09). */
    failedLogins: smallint('failed_logins').notNull().default(0),
    lockedUntil: timestamptz('locked_until'),
    lastLoginAt: timestamptz('last_login_at'),
    disabledAt: timestamptz('disabled_at'),
    /** The admin who created this user; NULL for seeded rows. */
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
  },
  (t) => [
    index('users_department_idx').on(t.departmentId),
    // "email every ADMIN" — the only query that filters on role.
    index('users_role_idx').on(t.role).where(sql`status = 'ACTIVE'`),
    check('users_full_name_length', sql`length(${t.fullName}) BETWEEN 1 AND 120`),
    check('users_email_format', sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check('users_role_valid', sql`${t.role} IN ('EMPLOYEE','ADMIN','FACILITY')`),
    check('users_employee_code_format', sql`${t.employeeCode} ~ '^[A-Za-z0-9-]{3,20}$'`),
    check('users_job_title_length', sql`length(${t.jobTitle}) BETWEEN 1 AND 100`),
    check('users_mobile_format', sql`${t.mobile} ~ '^0[0-9]{9}$'`),
    check('users_status_valid', sql`${t.status} IN ('INVITED','ACTIVE','DISABLED')`),
    check(
      'users_disabled_consistent',
      sql`(${t.status} = 'DISABLED') = (${t.disabledAt} IS NOT NULL)`,
    ),
    // Access state has exactly one value (C1-17). Removing this makes a "disabled" account
    // that is still usable, silently.
    check('users_banned_mirror', sql`${t.banned} = (${t.status} = 'DISABLED')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The value inside the `__Host-sid` cookie; better-auth owns it. */
    token: text().notNull().unique(),
    /** 7-day sliding window. */
    expiresAt: timestamptz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** admin plugin column; impersonation is not enabled. */
    impersonatedBy: uuid('impersonated_by'),
    ...rowTimestamps,
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    // Ours, not the library's: the daily purge scans on this.
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

/**
 * All 13 columns are mandatory — the adapter SELECTs every one of these names on each
 * sign-in. Dropping `issuer` or the six token columns fails with `42703` (proven twice on
 * PG 18.6, W0 S1/S2).
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'local:credential' for password rows. */
    issuer: text().notNull(),
    /** users.id for password rows. */
    accountId: text('account_id').notNull(),
    /** 'credential' = email/password. */
    providerId: text('provider_id').notNull(),
    /** argon2id, via emailAndPassword.password.hash/verify (@node-rs/argon2). */
    password: text(),
    // Six OAuth columns: unused in the MVP (SSO is Phase 2), never removable.
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamptz('access_token_expires_at'),
    refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
    scope: text(),
    ...rowTimestamps,
  },
  (t) => [
    // Declared by better-auth itself.
    uniqueIndex('accounts_issuer_account_id_idx').on(t.issuer, t.accountId),
    index('accounts_user_idx').on(t.userId),
  ],
);

/** better-auth internal. Not used for password setup (see passwordSetupTokens); purged daily. */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    ...rowTimestamps,
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/**
 * Password links are ours, not better-auth's (D-29 / C2-06): the TTL differs per purpose, and
 * the token id has to be available as `notifications.dedupe_key` inside the same transaction
 * that writes the outbox row.
 */
export const passwordSetupTokens = pgTable(
  'password_setup_tokens',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256(token). The 32-byte base64url token exists only in the email. */
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text().notNull(),
    /** Set by the app: INVITE = now()+7d, RESET/FORGOT = now()+24h. */
    expiresAt: timestamptz('expires_at').notNull(),
    /** Single use. Redeem is `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`. */
    usedAt: timestamptz('used_at'),
    /** The admin who sent it; NULL when the user asked for it via "forgot password". */
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('password_setup_tokens_user_idx').on(t.userId).where(sql`used_at IS NULL`),
    check('password_setup_tokens_purpose_valid', sql`${t.purpose} IN ('INVITE','RESET','FORGOT')`),
  ],
);
