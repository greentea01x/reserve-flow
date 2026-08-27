import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth/index.js';
import { authSchema } from '../src/auth/schema.js';
import { createDb } from '../src/db/index.js';
import { createLogger } from '../src/lib/logger.js';
import { bangkokParts } from '../src/lib/time.js';

const ownerUrl = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:5174';

function build(connectionString: string) {
  const db = createDb(connectionString);
  const auth = createAuth({
    db: drizzle(db.$client, { schema: authSchema }),
    secret: 'x'.repeat(32),
    baseURL: 'http://localhost:3000',
  });
  // Counts §5.7 post-commit kicks; the real server wires the scheduler's kick here.
  const kicked = { count: 0 };
  const app = createApp({
    publicBaseUrl: 'http://localhost:3000',
    additionalAllowedOrigins: [ORIGIN],
    logger: createLogger('silent'),
    db,
    auth,
    checkDatabase: async () => {},
    kickOutbox: () => {
      kicked.count += 1;
    },
  });
  return { app, db, auth, kicked };
}

/** Next Bangkok Mon/Tue/Thu/Fri ≥ tomorrow (skips weekends + the master-data holiday). */
function nextOpenDate(): string {
  for (let ahead = 1; ahead <= 8; ahead++) {
    const parts = bangkokParts(new Date(Date.now() + ahead * 86_400_000));
    if ([1, 2, 4, 5].includes(parts.isoWeekday)) {
      return parts.date;
    }
  }
  throw new Error('unreachable');
}

type AnyBody = Record<string, unknown>;

describe('hardening (no database)', () => {
  const { app } = build('postgresql://unused:unused@127.0.0.1:9/unused');

  it('accepts Sec-Fetch-Site: same-origin in place of an Origin header', async () => {
    const response = await app.request('/api/v1/not-implemented', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    expect(response.status).toBe(404); // reached routing instead of the 403 CSRF wall
  });

  it('413s an oversized request body before any handler buffers it', async () => {
    const response = await app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: `{"employee_code":"${'x'.repeat(70_000)}","password":"p"}`,
    });
    expect(response.status).toBe(413);
  });

  it('exempts the room-photo path from the 64 KB cap but answers auth first', async () => {
    const body = 'x'.repeat(100_000);
    // The 5 MB photo ceiling lives inside the route, behind requireAdmin: an anonymous caller
    // is turned away before anything reads its body, and the 413-vs-401 difference that would
    // otherwise advertise the hidden admin path (C-15) is gone.
    const photo = await app.request(
      '/api/v1/admin/rooms/00000000-0000-4000-8000-000000000000/photo',
      { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body },
    );
    expect(photo.status).toBe(401);
    await expect(photo.json()).resolves.toMatchObject({ code: 'UNAUTHENTICATED' });

    // Every other admin path keeps the 64 KB cap.
    const other = await app.request('/api/v1/admin/users', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ pad: body }),
    });
    expect(other.status).toBe(413);
  });
});

