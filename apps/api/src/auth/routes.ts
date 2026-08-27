import { createHash } from 'node:crypto';

import { createLocalAccountIssuer } from 'better-auth/db';
import { eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { schema } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { clientIp, parseBody, readJson } from '../lib/http.js';
import { createRateLimiter } from '../lib/rate-limit.js';
import { toBangkokIso } from '../lib/time.js';
import { withTx } from '../lib/tx.js';
import { hashPassword, verifyPassword } from './index.js';
import { type Actor, type AuthDependencies, createRequireAuth } from './middleware.js';

const { auditLogs, departments, users } = schema;

/** Lockout is 5 failures per 15 minutes (§09); better-auth counts nothing for us. */
const LOCKOUT_LIMIT = 5;
const LOCKOUT_MINUTES = 15;

export const signInSchema = z.strictObject({
  employee_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,20}$/),
  password: z.string().min(1).max(128),
  remember_me: z.boolean().optional(),
});

/** §6.3.1. `minPasswordLength` in the better-auth config is the same 10. */
const setPasswordSchema = z.strictObject({
  token: z.string().min(1).max(200),
  new_password: z.string().min(10).max(128),
});

// Burned when the identifier resolves to nothing, so unknown employee codes cost the
// same as a wrong password (§10.6 S-04).
let dummyHash: string | undefined;
async function burnDummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword('reserveflow-dummy-password');
  await verifyPassword({ hash: dummyHash, password });
}

/** Sign-in and /me share this shape; better-auth objects never pass through (spike §2). */
function serializeUser(user: Actor) {
  return {
    id: user.id,
    employee_code: user.employeeCode,
    full_name: user.fullName,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    department_id: user.departmentId,
    last_login_at: toBangkokIso(user.lastLoginAt),
  };
}

function serializeDepartment(department: typeof schema.departments.$inferSelect) {
  return { id: department.id, code: department.code, name: department.name };
}

