import type { SendMailOptions, Transporter } from 'nodemailer';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from '../src/db/index.js';
import { createMailer, type MailerConfig } from '../src/email/mailer.js';
import { runDrainOnce } from '../src/jobs/drain.js';
import { sweepRound } from '../src/jobs/index.js';
import { runSweepOnce } from '../src/jobs/sweep.js';
import { createLogger } from '../src/lib/logger.js';
import type { Settings } from '../src/lib/settings.js';

/**
 * Release gate: the sweep and the outbox drain against the REAL local Postgres and the REAL
 * local Mailpit (SMTP 127.0.0.1:1025, HTTP API 127.0.0.1:8025). No stubs on the happy path —
 * a message must actually land in Mailpit with its text/calendar part intact.
 */

const ownerUrl = process.env.TEST_DATABASE_URL;
const MAILPIT = 'http://127.0.0.1:8025';
const logger = createLogger('silent');

const OWNER = 'gate-jobs-owner@example.com';
const ATTENDEE = 'gate-jobs-att@example.com';
const ADMIN = 'gate-jobs-admin@example.com';
const FAIL_RECIPIENT = 'gate-jobs-fail@example.com';

const settings: Settings = {
  slot_increment_minutes: 15,
  min_duration_minutes: 30,
  max_duration_minutes: null,
  buffer_minutes: 0,
  max_advance_days: 60,
  min_lead_minutes: 0,
  checkin_open_before_minutes: 15,
  checkin_grace_minutes: 15,
  auto_release_enabled: true,
  reminder_minutes_before: 60,
};

const config: MailerConfig = {
  host: '127.0.0.1',
  port: 1025,
  user: '',
  pass: '',
  from: 'ReserveFlow <no-reply@reserveflow.test>',
  replyTo: 'no-reply@reserveflow.test',
  domain: 'reserveflow.test',
};

const floorTo15 = (instant: Date) => new Date(Math.floor(instant.getTime() / 900_000) * 900_000);
const minutesFromNow = (minutes: number) => floorTo15(new Date(Date.now() + minutes * 60_000));

type Queryable = Pick<PoolClient, 'query'>;

async function insertBooking(
  q: Queryable,
  input: {
    roomId: string;
    ownerId: string;
    title: string;
    start: Date;
    minutes: number;
    status?: 'CONFIRMED' | 'CHECKED_IN';
  },
): Promise<string> {
  const status = input.status ?? 'CONFIRMED';
  const end = new Date(input.start.getTime() + input.minutes * 60_000);
  const row = await q.query(
    `INSERT INTO bookings (room_id, owner_id, created_by, title, start_at, end_at, status,
                           confirmed_at, checked_in_at, checkin_method, idempotency_key)
     VALUES ($1, $2, $2, $3, $4, $5, $6, now(),
             CASE WHEN $6 = 'CHECKED_IN' THEN now() END,
             CASE WHEN $6 = 'CHECKED_IN' THEN 'SELF' END,
             gen_random_uuid())
     RETURNING id`,
    [
      input.roomId,
      input.ownerId,
      input.title,
      input.start.toISOString(),
      end.toISOString(),
      status,
    ],
  );
  return row.rows[0].id as string;
}

// ------------------------------------------------------------------------------ Mailpit API

type MailpitSummary = { ID: string; MessageID: string; Subject: string };
type MailpitPart = { PartID: string; FileName: string; ContentType: string };
type MailpitMessage = {
  ID: string;
  MessageID: string;
  Subject: string;
  To: { Address: string }[];
  Attachments: MailpitPart[];
  Inline: MailpitPart[];
};

async function mailpitJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT}${path}`);
  if (!response.ok) {
    throw new Error(`mailpit ${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

async function mailpitText(path: string): Promise<string> {
  const response = await fetch(`${MAILPIT}${path}`);
  if (!response.ok) {
    throw new Error(`mailpit ${path} responded ${response.status}`);
  }
  return await response.text();
}

/** Newest-first listing; polls briefly because SMTP 250 and API visibility are not atomic. */
async function mailpitFind(messageIdNeedle: string): Promise<MailpitSummary> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const { messages } = await mailpitJson<{ messages: MailpitSummary[] }>(
      '/api/v1/messages?limit=200',
    );
    const hit = messages.find((message) => message.MessageID.includes(messageIdNeedle));
    if (hit !== undefined) {
      return hit;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`mailpit has no message whose Message-ID contains "${messageIdNeedle}"`);
}

