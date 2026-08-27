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
// Lets the pg_locks assertion pick out exactly this suite's backends.
const APP_NAME = 'rf-gate';
const USERS = 5;
const STORM = 100;

/** Next Bangkok date (≥ tomorrow) on Mon/Tue/Thu/Fri — skips weekends and the Wednesday
 * the master-data suite turns into a holiday. */
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

describe.skipIf(!ownerUrl)('release gate: bookings (database)', () => {
  const password = 'gate-test-password-1';
  const day = nextOpenDate();
  const at = (time: string) => new Date(`${day}T${time}:00+07:00`).toISOString();
  let harness: ReturnType<typeof build>;
  let roomId = '';
  const cookies: string[] = [];
  const userIds: string[] = [];

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

  const request = (
    path: string,
    init: { method?: string; cookie: string; body?: unknown; idempotencyKey?: string },
  ) =>
    harness.app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        cookie: init.cookie,
        origin: ORIGIN,
        'content-type': 'application/json',
        ...(init.idempotencyKey === undefined ? {} : { 'idempotency-key': init.idempotencyKey }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  const createBooking = async (
    cookie: string,
    body: AnyBody,
    idempotencyKey: string = randomUUID(),
  ): Promise<{ response: Response; json: AnyBody }> => {
    const response = await request('/api/v1/bookings', {
      method: 'POST',
      cookie,
      body,
      idempotencyKey,
    });
    return { response, json: (await response.json()) as AnyBody };
  };

  beforeAll(async () => {
    const url = new URL(ownerUrl as string);
    url.searchParams.set('application_name', APP_NAME);
    harness = build(url.toString());
    const pool = harness.db.$client;

    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('GATEDEPT','Gate Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );

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
      `INSERT INTO rooms (code, name, capacity, active) VALUES ('gate-room', 'test: gate room', 10, true)
       ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`,
    );
    roomId = room.rows[0].id;

    // Crashed-run residue would trip the EXCLUDE constraint below.
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)`,
      [roomId],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = $1', [roomId]);

    for (let n = 1; n <= USERS; n++) {
      const email = `gate-u${n}@example.com`;
      const employeeCode = `GT-00${n}`;
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rowCount === 0) {
        await harness.auth.api.createUser({
          body: {
            email,
            password,
            name: `Gate User ${n}`,
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
                failed_logins=0, locked_until=NULL, role='EMPLOYEE'
         WHERE email=$1 RETURNING id`,
        [email],
      );
      userIds.push(user.rows[0].id);

      const signIn = await harness.app.request('/api/v1/auth/sign-in', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ employee_code: employeeCode, password }),
      });
      expect(signIn.status).toBe(200);
      const cookie = signIn.headers.getSetCookie().find((v) => v.startsWith('__Host-sid='));
      cookies.push((cookie as string).split(';')[0] as string);
    }
  }, 60_000);

  afterAll(async () => {
    const pool = harness.db.$client;
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)`,
      [roomId],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = $1', [roomId]);
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.end();
  });

  let winner: { id: string; cookie: string; key: string; body: AnyBody } | undefined;

  it(`concurrency gate: ${STORM} parallel creates for one slot → exactly one 201`, async () => {
    const body = {
      room_id: roomId,
      start_at: at('09:00'),
      end_at: at('10:00'),
      title: 'test: gate storm',
    };
    const shots = Array.from({ length: STORM }, (_, i) => ({
      cookie: cookies[i % USERS] as string,
      key: randomUUID(),
    }));
    const results = await Promise.all(
      shots.map(async (shot) => ({
        ...shot,
        ...(await createBooking(shot.cookie, body, shot.key)),
      })),
    );

    const created = results.filter((r) => r.response.status === 201);
    const conflicted = results.filter((r) => r.response.status === 409);
    expect(
      results.map((r) => r.response.status).sort((a, b) => a - b),
      JSON.stringify(results.map((r) => [r.response.status, r.json.code ?? null])),
    ).toEqual([201, ...Array(STORM - 1).fill(409)]);
    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(STORM - 1);
    for (const r of conflicted) {
      expect(r.json.code).toBe('SLOT_UNAVAILABLE');
    }

    const win = created[0] as (typeof results)[number];
    expect(win.json).toMatchObject({ status: 'CONFIRMED', version: 1 });
    winner = { id: win.json.id as string, cookie: win.cookie, key: win.key, body };

    const rows = await harness.db.$client.query(
      'SELECT count(*)::int AS n FROM bookings WHERE room_id = $1 AND start_at = $2',
      [roomId, body.start_at],
    );
    expect(rows.rows[0].n).toBe(1);
  }, 120_000);

  it('idempotency: replaying the winning key returns the same booking, no second row', async () => {
    expect(winner).toBeDefined();
    const w = winner as NonNullable<typeof winner>;
    const { response, json } = await createBooking(w.cookie, w.body, w.key);

    expect(response.status).toBe(200);
    expect(response.headers.get('idempotent-replayed')).toBe('true');
    expect(json.id).toBe(w.id);

    const rows = await harness.db.$client.query(
      'SELECT count(*)::int AS n FROM bookings WHERE room_id = $1 AND start_at = $2',
      [roomId, w.body.start_at as string],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('CB-03: colliding reschedule 409s and leaves the row byte-identical', async () => {
    const cookie = cookies[0] as string;
    const a = await createBooking(cookie, {
      room_id: roomId,
      start_at: at('13:00'),
      end_at: at('14:00'),
      title: 'test: gate cb03 A',
    });
    expect(a.response.status).toBe(201);
    const b = await createBooking(cookie, {
      room_id: roomId,
      start_at: at('14:00'),
      end_at: at('15:00'),
      title: 'test: gate cb03 B',
    });
    expect(b.response.status).toBe(201);

    const patch = await request(`/api/v1/bookings/${a.json.id}`, {
      method: 'PATCH',
      cookie,
      body: { version: 1, start_at: at('14:00'), end_at: at('15:00') },
    });
    expect(patch.status).toBe(409);
    await expect(patch.json()).resolves.toMatchObject({ code: 'SLOT_UNAVAILABLE' });

    const row = await harness.db.$client.query(
      'SELECT start_at, end_at, version, status, room_id FROM bookings WHERE id = $1',
      [a.json.id],
    );
    expect(row.rows[0]).toMatchObject({ version: 1, status: 'CONFIRMED', room_id: roomId });
    expect((row.rows[0].start_at as Date).toISOString()).toBe(at('13:00'));
    expect((row.rows[0].end_at as Date).toISOString()).toBe(at('14:00'));

    const detail = await request(`/api/v1/bookings/${a.json.id}`, { cookie });
    await expect(detail.json()).resolves.toMatchObject({
      version: 1,
      start_at: `${day}T13:00:00.000+07:00`,
      end_at: `${day}T14:00:00.000+07:00`,
    });
  });

  it('advisory locks are transaction-scoped: none survive the storm', async () => {
    const pool = harness.db.$client;
    // (a) no backend of THIS suite's pool holds any advisory lock…
    const mine = await pool.query(
      `SELECT count(*)::int AS n
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND a.application_name = $1`,
      [APP_NAME],
    );
    expect(mine.rows[0].n).toBe(0);
    // (b) …and nobody at all still holds the gate room's lock key.
    const roomKey = await pool.query(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory'
          AND objid::bigint = (hashtext($1::text)::bigint & 4294967295)`,
      [roomId],
    );
    expect(roomKey.rows[0].n).toBe(0);
  });
});
