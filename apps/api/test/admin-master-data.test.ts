import { setTimeout as sleep } from 'node:timers/promises';

import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth/index.js';
import { authSchema } from '../src/auth/schema.js';
import { createDb } from '../src/db/index.js';
import { createLogger } from '../src/lib/logger.js';
import type { Settings } from '../src/lib/settings.js';
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
type SettingsBody = { settings: Settings; holidays: { date: string; name: string }[] };
type BusinessHourRow = {
  weekday: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
};

const DAY_MS = 86_400_000;

/** Bangkok YYYY-MM-DD of the first Mon–Fri at least `minAhead` days out. */
function weekdayAhead(minAhead: number): string {
  for (let ahead = minAhead; ahead < minAhead + 7; ahead++) {
    const parts = bangkokParts(new Date(Date.now() + ahead * DAY_MS));
    if (parts.isoWeekday <= 5) {
      return parts.date;
    }
  }
  throw new Error('unreachable');
}

function isoWeekdayOf(date: string): number {
  return bangkokParts(new Date(`${date}T10:00:00+07:00`)).isoWeekday;
}

/** Valid JPEG magic bytes; nothing here decodes an image, only sniffs the header. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(48).fill(0x41), 0xff, 0xd9]);

describe.skipIf(!ownerUrl)('admin master data: rooms, hours, holidays, settings (database)', () => {
  const password = 'mw-test-password-1';
  const roomCodes = ['mw-alpha', 'mw-closed', 'mw-photo', 'mw-hours', 'mw-holiday'];
  const featureKey = 'mw_projector';
  const holidayDate = weekdayAhead(8);
  const hoursDate = weekdayAhead(15);
  const holidayYear = Number(holidayDate.slice(0, 4));

  let harness: ReturnType<typeof build>;
  let adminCookie = '';
  let employeeCookie = '';
  const userIds: string[] = [];
  const roomIds: Record<string, string> = {};

  // Business hours, holidays and settings are GLOBAL rows every other suite reads. Snapshot
  // them before the first write and put them back in afterAll, whatever happened in between.
  let hoursSnapshot: BusinessHourRow[] = [];
  let settingsSnapshot: { key: string; value: unknown }[] = [];
  let holidaySnapshot: { date: string; name: string }[] = [];

  const request = async (
    path: string,
    init: {
      method?: string;
      cookie: string;
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<Response> => {
    const form = init.body instanceof FormData;
    return harness.app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        cookie: init.cookie,
        origin: ORIGIN,
        ...(form ? {} : { 'content-type': 'application/json' }),
        ...(init.headers ?? {}),
      },
      ...(init.body === undefined
        ? {}
        : { body: form ? (init.body as FormData) : JSON.stringify(init.body) }),
    });
  };

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

  const createRoom = async (body: AnyBody): Promise<Response> =>
    request('/api/v1/admin/rooms', { method: 'POST', cookie: adminCookie, body });

  const book = async (roomId: string, date: string, hour: number): Promise<Response> =>
    request('/api/v1/bookings', {
      method: 'POST',
      cookie: employeeCookie,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: {
        room_id: roomId,
        start_at: new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+07:00`).toISOString(),
        end_at: new Date(`${date}T${String(hour + 1).padStart(2, '0')}:00:00+07:00`).toISOString(),
        title: 'test: mw booking',
      },
    });

  const currentSettings = async (): Promise<{ etag: string; body: SettingsBody }> => {
    const response = await request('/api/v1/settings', { cookie: adminCookie });
    expect(response.status).toBe(200);
    return {
      etag: response.headers.get('etag') as string,
      body: (await response.json()) as SettingsBody,
    };
  };

  const wipeRooms = async () => {
    const pool = harness.db.$client;
    const ids = await pool.query('SELECT id FROM rooms WHERE code = ANY($1::text[])', [roomCodes]);
    const targets = ids.rows.map((row: { id: string }) => row.id);
    if (targets.length > 0) {
      await pool.query(
        'DELETE FROM notifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = ANY($1::uuid[]))',
        [targets],
      );
      await pool.query('DELETE FROM bookings WHERE room_id = ANY($1::uuid[])', [targets]);
      await pool.query('DELETE FROM room_features WHERE room_id = ANY($1::uuid[])', [targets]);
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::uuid[])', [targets]);
    }
  };

  beforeAll(async () => {
    harness = build(ownerUrl as string);
    const pool = harness.db.$client;

    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('MWDEPT','Master Writes Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name, active = true RETURNING id`,
    );
    for (const [email, employeeCode, fullName, role] of [
      ['mw-admin@example.com', 'MW-001', 'MW Admin', 'ADMIN'],
      ['mw-user@example.com', 'MW-002', 'MW Employee', 'EMPLOYEE'],
    ] as const) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rowCount === 0) {
        await harness.auth.api.createUser({
          body: {
            email,
            password,
            name: fullName,
            role,
            data: {
              employee_code: employeeCode,
              department_id: department.rows[0].id,
              status: 'ACTIVE',
            },
          },
        });
      }
      const user = await pool.query(
        `UPDATE users SET status='ACTIVE', banned=false, disabled_at=NULL, failed_logins=0,
                locked_until=NULL, role=$2 WHERE email=$1 RETURNING id`,
        [email, role],
      );
      userIds.push(user.rows[0].id);
    }
    await wipeRooms();
    await pool.query(
      `INSERT INTO features (key, name, icon) VALUES ($1, 'MW Projector', 'projector')
       ON CONFLICT (key) DO NOTHING`,
      [featureKey],
    );

    hoursSnapshot = (
      await pool.query<BusinessHourRow>(
        `SELECT weekday, is_open, open_time::text AS open_time, close_time::text AS close_time
           FROM business_hours ORDER BY weekday`,
      )
    ).rows;
    settingsSnapshot = (await pool.query('SELECT key, value FROM settings')).rows;
    holidaySnapshot = (
      await pool.query('SELECT day::text AS date, name FROM holidays WHERE day BETWEEN $1 AND $2', [
        `${holidayYear}-01-01`,
        `${holidayYear + 1}-12-31`,
      ])
    ).rows;

    adminCookie = await signIn('MW-001');
    employeeCookie = await signIn('MW-002');
  }, 30_000);

  afterAll(async () => {
    const pool = harness.db.$client;
    await wipeRooms();
    await pool.query('DELETE FROM features WHERE key = $1', [featureKey]);

    await pool.query('DELETE FROM holidays WHERE day BETWEEN $1 AND $2', [
      `${holidayYear}-01-01`,
      `${holidayYear + 1}-12-31`,
    ]);
    for (const holiday of holidaySnapshot) {
      await pool.query('INSERT INTO holidays (day, name) VALUES ($1::date, $2)', [
        holiday.date,
        holiday.name,
      ]);
    }
    await pool.query('DELETE FROM settings');
    for (const setting of settingsSnapshot) {
      await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)', [
        setting.key,
        JSON.stringify(setting.value),
      ]);
    }
    for (const row of hoursSnapshot) {
      await pool.query(
        `INSERT INTO business_hours (weekday, is_open, open_time, close_time)
         VALUES ($1, $2, $3::time, $4::time)
         ON CONFLICT (weekday) DO UPDATE SET is_open = excluded.is_open,
                open_time = excluded.open_time, close_time = excluded.close_time`,
        [row.weekday, row.is_open, row.open_time, row.close_time],
      );
    }

    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.end();
  }, 30_000);

  it('hides every admin master-data path from an employee behind 404, never 403', async () => {
    const attempts: [string, string, unknown][] = [
      ['POST', '/api/v1/admin/rooms', { code: 'mw-nope', name: 'x', capacity: 2 }],
      ['PATCH', '/api/v1/admin/rooms/00000000-0000-0000-0000-000000000000', { active: false }],
      ['PUT', '/api/v1/admin/rooms/00000000-0000-0000-0000-000000000000/features', []],
      ['PUT', '/api/v1/admin/settings', {}],
      ['PUT', '/api/v1/admin/business-hours', []],
      ['PUT', '/api/v1/admin/holidays', { year: holidayYear, holidays: [] }],
    ];
    for (const [method, path, body] of attempts) {
      const response = await request(path, { method, cookie: employeeCookie, body });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect((await json(response)).code, `${method} ${path}`).toBe('NOT_FOUND');
    }
  });

  it('creates a room with features, refuses a duplicate code and an unknown feature key', async () => {
    const created = await createRoom({
      code: 'mw-alpha',
      name: 'test: MW Alpha',
      floor: '3',
      location: 'North wing',
      capacity: 8,
      features: [{ key: featureKey, quantity: 2 }],
    });
    expect(created.status).toBe(201);
    const room = await json(created);
    roomIds['mw-alpha'] = room.id as string;
    expect(room).toMatchObject({ code: 'mw-alpha', capacity: 8, active: true, photo_url: null });
    expect(room.features).toEqual([
      { key: featureKey, name: 'MW Projector', icon: 'projector', quantity: 2 },
    ]);
    expect(created.headers.get('location')).toBe(`/api/v1/admin/rooms/${room.id}`);

    const duplicate = await createRoom({ code: 'mw-alpha', name: 'test: dup', capacity: 2 });
    expect(duplicate.status).toBe(409);
    expect(await json(duplicate)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'code' },
    });

    const unknownFeature = await createRoom({
      code: 'mw-unknown',
      name: 'test: unknown feature',
      capacity: 2,
      features: [{ key: 'mw_nothing' }],
    });
    expect(unknownFeature.status).toBe(400);
    expect(await json(unknownFeature)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'features' },
    });
    // The failed create rolled back with its features — no orphan room row.
    const orphan = await harness.db.$client.query("SELECT id FROM rooms WHERE code = 'mw-unknown'");
    expect(orphan.rowCount).toBe(0);
  });

  it('refuses to change a room code and replaces the whole feature set on PUT', async () => {
    const id = roomIds['mw-alpha'] as string;

    const renamed = await request(`/api/v1/admin/rooms/${id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { code: 'mw-renamed' },
    });
    expect(renamed.status).toBe(400);
    expect((await json(renamed)).code).toBe('VALIDATION_FAILED');

    const cleared = await request(`/api/v1/admin/rooms/${id}/features`, {
      method: 'PUT',
      cookie: adminCookie,
      body: [],
    });
    expect(cleared.status).toBe(200);
    expect((await json(cleared)).features).toEqual([]);

    const restored = await request(`/api/v1/admin/rooms/${id}/features`, {
      method: 'PUT',
      cookie: adminCookie,
      body: [{ key: featureKey, quantity: 1 }],
    });
    expect(restored.status).toBe(200);
    expect((await json(restored)).features).toMatchObject([{ key: featureKey, quantity: 1 }]);
  });

  it('publishes the feature catalogue the room forms pick from (GET /features)', async () => {
    // Without this the keys PUT .../features accepts are unknowable to any client.
    const response = await request('/api/v1/features', { cookie: employeeCookie });
    expect(response.status).toBe(200);
    const catalogue = (await json(response)).data as AnyBody[];
    const seeded = catalogue.find((row) => row.key === featureKey);
    expect(seeded).toEqual({ key: featureKey, name: 'MW Projector', icon: 'projector' });
    expect((await harness.app.request('/api/v1/features')).status).toBe(401);
  });

  it('deactivating a room leaves its future bookings alone and only refuses NEW ones', async () => {
    const created = await createRoom({ code: 'mw-closed', name: 'test: MW Closed', capacity: 4 });
    expect(created.status).toBe(201);
    const id = (await json(created)).id as string;
    roomIds['mw-closed'] = id;

    const booked = await book(id, weekdayAhead(9), 10);
    expect(booked.status, await booked.clone().text()).toBe(201);
    const bookingId = (await json(booked)).id as string;

    const closed = await request(`/api/v1/admin/rooms/${id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { active: false },
    });
    expect(closed.status).toBe(200);
    expect((await json(closed)).active).toBe(false);

    // 1. The committed booking is untouched: still CONFIRMED, still readable by its owner.
    const existing = await request(`/api/v1/bookings/${bookingId}`, { cookie: employeeCookie });
    expect(existing.status).toBe(200);
    expect((await json(existing)).status).toBe('CONFIRMED');

    // 2. The room is gone from the employee's world (404, never 403) but visible to admins.
    const list = await json(await request('/api/v1/rooms', { cookie: employeeCookie }));
    expect((list.data as AnyBody[]).some((entry) => entry.id === id)).toBe(false);
    expect((await request(`/api/v1/rooms/${id}`, { cookie: employeeCookie })).status).toBe(404);
    expect((await request(`/api/v1/rooms/${id}`, { cookie: adminCookie })).status).toBe(200);

    // 3. Only new requests are refused.
    const refused = await book(id, weekdayAhead(10), 10);
    expect(refused.status).toBe(422);
    expect((await json(refused)).code).toBe('ROOM_INACTIVE');

    const audit = await harness.db.$client.query(
      `SELECT action, before, after FROM audit_logs
        WHERE entity_type = 'room' AND entity_id = $1 AND action = 'room.update'
        ORDER BY id DESC LIMIT 1`,
      [id],
    );
    expect(audit.rows[0].before.active).toBe(true);
    expect(audit.rows[0].after.active).toBe(false);
  });

  it('takes the same room advisory lock createBooking does (TC-ROOM-028 barrier)', async () => {
    const id = roomIds['mw-closed'] as string;
    const blocker = await harness.db.$client.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [id]);

      let settled = false;
      const patch = request(`/api/v1/admin/rooms/${id}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { name: 'test: MW Closed (renamed)' },
      }).then((response) => {
        settled = true;
        return response;
      });

      await sleep(300);
      expect(settled, 'PATCH ran without the room lock').toBe(false);

      await blocker.query('ROLLBACK');
      expect((await patch).status).toBe(200);
    } finally {
      blocker.release();
    }
  });

  it('enforces the photo size and magic-byte limits, then round-trips the image', async () => {
    const created = await createRoom({ code: 'mw-photo', name: 'test: MW Photo', capacity: 2 });
    expect(created.status).toBe(201);
    const id = (await json(created)).id as string;
    roomIds['mw-photo'] = id;
    const path = `/api/v1/admin/rooms/${id}/photo`;

    const upload = async (file: File): Promise<Response> => {
      const form = new FormData();
      form.append('file', file);
      return request(path, { method: 'POST', cookie: adminCookie, body: form });
    };

    const tooBig = await upload(
      new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' }),
    );
    expect(tooBig.status).toBe(413);

    // A text file renamed .jpg and labelled image/jpeg: the client's word counts for nothing.
    const notAnImage = await upload(
      new File([new TextEncoder().encode('not an image at all')], 'evil.jpg', {
        type: 'image/jpeg',
      }),
    );
    expect(notAnImage.status).toBe(415);

    const ok = await upload(new File([JPEG], 'room.jpg', { type: 'application/octet-stream' }));
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await json(ok)).toEqual({ photo_url: `/api/v1/rooms/${id}/photo` });

    const served = await request(`/api/v1/rooms/${id}/photo`, { cookie: employeeCookie });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);
    expect(
      (await json(await request(`/api/v1/rooms/${id}`, { cookie: employeeCookie }))).photo_url,
    ).toBe(`/api/v1/rooms/${id}/photo`);

    const audit = await harness.db.$client.query(
      `SELECT after FROM audit_logs WHERE entity_id = $1 AND action = 'room.photo_update'
        ORDER BY id DESC LIMIT 1`,
      [id],
    );
    // The bytes themselves never reach the audit row.
    expect(audit.rows[0].after).toEqual({ bytes: JPEG.byteLength, mime: 'image/jpeg' });

    const removed = await request(path, { method: 'DELETE', cookie: adminCookie });
    expect(removed.status).toBe(204);
    expect((await request(`/api/v1/rooms/${id}/photo`, { cookie: employeeCookie })).status).toBe(
      404,
    );
  });

  it('a new holiday closes the day for new bookings only, and leaves other years alone', async () => {
    const created = await createRoom({ code: 'mw-holiday', name: 'test: MW Holiday', capacity: 2 });
    expect(created.status).toBe(201);
    const id = (await json(created)).id as string;
    roomIds['mw-holiday'] = id;

    const booked = await book(id, holidayDate, 10);
    expect(booked.status, await booked.clone().text()).toBe(201);
    const bookingId = (await json(booked)).id as string;

    // Next year's document must survive a write to this year's.
    await harness.db.$client.query(
      `INSERT INTO holidays (day, name) VALUES ($1::date, 'test: MW Next Year')
       ON CONFLICT (day) DO UPDATE SET name = excluded.name`,
      [`${holidayYear + 1}-06-01`],
    );

    const written = await request('/api/v1/admin/holidays', {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        year: holidayYear,
        holidays: [{ date: holidayDate, name: 'test: MW Holiday Day' }],
      },
    });
    expect(written.status).toBe(200);
    expect((await json(written)).holidays).toEqual([
      { date: holidayDate, name: 'test: MW Holiday Day' },
    ]);

    // The booking that already existed on that day is NEVER retroactively invalidated.
    const existing = await request(`/api/v1/bookings/${bookingId}`, { cookie: employeeCookie });
    expect(existing.status).toBe(200);
    expect((await json(existing)).status).toBe('CONFIRMED');

    const refused = await book(id, holidayDate, 13);
    expect(refused.status).toBe(422);
    expect(await json(refused)).toMatchObject({
      code: 'OUTSIDE_BUSINESS_HOURS',
      details: { reason: 'HOLIDAY', holiday_name: 'test: MW Holiday Day' },
    });

    const nextYear = await harness.db.$client.query(
      'SELECT name FROM holidays WHERE day = $1::date',
      [`${holidayYear + 1}-06-01`],
    );
    expect(nextYear.rows[0]?.name).toBe('test: MW Next Year');

    expect(
      (
        await request('/api/v1/admin/holidays', {
          method: 'PUT',
          cookie: adminCookie,
          body: { year: holidayYear, holidays: [] },
        })
      ).status,
    ).toBe(200);

    for (const bad of [
      { year: holidayYear, holidays: [{ date: `${holidayYear + 1}-01-01`, name: 'wrong year' }] },
      { year: holidayYear, holidays: [{ date: `${holidayYear}-02-30`, name: 'not a date' }] },
      {
        year: holidayYear,
        holidays: [
          { date: holidayDate, name: 'a' },
          { date: holidayDate, name: 'b' },
        ],
      },
    ]) {
      const response = await request('/api/v1/admin/holidays', {
        method: 'PUT',
        cookie: adminCookie,
        body: bad,
      });
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('closing a weekday shuts it for new requests without touching what is booked', async () => {
    const created = await createRoom({ code: 'mw-hours', name: 'test: MW Hours', capacity: 2 });
    expect(created.status).toBe(201);
    const id = (await json(created)).id as string;
    roomIds['mw-hours'] = id;

    const booked = await book(id, hoursDate, 10);
    expect(booked.status, await booked.clone().text()).toBe(201);
    const bookingId = (await json(booked)).id as string;

    const closedWeekday = isoWeekdayOf(hoursDate);
    const putHours = async (body: unknown) =>
      request('/api/v1/admin/business-hours', { method: 'PUT', cookie: adminCookie, body });

    const rows = hoursSnapshot.map((row) => ({
      weekday: row.weekday,
      is_open: row.weekday === closedWeekday ? false : row.is_open,
      open_time: row.weekday === closedWeekday ? null : row.open_time,
      close_time: row.weekday === closedWeekday ? null : row.close_time,
    }));
    const written = await putHours(rows);
    expect(written.status, await written.clone().text()).toBe(200);
    expect((await written.json()) as BusinessHourRow[]).toContainEqual({
      weekday: closedWeekday,
      is_open: false,
      open_time: null,
      close_time: null,
    });

    const existing = await request(`/api/v1/bookings/${bookingId}`, { cookie: employeeCookie });
    expect(existing.status).toBe(200);
    expect((await json(existing)).status).toBe('CONFIRMED');

    const refused = await book(id, hoursDate, 13);
    expect(refused.status).toBe(422);
    expect(await json(refused)).toMatchObject({
      code: 'OUTSIDE_BUSINESS_HOURS',
      details: { reason: 'CLOSED_DAY' },
    });

    // Restore the company seed before anything else reads it.
    expect(
      (
        await putHours(
          hoursSnapshot.map((row) => ({
            weekday: row.weekday,
            is_open: row.is_open,
            open_time: row.open_time,
            close_time: row.close_time,
          })),
        )
      ).status,
    ).toBe(200);
    expect((await book(id, hoursDate, 13)).status).toBe(201);

    for (const bad of [
      rows.slice(0, 6),
      rows.map((row) => ({ ...row, weekday: 1 })),
      rows.map((row) => (row.weekday === 1 ? { ...row, is_open: true, open_time: null } : row)),
      rows.map((row) =>
        row.weekday === 1
          ? { ...row, is_open: true, open_time: '18:00', close_time: '09:00' }
          : row,
      ),
    ]) {
      expect((await putHours(bad)).status).toBe(400);
    }
  });

  it('guards the settings document with If-Match, validates its ranges, and invalidates the cache', async () => {
    const initial = await currentSettings();
    expect(initial.body.settings.max_advance_days).toBe(30);

    const put = async (body: unknown, etag?: string) =>
      request('/api/v1/admin/settings', {
        method: 'PUT',
        cookie: adminCookie,
        body,
        ...(etag === undefined ? {} : { headers: { 'if-match': etag } }),
      });

    const noHeader = await put(initial.body.settings);
    expect(noHeader.status).toBe(400);
    expect((await json(noHeader)).code).toBe('VALIDATION_FAILED');

    const stale = await put(initial.body.settings, '"deadbeefdeadbeef"');
    expect(stale.status).toBe(409);
    expect((await json(stale)).code).toBe('VERSION_CONFLICT');

    for (const invalid of [
      { min_duration_minutes: 45 }, // not a multiple of the 30-minute increment
      { slot_increment_minutes: 45 },
      { checkin_grace_minutes: 0 },
      { checkin_grace_minutes: 121 },
      { max_advance_days: 0 },
      { max_duration_minutes: 30 }, // below min_duration_minutes
      // §5.10: 0 or a multiple of slot_increment_minutes. 30 IS legal and is exercised
      // end-to-end in bookings.test.ts — the grid and POST /bookings both honour it.
      { buffer_minutes: 25 },
      { min_lead_minutes: -1 },
      { reminder_minutes_before: 1441 },
    ]) {
      const response = await put({ ...initial.body.settings, ...invalid }, initial.etag);
      expect(response.status, JSON.stringify(invalid)).toBe(400);
      expect((await json(response)).code).toBe('VALIDATION_FAILED');
    }
    // An unknown key is rejected outright — the document is written whole.
    expect((await put({ ...initial.body.settings, nonsense: 1 }, initial.etag)).status).toBe(400);

    const saved = await put({ ...initial.body.settings, max_advance_days: 45 }, initial.etag);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const savedEtag = saved.headers.get('etag') as string;
    expect(savedEtag).not.toBe(initial.etag);
    expect(((await json(saved)).settings as Settings).max_advance_days).toBe(45);

    // The 60 s memo must be dropped post-commit or the write is invisible to this process.
    const reread = await currentSettings();
    expect(reread.body.settings.max_advance_days).toBe(45);
    expect(reread.etag).toBe(savedEtag);

    // The stale ETag from before the save no longer opens the door.
    expect((await put(initial.body.settings, initial.etag)).status).toBe(409);

    const audit = await harness.db.$client.query(
      `SELECT before, after FROM audit_logs
        WHERE entity_type = 'settings' AND entity_id = 'settings' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.rows[0].before.max_advance_days).toBe(30);
    expect(audit.rows[0].after.max_advance_days).toBe(45);

    const restored = await put(initial.body.settings, reread.etag);
    expect(restored.status).toBe(200);
    expect((await currentSettings()).body.settings.max_advance_days).toBe(30);
  });
});