/** Real Mailpit for everyone except `failTo`, whose sends go to an unreachable SMTP port. */
function routingTransporter(failTo: string, bad: Transporter, good: Transporter): Transporter {
  const sendMail = (options: SendMailOptions) =>
    (options.to === failTo ? bad : good).sendMail(options);
  return { sendMail } as unknown as Transporter;
}

describe.skipIf(!ownerUrl)('release gate: jobs (database + Mailpit)', () => {
  const db = createDb(ownerUrl as string);
  const pool = db.$client;
  const roomIds = new Map<string, string>();
  let ownerId = '';

  const room = (code: string) => roomIds.get(code) as string;

  const cleanup = async () => {
    await pool.query(
      `DELETE FROM notifications
        WHERE recipient_email LIKE 'gate-jobs-%'
           OR booking_id IN (SELECT id FROM bookings WHERE room_id = ANY($1::uuid[]))`,
      [[...roomIds.values()]],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = ANY($1::uuid[])', [
      [...roomIds.values()],
    ]);
  };

  beforeAll(async () => {
    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('GJDEPT', 'Gate Jobs Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    for (const [email, employeeCode, fullName, role] of [
      [OWNER, 'GJ-001', 'Gate Jobs Owner', 'EMPLOYEE'],
      [ADMIN, 'GJ-002', 'Gate Jobs Admin', 'ADMIN'],
    ] as const) {
      const user = await pool.query(
        `INSERT INTO users (full_name, email, email_verified, employee_code, department_id,
                            status, role)
         VALUES ($1, $2, true, $3, $4, 'ACTIVE', $5)
         ON CONFLICT (email) DO UPDATE
           SET status = 'ACTIVE', role = excluded.role, banned = false, disabled_at = NULL
         RETURNING id`,
        [fullName, email, employeeCode, department.rows[0].id, role],
      );
      if (email === OWNER) {
        ownerId = user.rows[0].id as string;
      }
    }
    for (const code of [
      'gate-jobs-sweep',
      'gate-jobs-complete',
      'gate-jobs-drain',
      'gate-jobs-single',
    ]) {
      const inserted = await pool.query(
        `INSERT INTO rooms (code, name, capacity, active) VALUES ($1, $2, 6, true)
         ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`,
        [code, `test: ${code}`],
      );
      roomIds.set(code, inserted.rows[0].id as string);
    }
    await cleanup();
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  const statusOf = async (id: string) => {
    const row = await pool.query(
      `SELECT status, attempts, last_error, provider_message_id, sent_at,
              extract(epoch FROM (next_attempt_at - now()))::int AS delay
         FROM notifications WHERE id = $1`,
      [id],
    );
    return row.rows[0];
  };

  // ------------------------------------------------------------------------------- 1. sweep

  it('gate 1: no-show CONFIRMED past grace → one sweep tick → AUTO_RELEASED + audit + outbox', async () => {
    // Started 60 min ago with grace 15 (ends in 30): LEAST(end, start+grace) long expired.
    const id = await insertBooking(pool, {
      roomId: room('gate-jobs-sweep'),
      ownerId,
      title: 'test: gate jobs no-show',
      start: minutesFromNow(-60),
      minutes: 90,
    });
    await pool.query(
      `INSERT INTO booking_attendees (booking_id, email, name) VALUES ($1, $2, 'Gate Att')`,
      [id, ATTENDEE],
    );

    await expect(sweepRound(pool, settings, logger)).resolves.toBe(true);

    const booking = await pool.query(
      'SELECT status, reason_code, version, auto_released_at FROM bookings WHERE id = $1',
      [id],
    );
    expect(booking.rows[0]).toMatchObject({
      status: 'AUTO_RELEASED',
      reason_code: 'NO_SHOW',
      version: 2,
    });
    expect(booking.rows[0].auto_released_at).not.toBeNull();

    const audit = await pool.query(
      `SELECT actor_id, after FROM audit_logs
        WHERE entity_type = 'booking' AND entity_id = $1 AND action = 'booking.auto_release'`,
      [id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toEqual({
      actor_id: null,
      after: { status: 'AUTO_RELEASED', version: 2 },
    });

    const outbox = await pool.query(
      `SELECT template_key, recipient_email, dedupe_key FROM notifications
        WHERE booking_id = $1 ORDER BY template_key, recipient_email`,
      [id],
    );
    const released = outbox.rows.filter((r) => r.template_key === 'booking.auto_released');
    expect(released.map((r) => r.recipient_email)).toEqual([ATTENDEE, OWNER]);
    for (const r of released) {
      expect(r.dedupe_key).toBe('2');
    }
    const adminRows = outbox.rows.filter((r) => r.template_key === 'booking.auto_released_admin');
    expect(adminRows.map((r) => r.recipient_email)).toContain(ADMIN);
  }, 30_000);

  it('gate 2: CHECKED_IN past end_at → COMPLETED, no email', async () => {
    const id = await insertBooking(pool, {
      roomId: room('gate-jobs-complete'),
      ownerId,
      title: 'test: gate jobs ended',
      start: minutesFromNow(-120),
      minutes: 60,
      status: 'CHECKED_IN',
    });

    await expect(sweepRound(pool, settings, logger)).resolves.toBe(true);

    const booking = await pool.query('SELECT status, version FROM bookings WHERE id = $1', [id]);
    expect(booking.rows[0]).toEqual({ status: 'COMPLETED', version: 2 });
    const outbox = await pool.query(
      'SELECT count(*)::int AS n FROM notifications WHERE booking_id = $1',
      [id],
    );
    expect(outbox.rows[0].n).toBe(0);
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE entity_type = 'booking' AND entity_id = $1 AND action = 'booking.complete'`,
      [id],
    );
    expect(audit.rows[0].n).toBe(1);
  }, 30_000);

  // ------------------------------------------------------------------------------- 3. drain

  const drainDeps = (transporter: Transporter) => ({
    transporter,
    config,
    publicBaseUrl: 'http://localhost:3000',
    checkInGraceMinutes: settings.checkin_grace_minutes,
    logger,
  });

  let drainBookingId = '';
  let drainStart = new Date(0);

  function emailPayload(version: number) {
    return {
      booking_id: drainBookingId,
      title: 'test: gate jobs drain',
      description: null,
      start_at: drainStart.toISOString(),
      end_at: new Date(drainStart.getTime() + 60 * 60_000).toISOString(),
      headcount: 4,
      version,
      room: { code: 'gate-jobs-drain', name: 'test: gate-jobs-drain' },
      owner: { email: OWNER, name: 'Gate Jobs Owner' },
      attendees: [{ email: ATTENDEE, name: 'Gate Att' }],
    };
  }

  async function insertNotification(input: {
    templateKey: string;
    dedupeKey: string;
    recipient: string;
    payload: unknown;
  }): Promise<string> {
    const row = await pool.query(
      `INSERT INTO notifications (booking_id, template_key, dedupe_key, recipient_email, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id::text`,
      [
        drainBookingId,
        input.templateKey,
        input.dedupeKey,
        input.recipient,
        JSON.stringify(input.payload),
      ],
    );
    return row.rows[0].id as string;
  }

  it('gate 3: drain sends through the real SMTP and Mailpit holds the .ics UID + SEQUENCE', async () => {
    drainStart = minutesFromNow(120);
    drainBookingId = await insertBooking(pool, {
      roomId: room('gate-jobs-drain'),
      ownerId,
      title: 'test: gate jobs drain',
      start: drainStart,
      minutes: 60,
    });
    const notificationId = await insertNotification({
      templateKey: 'booking.confirmed',
      dedupeKey: '1',
      recipient: OWNER,
      payload: emailPayload(1),
    });

    await runDrainOnce(pool, drainDeps(createMailer(config)));

    const row = await statusOf(notificationId);
    expect(row).toMatchObject({
      status: 'SENT',
      provider_message_id: `<notif-${notificationId}@reserveflow.test>`,
    });
    expect(row.sent_at).not.toBeNull();
    expect(row.attempts).toBe(1);

    // The message must exist in Mailpit and carry the calendar part.
    const summary = await mailpitFind(`notif-${notificationId}@reserveflow.test`);
    const message = await mailpitJson<MailpitMessage>(`/api/v1/message/${summary.ID}`);
    expect(message.To.map((to) => to.Address.toLowerCase())).toContain(OWNER);

    const raw = await mailpitText(`/api/v1/message/${summary.ID}/raw`);
    expect(raw).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REQUEST/i);

    const calendarPart = [...message.Attachments, ...message.Inline].find((part) =>
      /calendar|ics/i.test(part.ContentType),
    );
    expect(calendarPart).toBeDefined();
    const ics = await mailpitText(
      `/api/v1/message/${summary.ID}/part/${(calendarPart as MailpitPart).PartID}`,
    );
    expect(ics).toContain(`UID:${drainBookingId}@reserveflow.test`);
    expect(ics).toContain('SEQUENCE:1');
    expect(ics).toContain('METHOD:REQUEST');
  }, 60_000);

  it('gate 4: an unreachable SMTP port backs one row off while the rest of the batch still sends', async () => {
    const failId = await insertNotification({
      templateKey: 'booking.confirmed',
      dedupeKey: '2',
      recipient: FAIL_RECIPIENT,
      payload: emailPayload(1),
    });
    const okId = await insertNotification({
      templateKey: 'booking.confirmed',
      dedupeKey: '3',
      recipient: OWNER,
      payload: emailPayload(1),
    });

    // Port 1 refuses instantly: a genuine nodemailer connection failure, not a stub.
    const unreachable = createMailer({ ...config, port: 1 });
    await runDrainOnce(
      pool,
      drainDeps(routingTransporter(FAIL_RECIPIENT, unreachable, createMailer(config))),
    );

    const failed = await statusOf(failId);
    expect(failed.status).toBe('PENDING'); // NOT sent, NOT dead-lettered
    expect(failed.attempts).toBe(1);
    expect(failed.last_error).toBeTruthy();
    expect(failed.provider_message_id).toBeNull();
    expect(failed.sent_at).toBeNull();
    expect(failed.delay).toBeGreaterThanOrEqual(25); // 2^0 * 30s retry scheduled
    expect(failed.delay).toBeLessThanOrEqual(35);

    // The failure did not wedge the round: the later row in the same batch went out for real.
    const ok = await statusOf(okId);
    expect(ok).toMatchObject({
      status: 'SENT',
      provider_message_id: `<notif-${okId}@reserveflow.test>`,
    });
    await mailpitFind(`notif-${okId}@reserveflow.test`);
  }, 60_000);

  // --------------------------------------------------------------------------- 5. singleton

  it('gate 5: with two concurrent ticks exactly one instance processes the booking', async () => {
    const id = await insertBooking(pool, {
      roomId: room('gate-jobs-single'),
      ownerId,
      title: 'test: gate jobs singleton',
      start: minutesFromNow(-60),
      minutes: 90,
    });

    // Instance A is mid-tick: its transaction holds the job advisory lock.
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const got = await holder.query(
        "SELECT pg_try_advisory_xact_lock(hashtext('job:booking.sweep')) AS ok",
      );
      expect(got.rows[0].ok).toBe(true);

      // Instance B ticks concurrently: it must skip (false), not block, not process.
      await expect(sweepRound(pool, settings, logger)).resolves.toBe(false);
      const untouched = await pool.query('SELECT status, version FROM bookings WHERE id = $1', [
        id,
      ]);
      expect(untouched.rows[0]).toEqual({ status: 'CONFIRMED', version: 1 });

      // Instance A finishes its tick and commits.
      await runSweepOnce(holder, settings, logger);
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }

    // Probe: processed exactly once — one version bump, one audit row, one owner email row.
    const booking = await pool.query('SELECT status, version FROM bookings WHERE id = $1', [id]);
    expect(booking.rows[0]).toEqual({ status: 'AUTO_RELEASED', version: 2 });
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE entity_type = 'booking' AND entity_id = $1 AND action = 'booking.auto_release'`,
      [id],
    );
    expect(audit.rows[0].n).toBe(1);
    const ownerRows = await pool.query(
      `SELECT count(*)::int AS n FROM notifications
        WHERE booking_id = $1 AND template_key = 'booking.auto_released' AND recipient_email = $2`,
      [id, OWNER],
    );
    expect(ownerRows.rows[0].n).toBe(1);
  }, 30_000);
});
