/**
 * better-auth wiring for ReserveFlow (T-008 spike output).
 *
 * Decisions this file encodes (spec §5.3, §6.2, §6.11, §10.6 S-01/S-03):
 * - plural `modelName`s so better-auth uses our table names;
 * - snake_case `fields` so it uses our column names;
 * - `advanced.database.generateId: false` so Postgres' `gen_random_uuid()` wins;
 * - argon2id via `@node-rs/argon2`, replacing better-auth's scrypt default;
 * - session cookie named `__Host-sid`, HttpOnly + Secure + SameSite=Lax + Path=/.
 */
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import type { DB } from 'better-auth/adapters/drizzle';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { authSchema } from './schema.js';

/** OWASP-recommended argon2id parameters (spec §10.6 S-03: m=64 MiB, t=3, p=1). */
export const ARGON2_OPTIONS = {
  // `Algorithm.Argon2id`. The enum is an ambient `const enum`, which cannot be
  // imported under `isolatedModules`, so the literal is inlined.
  algorithm: 2,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

export const hashPassword = (password: string): Promise<string> =>
  argon2Hash(password, ARGON2_OPTIONS);

export const verifyPassword = ({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> => argon2Verify(hash, password, ARGON2_OPTIONS);

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type CreateAuthOptions = {
  /** Drizzle db instance holding at least `authSchema`. */
  db: DB;
  secret: string;
  baseURL: string;
  /**
   * `false` suppresses better-auth's automatic `__Secure-` prefix, which would
   * otherwise produce `__Secure-__Host-sid`. Secure is re-asserted explicitly
   * via `defaultCookieAttributes`.
   */
  useSecureCookies?: boolean;
  /**
   * Extra origins better-auth's own CSRF check accepts, on top of `baseURL` (which it always
   * trusts). Needed only where the browser origin is not the API origin: in dev Vite serves
   * the SPAs on :5173/:5174 and proxies /api here, so POST /api/auth/sign-out arrives with an
   * Origin better-auth would otherwise refuse. Same list our own CSRF wall gets; empty in
   * production, where there is one origin.
   */
  trustedOrigins?: readonly string[];
  /**
   * better-auth's own limiter only guards its HTTP handler (`/api/auth/*`),
   * which §07 C-13 404s. Off by default; the real limits live on our wrapper
   * routes. Kept as a knob so the spike can demonstrate the native behaviour.
   */
  enableBetterAuthRateLimit?: boolean;
};

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    appName: 'ReserveFlow',
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: [...(options.trustedOrigins ?? [])],
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: authSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    user: {
      modelName: 'users',
      fields: {
        name: 'full_name',
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        employee_code: { type: 'string', required: true, unique: true, input: true },
        department_id: { type: 'string', required: true, input: true },
        job_title: { type: 'string', required: false, defaultValue: 'พนักงาน', input: true },
        mobile: { type: 'string', required: false, input: true },
        status: { type: 'string', required: false, defaultValue: 'INVITED', input: true },
      },
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 24 * 60 * 60,
    },
    account: {
      modelName: 'accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verifications',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    advanced: {
      database: { generateId: false },
      // better-auth silently turns its origin/CSRF check OFF when NODE_ENV=test, which is
      // how a sign-out that 403s from the admin origin shipped with a green suite. Pin it
      // on so the tests run the same trust rules production does.
      disableOriginCheck: false,
      useSecureCookies: options.useSecureCookies ?? false,
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      cookies: { session_token: { name: '__Host-sid' } },
    },
    rateLimit: {
      enabled: options.enableBetterAuthRateLimit ?? false,
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    plugins: [
      admin({
        defaultRole: 'EMPLOYEE',
        adminRoles: ['ADMIN'],
        // `adminRoles` is validated case-insensitively but `hasPermission` looks
        // roles up by exact key, so uppercase role values need their own map or
        // every admin endpoint answers "You are not allowed to ...".
        roles: { ADMIN: adminAc, EMPLOYEE: userAc, FACILITY: userAc },
        // The admin plugin's own fields carry no `fieldName`, so without this
        // they resolve to the camelCase column names `banReason`/`banExpires`/
        // `impersonatedBy` and the drizzle adapter throws on ban/unban.
        schema: {
          user: { fields: { banReason: 'ban_reason', banExpires: 'ban_expires' } },
          session: { fields: { impersonatedBy: 'impersonated_by' } },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
