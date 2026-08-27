import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth/index.js';
import { authSchema } from '../src/auth/schema.js';
import { createDb } from '../src/db/index.js';
import { renderTemplate } from '../src/email/templates.js';
import { createLogger } from '../src/lib/logger.js';

/**
 * RELEASE GATE — the admin surface, against the real database.
 *
 * Everything here is an invariant a release may not ship without: the last active admin
 * survives every removal path (including the two-writer race), deactivation is one atomic
 * cascade that also ends the session, an invite is a token AND an email or neither, an admin
 * cancelling someone else's booking must say why, no non-admin can reach any admin route, and
 * the reports report the truth.
 *
 * Two deliberate departures from the ticket's wording, both of them the specified behaviour:
 *  - a non-admin gets 404, never 403 (C-15: admin paths are hidden, not merely forbidden);
 *  - a missing/whitespace cancel reason is 422 REASON_REQUIRED — an empty string is 400
 *    VALIDATION_FAILED, because zod rejects it before the handler. Both are asserted.
 */

const ownerUrl = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:5174';
const HOUR = 3_600_000;

type AnyBody = Record<string, unknown>;

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

/** 15-minute grid (bookings_15min_grid) offsets from now. */
function grid(offsetMs: number): string {
  return new Date(Math.floor((Date.now() + offsetMs) / 900_000) * 900_000).toISOString();
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

describe.skipIf(!ownerUrl)('release gate: admin surface (database)', () => {
  const password = 'ga-test-password-1';
  const invitedEmail = 'ga-new@example.com';
  let harness: ReturnType<typeof build>;

  let departmentId = '';
  let roomId = '';
  let reportRoomId = '';
  let adminId = '';
  let admin2Id = '';
  let employeeId = '';
  let adminCookie = '';
  let admin2Cookie = '';
  let employeeCookie = '';
  const userIds: string[] = [];
  /** Admins elsewhere in the table, parked as EMPLOYEE so LAST_ADMIN is observable. */
  let parkedAdminIds: string[] = [];

  const bookingIds = { cancel: '', future: '', checkedIn: '', running: '' };
  /** The settled business day the report fixture sits on, and that day's window. */
  const fixture = { day: '', openMinutes: 0, closeMinutes: 0, isoWeekday: 0 };

  const request = async (
    path: string,
    init: { method?: string; cookie?: string; body?: unknown },
  ): Promise<Response> =>
    harness.app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
      },
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

  /** Highest ids right now: every "was this written?" assertion filters on them, so a rerun
   * never sees the previous run's rows. */
  const watermark = async (): Promise<{ audit: number; mail: number }> => {
    const pool = harness.db.$client;
    const rows = await pool.query<{ audit: string | null; mail: string | null }>(
      `SELECT (SELECT max(id) FROM audit_logs) AS audit, (SELECT max(id) FROM notifications) AS mail`,
    );
    return {
      audit: Number(rows.rows[0]?.audit ?? 0),
      mail: Number(rows.rows[0]?.mail ?? 0),
    };
  };

  const wipeDisposable = async () => {
    const pool = harness.db.$client;
    await pool.query('DELETE FROM notifications WHERE recipient_email = ANY($1::citext[])', [
      [invitedEmail],
    ]);
    await pool.query('DELETE FROM users WHERE employee_code = ANY($1::citext[])', [['GA-NEW1']]);
  };

  const wipeBookings = async () => {
    const pool = harness.db.$client;
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN
         (SELECT id FROM bookings WHERE room_id = ANY($1::uuid[]))`,
      [[roomId, reportRoomId]],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = ANY($1::uuid[])', [
      [roomId, reportRoomId],
    ]);
  };

  beforeAll(async () => {
    harness = build(ownerUrl as string);
    const pool = harness.db.$client;

    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('GADEPT','Gate Admin Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name, active = true RETURNING id`,
    );
    departmentId = department.rows[0].id;

    for (const [email, employeeCode, fullName, role] of [
      ['ga-admin@example.com', 'GA-001', 'GA Admin', 'ADMIN'],
      ['ga-admin2@example.com', 'GA-002', 'GA Admin Two', 'ADMIN'],
      ['ga-user@example.com', 'GA-003', 'GA Employee', 'EMPLOYEE'],
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
    admin2Id = userIds[1] as string;
    employeeId = userIds[2] as string;

    for (const [code, name] of [
      ['ga-room', 'test: gate admin room'],
      ['ga-rpt', 'test: gate report room'],
    ] as const) {
      const room = await pool.query(
        `INSERT INTO rooms (code, name, capacity, active) VALUES ($1, $2, 8, true)
         ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`,
        [code, name],
      );
      if (code === 'ga-room') {
        roomId = room.rows[0].id;
      } else {
        reportRoomId = room.rows[0].id;
      }
    }

    await wipeDisposable();
    await wipeBookings();

    // ---------------------------------------------------------------- cascade fixture
    const insertLive = async (
      startAt: string,
      endAt: string,
      status: string,
      checkedIn: boolean,
    ): Promise<string> => {
      const row = await pool.query(
        `INSERT INTO bookings (room_id, owner_id, created_by, title, start_at, end_at, status,
                               confirmed_at, checked_in_at, checked_in_by, checkin_method,
                               idempotency_key)
         VALUES ($1, $2, $2, $3, $4, $5, $6, now(),
                 CASE WHEN $7::boolean THEN now() END,
                 CASE WHEN $7::boolean THEN $2::uuid END,
                 CASE WHEN $7::boolean THEN 'SELF' END, gen_random_uuid())
         RETURNING id`,
        [roomId, employeeId, `test: gate ${status}`, startAt, endAt, status, checkedIn],
      );
      return row.rows[0].id;
    };
    bookingIds.cancel = await insertLive(grid(30 * HOUR), grid(31 * HOUR), 'CONFIRMED', false);
    bookingIds.future = await insertLive(grid(24 * HOUR), grid(25 * HOUR), 'CONFIRMED', false);
    bookingIds.checkedIn = await insertLive(grid(26 * HOUR), grid(27 * HOUR), 'CHECKED_IN', true);
    // Already under way, and CHECKED_IN rather than CONFIRMED on purpose: a past-start
    // CONFIRMED booking is exactly what booking.sweep auto-releases, and a dev worker may be
    // draining this same database.
    bookingIds.running = await insertLive(grid(-HOUR), grid(HOUR), 'CHECKED_IN', true);
    for (const bookingId of [bookingIds.cancel, bookingIds.future]) {
      await pool.query(
        `INSERT INTO booking_attendees (booking_id, email, name) VALUES ($1, $2, 'GA Guest')`,
        [bookingId, 'ga-guest@example.com'],
      );
    }

    // ----------------------------------------------------------------- report fixture
    // The most recent settled, open, non-holiday Bangkok day — the same day set the report's
    // own `days` CTE would build.
    const day = await pool.query<{ day: string; open_time: string; close_time: string }>(
      `SELECT d::date::text AS day, bh.open_time::text, bh.close_time::text
         FROM generate_series((now() AT TIME ZONE 'Asia/Bangkok')::date - 30,
                              (now() AT TIME ZONE 'Asia/Bangkok')::date - 1,
                              interval '1 day') d
         JOIN business_hours bh
           ON bh.weekday = extract(isodow FROM d)::int AND bh.is_open
        WHERE NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = d::date)
          AND (d::date + bh.close_time) AT TIME ZONE 'Asia/Bangkok' < now()
        ORDER BY d DESC LIMIT 1`,
    );
    const window = day.rows[0];
    expect(window, 'no settled open business day in the last 30 days').toBeDefined();
    fixture.day = (window as { day: string }).day;
    fixture.openMinutes = minutesOf((window as { open_time: string }).open_time);
    fixture.closeMinutes = minutesOf((window as { close_time: string }).close_time);
    fixture.isoWeekday = ((new Date(`${fixture.day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    // The fixture lays bookings out over 7.5 h from opening and needs quarter-hour alignment.
    expect(fixture.openMinutes % 15).toBe(0);
    expect(fixture.closeMinutes - fixture.openMinutes).toBeGreaterThanOrEqual(450);

    // Before the fixture day, so GREATEST(open, rooms.created_at) never clips the divisor.
    await pool.query(`UPDATE rooms SET created_at = ($2::date - 30) WHERE id = $1`, [
      reportRoomId,
      fixture.day,
    ]);

    const at = (offsetMinutes: number): string =>
      new Date(
        new Date(`${fixture.day}T00:00:00+07:00`).getTime() +
          (fixture.openMinutes + offsetMinutes) * 60_000,
      ).toISOString();
    const insertSettled = async (
      startOffset: number,
      endOffset: number,
      status: string,
      reasonCode: string | null,
    ): Promise<void> => {
      await pool.query(
        `INSERT INTO bookings (room_id, owner_id, created_by, title, start_at, end_at, status,
                               confirmed_at, reason_code, cancelled_at, cancelled_by,
                               auto_released_at, idempotency_key)
         VALUES ($1, $2, $2, $3, $4, $5, $6, $4, $7,
                 CASE WHEN $6 = 'CANCELLED' THEN $4::timestamptz END,
                 CASE WHEN $6 = 'CANCELLED' THEN $2::uuid END,
                 CASE WHEN $6 = 'AUTO_RELEASED' THEN $5::timestamptz END,
                 gen_random_uuid())`,
        [
          reportRoomId,
          employeeId,
          `test: gate report ${status}`,
          at(startOffset),
          at(endOffset),
          status,
          reasonCode,
        ],
      );
    };
    await insertSettled(60, 120, 'COMPLETED', null); //  1.0 h used
    await insertSettled(150, 180, 'CANCELLED', 'OWNER_CANCELLED');
    await insertSettled(210, 300, 'COMPLETED', null); //  1.5 h used
    await insertSettled(330, 360, 'CANCELLED', 'ADMIN_CANCELLED');
    await insertSettled(390, 450, 'AUTO_RELEASED', 'NO_SHOW');

    // LAST_ADMIN is a global rule, so it is only observable with a known number of active
    // admins in the whole table. vitest runs test FILES sequentially (vitest.config.ts).
    const parked = await pool.query<{ id: string }>(
      `UPDATE users SET role = 'EMPLOYEE'
        WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> ALL($1::uuid[]) RETURNING id`,
      [[adminId, admin2Id]],
    );
    parkedAdminIds = parked.rows.map((row) => row.id);

    adminCookie = await signIn('GA-001');
    admin2Cookie = await signIn('GA-002');
    employeeCookie = await signIn('GA-003');
  }, 60_000);

  afterAll(async () => {
    const pool = harness.db.$client;
    await pool.query(`UPDATE users SET role = 'ADMIN' WHERE id = ANY($1::uuid[])`, [
      [adminId, admin2Id, ...parkedAdminIds],
    ]);
    await wipeDisposable();
    await wipeBookings();
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query(
      `UPDATE users SET status='ACTIVE', banned=false, disabled_at=NULL WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    await pool.end();
  });

  // ==========================================================================  5 · RBAC

  it('refuses every admin route: 401 for anonymous, 404 for a signed-in employee', async () => {
    // Table-driven off the router itself, so a route added tomorrow is covered without
    // touching this test. Method+path pairs repeat (middleware and handler each register one).
    const routes = [
      ...new Set(
        harness.app.routes
          .filter((route) => route.method !== 'ALL' && route.path.startsWith('/api/v1/admin'))
          .map((route) => `${route.method} ${route.path}`),
      ),
    ].sort();

    // A sanity floor: if the enumeration ever silently returns nothing, this test would
    // otherwise pass by asserting on an empty list.
    expect(routes.length).toBeGreaterThanOrEqual(20);
    for (const known of [
      'GET /api/v1/admin/users',
      'POST /api/v1/admin/users/:id/deactivate',
      'DELETE /api/v1/admin/users/:id',
      'PUT /api/v1/admin/settings',
      'GET /api/v1/admin/reports/utilization',
      'GET /api/v1/admin/audit-logs',
    ]) {
      expect(routes, JSON.stringify(routes)).toContain(known);
    }

    for (const route of routes) {
      const [method, template] = route.split(' ') as [string, string];
      const path = template.replaceAll(':id', randomUUID());
      const body = method === 'GET' || method === 'DELETE' ? undefined : {};

      const anonymous = await request(path, { method, body });
      expect(anonymous.status, `anonymous ${route}`).toBe(401);
      expect((await json(anonymous)).code, `anonymous ${route}`).toBe('UNAUTHENTICATED');

      // C-15: hidden, not merely forbidden — an employee must not be able to map the admin
      // surface by telling 403 apart from 404.
      const employee = await request(path, { method, cookie: employeeCookie, body });
      expect(employee.status, `employee ${route}`).toBe(404);
      expect((await json(employee)).code, `employee ${route}`).toBe('NOT_FOUND');
    }
  }, 60_000);

  // ========================================================================  3 · INVITE

  it('invite: one transaction produces the user, a 7-day token and a mail that renders', async () => {
    const pool = harness.db.$client;
    const marks = await watermark();

    const response = await request('/api/v1/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        employee_code: 'GA-NEW1',
        full_name: 'GA Newcomer',
        email: invitedEmail,
        mobile: '0812345678',
        department_id: departmentId,
      },
    });
    expect(response.status).toBe(201);
    const created = await json(response);
    expect(created).toMatchObject({ status: 'INVITED', role: 'EMPLOYEE', bookings_count: 0 });
    const invitedId = created.id as string;

    const token = await pool.query(
      `SELECT id, purpose, used_at,
              expires_at > now() + interval '6 days'  AS at_least_six_days,
              expires_at < now() + interval '8 days'  AS at_most_eight_days
         FROM password_setup_tokens WHERE user_id = $1`,
      [invitedId],
    );
    expect(token.rowCount).toBe(1);
    expect(token.rows[0]).toMatchObject({
      purpose: 'INVITE',
      used_at: null,
      at_least_six_days: true,
      at_most_eight_days: true,
    });

    const mail = await pool.query(
      `SELECT id, booking_id, dedupe_key, payload, created_at FROM notifications
        WHERE id > $1 AND template_key = 'account.set_password' AND recipient_email = $2`,
      [marks.mail, invitedEmail],
    );
    expect(mail.rowCount).toBe(1);
    const row = mail.rows[0];
    expect(row.booking_id).toBeNull();
    // The token id is the dedupe key — that is what makes a re-issue always mail again (C1-05).
    expect(row.dedupe_key).toBe(token.rows[0].id);
    const setPasswordUrl = row.payload.set_password_url as string;
    expect(setPasswordUrl).toMatch(/^http:\/\/localhost:3000\/set-password\?token=.{20,}$/);

    // Token and mail in ONE transaction (C2-06): a token nobody was told about is an invite
    // that cannot be redeemed, and a mail without a token is a dead link.
    const audit = await pool.query(
      `SELECT created_at, after FROM audit_logs
        WHERE id > $1 AND action = 'user.create' AND entity_id = $2`,
      [marks.audit, invitedId],
    );
    expect(audit.rowCount).toBe(1);
    expect((audit.rows[0].created_at as Date).getTime()).toBe((row.created_at as Date).getTime());
    // S-12: the mobile we just stored is not in the trail.
    expect(JSON.stringify(audit.rows[0].after)).not.toContain('0812345678');

    // The queued row is renderable as it stands — the drain reads exactly these two fields.
    const rendered = renderTemplate('account.set_password', {
      bookingId: '',
      title: '',
      roomName: '',
      ownerName: row.payload.name as string,
      startAt: new Date(0),
      endAt: new Date(0),
      headcount: null,
      checkInGraceMinutes: 15,
      bookingUrl: setPasswordUrl,
    });
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.text).toContain(setPasswordUrl);
    expect(rendered.html).toContain(setPasswordUrl);
  });

  // ================================================================  4 · ADMIN CANCEL

  it("admin cancelling someone else's booking must give a reason, or nothing changes", async () => {
    const pool = harness.db.$client;
    const before = await pool.query(
      'SELECT status, version, reason_code, cancelled_at FROM bookings WHERE id = $1',
      [bookingIds.cancel],
    );
    const unchanged = async (label: string) => {
      const after = await pool.query(
        'SELECT status, version, reason_code, cancelled_at FROM bookings WHERE id = $1',
        [bookingIds.cancel],
      );
      expect(after.rows[0], label).toEqual(before.rows[0]);
    };

    for (const [body, status, code] of [
      [{}, 422, 'REASON_REQUIRED'],
      [{ reason: '   ' }, 422, 'REASON_REQUIRED'],
      // Rejected a layer earlier, by the schema's min(3) — still refused, still no write.
      [{ reason: '' }, 400, 'VALIDATION_FAILED'],
    ] as const) {
      const refused = await request(`/api/v1/bookings/${bookingIds.cancel}/cancel`, {
        method: 'POST',
        cookie: adminCookie,
        body,
      });
      expect(refused.status, JSON.stringify(body)).toBe(status);
      expect((await json(refused)).code, JSON.stringify(body)).toBe(code);
      await unchanged(JSON.stringify(body));
    }

    const marks = await watermark();
    const reason = 'test: room needed for a board meeting';
    const cancelled = await request(`/api/v1/bookings/${bookingIds.cancel}/cancel`, {
      method: 'POST',
      cookie: adminCookie,
      body: { reason },
    });
    expect(cancelled.status).toBe(200);
    expect(await json(cancelled)).toMatchObject({ status: 'CANCELLED' });

    const row = await pool.query(
      'SELECT status, reason_code, reason, cancelled_by FROM bookings WHERE id = $1',
      [bookingIds.cancel],
    );
    expect(row.rows[0]).toMatchObject({
      status: 'CANCELLED',
      reason_code: 'ADMIN_CANCELLED',
      reason,
      cancelled_by: adminId,
    });

    const audit = await pool.query(
      `SELECT action, reason FROM audit_logs
        WHERE id > $1 AND entity_type = 'booking' AND entity_id = $2`,
      [marks.audit, bookingIds.cancel],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]).toMatchObject({ action: 'booking.cancel', reason });

    // §2.6: an admin cancel notifies the owner AND the attendees.
    const mail = await pool.query(
      `SELECT DISTINCT recipient_email FROM notifications
        WHERE id > $1 AND booking_id = $2 AND template_key = 'booking.cancelled'
        ORDER BY recipient_email`,
      [marks.mail, bookingIds.cancel],
    );
    expect(mail.rows.map((entry: AnyBody) => entry.recipient_email)).toEqual([
      'ga-guest@example.com',
      'ga-user@example.com',
    ]);
  });

  // =====================================================================  2 · CASCADE

  it('deactivate: one transaction cancels, audits, queues mail and kills the session', async () => {
    const pool = harness.db.$client;
    const marks = await watermark();

    const response = await request(`/api/v1/admin/users/${employeeId}/deactivate`, {
      method: 'POST',
      cookie: adminCookie,
      body: { reason: 'test: left the company' },
    });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.user).toMatchObject({ status: 'DISABLED' });
    const doomed = [bookingIds.future, bookingIds.checkedIn].sort();
    expect((body.cancelled_bookings as AnyBody[]).map((entry) => entry.id).sort()).toEqual(doomed);

    const rows = await pool.query(
      'SELECT id, status, reason_code, cancelled_by, version FROM bookings WHERE room_id = $1',
      [roomId],
    );
    const byId = new Map(rows.rows.map((entry: AnyBody) => [entry.id, entry]));
    for (const id of doomed) {
      expect(byId.get(id), id).toMatchObject({
        status: 'CANCELLED',
        reason_code: 'OWNER_DISABLED',
        cancelled_by: adminId,
        version: 2,
      });
    }
    // C2-11 stops at the ones that have not started: the meeting under way is left alone.
    expect(byId.get(bookingIds.running)).toMatchObject({ status: 'CHECKED_IN' });

    const audit = await pool.query<{ action: string; created_at: Date }>(
      `SELECT action, created_at FROM audit_logs WHERE id > $1 AND actor_id = $2
        ORDER BY id`,
      [marks.audit, adminId],
    );
    // One user.disable plus one booking.cancel per cancelled booking, so Booking.history —
    // which derives 1:1 from audit_logs — is not blank on a disable-cancelled booking.
    expect(audit.rows.map((entry) => entry.action).sort()).toEqual([
      'booking.cancel',
      'booking.cancel',
      'user.disable',
    ]);

    const mail = await pool.query<{ recipient_email: string; created_at: Date }>(
      `SELECT recipient_email, created_at FROM notifications
        WHERE id > $1 AND booking_id = ANY($2::uuid[]) AND template_key = 'booking.cancelled'
        ORDER BY recipient_email`,
      [marks.mail, doomed],
    );
    expect([...new Set(mail.rows.map((entry) => entry.recipient_email))].sort()).toEqual([
      'ga-guest@example.com',
      'ga-user@example.com',
    ]);

    // ONE transaction: created_at defaults to now(), which is transaction_timestamp() and is
    // therefore identical across every row this cascade wrote — audit and outbox alike.
    const stamps = new Set(
      [...audit.rows, ...mail.rows].map((entry) => entry.created_at.getTime()),
    );
    expect(stamps.size, [...stamps].join(',')).toBe(1);

    // DELETE FROM sessions in that same transaction IS the revocation: banned = true alone
    // does not end a live session (better-auth checks it only at session creation).
    const sessions = await pool.query(
      'SELECT count(*)::int AS c FROM sessions WHERE user_id = $1',
      [employeeId],
    );
    expect(sessions.rows[0].c).toBe(0);

    const me = await request('/api/v1/me', { cookie: employeeCookie });
    expect(me.status).toBe(401);
    expect((await json(me)).code).toBe('UNAUTHENTICATED');

    const refused = await harness.app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ employee_code: 'GA-003', password }),
    });
    expect(refused.status).toBe(403);
    expect((await json(refused)).code).toBe('ACCOUNT_DISABLED');
  });

  // =================================================================  1 · LAST_ADMIN

  const activeAdmins = async (): Promise<number> => {
    const rows = await harness.db.$client.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'",
    );
    return rows.rows[0]?.c ?? 0;
  };

  /** Waits until `count` requests are parked on an advisory lock. */
  const waitForWaiters = async (count: number): Promise<void> => {
    for (let attempt = 0; attempt < 250; attempt++) {
      const waiting = await harness.db.$client.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
      );
      if ((waiting.rows[0]?.c ?? 0) >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no request parked on the advisory lock (expected ${count})`);
  };

  it('an admin cannot demote, disable or delete themselves, so the last one always survives', async () => {
    expect(await activeAdmins()).toBe(2);

    for (const [method, path, body] of [
      ['PATCH', `/api/v1/admin/users/${adminId}`, { role: 'EMPLOYEE' }],
      ['POST', `/api/v1/admin/users/${adminId}/deactivate`, {}],
      ['DELETE', `/api/v1/admin/users/${adminId}`, undefined],
    ] as const) {
      const response = await request(path, { method, cookie: adminCookie, body });
      expect(response.status, `${method} ${path}`).toBe(409);
      expect((await json(response)).code, `${method} ${path}`).toBe('CANNOT_MODIFY_SELF');
    }

    const row = await harness.db.$client.query('SELECT role, status FROM users WHERE id = $1', [
      adminId,
    ]);
    expect(row.rows[0]).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
  });

  it('LAST_ADMIN: demote, deactivate and delete are all refused on the only active admin', async () => {
    const pool = harness.db.$client;

    // Self-service is pre-empted by CANNOT_MODIFY_SELF (test above), so the ONLY way to be
    // holding a request against the last admin is to stop being an admin after that request
    // authenticated. That is the race the guard exists for — made deterministic here by
    // parking the request on 'users:last-admin' and demoting its actor while it waits.
    for (const [method, path, body] of [
      ['PATCH', `/api/v1/admin/users/${adminId}`, { role: 'EMPLOYEE' }],
      ['POST', `/api/v1/admin/users/${adminId}/deactivate`, {}],
      ['DELETE', `/api/v1/admin/users/${adminId}`, undefined],
    ] as const) {
      const gate = await pool.connect();
      await gate.query('BEGIN');
      await gate.query("SELECT pg_advisory_xact_lock(hashtext('users:last-admin'))");
      try {
        const pending = request(path, { method, cookie: admin2Cookie, body });
        await waitForWaiters(1);
        await pool.query("UPDATE users SET role = 'EMPLOYEE' WHERE id = $1", [admin2Id]);
        expect(await activeAdmins(), `${method} ${path}`).toBe(1);
        await gate.query('ROLLBACK');

        const response = await pending;
        expect(response.status, `${method} ${path}`).toBe(409);
        expect((await json(response)).code, `${method} ${path}`).toBe('LAST_ADMIN');
      } finally {
        gate.release();
        await pool.query("UPDATE users SET role = 'ADMIN' WHERE id = $1", [admin2Id]);
      }

      const row = await pool.query('SELECT role, status FROM users WHERE id = $1', [adminId]);
      expect(row.rows[0], `${method} ${path}`).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    }
  }, 30_000);

  it('with two active admins, one of them may be demoted', async () => {
    const pool = harness.db.$client;
    expect(await activeAdmins()).toBe(2);

    const response = await request(`/api/v1/admin/users/${admin2Id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'EMPLOYEE' },
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ role: 'EMPLOYEE' });
    expect(await activeAdmins()).toBe(1);

    await pool.query("UPDATE users SET role = 'ADMIN' WHERE id = $1", [admin2Id]);
  });

  it('two admins demoting each other at once: exactly one wins (TC-USR-017, C1-11)', async () => {
    const pool = harness.db.$client;
    expect(await activeAdmins()).toBe(2);

    // Hold 'users:last-admin' so BOTH requests get through requireAdmin (which re-reads the
    // role on every request) before either can write. Without this the loser can be demoted
    // before it authenticates and answer 404 — still refused, but not the branch under test.
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
      await waitForWaiters(2);
      await gate.query('ROLLBACK');
      const [first, second] = await race;

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect((await json(loser)).code).toBe('LAST_ADMIN');
      // Row locks alone would let both pass and leave the system with zero admins.
      expect(await activeAdmins()).toBe(1);
    } finally {
      gate.release();
      await pool.query(`UPDATE users SET role = 'ADMIN' WHERE id = ANY($1::uuid[])`, [
        [adminId, admin2Id],
      ]);
    }
  }, 30_000);

  /**
   * TC-USR-017's barrier matrix: EVERY pair of the four operations that can strip an account
   * of ADMIN — PATCH role, deactivate, DELETE and the CSV import — run head-on against the
   * last two active admins. Ten pairs, the self-pairs included.
   *
   * Each pair is racer1 acting on racer2 and racer2 acting on racer1, both parked on
   * 'users:last-admin' so neither can be pre-empted by the other's commit before it
   * authenticates. Whatever order they then settle in, two things must hold: at least one
   * ACTIVE ADMIN survives, and the side that lost the barrier is refused with 409 LAST_ADMIN.
   *
   * The racers are separate throwaway accounts, not GA-001/GA-002, because a DELETE that wins
   * its race must actually be able to delete — an admin with history is refused by U-03
   * before the barrier can be observed.
   */
  it('LAST_ADMIN barrier matrix: every pair of the four removal ops (TC-USR-017)', async () => {
    const pool = harness.db.$client;
    const racers = [
      { email: 'ga-race1@example.com', code: 'GA-R1', name: 'GA Racer One' },
      { email: 'ga-race2@example.com', code: 'GA-R2', name: 'GA Racer Two' },
    ] as const;

    /**
     * A DELETE that wins its race is refused by U-03 the moment the target has any history,
     * so every pair starts from racers with none. audit_logs is append-only by trigger;
     * `rf.audit_purge` is the documented way through it (§09 runbook) and this suite connects
     * as the schema owner.
     */
    const purgeHistory = async (): Promise<void> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL rf.audit_purge = 'on'");
        await client.query(
          `DELETE FROM audit_logs WHERE actor_id IN
             (SELECT id FROM users WHERE email = ANY($1::citext[]))`,
          [racers.map((racer) => racer.email)],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    };

    /**
     * Sign-in is 5/min per IP+employee code and this test needs more than that across ten pairs,
     * so it reuses a live session where it can and burns a throwaway app — same database,
     * same sessions, its own limiter — where it cannot.
     */
    const live = new Map<string, string>();
    const cookieFor = async (id: string, code: string): Promise<string> => {
      const existing = live.get(id);
      if (existing !== undefined) {
        const session = await pool.query('SELECT 1 FROM sessions WHERE user_id = $1 LIMIT 1', [id]);
        if ((session.rowCount ?? 0) > 0) {
          return existing;
        }
      }
      const fresh = createApp({
        publicBaseUrl: 'http://localhost:3000',
        additionalAllowedOrigins: [ORIGIN],
        logger: createLogger('silent'),
        db: harness.db,
        auth: harness.auth,
        checkDatabase: async () => {},
      });
      const response = await fresh.request('/api/v1/auth/sign-in', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ employee_code: code, password }),
      });
      expect(response.status, `sign-in ${code}`).toBe(200);
      const cookie = (
        response.headers.getSetCookie().find((value) => value.startsWith('__Host-sid=')) as string
      ).split(';')[0] as string;
      live.set(id, cookie);
      return cookie;
    };

    /** Re-creates the racer if a previous pair deleted it, then hands back a usable session. */
    const ensureRacer = async (index: 0 | 1): Promise<{ id: string; cookie: string }> => {
      const spec = racers[index];
      let row = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
        spec.email,
      ]);
      if (row.rowCount === 0) {
        await harness.auth.api.createUser({
          body: {
            email: spec.email,
            password,
            name: spec.name,
            role: 'ADMIN',
            data: { employee_code: spec.code, department_id: departmentId, status: 'ACTIVE' },
          },
        });
        row = await pool.query('SELECT id FROM users WHERE email = $1', [spec.email]);
      }
      await pool.query(
        `UPDATE users SET role='ADMIN', status='ACTIVE', banned=false, disabled_at=NULL,
                failed_logins=0, locked_until=NULL, department_id=$2, full_name=$3
         WHERE email=$1`,
        [spec.email, departmentId, spec.name],
      );
      const id = (row.rows[0] as { id: string }).id;
      return { id, cookie: await cookieFor(id, spec.code) };
    };

    const csv = (code: string) =>
      `employee_code,full_name,email,mobile,department_code,role\n` +
      `${code},${code === 'GA-R1' ? racers[0].name : racers[1].name},` +
      `${code === 'GA-R1' ? racers[0].email : racers[1].email},,GADEPT,EMPLOYEE\n`;

    type Op = 'patch' | 'deactivate' | 'delete' | 'import';
    const fire = (op: Op, actorCookie: string, targetId: string, targetCode: string) => {
      if (op === 'import') {
        const form = new FormData();
        form.append('file', new File([csv(targetCode)], 'demote.csv', { type: 'text/csv' }));
        return harness.app.request('/api/v1/admin/users/import', {
          method: 'POST',
          headers: { origin: ORIGIN, cookie: actorCookie },
          body: form,
        });
      }
      if (op === 'patch') {
        return request(`/api/v1/admin/users/${targetId}`, {
          method: 'PATCH',
          cookie: actorCookie,
          body: { role: 'EMPLOYEE' },
        });
      }
      if (op === 'deactivate') {
        return request(`/api/v1/admin/users/${targetId}/deactivate`, {
          method: 'POST',
          cookie: actorCookie,
          body: {},
        });
      }
      return request(`/api/v1/admin/users/${targetId}`, { method: 'DELETE', cookie: actorCookie });
    };

    const ops: Op[] = ['patch', 'deactivate', 'delete', 'import'];
    const pairs = ops.flatMap((first, index) => ops.slice(index).map((second) => [first, second]));
    expect(pairs).toHaveLength(10);

    // GA-001/GA-002 stand down for the duration so the racers really are the last two.
    await pool.query("UPDATE users SET role = 'EMPLOYEE' WHERE id = ANY($1::uuid[])", [
      [adminId, admin2Id],
    ]);
    try {
      for (const [first, second] of pairs as [Op, Op][]) {
        const label = `${first} × ${second}`;
        const one = await ensureRacer(0);
        const two = await ensureRacer(1);
        // AFTER the sign-in above, not before: `auth.login` is itself an audit row with the
        // racer as actor, and that alone is the history U-03 refuses to delete over.
        await purgeHistory();
        expect(await activeAdmins(), label).toBe(2);

        const gate = await pool.connect();
        await gate.query('BEGIN');
        await gate.query("SELECT pg_advisory_xact_lock(hashtext('users:last-admin'))");
        let responses: [Response, Response];
        try {
          const race = Promise.all([
            fire(first, one.cookie, two.id, 'GA-R2'),
            fire(second, two.cookie, one.id, 'GA-R1'),
          ]);
          await waitForWaiters(2);
          await gate.query('ROLLBACK');
          responses = (await race) as [Response, Response];
        } finally {
          gate.release();
        }

        // Row locks alone would let both through and leave the system with zero admins.
        expect(await activeAdmins(), label).toBeGreaterThanOrEqual(1);
        const bodies = await Promise.all(
          responses.map(async (response) =>
            response.status === 204 ? {} : ((await response.json()) as AnyBody),
          ),
        );
        const refused = responses
          .map((response, index) => ({ status: response.status, code: bodies[index]?.code }))
          .filter((outcome) => outcome.status >= 400);
        expect(refused.length, `${label}: ${JSON.stringify(refused)}`).toBeGreaterThanOrEqual(1);
        expect(
          refused.some((outcome) => outcome.code === 'LAST_ADMIN'),
          `${label}: ${JSON.stringify(refused)}`,
        ).toBe(true);
      }
    } finally {
      await pool.query(
        `DELETE FROM sessions WHERE user_id IN
           (SELECT id FROM users WHERE email = ANY($1::citext[]))`,
        [racers.map((racer) => racer.email)],
      );
      await pool.query("UPDATE users SET role = 'ADMIN' WHERE id = ANY($1::uuid[])", [
        [adminId, admin2Id],
      ]);
      await pool.query(
        `UPDATE users SET role = 'EMPLOYEE', status = 'DISABLED', banned = true,
                disabled_at = now() WHERE email = ANY($1::citext[])`,
        [racers.map((racer) => racer.email)],
      );
    }
  }, 180_000);

  // ======================================================================  6 · REPORTS

  it('utilization matches the numbers computed from the fixture, clips included', async () => {
    const availableHours = (fixture.closeMinutes - fixture.openMinutes) / 60;
    const usedHours = 2.5; // the two COMPLETED bookings, both inside the window
    const response = await request(
      `/api/v1/admin/reports/utilization?from=${fixture.day}&to=${fixture.day}` +
        `&room_id=${reportRoomId}`,
      { cookie: adminCookie },
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    const rows = body.rows as AnyBody[];
    expect(rows).toHaveLength(1);
    const row = rows[0] as AnyBody;

    expect((row.room as AnyBody).code).toBe('ga-rpt');
    expect(row.available_hours).toBeCloseTo(round1(availableHours), 5);
    expect(row.used_hours).toBeCloseTo(usedHours, 5);
    expect(row.utilization_pct).toBeCloseTo(round1((100 * usedHours) / availableHours), 5);
    // booked_hours is the secondary figure: whole durations of everything that held the room.
    expect(row.booked_hours).toBeCloseTo(usedHours, 5);
    expect(row).toMatchObject({ completed: 2, cancelled: 2, auto_released: 1 });
    expect(row.no_show_pct).toBeCloseTo(round1((100 * 1) / 3), 5);

    // The same fixture grouped by month is the same day's numbers under a period key.
    const byMonth = await json(
      await request(
        `/api/v1/admin/reports/utilization?from=${fixture.day}&to=${fixture.day}` +
          `&room_id=${reportRoomId}&group_by=month`,
        { cookie: adminCookie },
      ),
    );
    const monthRows = byMonth.rows as AnyBody[];
    expect(monthRows).toHaveLength(1);
    expect(monthRows[0]).toMatchObject({ period: fixture.day.slice(0, 7), completed: 2 });
    expect((monthRows[0] as AnyBody).used_hours).toBeCloseTo(usedHours, 5);
  });

  it('outcomes and heatmap match the fixture exactly', async () => {
    const outcomes = await json(
      await request(
        `/api/v1/admin/reports/outcomes?from=${fixture.day}&to=${fixture.day}` +
          `&room_id=${reportRoomId}`,
        { cookie: adminCookie },
      ),
    );
    expect(outcomes.totals).toEqual({
      created: 5,
      completed: 2,
      cancelled_by_owner: 1,
      // OWNER_DISABLED would fold in here too — the deactivate cascade is an admin action.
      cancelled_by_admin: 1,
      auto_released: 1,
    });
    expect(outcomes.no_show_pct).toBeCloseTo(round1((100 * 1) / 3), 5);
    expect(outcomes.by_day).toHaveLength(1);
    expect((outcomes.by_day as AnyBody[])[0]).toMatchObject({ date: fixture.day, created: 5 });

    const heatmap = await json(
      await request(
        `/api/v1/admin/reports/heatmap?from=${fixture.day}&to=${fixture.day}` +
          `&room_id=${reportRoomId}`,
        { cookie: adminCookie },
      ),
    );
    // COMPLETED/CHECKED_IN only, each booking's whole duration charged to its start hour.
    expect(heatmap.cells).toEqual([
      {
        weekday: fixture.isoWeekday,
        hour: Math.floor((fixture.openMinutes + 60) / 60),
        bookings: 1,
        used_hours: 1,
      },
      {
        weekday: fixture.isoWeekday,
        hour: Math.floor((fixture.openMinutes + 210) / 60),
        bookings: 1,
        used_hours: 1.5,
      },
    ]);

    const invalid = await request(
      `/api/v1/admin/reports/outcomes?from=${fixture.day}&to=2020-01-01`,
      { cookie: adminCookie },
    );
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).code).toBe('VALIDATION_FAILED');
  });
});
