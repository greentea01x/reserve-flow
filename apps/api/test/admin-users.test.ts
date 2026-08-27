import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth/index.js';
import { authSchema } from '../src/auth/schema.js';
import { createDb } from '../src/db/index.js';
import { createLogger } from '../src/lib/logger.js';

const ownerUrl = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:5174';

function build(connectionString: string) {
  const db = createDb(connectionString);
  const auth = createAuth({
    db: drizzle(db.$client, { schema: authSchema }),
    secret: 'x'.repeat(32),
    baseURL: 'http://localhost:3000',
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

type AnyBody = Record<string, unknown>;

/** 15-minute grid (bookings_15min_grid) offsets from now. */
function grid(offsetMs: number): string {
  return new Date(Math.floor((Date.now() + offsetMs) / 900_000) * 900_000).toISOString();
}

const HOUR = 3_600_000;

describe.skipIf(!ownerUrl)('admin identity: users + departments (database)', () => {
  const password = 'au-test-password-1';
  /** Accounts this suite creates through the API; wiped before and after so it can rerun. */
  const disposableCodes = ['AU-NEW1', 'AU-DEL1', 'AU-IMP1', 'AU-IMP2', 'AU-RL1'];
  const disposableEmails = [
    'au-new@example.com',
    'au-del@example.com',
    'au-imp1@example.com',
    'au-imp2@example.com',
    'au-imp2b@example.com',
    'au-rl@example.com',
  ];
  let harness: ReturnType<typeof build>;
  let departmentId = '';
  let roomId = '';
  let adminId = '';
  let admin2Id = '';
  let employeeId = '';
  let adminCookie = '';
  let admin2Cookie = '';
  let employeeCookie = '';
  const userIds: string[] = [];
  const bookingIds = { future: '', checkedIn: '', running: '' };

  const request = async (
    path: string,
    init: { method?: string; cookie: string; body?: unknown },
  ): Promise<Response> =>
    harness.app.request(path, {
      method: init.method ?? 'GET',
      headers: { cookie: init.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  const json = async (response: Response): Promise<AnyBody> => (await response.json()) as AnyBody;

  const signIn = async (employeeCode: string) => {
    const response = await harness.app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ employee_code: employeeCode, password }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-sid='));
    return (cookie as string).split(';')[0] as string;
  };

  const wipeDisposable = async () => {
    const pool = harness.db.$client;
    await pool.query('DELETE FROM notifications WHERE recipient_email = ANY($1::citext[])', [
      disposableEmails,
    ]);
    // Redeeming an invite and then signing in leaves auth.login rows whose actor_id FK holds
    // the account down. audit_logs is append-only by trigger; `rf.audit_purge` is the
    // documented way through it (§09 runbook) and this suite connects as the schema owner.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL rf.audit_purge = 'on'");
      await client.query(
        `DELETE FROM audit_logs WHERE actor_id IN
           (SELECT id FROM users WHERE employee_code = ANY($1::citext[]))`,
        [disposableCodes],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.query('DELETE FROM users WHERE employee_code = ANY($1::citext[])', [
      disposableCodes,
    ]);
    await pool.query(`DELETE FROM departments WHERE code = 'AUTEMP'`);
  };

  beforeAll(async () => {
    harness = build(ownerUrl as string);
    const pool = harness.db.$client;

    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('AUDEPT','Admin Users Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name, active = true RETURNING id`,
    );
    departmentId = department.rows[0].id;

    for (const [email, employeeCode, fullName, role] of [
      ['au-admin@example.com', 'AU-001', 'AU Admin', 'ADMIN'],
      ['au-user@example.com', 'AU-002', 'AU Employee', 'EMPLOYEE'],
      ['au-admin2@example.com', 'AU-003', 'AU Admin Two', 'ADMIN'],
    ] as const) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rowCount === 0) {
        await harness.auth.api.createUser({
          body: {
            email,
            password,
            name: fullName,
            role,
            data: { employee_code: employeeCode, department_id: departmentId, status: 'ACTIVE' },
          },
        });
      }
      const user = await pool.query(
        `UPDATE users SET status='ACTIVE', banned=false, disabled_at=NULL, failed_logins=0,
                locked_until=NULL, role=$2, department_id=$3, full_name=$4
         WHERE email=$1 RETURNING id`,
        [email, role, departmentId, fullName],
      );
      userIds.push(user.rows[0].id);
    }
    adminId = userIds[0] as string;
    employeeId = userIds[1] as string;
    admin2Id = userIds[2] as string;

    const room = await pool.query(
      `INSERT INTO rooms (code, name, capacity) VALUES ('au-room','test: AU Room',6)
       ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`,
    );
    roomId = room.rows[0].id;

    await wipeDisposable();
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)`,
      [roomId],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = $1', [roomId]);

    // Three bookings owned by the employee: two in the future (one CONFIRMED, one already
    // CHECKED_IN) and one already under way. Only the first two may be cancelled (C2-11).
    // The running one is CHECKED_IN on purpose: a past-start CONFIRMED booking is exactly
    // what booking.sweep auto-releases, and a dev worker may be draining the same database.
    const insert = async (
      startAt: string,
      endAt: string,
      status: string,
      checkedIn: boolean,
    ): Promise<string> => {
      const row = await harness.db.$client.query(
        `INSERT INTO bookings (room_id, owner_id, created_by, title, start_at, end_at, status,
                               confirmed_at, checked_in_at, checked_in_by, checkin_method,
                               idempotency_key)
         VALUES ($1, $2, $2, $3, $4, $5, $6, now(),
                 CASE WHEN $7::boolean THEN now() END,
                 CASE WHEN $7::boolean THEN $2::uuid END,
                 CASE WHEN $7::boolean THEN 'SELF' END, gen_random_uuid())
         RETURNING id`,
        [roomId, employeeId, `test: au ${status}`, startAt, endAt, status, checkedIn],
      );
      return row.rows[0].id;
    };
    bookingIds.future = await insert(grid(24 * HOUR), grid(25 * HOUR), 'CONFIRMED', false);
    bookingIds.checkedIn = await insert(grid(26 * HOUR), grid(27 * HOUR), 'CHECKED_IN', true);
    bookingIds.running = await insert(grid(-HOUR), grid(HOUR), 'CHECKED_IN', true);
    await pool.query(
      `INSERT INTO booking_attendees (booking_id, email, name) VALUES ($1, $2, 'AU Guest')`,
      [bookingIds.future, 'au-guest@example.com'],
    );

    adminCookie = await signIn('AU-001');
    admin2Cookie = await signIn('AU-003');
    employeeCookie = await signIn('AU-002');
  }, 30_000);

  afterAll(async () => {
    const pool = harness.db.$client;
    await wipeDisposable();
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)`,
      [roomId],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = $1', [roomId]);
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query(
      `UPDATE users SET status='ACTIVE', banned=false, disabled_at=NULL WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    await pool.end();
  });

  let invitedId = '';

  // ------------------------------------------------------------------- RBAC

  it('hides every admin path from an employee: 404, never 403 (C-15)', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/admin/users'],
      ['GET', `/api/v1/admin/users/${employeeId}`],
      ['PATCH', `/api/v1/admin/users/${employeeId}`],
      ['POST', `/api/v1/admin/users/${employeeId}/deactivate`],
      ['DELETE', `/api/v1/admin/users/${employeeId}`],
      ['POST', '/api/v1/admin/departments'],
    ] as const) {
      const response = await request(path, {
        method,
        cookie: employeeCookie,
        ...(method === 'GET' || method === 'DELETE' ? {} : { body: {} }),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect((await json(response)).code).toBe('NOT_FOUND');
    }
  });

  // ----------------------------------------------------------------- invite

  it('creates an INVITED user with a 7-day token and one account.set_password outbox row', async () => {
    const response = await request('/api/v1/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        employee_code: 'AU-NEW1',
        full_name: 'AU Newcomer',
        email: 'au-new@example.com',
        mobile: '0812345678',
        department_id: departmentId,
      },
    });

    expect(response.status).toBe(201);
    const body = await json(response);
    invitedId = body.id as string;
    expect(response.headers.get('location')).toBe(`/api/v1/admin/users/${invitedId}`);
    expect(body).toMatchObject({
      employee_code: 'AU-NEW1',
      email: 'au-new@example.com',
      role: 'EMPLOYEE',
      status: 'INVITED',
      bookings_count: 0,
      department: { code: 'AUDEPT' },
    });

    const pool = harness.db.$client;
    const token = await pool.query(
      `SELECT id, purpose, used_at, expires_at > now() + interval '6 days' AS week
         FROM password_setup_tokens WHERE user_id = $1`,
      [invitedId],
    );
    expect(token.rowCount).toBe(1);
    expect(token.rows[0]).toMatchObject({ purpose: 'INVITE', used_at: null, week: true });

    const mail = await pool.query(
      `SELECT dedupe_key, status, payload FROM notifications
        WHERE recipient_email = 'au-new@example.com' AND template_key = 'account.set_password'`,
    );
    expect(mail.rowCount).toBe(1);
    expect(mail.rows[0].dedupe_key).toBe(token.rows[0].id);
    expect(mail.rows[0].payload.set_password_url).toMatch(
      /^http:\/\/localhost:3000\/set-password\?token=.{20,}$/,
    );

    // S-12: the mobile we just stored must not appear anywhere in the audit row.
    const audit = await pool.query(
      `SELECT after FROM audit_logs WHERE action = 'user.create' AND entity_id = $1`,
      [invitedId],
    );
    expect(JSON.stringify(audit.rows[0].after)).not.toContain('0812345678');
  });

  it('rejects a duplicate employee_code with 409 VALIDATION_FAILED on that field', async () => {
    const response = await request('/api/v1/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        employee_code: 'AU-NEW1',
        full_name: 'AU Clash',
        email: 'au-clash@example.com',
        department_id: departmentId,
      },
    });

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'employee_code' },
    });
  });

  it('resend-invite supersedes the pending mail and issues a brand new token (C1-05)', async () => {
    const pool = harness.db.$client;
    const before = await pool.query('SELECT id FROM password_setup_tokens WHERE user_id = $1', [
      invitedId,
    ]);

    const response = await request(`/api/v1/admin/users/${invitedId}/resend-invite`, {
      method: 'POST',
      cookie: adminCookie,
    });
    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({ queued: 1 });

    const tokens = await pool.query('SELECT id FROM password_setup_tokens WHERE user_id = $1', [
      invitedId,
    ]);
    expect(tokens.rowCount).toBe(1);
    expect(tokens.rows[0].id).not.toBe(before.rows[0].id);

    const mail = await pool.query(
      `SELECT dedupe_key, status FROM notifications
        WHERE recipient_email = 'au-new@example.com' ORDER BY id`,
    );
    expect(mail.rowCount).toBe(2);
    expect(mail.rows[0].status).toBe('SKIPPED');
    // Not SKIPPED — a drain running against this database may already have marked it SENT.
    expect(mail.rows[1].status).not.toBe('SKIPPED');
    expect(mail.rows[1].dedupe_key).toBe(tokens.rows[0].id);
  });

  // ------------------------------------------------------------ list/detail

  it('lists and searches users, and the detail view carries recent bookings', async () => {
    const list = await json(
      await request('/api/v1/admin/users?q=AU-NEW1&page_size=5', { cookie: adminCookie }),
    );
    expect(list.page).toMatchObject({ page: 1, page_size: 5, total: 1 });
    expect((list.data as AnyBody[])[0]).toMatchObject({ employee_code: 'AU-NEW1' });

    const filtered = await json(
      await request(`/api/v1/admin/users?status=INVITED&department_id=${departmentId}`, {
        cookie: adminCookie,
      }),
    );
    for (const row of filtered.data as AnyBody[]) {
      expect(row.status).toBe('INVITED');
    }

    const detail = await json(
      await request(`/api/v1/admin/users/${employeeId}`, { cookie: adminCookie }),
    );
    expect(detail).toMatchObject({ employee_code: 'AU-002', bookings_count: 3 });
    const recent = detail.recent_bookings as AnyBody[];
    expect(recent).toHaveLength(3);
    // 6.1.1: an ADMIN always sees FULL — there is no admin mask.
    expect(recent[0]).toMatchObject({ visibility: 'FULL' });
  });

  // ------------------------------------------------- self-modification (U-02)

  it('lets an admin edit their own profile but not their own role, status or existence', async () => {
    const renamed = await request(`/api/v1/admin/users/${adminId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { full_name: 'AU Admin' },
    });
    expect(renamed.status).toBe(200);

    for (const [method, path, body] of [
      ['PATCH', `/api/v1/admin/users/${adminId}`, { role: 'EMPLOYEE' }],
      ['POST', `/api/v1/admin/users/${adminId}/deactivate`, {}],
      ['DELETE', `/api/v1/admin/users/${adminId}`, undefined],
    ] as const) {
      const response = await request(path, { method, cookie: adminCookie, body });
      expect(response.status, path).toBe(409);
      expect((await json(response)).code).toBe('CANNOT_MODIFY_SELF');
    }
  });

  it('records a role change as user.role_change and leaves mobile out of the audit', async () => {
    const promoted = await request(`/api/v1/admin/users/${invitedId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'ADMIN', mobile: '0898765432' },
    });
    expect(promoted.status).toBe(200);
    expect(await json(promoted)).toMatchObject({ role: 'ADMIN', mobile: '0898765432' });

    const audit = await harness.db.$client.query(
      `SELECT action, before, after FROM audit_logs
        WHERE entity_id = $1 AND action = 'user.role_change'`,
      [invitedId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].before).toMatchObject({ role: 'EMPLOYEE' });
    expect(audit.rows[0].after).toMatchObject({ role: 'ADMIN' });
    expect(JSON.stringify(audit.rows[0])).not.toContain('0898765432');

    const demoted = await request(`/api/v1/admin/users/${invitedId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'EMPLOYEE' },
    });
    // An INVITED admin never counted towards LAST_ADMIN, so this always passes.
    expect(demoted.status).toBe(200);
  });

  // -------------------------------------------------------------- LAST_ADMIN

  it('serializes two admins demoting each other: exactly one wins (TC-USR-017, C1-11)', async () => {
    const pool = harness.db.$client;
    // The rule is global, so the barrier only shows with exactly two active admins in the
    // whole table. vitest runs test FILES sequentially (vitest.config.ts), so parking the
    // other suites' admins for the length of this test is safe; restored in the finally.
    const parked = await pool.query(
      `UPDATE users SET role = 'EMPLOYEE'
        WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> ALL($1::uuid[]) RETURNING id`,
      [[adminId, admin2Id]],
    );
    // Hold 'users:last-admin' from the test so BOTH requests get through requireAdmin (which
    // re-reads the role on every request) and then park on the advisory lock. Without this
    // gate the loser can be demoted before it authenticates and answer 404 instead of 409 —
    // still refused, but not the branch this test is about.
    const gate = await pool.connect();
    await gate.query('BEGIN');
    await gate.query("SELECT pg_advisory_xact_lock(hashtext('users:last-admin'))");
    try {
      const race = Promise.all([
        request(`/api/v1/admin/users/${admin2Id}`, {
          method: 'PATCH',
          cookie: adminCookie,
          body: { role: 'EMPLOYEE' },
        }),
        request(`/api/v1/admin/users/${adminId}`, {
          method: 'PATCH',
          cookie: admin2Cookie,
          body: { role: 'EMPLOYEE' },
        }),
      ]);
      for (let attempt = 0; attempt < 200; attempt++) {
        const waiting = await pool.query<{ c: number }>(
          "SELECT count(*)::int AS c FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
        );
        if ((waiting.rows[0]?.c ?? 0) >= 2) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await gate.query('ROLLBACK');
      const [first, second] = await race;

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect((await json(loser)).code).toBe('LAST_ADMIN');

      const remaining = await pool.query(
        "SELECT count(*)::int AS c FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'",
      );
      expect(remaining.rows[0].c).toBe(1);
    } finally {
      gate.release();
      await pool.query(`UPDATE users SET role = 'ADMIN' WHERE id = ANY($1::uuid[])`, [
        [adminId, admin2Id, ...parked.rows.map((row: { id: string }) => row.id)],
      ]);
    }
  });

  // --------------------------------------------------------------- deactivate

  it('deactivate cancels only the not-yet-started bookings and kills the session in-tx', async () => {
    const pool = harness.db.$client;
    const response = await request(`/api/v1/admin/users/${employeeId}/deactivate`, {
      method: 'POST',
      cookie: adminCookie,
      body: { reason: 'test: left the company' },
    });

    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.user).toMatchObject({ status: 'DISABLED' });
    const cancelled = body.cancelled_bookings as AnyBody[];
    expect(cancelled.map((entry) => entry.id).sort()).toEqual(
      [bookingIds.future, bookingIds.checkedIn].sort(),
    );
    expect(cancelled.map((entry) => entry.status_before).sort()).toEqual([
      'CHECKED_IN',
      'CONFIRMED',
    ]);
    expect((cancelled[0] as { room: AnyBody }).room).toMatchObject({ code: 'au-room' });

    const rows = await pool.query(
      'SELECT id, status, reason_code, cancelled_by FROM bookings WHERE room_id = $1',
      [roomId],
    );
    const byId = new Map(rows.rows.map((row: AnyBody) => [row.id, row]));
    for (const id of [bookingIds.future, bookingIds.checkedIn]) {
      expect(byId.get(id)).toMatchObject({
        status: 'CANCELLED',
        reason_code: 'OWNER_DISABLED',
        cancelled_by: adminId,
      });
    }
    // The meeting already under way is left alone; the admin can cancel it by hand.
    expect(byId.get(bookingIds.running)).toMatchObject({ status: 'CHECKED_IN' });

    // Owner AND attendees are notified (§2.6 admin-cancel row of the matrix).
    const mail = await pool.query(
      `SELECT DISTINCT recipient_email FROM notifications
        WHERE booking_id = ANY($1::uuid[]) AND template_key = 'booking.cancelled'
        ORDER BY recipient_email`,
      [[bookingIds.future, bookingIds.checkedIn]],
    );
    expect(mail.rows.map((row: AnyBody) => row.recipient_email)).toEqual([
      'au-guest@example.com',
      'au-user@example.com',
    ]);

    // Booking.history reads audit_logs, so each cancelled booking needs its own row.
    const history = await pool.query(
      `SELECT count(*)::int AS c FROM audit_logs
        WHERE entity_type = 'booking' AND action = 'booking.cancel' AND entity_id = ANY($1::text[])`,
      [[bookingIds.future, bookingIds.checkedIn]],
    );
    expect(history.rows[0].c).toBe(2);

    const sessions = await pool.query(
      'SELECT count(*)::int AS c FROM sessions WHERE user_id = $1',
      [employeeId],
    );
    expect(sessions.rows[0].c).toBe(0);
  });

  it('the deactivated session is dead and sign-in is refused', async () => {
    const me = await request('/api/v1/me', { cookie: employeeCookie });
    expect(me.status).toBe(401);
    expect((await json(me)).code).toBe('UNAUTHENTICATED');

    const signInResponse = await harness.app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ employee_code: 'AU-002', password }),
    });
    expect(signInResponse.status).toBe(403);
    expect((await json(signInResponse)).code).toBe('ACCOUNT_DISABLED');
  });

  it('repeating deactivate is a no-op with no new side effects (U-04)', async () => {
    const pool = harness.db.$client;
    const before = await pool.query(
      'SELECT count(*)::int AS c FROM notifications WHERE booking_id = ANY($1::uuid[])',
      [[bookingIds.future, bookingIds.checkedIn]],
    );

    const response = await request(`/api/v1/admin/users/${employeeId}/deactivate`, {
      method: 'POST',
      cookie: adminCookie,
      body: {},
    });
    expect(response.status).toBe(200);
    expect((await json(response)).cancelled_bookings).toEqual([]);

    const after = await pool.query(
      'SELECT count(*)::int AS c FROM notifications WHERE booking_id = ANY($1::uuid[])',
      [[bookingIds.future, bookingIds.checkedIn]],
    );
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it('lets an admin cancel by hand the in-progress meeting the cascade left alive', async () => {
    const pool = harness.db.$client;
    const owner = await pool.query('SELECT status FROM users WHERE id = $1', [employeeId]);
    expect(owner.rows[0].status).toBe('DISABLED');

    const reason = 'test: room needed for an incident call';
    const response = await request(`/api/v1/bookings/${bookingIds.running}/cancel`, {
      method: 'POST',
      cookie: adminCookie,
      body: { reason },
    });
    expect(response.status, await response.clone().text()).toBe(200);

    const row = await pool.query(
      'SELECT status, reason_code, reason, cancelled_by FROM bookings WHERE id = $1',
      [bookingIds.running],
    );
    expect(row.rows[0]).toMatchObject({
      status: 'CANCELLED',
      reason_code: 'ADMIN_CANCELLED',
      reason,
      cancelled_by: adminId,
    });

    // §2.6: an admin cancel notifies owner + attendees AND shows the reason they typed.
    const mail = await pool.query(
      `SELECT recipient_email, payload->>'reason' AS reason FROM notifications
        WHERE booking_id = $1 AND template_key = 'booking.cancelled'`,
      [bookingIds.running],
    );
    expect(mail.rows.map((entry: AnyBody) => entry.recipient_email)).toEqual([
      'au-user@example.com',
    ]);
    expect(mail.rows[0].reason).toBe(reason);
  });

  it('reactivate restores access without restoring the cancelled bookings (U-05)', async () => {
    const response = await request(`/api/v1/admin/users/${employeeId}/reactivate`, {
      method: 'POST',
      cookie: adminCookie,
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ status: 'ACTIVE', disabled_at: null });

    const still = await harness.db.$client.query('SELECT status FROM bookings WHERE id = $1', [
      bookingIds.future,
    ]);
    expect(still.rows[0].status).toBe('CANCELLED');

    const again = await request(`/api/v1/admin/users/${employeeId}/reactivate`, {
      method: 'POST',
      cookie: adminCookie,
    });
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('INVALID_STATUS_TRANSITION');

    employeeCookie = await signIn('AU-002');
    expect((await request('/api/v1/me', { cookie: employeeCookie })).status).toBe(200);
  });

  // ------------------------------------------------------------------ delete

  it('refuses to delete a user with history and deletes an unused account', async () => {
    const refused = await request(`/api/v1/admin/users/${employeeId}`, {
      method: 'DELETE',
      cookie: adminCookie,
    });
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({
      code: 'USER_HAS_HISTORY',
      details: { hint: 'deactivate' },
    });

    const created = await request('/api/v1/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        employee_code: 'AU-DEL1',
        full_name: 'AU Disposable',
        email: 'au-del@example.com',
        department_id: departmentId,
      },
    });
    expect(created.status).toBe(201);
    const disposableId = (await json(created)).id as string;

    const deleted = await request(`/api/v1/admin/users/${disposableId}`, {
      method: 'DELETE',
      cookie: adminCookie,
    });
    expect(deleted.status).toBe(204);

    const pool = harness.db.$client;
    const gone = await pool.query('SELECT 1 FROM users WHERE id = $1', [disposableId]);
    expect(gone.rowCount).toBe(0);
    // The token cascaded; the audit trail did not.
    const tokens = await pool.query('SELECT 1 FROM password_setup_tokens WHERE user_id = $1', [
      disposableId,
    ]);
    expect(tokens.rowCount).toBe(0);
    const audit = await pool.query(
      `SELECT 1 FROM audit_logs WHERE action = 'user.delete' AND entity_id = $1`,
      [disposableId],
    );
    expect(audit.rowCount).toBe(1);
  });

  // ------------------------------------------------------------- departments

  it('creates, closes and lists departments; closing never deletes', async () => {
    const code = 'AUTEMP';
    const created = await request('/api/v1/admin/departments', {
      method: 'POST',
      cookie: adminCookie,
      body: { code, name: 'test: AU Temp' },
    });
    expect(created.status).toBe(201);
    const department = await json(created);
    expect(department).toMatchObject({ code, name: 'test: AU Temp', active: true });

    const duplicate = await request('/api/v1/admin/departments', {
      method: 'POST',
      cookie: adminCookie,
      body: { code, name: 'test: AU Temp again' },
    });
    expect(duplicate.status).toBe(409);
    expect(await json(duplicate)).toMatchObject({ details: { field: 'code' } });

    const closed = await request(`/api/v1/admin/departments/${department.id as string}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { active: false },
    });
    expect(closed.status).toBe(200);
    expect(await json(closed)).toMatchObject({ code, active: false });

    const visible = await json(await request('/api/v1/departments', { cookie: employeeCookie }));
    expect((visible.data as AnyBody[]).some((row) => row.code === code)).toBe(false);
    expect((visible.data as AnyBody[]).some((row) => row.code === 'AUDEPT')).toBe(true);

    const all = await json(
      await request('/api/v1/departments?include_inactive=true', { cookie: adminCookie }),
    );
    expect((all.data as AnyBody[]).some((row) => row.code === code)).toBe(true);

    const forbidden = await request('/api/v1/departments?include_inactive=true', {
      cookie: employeeCookie,
    });
    expect(forbidden.status).toBe(403);
  });

  // ------------------------------------------------- adjacent reads + ids

  it('serves the staff directory to any signed-in user, ACTIVE accounts only', async () => {
    const directory = await request('/api/v1/directory/users?q=AU%20Employee', {
      cookie: employeeCookie,
    });
    expect(directory.status).toBe(200);
    const body = await json(directory);
    const rows = body.data as AnyBody[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Exactly the four public fields — no mobile, role, status or last_login_at.
    expect(Object.keys(rows[0] as AnyBody).sort()).toEqual([
      'department',
      'email',
      'full_name',
      'id',
    ]);
    expect(rows.some((row) => row.id === employeeId)).toBe(true);

    // INVITED accounts are not in the directory, and a 1-character search is refused.
    const invited = await json(
      await request('/api/v1/directory/users?q=AU-NEW1', { cookie: employeeCookie }),
    );
    expect(invited.data).toEqual([]);
    expect((await request('/api/v1/directory/users?q=A', { cookie: employeeCookie })).status).toBe(
      400,
    );
    expect((await harness.app.request('/api/v1/directory/users')).status).toBe(401);
  });

  it('treats an upper-case UUID path parameter as the same user it reads back', async () => {
    const upper = invitedId.toUpperCase();
    expect((await request(`/api/v1/admin/users/${upper}`, { cookie: adminCookie })).status).toBe(
      200,
    );
    // Before the id was normalised this 404'd: the lock map is keyed by Postgres' canonical
    // lower-case uuid, so the raw parameter never matched.
    const patched = await request(`/api/v1/admin/users/${upper}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { full_name: 'AU Newcomer' },
    });
    expect(patched.status, await patched.clone().text()).toBe(200);
  });

  // --------------------------------------------------------- set-password

  it('redeems the invite link once: the account gets a password, then the token is dead', async () => {
    const pool = harness.db.$client;
    const newPassword = 'au-redeemed-password-1';
    const mail = await pool.query(
      `SELECT payload->>'set_password_url' AS url FROM notifications
        WHERE recipient_email = 'au-new@example.com' AND template_key = 'account.set_password'
        ORDER BY id DESC LIMIT 1`,
    );
    const token = new URL(mail.rows[0].url as string).searchParams.get('token') as string;
    expect(token.length).toBeGreaterThan(20);

    const redeem = (body: unknown) =>
      harness.app.request('/api/v1/auth/set-password', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    // A password shorter than the 10 better-auth enforces never reaches the token.
    const short = await redeem({ token, new_password: 'short' });
    expect(short.status).toBe(400);
    const stillUnused = await pool.query(
      'SELECT count(*)::int AS c FROM password_setup_tokens WHERE user_id = $1 AND used_at IS NULL',
      [invitedId],
    );
    expect(stillUnused.rows[0].c).toBe(1);

    const accepted = await redeem({ token, new_password: newPassword });
    expect(accepted.status, await accepted.clone().text()).toBe(204);

    const user = await pool.query('SELECT status, email_verified FROM users WHERE id = $1', [
      invitedId,
    ]);
    expect(user.rows[0]).toMatchObject({ status: 'ACTIVE', email_verified: true });
    const account = await pool.query(
      `SELECT issuer, account_id, password IS NOT NULL AS has_password FROM accounts
        WHERE user_id = $1 AND provider_id = 'credential'`,
      [invitedId],
    );
    expect(account.rows[0]).toMatchObject({
      issuer: 'local:credential',
      account_id: invitedId,
      has_password: true,
    });

    // The whole point: better-auth must accept the row we wrote by hand.
    const signedIn = await harness.app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ employee_code: 'AU-NEW1', password: newPassword }),
    });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);

    // Single use: the same link cannot be replayed, and neither can a made-up one.
    const replay = await redeem({ token, new_password: 'au-redeemed-password-2' });
    expect(replay.status).toBe(410);
    expect((await json(replay)).code).toBe('TOKEN_EXPIRED');
    expect((await redeem({ token: 'nope', new_password: newPassword })).status).toBe(410);
  }, 30_000);

  // ------------------------------------------------------- ACCOUNT_EMAIL_DOMAINS

  it('refuses an out-of-domain address with 422 and a locatable field (§6.3.6)', async () => {
    // A second app over the SAME database and sessions, so adminCookie still authenticates.
    const guarded = createApp({
      publicBaseUrl: 'http://localhost:3000',
      additionalAllowedOrigins: [ORIGIN],
      logger: createLogger('silent'),
      db: harness.db,
      auth: harness.auth,
      checkDatabase: async () => {},
      accountEmailDomains: ['example.com'],
    });
    const post = (body: unknown) =>
      guarded.request('/api/v1/admin/users', {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const refused = await post({
      employee_code: 'AU-OUT1',
      full_name: 'AU Outsider',
      email: 'someone@gmail.com',
      department_id: departmentId,
    });
    // Not the 400 a malformed body gets: the address parses, the company just does not take
    // that domain, and the form has to be able to point at the field.
    expect(refused.status).toBe(422);
    const body = await json(refused);
    expect(body.code).toBe('VALIDATION_FAILED');
    const details = body.details as { issues: { path: string[] }[]; allowed_domains: string[] };
    expect(details.issues[0]?.path).toEqual(['email']);
    expect(details.allowed_domains).toEqual(['example.com']);
    const created = await harness.db.$client.query('SELECT 1 FROM users WHERE employee_code = $1', [
      'AU-OUT1',
    ]);
    expect(created.rowCount).toBe(0);
  });

  // ------------------------------------------------------------- account mail budget

  it('spends ONE 3/hour budget per target across resend-invite AND reset-password (C-13)', async () => {
    const created = await request('/api/v1/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        employee_code: 'AU-RL1',
        full_name: 'AU Rate Limited',
        email: 'au-rl@example.com',
        department_id: departmentId,
      },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const targetId = (await json(created)).id as string;

    const send = (purpose: 'resend-invite' | 'reset-password') =>
      request(`/api/v1/admin/users/${targetId}/${purpose}`, {
        method: 'POST',
        cookie: adminCookie,
      });

    // Three account mails, deliberately split across BOTH endpoints.
    expect((await send('resend-invite')).status).toBe(202);
    expect((await send('reset-password')).status).toBe(202);
    expect((await send('resend-invite')).status).toBe(202);
    // A per-purpose key would have handed this target six per hour instead of three.
    const fourth = await send('reset-password');
    expect(fourth.status).toBe(429);
    expect((await json(fourth)).code).toBe('RATE_LIMITED');
    expect(fourth.headers.get('retry-after')).not.toBeNull();

    // A different target still has its own budget — the limit is per user, not global.
    expect(
      (
        await request(`/api/v1/admin/users/${invitedId}/reset-password`, {
          method: 'POST',
          cookie: adminCookie,
        })
      ).status,
    ).toBe(202);
  }, 30_000);

  // --------------------------------------------------------------- CSV import

  it('imports a CSV as an upsert: dry-run previews, the real run invites, a rerun is a no-op', async () => {
    const pool = harness.db.$client;
    const header = 'employee_code,full_name,email,mobile,department_code,role';
    const send = (csv: string, query = '', type = 'text/csv') => {
      const form = new FormData();
      form.append('file', new File([csv], 'users.csv', { type }));
      return harness.app.request(`/api/v1/admin/users/import${query}`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: adminCookie },
        body: form,
      });
    };

    // Whole-file failures: an unknown header and a payload that is not CSV at all.
    expect((await send('nope,at,all\n1,2,3')).status).toBe(400);
    expect((await send(`${header}\n`, '', 'application/pdf')).status).toBe(415);
    // A NUL never reaches the driver: Postgres answers 22021 on the batch lookup, which is an
    // unmapped 500 for what has to be this endpoint's 400.
    expect((await send(`${header}\nAU-N\u0000UL,Nul,au-nul@example.com,,AUDEPT,`)).status).toBe(
      400,
    );

    const csv =
      `${header}\n` +
      // BOM + a quoted name carrying the delimiter: an HR export looks like this.
      `AU-IMP1,"Import, Alice",au-imp1@example.com,0811111111,AUDEPT,\n` +
      `AU-IMP2,Import Bob,au-imp2@example.com,,AUDEPT,FACILITY\n` +
      // and four rows that must each fail on their own line without failing the file
      `AU,Too Short,au-short@example.com,,AUDEPT,\n` +
      `AU-IMP3,No Dept,au-imp3@example.com,,NOSUCH,\n` +
      `AU-IMP1,Duplicate Code,au-dup@example.com,,AUDEPT,\n` +
      `AU-IMP4,Taken Email,au-user@example.com,,AUDEPT,\n`;

    const preview = (await json(await send(`﻿${csv}`, '?dry_run=true'))) as {
      summary: Record<string, number>;
      rows: { line: number; action: string; message?: string }[];
    };
    expect(preview.summary).toEqual({ rows: 6, create: 2, update: 0, skip: 0, error: 4 });
    expect(preview.rows.map((row) => row.action)).toEqual([
      'CREATE',
      'CREATE',
      'ERROR',
      'ERROR',
      'ERROR',
      'ERROR',
    ]);
    expect(preview.rows[3]?.message).toContain('NOSUCH');
    expect(preview.rows[4]?.message).toContain('line 2');
    expect(preview.rows[5]?.message).toContain('another account');
    // A dry run writes NOTHING.
    const afterPreview = await pool.query(
      'SELECT count(*)::int AS c FROM users WHERE employee_code = ANY($1::citext[])',
      [['AU-IMP1', 'AU-IMP2']],
    );
    expect(afterPreview.rows[0].c).toBe(0);

    const real = (await json(await send(csv))) as { summary: Record<string, number> };
    expect(real.summary).toEqual({ rows: 6, create: 2, update: 0, skip: 0, error: 4 });
    const inserted = await pool.query(
      `SELECT employee_code::text AS code, full_name, email::text AS email, mobile, role, status
         FROM users WHERE employee_code = ANY($1::citext[]) ORDER BY employee_code`,
      [['AU-IMP1', 'AU-IMP2']],
    );
    expect(inserted.rows).toEqual([
      {
        code: 'AU-IMP1',
        full_name: 'Import, Alice',
        email: 'au-imp1@example.com',
        mobile: '0811111111',
        role: 'EMPLOYEE',
        status: 'INVITED',
      },
      {
        code: 'AU-IMP2',
        full_name: 'Import Bob',
        email: 'au-imp2@example.com',
        mobile: null,
        role: 'FACILITY',
        status: 'INVITED',
      },
    ]);
    // Every new row leaves with its invite (FL-04), token and mail in the same transaction.
    const invites = await pool.query(
      `SELECT count(*)::int AS c FROM notifications
        WHERE template_key = 'account.set_password'
          AND recipient_email = ANY($1::citext[])`,
      [['au-imp1@example.com', 'au-imp2@example.com']],
    );
    expect(invites.rows[0].c).toBe(2);
    const tokens = await pool.query(
      `SELECT count(*)::int AS c FROM password_setup_tokens t JOIN users u ON u.id = t.user_id
        WHERE u.employee_code = ANY($1::citext[])`,
      [['AU-IMP1', 'AU-IMP2']],
    );
    expect(tokens.rows[0].c).toBe(2);

    // Rerunning the same file creates nothing: the upsert key is employee_code (U-07).
    const rerun = (await json(await send(csv))) as { summary: Record<string, number> };
    expect(rerun.summary).toEqual({ rows: 6, create: 0, update: 0, skip: 2, error: 4 });

    // A changed profile field is an UPDATE; status and password are never touched, and the
    // blank role column leaves FACILITY alone.
    const edited = `${header}\nAU-IMP2,Import Bobby,au-imp2b@example.com,0822222222,AUDEPT,\n`;
    const updated = (await json(await send(edited))) as { summary: Record<string, number> };
    expect(updated.summary).toEqual({ rows: 1, create: 0, update: 1, skip: 0, error: 0 });
    const after = await pool.query(
      `SELECT full_name, email::text AS email, mobile, role, status FROM users
        WHERE employee_code = 'AU-IMP2'`,
    );
    expect(after.rows[0]).toEqual({
      full_name: 'Import Bobby',
      email: 'au-imp2b@example.com',
      mobile: '0822222222',
      role: 'FACILITY',
      status: 'INVITED',
    });
    // Not a join on entity_id::uuid — a settings row's entity_id is not a uuid and the cast
    // would be evaluated before the entity_type filter.
    const trail = await pool.query(
      `SELECT action FROM audit_logs
        WHERE entity_type = 'user'
          AND entity_id = (SELECT id::text FROM users WHERE employee_code = 'AU-IMP2')
        ORDER BY id`,
    );
    expect(trail.rows.map((row: { action: string }) => row.action)).toEqual([
      'user.create',
      'user.update',
    ]);
  }, 30_000);
});
