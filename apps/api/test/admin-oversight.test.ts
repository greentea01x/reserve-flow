import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth/index.js';
import { authSchema } from '../src/auth/schema.js';
import { createDb } from '../src/db/index.js';
import { createLogger } from '../src/lib/logger.js';
import { bangkokParts } from '../src/lib/time.js';

/**
 * Step 3 — oversight. Everything here is read-mostly, so the fixtures go in with plain SQL:
 * the reports must be checked against numbers we chose, not against whatever the booking
 * window rules allow at the moment the suite runs.
 */

const ownerUrl = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:5174';
const GRID_MS = 900_000;

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

/** Postgres `round(numeric, 1)`: half away from zero, which Math.round matches for positives. */
function round1(value: number): number {
  return Math.round(value * 10 + Number.EPSILON) / 10;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Overlap of [start,end) with the business window, in minutes. */
function overlapMinutes(start: string, end: string, open: string, close: string): number {
  return Math.max(
    0,
    Math.min(minutesOf(end), minutesOf(close)) - Math.max(minutesOf(start), minutesOf(open)),
  );
}

describe.skipIf(!ownerUrl)('admin oversight: masking, cancel, check-in, reports, audit', () => {
  const password = 'ov-test-password-1';
  const roomCodes = ['ov-report', 'ov-live', 'ov-k2', 'ov-k3', 'ov-newroom'];

  let harness: ReturnType<typeof build>;
  let adminCookie = '';
  let ownerCookie = '';
  let otherCookie = '';
  const users: Record<string, { id: string; email: string }> = {};
  let departmentId = '';
  const rooms: Record<string, string> = {};

  /** The past weekday the report fixtures live on: open, not a holiday, safely settled. */
  let reportDay = '';
  let openTime = '';
  let closeTime = '';

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

  const at = (day: string, time: string): string =>
    new Date(`${day}T${time}:00+07:00`).toISOString();

  const insertBooking = async (input: {
    room: string;
    owner: string;
    startAt: string;
    endAt: string;
    title: string;
    status: string;
    isPrivate?: boolean;
    reasonCode?: string | null;
    reason?: string | null;
    cancelledBy?: string | null;
  }): Promise<string> => {
    const terminal = input.status === 'CANCELLED';
    const result = await harness.db.$client.query<{ id: string }>(
      `INSERT INTO bookings (room_id, owner_id, created_by, title, is_private, start_at, end_at,
                             status, confirmed_at, idempotency_key, reason_code, reason,
                             cancelled_at, cancelled_by, auto_released_at)
       VALUES ($1, $2, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $5::timestamptz,
               gen_random_uuid(), $8, $9,
               CASE WHEN $10 THEN $5::timestamptz END, $11,
               CASE WHEN $7 = 'AUTO_RELEASED' THEN $5::timestamptz END)
       RETURNING id`,
      [
        rooms[input.room],
        users[input.owner]?.id,
        input.title,
        input.isPrivate ?? false,
        input.startAt,
        input.endAt,
        input.status,
        input.reasonCode ?? null,
        input.reason ?? null,
        terminal,
        input.cancelledBy == null ? null : (users[input.cancelledBy]?.id ?? null),
      ],
    );
    return (result.rows[0] as { id: string }).id;
  };

  const wipeRooms = async () => {
    const pool = harness.db.$client;
    const ids = await pool.query<{ id: string }>(
      'SELECT id FROM rooms WHERE code = ANY($1::text[])',
      [roomCodes],
    );
    const targets = ids.rows.map((row) => row.id);
    if (targets.length > 0) {
      await pool.query(
        `DELETE FROM notifications
          WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = ANY($1::uuid[]))`,
        [targets],
      );
      await pool.query('DELETE FROM bookings WHERE room_id = ANY($1::uuid[])', [targets]);
      await pool.query('DELETE FROM rooms WHERE id = ANY($1::uuid[])', [targets]);
    }
  };

  beforeAll(async () => {
    harness = build(ownerUrl as string);
    const pool = harness.db.$client;

    const department = await pool.query<{ id: string }>(
      `INSERT INTO departments (code, name) VALUES ('OVDEPT','Oversight Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name, active = true RETURNING id`,
    );
    departmentId = (department.rows[0] as { id: string }).id;

    for (const [key, email, employeeCode, fullName, role] of [
      ['admin', 'ov-admin@example.com', 'OV-001', 'OV Admin', 'ADMIN'],
      ['owner', 'ov-owner@example.com', 'OV-002', 'OV Owner', 'EMPLOYEE'],
      ['other', 'ov-other@example.com', 'OV-003', 'OV Other', 'EMPLOYEE'],
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
      const user = await pool.query<{ id: string }>(
        `UPDATE users SET status='ACTIVE', banned=false, disabled_at=NULL, failed_logins=0,
                locked_until=NULL, role=$2, department_id=$3 WHERE email=$1 RETURNING id`,
        [email, role, departmentId],
      );
      users[key] = { id: (user.rows[0] as { id: string }).id, email };
    }

    await wipeRooms();
    for (const [index, code] of roomCodes.entries()) {
      // created_at well in the past so the C2-09 divisor clip never bites the fixture day.
      const room = await pool.query<{ id: string }>(
        `INSERT INTO rooms (code, name, capacity, created_at, updated_at)
         VALUES ($1, $2, 10, now() - interval '400 days', now()) RETURNING id`,
        [code, `Oversight ${index}`],
      );
      rooms[code] = (room.rows[0] as { id: string }).id;
    }

    // Latest settled weekday that is open and not a holiday — the report fixtures land there.
    const day = await pool.query<{ day: string; open_time: string; close_time: string }>(
      `SELECT d::date::text AS day, bh.open_time::text, bh.close_time::text
         FROM generate_series(now()::date - interval '30 days', now()::date - interval '2 days',
                              interval '1 day') d
         JOIN business_hours bh
           ON bh.weekday = extract(isodow FROM d)::int AND bh.is_open
        WHERE NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = d::date)
        ORDER BY d DESC LIMIT 1`,
    );
    const dayRow = day.rows[0];
    if (dayRow === undefined) {
      throw new Error('no open, non-holiday weekday in the last 30 days to report on');
    }
    reportDay = dayRow.day;
    openTime = dayRow.open_time;
    closeTime = dayRow.close_time;

    // Five bookings, one room, one past day — every report number below is derived from these.
    await insertBooking({
      room: 'ov-report',
      owner: 'owner',
      startAt: at(reportDay, '10:00'),
      endAt: at(reportDay, '12:00'),
      title: 'test: ov completed',
      status: 'COMPLETED',
    });
    await insertBooking({
      room: 'ov-report',
      owner: 'owner',
      startAt: at(reportDay, '17:00'),
      endAt: at(reportDay, '18:00'),
      title: 'test: ov overrun',
      status: 'COMPLETED',
    });
    await insertBooking({
      room: 'ov-report',
      owner: 'owner',
      startAt: at(reportDay, '13:00'),
      endAt: at(reportDay, '14:00'),
      title: 'test: ov owner cancel',
      status: 'CANCELLED',
      reasonCode: 'OWNER_CANCELLED',
      cancelledBy: 'owner',
    });
    await insertBooking({
      room: 'ov-report',
      owner: 'owner',
      startAt: at(reportDay, '14:00'),
      endAt: at(reportDay, '15:00'),
      title: 'test: ov admin cancel',
      status: 'CANCELLED',
      reasonCode: 'ADMIN_CANCELLED',
      reason: 'room needed for the board',
      cancelledBy: 'admin',
    });
    await insertBooking({
      room: 'ov-report',
      owner: 'owner',
      startAt: at(reportDay, '15:00'),
      endAt: at(reportDay, '16:00'),
      title: 'test: ov no show',
      status: 'AUTO_RELEASED',
      reasonCode: 'NO_SHOW',
    });

    adminCookie = await signIn('OV-001');
    ownerCookie = await signIn('OV-002');
    otherCookie = await signIn('OV-003');
  }, 30_000);

  afterAll(async () => {
    const pool = harness.db.$client;
    await wipeRooms();
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [
      Object.values(users).map((user) => user.id),
    ]);
    await pool.end();
  }, 30_000);

  it('hides every oversight path from an employee behind 404, never 403', async () => {
    const window = `from=${reportDay}&to=${reportDay}`;
    for (const path of [
      `/api/v1/admin/reports/utilization?${window}`,
      `/api/v1/admin/reports/outcomes?${window}`,
      `/api/v1/admin/reports/heatmap?${window}`,
      '/api/v1/admin/audit-logs',
    ]) {
      const response = await request(path, { cookie: otherCookie });
      expect(response.status, path).toBe(404);
      expect((await json(response)).code, path).toBe('NOT_FOUND');
    }
  });

  it('gives an admin the FULL view of a private booking and masks it for everyone else', async () => {
    const tomorrow = bangkokParts(new Date(Date.now() + 86_400_000)).date;
    const privateId = await insertBooking({
      room: 'ov-live',
      owner: 'owner',
      startAt: at(tomorrow, '09:00'),
      endAt: at(tomorrow, '10:00'),
      title: 'test: ov private',
      status: 'CONFIRMED',
      isPrivate: true,
    });
    const attendedId = await insertBooking({
      room: 'ov-live',
      owner: 'owner',
      startAt: at(tomorrow, '11:00'),
      endAt: at(tomorrow, '12:00'),
      title: 'test: ov private attended',
      status: 'CONFIRMED',
      isPrivate: true,
    });
    await harness.db.$client.query(
      'INSERT INTO booking_attendees (booking_id, email, name) VALUES ($1, $2, $3)',
      [attendedId, users.other?.email, 'OV Other'],
    );

    // 6.1.1: ADMIN sees everything — there is no admin-specific mask.
    const asAdmin = await json(
      await request(`/api/v1/bookings/${privateId}`, { cookie: adminCookie }),
    );
    expect(asAdmin.visibility).toBe('FULL');
    expect(asAdmin.title).toBe('test: ov private');
    expect(asAdmin).toHaveProperty('attendees');

    // An uninvolved employee gets BUSY, and `title` is an ABSENT KEY, not an empty string.
    const asOther = await json(
      await request(`/api/v1/bookings/${privateId}`, { cookie: otherCookie }),
    );
    expect(asOther.visibility).toBe('BUSY');
    expect(asOther).not.toHaveProperty('title');
    expect(asOther).not.toHaveProperty('attendees');
    expect(asOther.is_private).toBe(true);

    // Membership unmasks: the same employee is an attendee on the second one.
    const asAttendee = await json(
      await request(`/api/v1/bookings/${attendedId}`, { cookie: otherCookie }),
    );
    expect(asAttendee.visibility).toBe('FULL');
    expect(asAttendee.title).toBe('test: ov private attended');

    // The list obeys the same rule: scope=all is admin-only, and the rows come back FULL.
    const list = await json(
      await request(`/api/v1/bookings?scope=all&room_id=${rooms['ov-live']}&page_size=100`, {
        cookie: adminCookie,
      }),
    );
    const listed = (list.data as AnyBody[]).find((row) => row.id === privateId);
    expect(listed?.visibility).toBe('FULL');
    expect(listed?.title).toBe('test: ov private');

    for (const query of ['scope=all', `owner_id=${users.owner?.id}`, 'q=private']) {
      const denied = await request(`/api/v1/bookings?${query}`, { cookie: otherCookie });
      expect(denied.status, query).toBe(403);
      expect((await json(denied)).code, query).toBe('FORBIDDEN');
    }
  });

  it('filters the admin booking search by owner, department, room, status and text', async () => {
    const tomorrow = bangkokParts(new Date(Date.now() + 86_400_000)).date;
    const needle = `ov-needle-${randomUUID().slice(0, 8)}`;
    const id = await insertBooking({
      room: 'ov-live',
      owner: 'owner',
      startAt: at(tomorrow, '14:00'),
      endAt: at(tomorrow, '15:00'),
      title: `test: ${needle}`,
      status: 'CONFIRMED',
    });

    const ids = async (query: string): Promise<string[]> => {
      const response = await request(`/api/v1/bookings?scope=all&page_size=100&${query}`, {
        cookie: adminCookie,
      });
      expect(response.status, query).toBe(200);
      return ((await json(response)).data as AnyBody[]).map((row) => row.id as string);
    };

    expect(await ids(`q=${needle}`)).toEqual([id]);
    expect(await ids(`owner_id=${users.owner?.id}&q=${needle}`)).toEqual([id]);
    expect(await ids(`department_id=${departmentId}&q=${needle}`)).toEqual([id]);
    expect(await ids(`room_id=${rooms['ov-live']}&q=${needle}`)).toEqual([id]);
    expect(await ids(`status=CONFIRMED&q=${needle}`)).toEqual([id]);
    expect(await ids(`status=CANCELLED&q=${needle}`)).toEqual([]);
    expect(await ids(`owner_id=${users.other?.id}&q=${needle}`)).toEqual([]);
  });

  it('requires a real reason when an admin cancels someone else, and notifies owner + attendees', async () => {
    const tomorrow = bangkokParts(new Date(Date.now() + 86_400_000)).date;
    const bookingId = await insertBooking({
      room: 'ov-live',
      owner: 'owner',
      startAt: at(tomorrow, '15:00'),
      endAt: at(tomorrow, '16:00'),
      title: 'test: ov admin cancels this',
      status: 'CONFIRMED',
    });
    await harness.db.$client.query(
      'INSERT INTO booking_attendees (booking_id, email, name) VALUES ($1, $2, $3)',
      [bookingId, 'ov-guest@example.com', 'OV Guest'],
    );

    for (const body of [undefined, { reason: '   ' }]) {
      const refused = await request(`/api/v1/bookings/${bookingId}/cancel`, {
        method: 'POST',
        cookie: adminCookie,
        ...(body === undefined ? {} : { body }),
      });
      expect(refused.status).toBe(422);
      expect((await json(refused)).code).toBe('REASON_REQUIRED');
    }

    const reason = 'Room reassigned to the quarterly board meeting';
    const cancelled = await request(`/api/v1/bookings/${bookingId}/cancel`, {
      method: 'POST',
      cookie: adminCookie,
      body: { reason },
    });
    expect(cancelled.status).toBe(200);
    const view = await json(cancelled);
    expect(view.status).toBe('CANCELLED');
    expect(view.reason_code).toBe('ADMIN_CANCELLED');
    expect((view.cancel as AnyBody).reason).toBe(reason);

    const recipients = await harness.db.$client.query<{ recipient_email: string }>(
      `SELECT recipient_email FROM notifications
        WHERE booking_id = $1 AND template_key = 'booking.cancelled' ORDER BY recipient_email`,
      [bookingId],
    );
    expect(recipients.rows.map((row) => row.recipient_email)).toEqual([
      'ov-guest@example.com',
      users.owner?.email,
    ]);

    // The audit row is written in the SAME transaction as the cancel (TC-AUD-016).
    const audit = await json(
      await request(`/api/v1/admin/audit-logs?entity_type=booking&entity_id=${bookingId}`, {
        cookie: adminCookie,
      }),
    );
    const cancelEvent = (audit.data as AnyBody[]).find((row) => row.action === 'booking.cancel');
    expect(cancelEvent?.reason).toBe(reason);
    expect(cancelEvent?.actor).toMatchObject({ id: users.admin?.id });
    expect(cancelEvent?.after).toMatchObject({ reason_code: 'ADMIN_CANCELLED' });
  });

  it('lets an owner cancel without a reason', async () => {
    const tomorrow = bangkokParts(new Date(Date.now() + 86_400_000)).date;
    const bookingId = await insertBooking({
      room: 'ov-live',
      owner: 'owner',
      startAt: at(tomorrow, '16:00'),
      endAt: at(tomorrow, '17:00'),
      title: 'test: ov owner cancels this',
      status: 'CONFIRMED',
    });

    const response = await request(`/api/v1/bookings/${bookingId}/cancel`, {
      method: 'POST',
      cookie: ownerCookie,
    });
    expect(response.status).toBe(200);
    expect((await json(response)).reason_code).toBe('OWNER_CANCELLED');
  });

  it('records admin check-in as ADMIN, and as SELF when the admin is a participant', async () => {
    // Round UP to the 15-minute grid: the booking is at most 15 minutes out, so it sits inside
    // checkin_open_before_minutes (15) without ever being old enough for the sweep.
    const start = new Date(Math.ceil(Date.now() / GRID_MS) * GRID_MS);
    const end = new Date(start.getTime() + 3_600_000);

    const uninvolved = await insertBooking({
      room: 'ov-k2',
      owner: 'owner',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      title: 'test: ov admin checkin',
      status: 'CONFIRMED',
    });
    const ownedByAdmin = await insertBooking({
      room: 'ov-k3',
      owner: 'admin',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      title: 'test: ov admin own checkin',
      status: 'CONFIRMED',
    });

    const asAdmin = await request(`/api/v1/bookings/${uninvolved}/check-in`, {
      method: 'POST',
      cookie: adminCookie,
    });
    expect(asAdmin.status).toBe(200);
    expect(((await json(asAdmin)).booking as AnyBody).checkin).toMatchObject({ method: 'ADMIN' });

    // TC-CHK-019: membership beats role — the admin owns this one, so it is a SELF check-in.
    const asSelf = await request(`/api/v1/bookings/${ownedByAdmin}/check-in`, {
      method: 'POST',
      cookie: adminCookie,
    });
    expect(asSelf.status).toBe(200);
    expect(((await json(asSelf)).booking as AnyBody).checkin).toMatchObject({ method: 'SELF' });

    // An uninvolved EMPLOYEE is still refused.
    const refused = await request(`/api/v1/bookings/${uninvolved}/check-in`, {
      method: 'POST',
      cookie: otherCookie,
    });
    expect(refused.status).toBe(403);
    expect((await json(refused)).code).toBe('FORBIDDEN');
  });

  it('computes utilization against the seeded fixtures', async () => {
    const availableHours = (minutesOf(closeTime) - minutesOf(openTime)) / 60;
    const usedHours =
      (overlapMinutes('10:00', '12:00', openTime, closeTime) +
        overlapMinutes('17:00', '18:00', openTime, closeTime)) /
      60;

    const response = await request(
      `/api/v1/admin/reports/utilization?from=${reportDay}&to=${reportDay}&room_id=${rooms['ov-report']}`,
      { cookie: adminCookie },
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.rows).toHaveLength(1);
    const row = (body.rows as AnyBody[])[0] as AnyBody;

    expect(row.available_hours).toBe(round1(availableHours));
    expect(row.used_hours).toBe(round1(usedHours));
    expect(row.utilization_pct).toBe(round1((100 * usedHours) / availableHours));
    // Secondary figure: the whole duration of everything holding the room, unclipped.
    expect(row.booked_hours).toBe(3);
    expect(row.completed).toBe(2);
    expect(row.cancelled).toBe(2);
    expect(row.auto_released).toBe(1);
    expect(row.no_show_pct).toBe(round1((100 * 1) / 3));
    expect((row.room as AnyBody).code).toBe('ov-report');
    expect(row.period).toBeNull();

    const byMonth = await json(
      await request(
        `/api/v1/admin/reports/utilization?from=${reportDay}&to=${reportDay}&room_id=${rooms['ov-report']}&group_by=month`,
        { cookie: adminCookie },
      ),
    );
    const monthRow = (byMonth.rows as AnyBody[])[0] as AnyBody;
    expect(monthRow.period).toBe(reportDay.slice(0, 7));
    expect(monthRow.used_hours).toBe(round1(usedHours));
    expect(monthRow.key).toBe(`${rooms['ov-report']}:${reportDay.slice(0, 7)}`);
  });

  it('reports on a room created INSIDE the window, counting only the hours it existed', async () => {
    // The divisor clips cross on every day before rooms.created_at, and tstzrange() raises on
    // lower > upper — this used to 500 the whole report (and the dashboard) for a month after
    // anyone added a room. Born one hour before closing on the fixture day: that hour is the
    // only availability in a 30-day window, everything earlier is excluded, not fatal.
    const bornAt = new Date(new Date(`${reportDay}T${closeTime}+07:00`).getTime() - 3_600_000);
    await harness.db.$client.query('UPDATE rooms SET created_at = $1 WHERE id = $2', [
      bornAt.toISOString(),
      rooms['ov-newroom'],
    ]);
    const from = new Date(new Date(`${reportDay}T00:00:00Z`).getTime() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const response = await request(
      `/api/v1/admin/reports/utilization?from=${from}&to=${reportDay}`,
      { cookie: adminCookie },
    );
    expect(response.status).toBe(200);
    const rows = (await json(response)).rows as AnyBody[];
    const newRoom = rows.find((row) => (row.room as AnyBody).id === rooms['ov-newroom']);
    expect(newRoom?.available_hours).toBe(1);
    expect(newRoom?.used_hours).toBe(0);
    // Sanity: the same window is many open days wide for a room that already existed, so the
    // 1 above is the created_at clip working, not an empty window.
    const oldRoom = rows.find((row) => (row.room as AnyBody).id === rooms['ov-report']);
    expect(oldRoom?.available_hours).toBeGreaterThan(8);
  });

  it('counts outcomes and the no-show rate per day', async () => {
    const body = await json(
      await request(
        `/api/v1/admin/reports/outcomes?from=${reportDay}&to=${reportDay}&room_id=${rooms['ov-report']}`,
        { cookie: adminCookie },
      ),
    );
    expect(body.totals).toEqual({
      created: 5,
      completed: 2,
      cancelled_by_owner: 1,
      cancelled_by_admin: 1,
      auto_released: 1,
    });
    expect(body.no_show_pct).toBe(round1((100 * 1) / 3));
    expect(body.by_day).toHaveLength(1);
    expect((body.by_day as AnyBody[])[0]).toMatchObject({ date: reportDay, created: 5 });
  });

  it('buckets the heatmap by weekday and start hour', async () => {
    const body = await json(
      await request(
        `/api/v1/admin/reports/heatmap?from=${reportDay}&to=${reportDay}&room_id=${rooms['ov-report']}`,
        { cookie: adminCookie },
      ),
    );
    const weekday = bangkokParts(new Date(`${reportDay}T10:00:00+07:00`)).isoWeekday;
    // COMPLETED only; each booking's whole duration is charged to its START hour.
    expect(body.cells).toEqual([
      { weekday, hour: 10, bookings: 1, used_hours: 2 },
      { weekday, hour: 17, bookings: 1, used_hours: 1 },
    ]);
  });

  it('400s an impossible date on every list that takes one', async () => {
    // A date that passes /^\d{4}-\d{2}-\d{2}$/ but is not a day: '9999-99-99' reached
    // Postgres as a 500, '2026-02-30' silently became March 2nd. Both are bad requests.
    for (const path of [
      '/api/v1/bookings?from=9999-99-99',
      '/api/v1/bookings?to=2026-02-30',
      '/api/v1/calendar?from=9999-99-99&to=9999-99-99',
      `/api/v1/calendar?from=${reportDay}&to=2026-02-30`,
      '/api/v1/admin/audit-logs?from=9999-99-99',
      '/api/v1/admin/audit-logs?to=2026-02-30',
      '/api/v1/admin/notifications/emails?from=2026-02-30',
      '/api/v1/admin/notifications/emails?to=9999-99-99',
      `/api/v1/admin/reports/outcomes?from=9999-99-99&to=${reportDay}`,
    ]) {
      const response = await request(path, { cookie: adminCookie });
      expect(response.status, path).toBe(400);
      expect((await json(response)).code, path).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects a malformed or oversized report range', async () => {
    for (const query of [
      'from=2026-02-30&to=2026-03-01',
      'from=2026-03-02&to=2026-03-01',
      'from=2026-01-01&to=2027-06-01',
      `from=${reportDay}`,
    ]) {
      const response = await request(`/api/v1/admin/reports/utilization?${query}`, {
        cookie: adminCookie,
      });
      expect(response.status, query).toBe(400);
      expect((await json(response)).code, query).toBe('VALIDATION_FAILED');
    }
  });

  it('filters and pages the audit log, and redacts before/after', async () => {
    const entityId = randomUUID();
    await harness.db.$client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, reason)
       VALUES ($1, 'user.update', 'user', $2, $3::jsonb, $4::jsonb, 'ov redaction probe'),
              ($1, 'user.update', 'user', $2, NULL, NULL, 'ov second row')`,
      [
        users.admin?.id,
        entityId,
        JSON.stringify({ mobile: '0812345678', full_name: 'Before' }),
        JSON.stringify({ full_name: 'After', nested: { password_hash: 'secret', keep: 1 } }),
      ],
    );

    const filtered = await json(
      await request(`/api/v1/admin/audit-logs?entity_type=user&entity_id=${entityId}`, {
        cookie: adminCookie,
      }),
    );
    expect((filtered.page as AnyBody).total).toBe(2);
    const [newest, oldest] = filtered.data as AnyBody[];
    // Newest first.
    expect(newest?.reason).toBe('ov second row');
    expect(oldest?.reason).toBe('ov redaction probe');
    expect(oldest?.before).toEqual({ full_name: 'Before' });
    expect(oldest?.after).toEqual({ full_name: 'After', nested: { keep: 1 } });
    expect(oldest?.actor).toMatchObject({ id: users.admin?.id });

    const paged = await json(
      await request(
        `/api/v1/admin/audit-logs?entity_type=user&entity_id=${entityId}&page=2&page_size=1`,
        { cookie: adminCookie },
      ),
    );
    expect(paged.data).toHaveLength(1);
    expect((paged.page as AnyBody).total).toBe(2);
    expect((paged.data as AnyBody[])[0]?.reason).toBe('ov redaction probe');

    const byAction = await json(
      await request(
        `/api/v1/admin/audit-logs?action=user.update&entity_id=${entityId}&actor_id=${users.admin?.id}`,
        { cookie: adminCookie },
      ),
    );
    expect((byAction.page as AnyBody).total).toBe(2);

    const wrongActor = await json(
      await request(`/api/v1/admin/audit-logs?entity_id=${entityId}&actor_id=${users.other?.id}`, {
        cookie: adminCookie,
      }),
    );
    expect((wrongActor.page as AnyBody).total).toBe(0);

    // The Bangkok day window is inclusive on both ends.
    const today = bangkokParts(new Date()).date;
    const inWindow = await json(
      await request(`/api/v1/admin/audit-logs?entity_id=${entityId}&from=${today}&to=${today}`, {
        cookie: adminCookie,
      }),
    );
    expect((inWindow.page as AnyBody).total).toBe(2);
    const outOfWindow = await json(
      await request(
        `/api/v1/admin/audit-logs?entity_id=${entityId}&from=2020-01-01&to=2020-01-02`,
        { cookie: adminCookie },
      ),
    );
    expect((outOfWindow.page as AnyBody).total).toBe(0);

    // C-06's hard cap: the trail is the fastest-growing table in the system and nobody gets
    // to ask it for an unbounded page.
    const oversized = await request('/api/v1/admin/audit-logs?page_size=101', {
      cookie: adminCookie,
    });
    expect(oversized.status).toBe(400);
    expect((await json(oversized)).code).toBe('VALIDATION_FAILED');
    // Unfiltered, the total is still served — counted with a LIMIT so it can never scan the
    // whole table (`total_is_capped` appears only past that cap).
    const unfiltered = await json(
      await request('/api/v1/admin/audit-logs?page_size=1', { cookie: adminCookie }),
    );
    expect((unfiltered.page as AnyBody).total).toBeGreaterThan(0);
    expect((unfiltered.page as AnyBody).total).toBeLessThanOrEqual(10_000);
  });

  // ---------------------------------------------------------------- outbox (§6.3.9)

  it('lists the email outbox with filters and retries a dead letter, admin-only', async () => {
    const pool = harness.db.$client;
    const recipient = `ov-outbox-${randomUUID()}@example.com`;
    const failed = await pool.query<{ id: string }>(
      `INSERT INTO notifications (booking_id, template_key, dedupe_key, recipient_email, payload,
                                  status, attempts, last_error, next_attempt_at)
       VALUES (NULL, 'account.set_password', $1, $2, '{"name":"OV"}'::jsonb, 'FAILED', 8,
               'relay said no', now() + interval '1 day')
       RETURNING id::text AS id`,
      [randomUUID(), recipient],
    );
    const id = failed.rows[0]?.id as string;

    const listed = await json(
      await request(`/api/v1/admin/notifications/emails?recipient=${recipient}&status=FAILED`, {
        cookie: adminCookie,
      }),
    );
    expect((listed.page as AnyBody).total).toBe(1);
    expect((listed.data as AnyBody[])[0]).toMatchObject({
      id: Number(id),
      template_key: 'account.set_password',
      recipient_email: recipient,
      status: 'FAILED',
      attempts: 8,
      last_error: 'relay said no',
      booking_id: null,
    });
    // A filter that excludes it must actually exclude it.
    const other = await json(
      await request(`/api/v1/admin/notifications/emails?recipient=${recipient}&status=SENT`, {
        cookie: adminCookie,
      }),
    );
    expect((other.page as AnyBody).total).toBe(0);
    const badStatus = await request('/api/v1/admin/notifications/emails?status=NOPE', {
      cookie: adminCookie,
    });
    expect(badStatus.status).toBe(400);

    // Retry puts it back exactly where the drain contract expects to find it.
    const retried = await request(`/api/v1/admin/notifications/emails/${id}/retry`, {
      method: 'POST',
      cookie: adminCookie,
    });
    expect(retried.status, await retried.clone().text()).toBe(202);
    expect(await json(retried)).toEqual({ queued: 1 });
    const row = await pool.query(
      'SELECT status, attempts, last_error FROM notifications WHERE id = $1',
      [id],
    );
    // Not `status = 'PENDING'` exactly: the row is due NOW by design, so a dev worker
    // draining this same database may already have sent it. What retry has to prove is that
    // the dead letter left the FAILED state with its 8 attempts and its error cleared.
    expect(['PENDING', 'SENT']).toContain(row.rows[0].status);
    expect(row.rows[0].attempts).toBeLessThanOrEqual(1);
    expect(row.rows[0].last_error).toBeNull();
    const audited = await pool.query(
      `SELECT action, actor_id FROM audit_logs
        WHERE entity_type = 'notification' AND entity_id = $1`,
      [id],
    );
    expect(audited.rows[0]).toMatchObject({
      action: 'notification.retry',
      actor_id: users.admin?.id,
    });

    // Only a FAILED row can be retried, an unknown id is a 404, and the whole namespace is
    // hidden from everyone but an admin (C-15).
    const again = await request(`/api/v1/admin/notifications/emails/${id}/retry`, {
      method: 'POST',
      cookie: adminCookie,
    });
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('INVALID_STATUS_TRANSITION');
    expect(
      (
        await request('/api/v1/admin/notifications/emails/999999999/retry', {
          method: 'POST',
          cookie: adminCookie,
        })
      ).status,
    ).toBe(404);
    // An id too large for bigint is still just an id we do not have — 404, not the 22003 a
    // 19-digit guard would have let through as a 500.
    expect(
      (
        await request('/api/v1/admin/notifications/emails/9999999999999999999/retry', {
          method: 'POST',
          cookie: adminCookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (await request('/api/v1/admin/notifications/emails', { cookie: ownerCookie })).status,
    ).toBe(404);

    // The drain is free to pick it up now; leave nothing behind for it either way.
    await pool.query('DELETE FROM notifications WHERE id = $1', [id]);
  });
});