export function createAuthRouter(dependencies: AuthDependencies & { demoToolsEnabled?: boolean }) {
  const { auth, db } = dependencies;
  const router = new Hono();
  const requireAuth = createRequireAuth(dependencies);
  // Sign-in is 5/min per IP+employee code — the only control against per-account
  // lockout DoS (5 wrong passwords locks anyone) and slow password spraying.
  const signInRateLimit = createRateLimiter(5);
  // The per-code bucket above is defeated by varying the employee code — every fresh string
  // gets a fresh bucket, and each attempt costs one argon2id burn plus one row in an append-only
  // table nothing can delete. This second bucket is checked only once a code fails to resolve,
  // so a real user typing their own code never sees it.
  const unknownIdentifierRateLimit = createRateLimiter(20);

  const auditLogin = (
    context: Context,
    entry: {
      action: 'auth.login' | 'auth.login_failed';
      actorId: string | null;
      entityType: 'user' | 'auth';
      entityId: string;
    },
  ) =>
    db.insert(auditLogs).values({
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });

  router.post('/auth/sign-in', async (context) => {
    let raw: unknown;
    try {
      raw = await context.req.json();
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Request body must be JSON');
    }
    const parsed = signInSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid sign-in request', {
        details: parsed.error.issues,
      });
    }
    const { employee_code: employeeCode, password } = parsed.data;
    signInRateLimit(`${clientIp(context) ?? 'local'}:${employeeCode.toLowerCase()}`);

    // Employee code is the only public sign-in identity. Email remains an internal Better Auth
    // credential key after this lookup; mobile remains profile/contact data.
    const [match] = await db
      .select({ user: users, department: departments })
      .from(users)
      .innerJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(users.employeeCode, employeeCode))
      .limit(1);

    if (match === undefined) {
      unknownIdentifierRateLimit(clientIp(context) ?? 'local');
      await burnDummyVerify(password);
      await auditLogin(context, {
        action: 'auth.login_failed',
        actorId: null,
        entityType: 'auth',
        // Never the submitted employee code: an anonymous caller must not choose what enters a
        // table the app cannot delete and the admin audit screen renders verbatim.
        entityId: 'unknown',
      });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const user = match.user;
    if (user.status === 'DISABLED') {
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (user.lockedUntil !== null) {
      if (user.lockedUntil.getTime() > Date.now()) {
        throw new AppError('ACCOUNT_LOCKED', 'Account is temporarily locked', {
          details: { locked_until: toBangkokIso(user.lockedUntil) },
        });
      }
      // Expired lock: the failure window restarts.
      await db
        .update(users)
        .set({ failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
    }

    const authResponse = await auth.api.signInEmail({
      body: { email: user.email, password, rememberMe: parsed.data.remember_me ?? true },
      headers: context.req.raw.headers,
      asResponse: true,
    });

    if (authResponse.status === 401) {
      await db
        .update(users)
        .set({
          failedLogins: sql`${users.failedLogins} + 1`,
          lockedUntil: sql`CASE WHEN ${users.failedLogins} + 1 >= ${LOCKOUT_LIMIT}
            THEN now() + make_interval(mins => ${LOCKOUT_MINUTES})
            ELSE ${users.lockedUntil} END`,
        })
        .where(eq(users.id, user.id));
      await auditLogin(context, {
        action: 'auth.login_failed',
        actorId: null,
        entityType: 'user',
        entityId: user.id,
      });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid credentials');
    }
    if (authResponse.status === 403) {
      // BANNED_USER backstop; the status pre-read above normally answers first (spike §6c).
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (!authResponse.ok) {
      throw new AppError('INTERNAL', 'Sign-in failed');
    }

    const lastLoginAt = new Date();
    await db
      .update(users)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt })
      .where(eq(users.id, user.id));
    await auditLogin(context, {
      action: 'auth.login',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
    });

    for (const cookie of authResponse.headers.getSetCookie()) {
      context.header('set-cookie', cookie, { append: true });
    }
    return context.json({
      user: serializeUser({ ...user, lastLoginAt }),
      department: serializeDepartment(match.department),
      capabilities: { demo_check_in: dependencies.demoToolsEnabled === true },
    });
  });

  /**
   * The other end of every account.set_password mail (invite and admin reset alike). Without
   * it a created user has a `users` row and no `accounts` row, so nothing can ever sign in.
   *
   * One transaction, and the claim goes FIRST: the single guarded UPDATE is what makes the
   * token single-use — a read-then-write is a race. Hashing then happens inside the tx even
   * though it costs ~100 ms, so a garbage token is refused before it can burn an argon2id.
   * ponytail: no audit row — `password_setup_tokens.used_at` already records the redemption,
   * and an audit row would make its own actor undeletable (USER_HAS_HISTORY).
   */
  router.post('/auth/set-password', async (context) => {
    const body = parseBody(setPasswordSchema, await readJson(context));
    const tokenHash = createHash('sha256').update(body.token).digest('hex');

    await withTx(db.$client, async (tx) => {
      const claim = await tx.query<{ user_id: string }>(
        `UPDATE password_setup_tokens SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [tokenHash],
      );
      const userId = claim.rows[0]?.user_id;
      if (userId === undefined) {
        throw new AppError('TOKEN_EXPIRED', 'This link is no longer valid');
      }

      // A DISABLED account must not walk back in through an old link; the rollback also
      // un-claims the token.
      const user = await tx.query<{ status: string }>(
        'SELECT status FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (user.rows[0]?.status === 'DISABLED') {
        throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
      }

      const password = await hashPassword(body.new_password);
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM accounts WHERE user_id = $1 AND provider_id = 'credential' FOR UPDATE`,
        [userId],
      );
      const accountId = existing.rows[0]?.id;
      if (accountId === undefined) {
        // account_id is users.id as text for credential rows; it needs its own placeholder
        // because Postgres deduces one type per parameter (42P08 otherwise).
        await tx.query(
          `INSERT INTO accounts (user_id, issuer, account_id, provider_id, password)
           VALUES ($1::uuid, $2, $3, 'credential', $4)`,
          [userId, createLocalAccountIssuer('credential'), userId, password],
        );
      } else {
        await tx.query('UPDATE accounts SET password = $2, updated_at = now() WHERE id = $1', [
          accountId,
          password,
        ]);
      }

      // C1-20: email_verified becomes true on redeem, not when the admin created the row.
      await tx.query(
        `UPDATE users SET status = 'ACTIVE', email_verified = true, failed_logins = 0,
                locked_until = NULL, updated_at = now()
          WHERE id = $1`,
        [userId],
      );
      // Setting a password ends every other session (U-06): the old one may be the attacker's.
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    });

    return context.body(null, 204);
  });

  router.get('/me', requireAuth, async (context) => {
    const actor = context.get('actor');
    const [department] = await db
      .select()
      .from(departments)
      .where(eq(departments.id, actor.departmentId))
      .limit(1);
    if (department === undefined) {
      throw new AppError('INTERNAL', 'Department missing for user');
    }

    return context.json({
      user: serializeUser(actor),
      department: serializeDepartment(department),
      capabilities: { demo_check_in: dependencies.demoToolsEnabled === true },
      session: { expires_at: toBangkokIso(context.get('sessionExpiresAt')) },
    });
  });

  return router;
}
