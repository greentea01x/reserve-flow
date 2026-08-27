import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth/index.js';
import { authSchema } from '../src/auth/schema.js';
import { createDb } from '../src/db/index.js';
import { createLogger } from '../src/lib/logger.js';
import { invalidateSettings } from '../src/lib/settings.js';
import { bangkokParts, toBangkokIso } from '../src/lib/time.js';

const ownerUrl = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:5174';

function build(connectionString: string, demoToolsEnabled = false) {
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
    demoToolsEnabled,
    checkDatabase: async () => {},
  });
  return { app, db, auth };
}

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

function floorTo15(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 900_000) * 900_000);
}

type AnyBody = Record<string, unknown>;

describe.skipIf(!ownerUrl)('bookings core (database)', () => {
  const password = 'bk-test-password-1';
  const day = nextOpenDate();
  const at = (time: string) => new Date(`${day}T${time}:00+07:00`).toISOString();
  let harness: ReturnType<typeof build>;
  let ownerCookie: string;
  let strangerCookie: string;
  let adminCookie: string;
  let ownerId = '';
  const roomIds = new Map<string, string>();
  const userIds: string[] = [];

  const request = (
    path: string,
    init: {
      method?: string;
      cookie: string;
      body?: unknown;
      idempotencyKey?: string | null;
    },
  ) =>
    harness.app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        cookie: init.cookie,
        origin: ORIGIN,
        'content-type': 'application/json',
        ...(init.idempotencyKey == null ? {} : { 'idempotency-key': init.idempotencyKey }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  const createBooking = async (
    cookie: string,
    body: AnyBody,
    idempotencyKey = randomUUID(),
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
    harness = build(ownerUrl as string, true);
    const pool = harness.db.$client;

    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('BKDEPT','Bookings Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    for (const [email, employeeCode, fullName, role] of [
      ['bk-owner@example.com', 'BK-001', 'BK Owner', 'EMPLOYEE'],
      ['bk-stranger@example.com', 'BK-002', 'BK Stranger', 'EMPLOYEE'],
      ['bk-admin@example.com', 'BK-003', 'BK Admin', 'ADMIN'],
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
        `UPDATE users SET status='ACTIVE', banned=false, disabled_at=NULL,
                failed_logins=0, locked_until=NULL, role=$2
         WHERE email=$1 RETURNING id`,
        [email, role],
      );
      userIds.push(user.rows[0].id);
    }
    ownerId = userIds[0] as string;

    await pool.query(
      `INSERT INTO business_hours (weekday, is_open, open_time, close_time)
       SELECT w, w <= 5, CASE WHEN w <= 5 THEN '08:30'::time END,
              CASE WHEN w <= 5 THEN '17:30'::time END
         FROM generate_series(1, 7) AS w
       ON CONFLICT (weekday) DO UPDATE
         SET is_open = excluded.is_open, open_time = excluded.open_time,
             close_time = excluded.close_time`,
    );

    for (const [code, capacity, active] of [
      ['bk-room-a', 4, true],
      ['bk-room-b', 8, true],
      ['bk-room-c', 6, true],
      ['bk-room-d', 6, true],
      ['bk-room-buf', 6, true],
      ['bk-room-demo', 6, true],
      ['bk-room-off', 2, false],
    ] as const) {
      const room = await pool.query(
        `INSERT INTO rooms (code, name, capacity, active) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET active = $4, capacity = $3 RETURNING id`,
        [code, `test: ${code}`, capacity, active],
      );
      roomIds.set(code, room.rows[0].id);
    }

    // Crashed-run residue would trip the EXCLUDE constraint below.
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN
         (SELECT id FROM bookings WHERE room_id = ANY($1::uuid[]))`,
      [[...roomIds.values()]],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = ANY($1::uuid[])', [
      [...roomIds.values()],
    ]);

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
    ownerCookie = await signIn('BK-001');
    strangerCookie = await signIn('BK-002');
    adminCookie = await signIn('BK-003');
  }, 30_000);

  afterAll(async () => {
    const pool = harness.db.$client;
    await pool.query(
      `DELETE FROM notifications WHERE booking_id IN
         (SELECT id FROM bookings WHERE room_id = ANY($1::uuid[]))`,
      [[...roomIds.values()]],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = ANY($1::uuid[])', [
      [...roomIds.values()],
    ]);
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.end();
  });

  let bookingId = '';
  let onBehalfId = '';
  const firstKey = randomUUID();

  // ------------------------------------------------------------------ create

  it('creates a CONFIRMED booking with Location, outbox and audit rows', async () => {
    const { response, json } = await createBooking(
      ownerCookie,
      {
        room_id: roomIds.get('bk-room-a'),
        start_at: at('10:00'),
        end_at: at('11:00'),
        title: 'test: bk sync',
        attendees: [{ email: 'BK-Attendee@example.com', name: 'Att' }],
      },
      firstKey,
    );

    expect(response.status).toBe(201);
    bookingId = json.id as string;
    expect(response.headers.get('location')).toBe(`/api/v1/bookings/${bookingId}`);
    expect(json).toMatchObject({
      status: 'CONFIRMED',
      version: 1,
      visibility: 'FULL',
      is_mine: true,
      title: 'test: bk sync',
      attendee_count: 1,
      attendees: [{ email: 'bk-attendee@example.com', name: 'Att' }],
    });
    expect(json.start_at).toMatch(/\+07:00$/);

    const pool = harness.db.$client;
    const outbox = await pool.query(
      `SELECT recipient_email, template_key, dedupe_key FROM notifications
        WHERE booking_id = $1 ORDER BY recipient_email`,
      [bookingId],
    );
    expect(outbox.rows).toEqual([
      {
        recipient_email: 'bk-attendee@example.com',
        template_key: 'booking.confirmed',
        dedupe_key: '1',
      },
      {
        recipient_email: 'bk-owner@example.com',
        template_key: 'booking.confirmed',
        dedupe_key: '1',
      },
    ]);
    const audit = await pool.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'booking' AND entity_id = $1`,
      [bookingId],
    );
    expect(audit.rows).toEqual([{ action: 'booking.create' }]);
  });

  it('replays the same Idempotency-Key even with a different payload (CF-01)', async () => {
    const { response, json } = await createBooking(
      ownerCookie,
      {
        room_id: roomIds.get('bk-room-a'),
        start_at: at('10:00'),
        end_at: at('11:00'),
        title: 'test: bk sync CHANGED',
      },
      firstKey,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('idempotent-replayed')).toBe('true');
    expect(json.id).toBe(bookingId);
    expect(json.title).toBe('test: bk sync');
  });

  it('requires the Idempotency-Key header', async () => {
    const response = await request('/api/v1/bookings', {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        room_id: roomIds.get('bk-room-a'),
        start_at: at('10:00'),
        end_at: at('11:00'),
        title: 'test: bk no key',
      },
      idempotencyKey: null,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('turns the EXCLUDE 23P01 into 409 SLOT_UNAVAILABLE with alternatives', async () => {
    const { response, json } = await createBooking(strangerCookie, {
      room_id: roomIds.get('bk-room-a'),
      start_at: at('10:00'),
      end_at: at('11:00'),
      title: 'test: bk clash',
    });

    expect(response.status).toBe(409);
    expect(json).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    const details = json.details as { alternatives: { room_id: string; code: string }[] };
    expect(details.alternatives.some((alt) => alt.room_id === roomIds.get('bk-room-b'))).toBe(true);
  });

  it('rejects each window violation with its own code', async () => {
    const cases: [AnyBody, number, string][] = [
      [{ start_at: at('10:00'), end_at: at('10:30') }, 422, 'MIN_DURATION'],
      [
        {
          start_at: new Date(Date.now() - 86_400_000).toISOString(),
          end_at: new Date(Date.now() - 82_800_000).toISOString(),
        },
        422,
        'IN_PAST',
      ],
    ];
    for (const [window, status, code] of cases) {
      const { response, json } = await createBooking(strangerCookie, {
        room_id: roomIds.get('bk-room-b'),
        title: 'test: bk window',
        ...window,
      });
      expect(response.status, code).toBe(status);
      expect(json.code, code).toBe(code);
    }

    // Next Saturday is a structurally closed day (CB-04).
    let saturday = '';
    for (let ahead = 1; ahead <= 8; ahead++) {
      const parts = bangkokParts(new Date(Date.now() + ahead * 86_400_000));
      if (parts.isoWeekday === 6) {
        saturday = parts.date;
        break;
      }
    }
    const closed = await createBooking(strangerCookie, {
      room_id: roomIds.get('bk-room-b'),
      start_at: new Date(`${saturday}T10:00:00+07:00`).toISOString(),
      end_at: new Date(`${saturday}T11:00:00+07:00`).toISOString(),
      title: 'test: bk closed',
    });
    expect(closed.response.status).toBe(422);
    expect(closed.json).toMatchObject({
      code: 'OUTSIDE_BUSINESS_HOURS',
      details: { reason: 'CLOSED_DAY' },
    });
  });

  it('rejects inactive and unknown rooms', async () => {
    const inactive = await createBooking(strangerCookie, {
      room_id: roomIds.get('bk-room-off'),
      start_at: at('10:00'),
      end_at: at('11:00'),
      title: 'test: bk inactive',
    });
    expect(inactive.response.status).toBe(422);
    expect(inactive.json.code).toBe('ROOM_INACTIVE');

    const unknown = await createBooking(strangerCookie, {
      room_id: randomUUID(),
      start_at: at('10:00'),
      end_at: at('11:00'),
      title: 'test: bk unknown room',
    });
    expect(unknown.response.status).toBe(404);
  });

  it('lets only an ADMIN book on behalf of someone else', async () => {
    const forbidden = await createBooking(strangerCookie, {
      room_id: roomIds.get('bk-room-a'),
      start_at: at('13:00'),
      end_at: at('14:00'),
      title: 'test: bk on behalf',
      owner_id: ownerId,
    });
    expect(forbidden.response.status).toBe(403);

    const { response, json } = await createBooking(adminCookie, {
      room_id: roomIds.get('bk-room-a'),
      start_at: at('13:00'),
      end_at: at('14:00'),
      title: 'test: bk on behalf',
      owner_id: ownerId,
    });
    expect(response.status).toBe(201);
    onBehalfId = json.id as string;
    expect((json.owner as { id: string }).id).toBe(ownerId);
    expect(json.is_mine).toBe(false);
  });

  // ------------------------------------------------------------------ patch

  it('reschedules with an optimistic version bump', async () => {
    const response = await request(`/api/v1/bookings/${bookingId}`, {
      method: 'PATCH',
      cookie: ownerCookie,
      body: { version: 1, start_at: at('11:00'), end_at: at('12:00') },
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as AnyBody;
    expect(json).toMatchObject({ version: 2, status: 'CONFIRMED' });
    expect(json.start_at).toBe(`${day}T11:00:00.000+07:00`);

    const outbox = await harness.db.$client.query(
      `SELECT count(*)::int AS n FROM notifications
        WHERE booking_id = $1 AND template_key = 'booking.rescheduled' AND dedupe_key = '2'`,
      [bookingId],
    );
    expect(outbox.rows[0].n).toBe(2);
  });

  it('answers a stale version with VERSION_CONFLICT and the current row', async () => {
    const response = await request(`/api/v1/bookings/${bookingId}`, {
      method: 'PATCH',
      cookie: ownerCookie,
      body: { version: 1, title: 'test: bk stale' },
    });
    expect(response.status).toBe(409);
    const json = (await response.json()) as AnyBody;
    expect(json.code).toBe('VERSION_CONFLICT');
    expect(json.details).toMatchObject({
      current_version: 2,
      current: { version: 2, title: 'test: bk sync' },
    });
  });

  it('CB-03: a colliding reschedule rolls back whole — the row is untouched', async () => {
    const response = await request(`/api/v1/bookings/${bookingId}`, {
      method: 'PATCH',
      cookie: ownerCookie,
      body: { version: 2, start_at: at('13:00'), end_at: at('14:00') },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'SLOT_UNAVAILABLE' });

    const detail = await request(`/api/v1/bookings/${bookingId}`, { cookie: ownerCookie });
    const json = (await detail.json()) as AnyBody;
    expect(json.version).toBe(2);
    expect(json.start_at).toBe(`${day}T11:00:00.000+07:00`);
  });

  it('forbids edits by a stranger and keeps detail-only edits silent', async () => {
    const forbidden = await request(`/api/v1/bookings/${bookingId}`, {
      method: 'PATCH',
      cookie: strangerCookie,
      body: { version: 2, title: 'test: bk hijack' },
    });
    expect(forbidden.status).toBe(403);

    const before = await harness.db.$client.query(
      'SELECT count(*)::int AS n FROM notifications WHERE booking_id = $1',
      [bookingId],
    );
    const response = await request(`/api/v1/bookings/${bookingId}`, {
      method: 'PATCH',
      cookie: ownerCookie,
      body: { version: 2, title: 'test: bk renamed' },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: 3,
      title: 'test: bk renamed',
    });
    const after = await harness.db.$client.query(
      'SELECT count(*)::int AS n FROM notifications WHERE booking_id = $1',
      [bookingId],
    );
    // D-30e: no email for a detail-only edit.
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  // ------------------------------------------------------------------ cancel

  it('cancels idempotently as the owner with reason_code OWNER_CANCELLED', async () => {
    const forbidden = await request(`/api/v1/bookings/${bookingId}/cancel`, {
      method: 'POST',
      cookie: strangerCookie,
      body: {},
    });
    expect(forbidden.status).toBe(403);

    const response = await request(`/api/v1/bookings/${bookingId}/cancel`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {},
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as AnyBody;
    expect(json).toMatchObject({ status: 'CANCELLED', reason_code: 'OWNER_CANCELLED' });
    expect((json.cancel as AnyBody).cancelled_by).toMatchObject({ id: ownerId });

    const again = await request(`/api/v1/bookings/${bookingId}/cancel`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {},
    });
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toMatchObject({ status: 'CANCELLED', version: 4 });

    // §2.6 matrix: owner cancel notifies the attendees only — never the owner themselves.
    const outbox = await harness.db.$client.query(
      `SELECT recipient_email FROM notifications
        WHERE booking_id = $1 AND template_key = 'booking.cancelled'
        ORDER BY recipient_email`,
      [bookingId],
    );
    expect(outbox.rows.map((row) => row.recipient_email)).toEqual(['bk-attendee@example.com']);
  });

  it('blocks check-in on a CANCELLED booking with INVALID_STATUS_TRANSITION', async () => {
    const response = await request(`/api/v1/bookings/${bookingId}/check-in`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {},
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
      details: { status: 'CANCELLED', action: 'CHECK_IN' },
    });
  });

  it("requires a reason when an admin cancels someone else's booking", async () => {
    const missing = await request(`/api/v1/bookings/${onBehalfId}/cancel`, {
      method: 'POST',
      cookie: adminCookie,
      body: {},
    });
    expect(missing.status).toBe(422);
    await expect(missing.json()).resolves.toMatchObject({ code: 'REASON_REQUIRED' });

    const response = await request(`/api/v1/bookings/${onBehalfId}/cancel`, {
      method: 'POST',
      cookie: adminCookie,
      body: { reason: 'room maintenance' },
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as AnyBody;
    expect(json).toMatchObject({ status: 'CANCELLED', reason_code: 'ADMIN_CANCELLED' });
    expect((json.cancel as AnyBody).reason).toBe('room maintenance');

    // §2.6 matrix: an ADMIN cancelling someone else's booking notifies the owner
    // (+ attendees; this booking has none).
    const outbox = await harness.db.$client.query(
      `SELECT recipient_email FROM notifications
        WHERE booking_id = $1 AND template_key = 'booking.cancelled'
        ORDER BY recipient_email`,
      [onBehalfId],
    );
    expect(outbox.rows.map((row) => row.recipient_email)).toEqual(['bk-owner@example.com']);
  });

  // ------------------------------------------------------------------ check-in

  let liveA = '';
  let liveB = '';
  let liveC = '';
  let liveD = '';
  let futureId = '';
  let futureVersion = 0;

  it('checks the owner in (SELF) inside the window, idempotently', async () => {
    const pool = harness.db.$client;
    const start = floorTo15(new Date());
    const insertLive = async (roomCode: string, owner: string, startAt: Date, minutes: number) => {
      const row = await pool.query(
        `INSERT INTO bookings (room_id, owner_id, created_by, title, start_at, end_at,
                               status, confirmed_at, idempotency_key)
         VALUES ($1, $2, $2, $3, $4, $5, 'CONFIRMED', now(), gen_random_uuid()) RETURNING id`,
        [
          roomIds.get(roomCode),
          owner,
          `test: live ${roomCode}`,
          startAt.toISOString(),
          new Date(startAt.getTime() + minutes * 60_000).toISOString(),
        ],
      );
      return row.rows[0].id as string;
    };
    const earlier = new Date(start.getTime() - 30 * 60_000);
    liveA = await insertLive('bk-room-a', ownerId, start, 60);
    liveB = await insertLive('bk-room-b', ownerId, start, 60);
    liveC = await insertLive('bk-room-c', ownerId, earlier, 90);
    liveD = await insertLive('bk-room-d', userIds[2] as string, earlier, 90);

    const response = await request(`/api/v1/bookings/${liveA}/check-in`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {},
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as AnyBody;
    expect(json.already_checked_in).toBe(false);
    expect(json.booking).toMatchObject({
      status: 'CHECKED_IN',
      checkin: { method: 'SELF' },
    });

    const again = await request(`/api/v1/bookings/${liveA}/check-in`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {},
    });
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toMatchObject({ already_checked_in: true });
  });

  it('closes the window before it opens (CHECKIN_WINDOW_CLOSED with opens_at)', async () => {
    const created = await createBooking(ownerCookie, {
      room_id: roomIds.get('bk-room-demo'),
      start_at: at('15:00'),
      end_at: at('16:00'),
      title: 'test: bk future',
    });
    expect(created.response.status).toBe(201);
    futureId = created.json.id as string;
    futureVersion = created.json.version as number;

    const stranger = await request(`/api/v1/bookings/${futureId}/check-in`, {
      method: 'POST',
      cookie: strangerCookie,
      body: {},
    });
    expect(stranger.status).toBe(403);

    const response = await request(`/api/v1/bookings/${futureId}/check-in`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {},
    });
    expect(response.status).toBe(422);
    const json = (await response.json()) as AnyBody;
    expect(json.code).toBe('CHECKIN_WINDOW_CLOSED');
    expect((json.details as AnyBody).opens_at).toMatch(/\+07:00$/);
  });

  it('QR: resolves the booking from scanner + room + window', async () => {
    const response = await request('/api/v1/check-in/rooms/bk-room-b', {
      method: 'POST',
      cookie: ownerCookie,
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as AnyBody;
    expect(json.already_checked_in).toBe(false);
    expect(json.booking).toMatchObject({ id: liveB, status: 'CHECKED_IN' });
    expect((json.booking as AnyBody).checkin).toMatchObject({ method: 'QR' });
  });

  it('QR: unknown room 404s, uninvolved scanner gets NO_BOOKING_IN_WINDOW', async () => {
    const unknown = await request('/api/v1/check-in/rooms/no-such-room', {
      method: 'POST',
      cookie: ownerCookie,
    });
    expect(unknown.status).toBe(404);

    const response = await request('/api/v1/check-in/rooms/bk-room-a', {
      method: 'POST',
      cookie: strangerCookie,
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'NO_BOOKING_IN_WINDOW',
      details: { room_code: 'bk-room-a' },
    });
  });

  it('gives an uninvolved admin the wide window, but an involved admin the SELF window (TC-CHK-019)', async () => {
    // liveC started 30 min ago: past the 15-min self grace, inside the admin window.
    const admin = await request(`/api/v1/bookings/${liveC}/check-in`, {
      method: 'POST',
      cookie: adminCookie,
      body: { note: 'front desk' },
    });
    expect(admin.status).toBe(200);
    const json = (await admin.json()) as AnyBody;
    expect(json.booking).toMatchObject({ status: 'CHECKED_IN' });
    expect((json.booking as AnyBody).checkin).toMatchObject({ method: 'ADMIN' });

    // liveD is OWNED by the admin: membership beats role — the self window already closed.
    const adminOwner = await request(`/api/v1/bookings/${liveD}/check-in`, {
      method: 'POST',
      cookie: adminCookie,
      body: {},
    });
    expect(adminOwner.status).toBe(422);
    await expect(adminOwner.json()).resolves.toMatchObject({ code: 'CHECKIN_WINDOW_CLOSED' });
  });

  // ------------------------------------------------------------------ list & detail

  it('lists my bookings with paging; scope=all is admin-only', async () => {
    const response = await request('/api/v1/bookings?page_size=50', { cookie: ownerCookie });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: AnyBody[]; page: AnyBody };
    expect(json.page).toMatchObject({ page: 1, page_size: 50 });
    const ids = json.data.map((entry) => entry.id);
    expect(ids).toContain(liveA);
    expect(ids).toContain(futureId);
    for (const entry of json.data) {
      expect(entry.visibility).toBe('FULL');
    }

    const forbidden = await request('/api/v1/bookings?scope=all', { cookie: strangerCookie });
    expect(forbidden.status).toBe(403);
    const admin = await request('/api/v1/bookings?scope=all&page_size=100', {
      cookie: adminCookie,
    });
    expect(admin.status).toBe(200);
  });

  it('masks a private booking as BUSY on detail for a stranger', async () => {
    const pool = harness.db.$client;
    const row = await pool.query(
      `INSERT INTO bookings (room_id, owner_id, created_by, title, is_private, start_at, end_at,
                             status, confirmed_at, idempotency_key)
       VALUES ($1, $2, $2, 'test: bk private', true, $3, $4, 'CONFIRMED', now(),
               gen_random_uuid()) RETURNING id`,
      [roomIds.get('bk-room-b'), ownerId, at('15:00'), at('16:00')],
    );
    const privateId = row.rows[0].id as string;

    const response = await request(`/api/v1/bookings/${privateId}`, { cookie: strangerCookie });
    expect(response.status).toBe(200);
    const json = (await response.json()) as AnyBody;
    expect(Object.keys(json).sort()).toEqual([
      'end_at',
      'id',
      'is_mine',
      'is_private',
      'room_id',
      'start_at',
      'status',
      'visibility',
    ]);
    expect(json.visibility).toBe('BUSY');

    const missing = await request(`/api/v1/bookings/${randomUUID()}`, { cookie: ownerCookie });
    expect(missing.status).toBe(404);
  });

  it('serves the owner FULL detail with history and can{}', async () => {
    const response = await request(`/api/v1/bookings/${futureId}`, { cookie: ownerCookie });
    expect(response.status).toBe(200);
    const json = (await response.json()) as AnyBody;
    expect(json.visibility).toBe('FULL');
    expect(json.history).toEqual([
      { event: 'CREATED', at: expect.stringMatching(/\+07:00$/), actor: expect.anything() },
    ]);
    expect(json.can).toEqual({ edit: true, reschedule: true, cancel: true, check_in: false });
  });

  // ------------------------------------------------------------ buffer_minutes

  it('honours buffer_minutes in the grid and in create/reschedule, with one validator', async () => {
    const pool = harness.db.$client;
    const roomId = roomIds.get('bk-room-buf') as string;
    const setBuffer = async (minutes: number) => {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('buffer_minutes', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
        [String(minutes)],
      );
      // The route's own PUT calls this after committing; here the write is direct SQL.
      invalidateSettings(harness.db);
    };

    const anchor = await createBooking(ownerCookie, {
      room_id: roomId,
      start_at: at('13:00'),
      end_at: at('14:00'),
      title: 'Buffer anchor',
    });
    expect(anchor.response.status, JSON.stringify(anchor.json)).toBe(201);

    // At the default 0 the half-open slot makes back-to-back legal — the behaviour a
    // non-zero buffer is supposed to change.
    const abutting = await createBooking(ownerCookie, {
      room_id: roomId,
      start_at: at('14:00'),
      end_at: at('15:00'),
      title: 'Back to back',
    });
    expect(abutting.response.status).toBe(201);
    await pool.query('DELETE FROM notifications WHERE booking_id = $1', [abutting.json.id]);
    await pool.query('DELETE FROM bookings WHERE id = $1', [abutting.json.id]);

    await setBuffer(30);
    try {
      const grid = (await (
        await request(`/api/v1/availability?start=${at('14:00')}&end=${at('15:00')}`, {
          cookie: ownerCookie,
        })
      ).json()) as { rooms: AnyBody[] };
      const room = grid.rooms.find((entry) => (entry.room as AnyBody).id === roomId);
      expect(room?.available).toBe(false);
      expect(room?.reasons).toContain('BUSY');
      // Free again one buffer after the anchor ends, not the moment it ends.
      expect(room?.busy_until).toBe(toBangkokIso(new Date(at('14:30'))));

      // The create endpoint must agree with the grid, or the UI offers what it then refuses.
      const refused = await createBooking(ownerCookie, {
        room_id: roomId,
        start_at: at('14:00'),
        end_at: at('15:00'),
        title: 'Inside the gap',
      });
      expect(refused.response.status).toBe(409);
      expect(refused.json.code).toBe('SLOT_UNAVAILABLE');
      expect((refused.json.details as AnyBody).alternatives).toBeInstanceOf(Array);

      const cleared = await createBooking(ownerCookie, {
        room_id: roomId,
        start_at: at('14:30'),
        end_at: at('15:30'),
        title: 'After the gap',
      });
      expect(cleared.response.status, JSON.stringify(cleared.json)).toBe(201);

      // CB-03 again, this time refused by the buffer rather than by constraint A.
      const moved = await request(`/api/v1/bookings/${cleared.json.id}`, {
        method: 'PATCH',
        cookie: ownerCookie,
        body: { version: 1, start_at: at('14:00'), end_at: at('15:00') },
      });
      expect(moved.status).toBe(409);
      expect(((await moved.json()) as AnyBody).code).toBe('SLOT_UNAVAILABLE');
      const unmoved = await pool.query('SELECT start_at, version FROM bookings WHERE id = $1', [
        cleared.json.id,
      ]);
      expect(unmoved.rows[0].version).toBe(1);
      expect(new Date(unmoved.rows[0].start_at).toISOString()).toBe(at('14:30'));
    } finally {
      await setBuffer(0);
    }
  });

  it('scope=attending surfaces bookings the viewer is invited to, at FULL', async () => {
    await harness.db.$client.query(
      `INSERT INTO booking_attendees (booking_id, email) VALUES ($1, 'bk-stranger@example.com')
       ON CONFLICT DO NOTHING`,
      [futureId],
    );
    const response = await request('/api/v1/bookings?scope=attending&page_size=50', {
      cookie: strangerCookie,
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: AnyBody[] };
    const entry = json.data.find((candidate) => candidate.id === futureId);
    expect(entry).toMatchObject({ visibility: 'FULL', is_mine: false });
  });

  it('demo-only: shifts an owned booking into the live window, then QR check-in works', async () => {
    const stranger = await request(`/api/v1/bookings/${futureId}/demo-check-in-ready`, {
      method: 'POST',
      cookie: strangerCookie,
      body: { version: futureVersion },
    });
    expect(stranger.status).toBe(403);

    const before = Date.now();
    const prepared = await request(`/api/v1/bookings/${futureId}/demo-check-in-ready`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { version: futureVersion },
    });
    expect(prepared.status).toBe(200);
    const preparedBooking = (await prepared.json()) as AnyBody;
    expect(preparedBooking).toMatchObject({
      id: futureId,
      status: 'CONFIRMED',
      room_id: roomIds.get('bk-room-demo'),
    });
    const preparedStart = new Date(preparedBooking.start_at as string).getTime();
    expect(preparedStart).toBeGreaterThan(before - 15 * 60_000);
    expect(preparedStart).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    expect(preparedStart % (15 * 60_000)).toBe(0);

    const detail = await request(`/api/v1/bookings/${futureId}`, { cookie: ownerCookie });
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      can: { check_in: true },
      history: [{ event: 'CREATED' }, { event: 'RESCHEDULED' }],
    });

    const qr = await request('/api/v1/check-in/rooms/bk-room-demo', {
      method: 'POST',
      cookie: ownerCookie,
    });
    expect(qr.status).toBe(200);
    await expect(qr.json()).resolves.toMatchObject({
      already_checked_in: false,
      booking: { id: futureId, status: 'CHECKED_IN', checkin: { method: 'QR' } },
    });

    const audit = await harness.db.$client.query(
      "SELECT action FROM audit_logs WHERE entity_type = 'booking' AND entity_id = $1 ORDER BY created_at, id",
      [futureId],
    );
    expect(audit.rows.map((row) => row.action)).toContain('booking.demo_shift');

    const notifications = await harness.db.$client.query(
      'SELECT template_key FROM notifications WHERE booking_id = $1 ORDER BY created_at, id',
      [futureId],
    );
    expect(notifications.rows.map((row) => row.template_key)).toEqual(['booking.confirmed']);
  });
});
