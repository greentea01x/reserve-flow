import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth/index.js';
import { authSchema } from '../src/auth/schema.js';
import { createDb } from '../src/db/index.js';
import { createLogger } from '../src/lib/logger.js';

type JsonBody = {
  user: Record<string, unknown>;
  department: Record<string, unknown>;
  capabilities: { demo_check_in: boolean };
  session: { expires_at: string };
};

const ownerUrl = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:5174';
const jsonHeaders = { origin: ORIGIN, 'content-type': 'application/json' };

function build(connectionString: string) {
  const db = createDb(connectionString);
  const auth = createAuth({
    db: drizzle(db.$client, { schema: authSchema }),
    secret: 'x'.repeat(32),
    baseURL: 'http://localhost:3000',
    // What the server passes in dev: the SPA origins Vite proxies from. Without it
    // better-auth trusts baseURL alone and 403s sign-out from the admin origin.
    trustedOrigins: [ORIGIN],
  });
  const app = createApp({
    publicBaseUrl: 'http://localhost:3000',
    additionalAllowedOrigins: [ORIGIN],
    logger: createLogger('silent'),
    db,
    auth,
    checkDatabase: async () => {},
  });
  return { app, db, auth };
}

describe('auth surface (no database)', () => {
  const { app } = build('postgresql://unused:unused@127.0.0.1:9/unused');

  it('404s every better-auth route outside the allowlist', async () => {
    for (const path of [
      '/api/auth/sign-in/email',
      '/api/auth/forget-password',
      '/api/auth/admin/ban-user',
      '/api/auth/admin/create-user',
    ]) {
      const response = await app.request(path, {
        method: 'POST',
        headers: jsonHeaders,
        body: '{}',
      });
      expect(response.status, path).toBe(404);
    }
  });

  it('401s /me without a session cookie', async () => {
    const response = await app.request('/api/v1/me');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe.skipIf(!ownerUrl)('auth routes (database)', () => {
  const email = 'auth-route-test@example.com';
  const employeeCode = 'AUTH-001';
  const password = 'auth-test-password-1';
  let harness: ReturnType<typeof build>;
  let userId: string;
  let cookie: string;

  const signIn = (body: unknown) =>
    harness.app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    harness = build(ownerUrl as string);
    const pool = harness.db.$client;
    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('AUTHDEPT','Auth Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    // Users survive across runs (their audit rows block deletion); create only when absent.
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount === 0) {
      await harness.auth.api.createUser({
        body: {
          email,
          password,
          name: 'Auth Route Test',
          role: 'EMPLOYEE',
          data: {
            employee_code: employeeCode,
            department_id: department.rows[0].id,
            status: 'ACTIVE',
          },
        },
      });
    }
    const user = await pool.query(
      `UPDATE users SET status='ACTIVE', banned=false, disabled_at=NULL,
              failed_logins=0, locked_until=NULL
       WHERE email=$1 RETURNING id`,
      [email],
    );
    userId = user.rows[0].id;
  }, 30_000);

  afterAll(async () => {
    await harness.db.$client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await harness.db.$client.end();
  });

  it('signs in with an employee code (case-insensitive) and sets __Host-sid', async () => {
    const response = await signIn({ employee_code: 'auth-001', password, remember_me: true });

    expect(response.status).toBe(200);
    const sessionCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-sid='));
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/Max-Age=604800/);
    cookie = (sessionCookie as string).split(';')[0] as string;

    const body = (await response.json()) as JsonBody;
    expect(body.user).toMatchObject({
      id: userId,
      email,
      employee_code: employeeCode,
      full_name: 'Auth Route Test',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
    });
    expect(body.user.last_login_at).toMatch(/\+07:00$/);
    expect(body.department).toMatchObject({ code: 'AUTHDEPT', name: 'Auth Test' });
    expect(body.capabilities).toEqual({ demo_check_in: false });
  });

  it('round-trips /me with the session cookie', async () => {
    const response = await harness.app.request('/api/v1/me', { headers: { cookie } });

    expect(response.status).toBe(200);
    const body = (await response.json()) as JsonBody;
    expect(body.user).toMatchObject({ id: userId, email, employee_code: employeeCode });
    expect(body.department).toMatchObject({ code: 'AUTHDEPT', name: 'Auth Test' });
    expect(body.capabilities).toEqual({ demo_check_in: false });
    expect(body.session.expires_at).toMatch(/\+07:00$/);
  });

  it('accepts only employee_code as the sign-in identity field', async () => {
    const emailResponse = await signIn({ employee_code: email, password });
    const legacyResponse = await signIn({ identifier: employeeCode, password });
    const mobileResponse = await signIn({
      employee_code: employeeCode,
      mobile: '0812345678',
      password,
    });

    expect(emailResponse.status).toBe(400);
    expect(legacyResponse.status).toBe(400);
    expect(mobileResponse.status).toBe(400);
    await expect(emailResponse.json()).resolves.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(legacyResponse.json()).resolves.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(mobileResponse.json()).resolves.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('401s a wrong password and counts the failure', async () => {
    const response = await signIn({
      employee_code: employeeCode,
      password: 'wrong-password-x',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const row = await harness.db.$client.query('SELECT failed_logins FROM users WHERE id = $1', [
      userId,
    ]);
    expect(row.rows[0].failed_logins).toBe(1);
  });

  it('401s an unknown employee code with the same generic error', async () => {
    const response = await signIn({
      employee_code: 'NO-SUCH-USER',
      password: 'whatever-pass',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('423s a locked account even with the correct password', async () => {
    await harness.db.$client.query(
      `UPDATE users SET failed_logins=5, locked_until=now() + interval '15 minutes' WHERE id=$1`,
      [userId],
    );

    const response = await signIn({ employee_code: employeeCode, password });

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    await harness.db.$client.query(
      'UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1',
      [userId],
    );
  });

  it('403s a disabled user on /me even with a live session', async () => {
    await harness.db.$client.query(
      `UPDATE users SET status='DISABLED', banned=true, disabled_at=now() WHERE id=$1`,
      [userId],
    );

    const me = await harness.app.request('/api/v1/me', { headers: { cookie } });
    expect(me.status).toBe(403);
    await expect(me.json()).resolves.toMatchObject({ code: 'ACCOUNT_DISABLED' });

    const signInResponse = await signIn({ employee_code: employeeCode, password });
    expect(signInResponse.status).toBe(403);
    await expect(signInResponse.json()).resolves.toMatchObject({ code: 'ACCOUNT_DISABLED' });

    await harness.db.$client.query(
      `UPDATE users SET status='ACTIVE', banned=false, disabled_at=NULL WHERE id=$1`,
      [userId],
    );
  });

  it('signs out from a trusted SPA origin, and only from a trusted one', async () => {
    const signOut = (app: ReturnType<typeof build>['app']) =>
      app.request('/api/auth/sign-out', {
        method: 'POST',
        headers: { ...jsonHeaders, cookie },
        body: '{}',
      });

    // Same app, same origin, better-auth built WITHOUT the extra origin: still 403. Trust is
    // exactly the configured list, never widened by turning the check off.
    const untrusting = createApp({
      publicBaseUrl: 'http://localhost:3000',
      additionalAllowedOrigins: [ORIGIN],
      logger: createLogger('silent'),
      db: harness.db,
      auth: createAuth({
        db: drizzle(harness.db.$client, { schema: authSchema }),
        secret: 'x'.repeat(32),
        baseURL: 'http://localhost:3000',
      }),
      checkDatabase: async () => {},
    });
    const refused = await signOut(untrusting);
    expect(refused.status).toBe(403);

    const response = await signOut(harness.app);
    expect(response.status).toBe(200);
    // The session is really gone, not just the cookie cleared client-side.
    const me = await harness.app.request('/api/v1/me', { headers: { cookie } });
    expect(me.status).toBe(401);
  });
});
