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
const jsonHeaders = { origin: ORIGIN, 'content-type': 'application/json' };

type AvailabilityBody = {
  rooms: { room: { id: string; code: string }; available: boolean; reasons: string[] }[];
};
type CalendarBody = {
  business_hours: { weekday: number; is_open: boolean }[];
  holidays: { date: string; name: string }[];
  bookings: Record<string, unknown>[];
};

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

/** Bangkok date (YYYY-MM-DD) of the next occurrence of an ISO weekday, at least tomorrow. */
function nextBangkokDate(isoWeekday: number): string {
  for (let ahead = 1; ahead <= 8; ahead++) {
    const parts = bangkokParts(new Date(Date.now() + ahead * 86_400_000));
    if (parts.isoWeekday === isoWeekday) {
      return parts.date;
    }
  }
  throw new Error('unreachable');
}

describe.skipIf(!ownerUrl)('master data reads (database)', () => {
  const password = 'md-test-password-1';
  const ownerEmail = 'md-owner@example.com';
  const strangerEmail = 'md-stranger@example.com';
  const saturday = nextBangkokDate(6);
  const wednesday = nextBangkokDate(3); // becomes a holiday
  const thursday = nextBangkokDate(4); // carries the private booking
  let harness: ReturnType<typeof build>;
  let roomId: string;
  let bookingId: string;
  let publicBookingId: string;
  let ownerCookie: string;
  let strangerCookie: string;
  const userIds: string[] = [];

  const signInCookie = async (employeeCode: string) => {
    const response = await harness.app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ employee_code: employeeCode, password }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-sid='));
    return (cookie as string).split(';')[0] as string;
  };

  const getJson = async <T>(path: string, cookie: string): Promise<T> => {
    const response = await harness.app.request(path, { headers: { cookie } });
    expect(response.status, path).toBe(200);
    return (await response.json()) as T;
  };

  beforeAll(async () => {
    harness = build(ownerUrl as string);
    const pool = harness.db.$client;

    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('MDDEPT','Master Data Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    for (const [email, employeeCode, fullName] of [
      [ownerEmail, 'MD-001', 'MD Owner'],
      [strangerEmail, 'MD-002', 'MD Stranger'],
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

    // The intended company-wide seed (CB-04): Mon–Fri 08:30–17:30 open, Sat/Sun closed.
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
      `INSERT INTO rooms (code, name, capacity) VALUES ('md-room','test: MD Room',4)
       ON CONFLICT (code) DO UPDATE SET active = true, capacity = 4 RETURNING id`,
    );
    roomId = room.rows[0].id;

    await pool.query(`DELETE FROM holidays WHERE name LIKE 'test:%'`);
    await pool.query(`INSERT INTO holidays (day, name) VALUES ($1, 'test: MD Holiday')`, [
      wednesday,
    ]);

    // Crashed-run residue would trip the EXCLUDE constraint on the insert below.
    await pool.query(`DELETE FROM bookings WHERE room_id = $1 AND title LIKE 'test:%'`, [roomId]);
    const booking = await pool.query(
      `INSERT INTO bookings (room_id, owner_id, created_by, title, is_private,
                             start_at, end_at, status, confirmed_at, idempotency_key)
       VALUES ($1, $2, $2, 'test: private sync', true, $3, $4, 'CONFIRMED', now(),
               gen_random_uuid())
       RETURNING id`,
      [
        roomId,
        userIds[0],
        new Date(`${thursday}T10:00:00+07:00`).toISOString(),
        new Date(`${thursday}T11:00:00+07:00`).toISOString(),
      ],
    );
    bookingId = booking.rows[0].id;
    const publicBooking = await pool.query(
      `INSERT INTO bookings (room_id, owner_id, created_by, title, is_private,
                             start_at, end_at, status, confirmed_at, idempotency_key)
       VALUES ($1, $2, $2, 'test: public sync', false, $3, $4, 'CONFIRMED', now(),
               gen_random_uuid())
       RETURNING id`,
      [
        roomId,
        userIds[0],
        new Date(`${thursday}T13:00:00+07:00`).toISOString(),
        new Date(`${thursday}T14:00:00+07:00`).toISOString(),
      ],
    );
    publicBookingId = publicBooking.rows[0].id;

    ownerCookie = await signInCookie('MD-001');
    strangerCookie = await signInCookie('MD-002');
  }, 30_000);

  afterAll(async () => {
    const pool = harness.db.$client;
    await pool.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [
      [bookingId, publicBookingId],
    ]);
    await pool.query(`DELETE FROM holidays WHERE name LIKE 'test:%'`);
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.end();
  });

  it('lists active rooms with features and no photo url', async () => {
    const body = await getJson<{ data: Record<string, unknown>[] }>('/api/v1/rooms', ownerCookie);

    const room = body.data.find((entry) => entry.id === roomId);
    expect(room).toMatchObject({
      code: 'md-room',
      capacity: 4,
      active: true,
      photo_url: null,
      features: [],
    });
    expect(room?.created_at).toMatch(/\+07:00$/);
  });

  it('closed Saturday: every room is unavailable with reason CLOSED, and the calendar day is structurally closed', async () => {
    const query = new URLSearchParams({
      start: new Date(`${saturday}T10:00:00+07:00`).toISOString(),
      end: new Date(`${saturday}T11:00:00+07:00`).toISOString(),
    });
    const body = await getJson<AvailabilityBody>(`/api/v1/availability?${query}`, ownerCookie);

    expect(body.rooms.length).toBeGreaterThan(0);
    for (const entry of body.rooms) {
      expect(entry.available).toBe(false);
      expect(entry.reasons).toContain('CLOSED');
    }

    const calendar = await getJson<CalendarBody>(
      `/api/v1/calendar?from=${saturday}&to=${saturday}`,
      ownerCookie,
    );
    // Zero slots fall out structurally: the only business_hours row in range is closed.
    expect(calendar.business_hours).toEqual([
      { weekday: 6, is_open: false, open_time: null, close_time: null },
    ]);
  });

  it('a holiday closes an otherwise open Wednesday', async () => {
    const query = new URLSearchParams({
      start: new Date(`${wednesday}T10:00:00+07:00`).toISOString(),
      end: new Date(`${wednesday}T11:00:00+07:00`).toISOString(),
    });
    const body = await getJson<AvailabilityBody>(`/api/v1/availability?${query}`, ownerCookie);

    expect(body.rooms.length).toBeGreaterThan(0);
    for (const entry of body.rooms) {
      expect(entry.available).toBe(false);
      expect(entry.reasons).toContain('HOLIDAY');
    }

    const calendar = await getJson<CalendarBody>(
      `/api/v1/calendar?from=${wednesday}&to=${wednesday}`,
      ownerCookie,
    );
    expect(calendar.holidays).toEqual([{ date: wednesday, name: 'test: MD Holiday' }]);
    expect(calendar.business_hours).toEqual([
      { weekday: 3, is_open: true, open_time: '08:30:00', close_time: '17:30:00' },
    ]);
  });

  it('reports the booked room BUSY for the overlapping window', async () => {
    const query = new URLSearchParams({
      start: new Date(`${thursday}T10:00:00+07:00`).toISOString(),
      end: new Date(`${thursday}T11:00:00+07:00`).toISOString(),
    });
    const body = await getJson<AvailabilityBody>(`/api/v1/availability?${query}`, ownerCookie);

    const entry = body.rooms.find((candidate) => candidate.room.id === roomId);
    expect(entry).toMatchObject({ available: false, reasons: ['BUSY'] });
    expect((entry as { busy_until?: string }).busy_until).toBe(`${thursday}T11:00:00.000+07:00`);
  });

  it('masks a private calendar title but identifies the reservation owner', async () => {
    const body = await getJson<CalendarBody>(
      `/api/v1/calendar?from=${thursday}&to=${thursday}&room_id=${roomId}`,
      strangerCookie,
    );

    const entry = body.bookings.find((candidate) => candidate.id === bookingId);
    expect(entry).toBeDefined();
    // Calendar adds only the display name. Private title and owner details stay absent.
    expect(Object.keys(entry as object).sort()).toEqual([
      'end_at',
      'id',
      'is_mine',
      'is_private',
      'owner_display_name',
      'room_id',
      'start_at',
      'status',
      'visibility',
    ]);
    expect(entry).toMatchObject({
      visibility: 'BUSY',
      owner_display_name: 'MD Owner',
      is_mine: false,
      is_private: true,
      status: 'CONFIRMED',
    });
    expect(entry).not.toHaveProperty('title');
    expect(entry).not.toHaveProperty('owner');
  });

  it('shows the owner the FULL private booking on the same URL', async () => {
    const body = await getJson<CalendarBody>(
      `/api/v1/calendar?from=${thursday}&to=${thursday}&room_id=${roomId}`,
      ownerCookie,
    );

    const entry = body.bookings.find((candidate) => candidate.id === bookingId);
    expect(entry).toMatchObject({
      visibility: 'FULL',
      is_mine: true,
      title: 'test: private sync',
      attendee_count: 0,
      attendees: [],
      version: 1,
      owner_display_name: 'MD Owner',
    });
    expect((entry as { owner: { full_name: string } }).owner.full_name).toBe('MD Owner');
    expect(entry?.start_at).toMatch(/\+07:00$/);
  });

  it('includes the reservation owner name on a public calendar booking', async () => {
    const body = await getJson<CalendarBody>(
      `/api/v1/calendar?from=${thursday}&to=${thursday}&room_id=${roomId}`,
      strangerCookie,
    );

    const entry = body.bookings.find((candidate) => candidate.id === publicBookingId);
    expect(entry).toMatchObject({
      visibility: 'PUBLIC',
      title: 'test: public sync',
      owner_display_name: 'MD Owner',
      owner: { full_name: 'MD Owner' },
    });
  });
});