describe.skipIf(!ownerUrl)('review fixes (database)', () => {
  const password = 'fix-test-password-1';
  const day = nextOpenDate();
  const at = (time: string) => new Date(`${day}T${time}:00+07:00`).toISOString();
  let harness: ReturnType<typeof build>;
  let ownerCookie = '';
  let strangerCookie = '';
  let roomId = '';
  const userIds: string[] = [];

  const request = (
    path: string,
    init: { method?: string; cookie: string; body?: unknown; headers?: Record<string, string> },
  ) =>
    harness.app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        cookie: init.cookie,
        origin: ORIGIN,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  beforeAll(async () => {
    harness = build(ownerUrl as string);
    const pool = harness.db.$client;

    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('FIXDEPT','Fix Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    for (const [email, employeeCode, fullName] of [
      ['fix-owner@example.com', 'FIX-001', 'Fix Owner'],
      ['fix-stranger@example.com', 'FIX-002', 'Fix Stranger'],
    ] as const) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rowCount === 0) {
        await harness.auth.api.createUser({
          body: {
            email,
            password,
            name: fullName,
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
      userIds.push(user.rows[0].id);
    }

    await pool.query(
      `INSERT INTO business_hours (weekday, is_open, open_time, close_time)
       SELECT w, w <= 5, CASE WHEN w <= 5 THEN '08:30'::time END,
              CASE WHEN w <= 5 THEN '17:30'::time END
         FROM generate_series(1, 7) AS w
       ON CONFLICT (weekday) DO UPDATE
         SET is_open = excluded.is_open, open_time = excluded.open_time,
             close_time = excluded.close_time`,
    );
    const room = await pool.query(
      `INSERT INTO rooms (code, name, capacity, active) VALUES ('fix-room','test: fix room',6,true)
       ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`,
    );
    roomId = room.rows[0].id;
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)`,
      [roomId],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = $1', [roomId]);

    const signIn = async (employeeCode: string) => {
      const response = await harness.app.request('/api/v1/auth/sign-in', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ employee_code: employeeCode, password }),
      });
      expect(response.status).toBe(200);
      const cookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith('__Host-sid='));
      return (cookie as string).split(';')[0] as string;
    };
    ownerCookie = await signIn('FIX-001');
    strangerCookie = await signIn('FIX-002');
  }, 30_000);

  afterAll(async () => {
    const pool = harness.db.$client;
    await pool.query('UPDATE rooms SET active = true WHERE id = $1', [roomId]);
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)`,
      [roomId],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = $1', [roomId]);
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.end();
  });

  let bookingId = '';
  const idemKey = randomUUID();

  it('replays an idempotent retry even when re-validation would now fail (CF-01)', async () => {
    const created = await request('/api/v1/bookings', {
      method: 'POST',
      cookie: ownerCookie,
      headers: { 'idempotency-key': idemKey },
      body: {
        room_id: roomId,
        start_at: at('09:00'),
        end_at: at('10:00'),
        title: 'test: fix idem',
      },
    });
    expect(created.status).toBe(201);
    bookingId = ((await created.json()) as AnyBody).id as string;

    // The room goes inactive after the create: a retry must replay, not 422 ROOM_INACTIVE.
    await harness.db.$client.query('UPDATE rooms SET active = false WHERE id = $1', [roomId]);
    const retry = await request('/api/v1/bookings', {
      method: 'POST',
      cookie: ownerCookie,
      headers: { 'idempotency-key': idemKey },
      body: {
        room_id: roomId,
        start_at: at('09:00'),
        end_at: at('10:00'),
        title: 'test: fix idem',
      },
    });
    await harness.db.$client.query('UPDATE rooms SET active = true WHERE id = $1', [roomId]);

    expect(retry.status).toBe(200);
    expect(retry.headers.get('idempotent-replayed')).toBe('true');
    expect(((await retry.json()) as AnyBody).id).toBe(bookingId);
  });

  it('PUT /bookings/:id/attendees replaces the list version-guarded with outbox diff', async () => {
    const added = await request(`/api/v1/bookings/${bookingId}/attendees`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { version: 1, attendees: [{ email: 'Fix-Att@example.com', name: 'Att' }] },
    });
    expect(added.status).toBe(200);
    const addedJson = (await added.json()) as AnyBody;
    expect(addedJson).toMatchObject({
      version: 2,
      attendee_count: 1,
      attendees: [{ email: 'fix-att@example.com', name: 'Att' }],
    });

    const stale = await request(`/api/v1/bookings/${bookingId}/attendees`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { version: 1, attendees: [] },
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: 'VERSION_CONFLICT' });

    const removed = await request(`/api/v1/bookings/${bookingId}/attendees`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { version: 2, attendees: [] },
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ version: 3, attendee_count: 0 });

    const outbox = await harness.db.$client.query(
      `SELECT template_key, dedupe_key FROM notifications
        WHERE booking_id = $1 AND recipient_email = 'fix-att@example.com'
        ORDER BY dedupe_key`,
      [bookingId],
    );
    expect(outbox.rows).toEqual([
      { template_key: 'booking.confirmed', dedupe_key: '2' },
      { template_key: 'booking.cancelled', dedupe_key: '3' },
    ]);
  });

  it('kicks the outbox drain right after an outbox-writing booking tx commits (§5.7)', async () => {
    const kickKey = randomUUID();
    const body = {
      room_id: roomId,
      start_at: at('13:00'),
      end_at: at('14:00'),
      title: 'test: fix kick',
    };

    let before = harness.kicked.count;
    const created = await request('/api/v1/bookings', {
      method: 'POST',
      cookie: ownerCookie,
      headers: { 'idempotency-key': kickKey },
      body,
    });
    expect(created.status).toBe(201);
    const kickedBookingId = ((await created.json()) as AnyBody).id as string;
    expect(harness.kicked.count).toBe(before + 1);

    // A replay commits nothing, so it must not kick.
    before = harness.kicked.count;
    const replay = await request('/api/v1/bookings', {
      method: 'POST',
      cookie: ownerCookie,
      headers: { 'idempotency-key': kickKey },
      body,
    });
    expect(replay.status).toBe(200);
    expect(harness.kicked.count).toBe(before);

    // A detail-only edit writes no outbox row (D-30e) — no kick either.
    before = harness.kicked.count;
    const renamed = await request(`/api/v1/bookings/${kickedBookingId}`, {
      method: 'PATCH',
      cookie: ownerCookie,
      body: { version: 1, title: 'test: fix kick renamed' },
    });
    expect(renamed.status).toBe(200);
    expect(harness.kicked.count).toBe(before);

    // Cancel commits booking.cancelled rows → kick; the idempotent replay does not.
    before = harness.kicked.count;
    const cancelled = await request(`/api/v1/bookings/${kickedBookingId}/cancel`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {},
    });
    expect(cancelled.status).toBe(200);
    expect(harness.kicked.count).toBe(before + 1);
    const again = await request(`/api/v1/bookings/${kickedBookingId}/cancel`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {},
    });
    expect(again.status).toBe(200);
    expect(harness.kicked.count).toBe(before + 1);
  });

  it('serves the .ics to FULL viewers only, SEQUENCE = version', async () => {
    const forbidden = await request(`/api/v1/bookings/${bookingId}/ics`, {
      cookie: strangerCookie,
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'FORBIDDEN_PRIVATE' });

    const response = await request(`/api/v1/bookings/${bookingId}/ics`, { cookie: ownerCookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/calendar');
    const body = await response.text();
    expect(body).toContain(`UID:${bookingId}@localhost:3000`);
    expect(body).toContain('SEQUENCE:3');
    expect(body).toContain('METHOD:REQUEST');
  });

  it('GET /settings returns the full 7-row hours set with a working ETag', async () => {
    const response = await request('/api/v1/settings', { cookie: ownerCookie });
    expect(response.status).toBe(200);
    const etag = response.headers.get('etag');
    expect(etag).toBeTruthy();
    const body = (await response.json()) as AnyBody;
    expect((body.business_hours as unknown[]).length).toBe(7);
    expect(body.settings).toMatchObject({ slot_increment_minutes: 30 });
    expect(body.server_time).toMatch(/\+07:00$/);

    const revalidated = await request('/api/v1/settings', {
      cookie: ownerCookie,
      headers: { 'if-none-match': etag as string },
    });
    expect(revalidated.status).toBe(304);
  });

  it('reports the true total on a page past the end of the list', async () => {
    const response = await request('/api/v1/bookings?page=7&page_size=50', { cookie: ownerCookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[]; page: { total: number } };
    expect(body.data).toEqual([]);
    expect(body.page.total).toBeGreaterThanOrEqual(1);
  });

  it('rate-limits sign-in to 5/min per IP+employee code with Retry-After', async () => {
    const attempt = () =>
      harness.app.request('/api/v1/auth/sign-in', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          employee_code: 'fix-no-such-user',
          password: 'wrong-pass-1',
        }),
      });
    const since = new Date().toISOString();
    for (let n = 0; n < 5; n++) {
      expect((await attempt()).status).toBe(401);
    }
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    await expect(limited.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });

    // audit_logs is append-only and the admin screen renders entity_id verbatim, so an
    // anonymous caller must not get to choose what lands in it. (Rows written before this
    // fix are still in the table — hence the window.)
    const rows = await harness.db.$client.query<{ entity_id: string; c: number }>(
      `SELECT entity_id, count(*)::int AS c FROM audit_logs
        WHERE action = 'auth.login_failed' AND actor_id IS NULL AND created_at >= $1
        GROUP BY entity_id`,
      [since],
    );
    expect(rows.rows).toEqual([{ entity_id: 'unknown', c: 5 }]);
  }, 30_000);
});
