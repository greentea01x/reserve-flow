import type { Transporter } from 'nodemailer';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from '../src/db/index.js';
import type { MailerConfig } from '../src/email/mailer.js';
import type { Env } from '../src/env.js';
import { runDrainOnce } from '../src/jobs/drain.js';
import {
  maintenanceRound,
  msUntilBangkok0315,
  startScheduler,
  sweepRound,
} from '../src/jobs/index.js';
import { RETENTION_TITLE, runMaintenanceOnce } from '../src/jobs/maintenance.js';
import { runSweepOnce } from '../src/jobs/sweep.js';
import { createLogger } from '../src/lib/logger.js';
import type { Settings } from '../src/lib/settings.js';

const ownerUrl = process.env.TEST_DATABASE_URL;
const logger = createLogger('silent');

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

type SentMail = {
  messageId: string;
  to: string;
  subject: string;
  text: string;
  icalEvent?: { method: string; content: string };
};

function stubTransporter(sent: SentMail[], failWith?: string): Transporter {
  return {
    sendMail: (options: SentMail) => {
      if (failWith !== undefined) {
        return Promise.reject(new Error(failWith));
      }
      sent.push(options);
      return Promise.resolve({
        messageId: options.messageId,
        accepted: [options.to],
        rejected: [],
        response: '250 ok',
      });
    },
  } as unknown as Transporter;
}

function floorTo15(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 900_000) * 900_000);
}

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
    status?: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED' | 'AUTO_RELEASED';
  },
): Promise<string> {
  const status = input.status ?? 'CONFIRMED';
  const end = new Date(input.start.getTime() + input.minutes * 60_000);
  const row = await q.query(
    `INSERT INTO bookings (room_id, owner_id, created_by, title, start_at, end_at, status,
                           confirmed_at, checked_in_at, checkin_method,
                           cancelled_at, cancelled_by, auto_released_at, reason_code,
                           idempotency_key)
     VALUES ($1, $2, $2, $3, $4, $5, $6,
             CASE WHEN $6 IN ('CONFIRMED', 'CHECKED_IN') THEN now() END,
             CASE WHEN $6 = 'CHECKED_IN' THEN now() END,
             CASE WHEN $6 = 'CHECKED_IN' THEN 'SELF' END,
             CASE WHEN $6 = 'CANCELLED' THEN now() END,
             CASE WHEN $6 = 'CANCELLED' THEN $2::uuid END,
             CASE WHEN $6 = 'AUTO_RELEASED' THEN now() END,
             CASE WHEN $6 = 'CANCELLED' THEN 'OWNER_CANCELLED'
                  WHEN $6 = 'AUTO_RELEASED' THEN 'NO_SHOW' END,
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

describe('scheduler (no database)', () => {
  it('computes the next 03:15 Asia/Bangkok (20:15 UTC — Bangkok is fixed UTC+7)', () => {
    // 10:00Z → 20:15Z the same day.
    expect(msUntilBangkok0315(new Date('2026-08-25T10:00:00Z'))).toBe((10 * 60 + 15) * 60_000);
    // 21:00Z is past 20:15Z → 20:15Z the next day.
    expect(msUntilBangkok0315(new Date('2026-08-25T21:00:00Z'))).toBe((23 * 60 + 15) * 60_000);
    // Exactly on the mark → a full day ahead, never 0 (that would be a hot loop).
    expect(msUntilBangkok0315(new Date('2026-08-25T20:15:00Z'))).toBe(86_400_000);
  });

  it('startScheduler is reentrant: two instances keep independent state', async () => {
    const env = {
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:9/unused',
      DATABASE_URL_MIGRATE: 'postgresql://unused:unused@127.0.0.1:9/unused',
      PUBLIC_BASE_URL: 'http://localhost:3000',
      TRUST_PROXY: false,
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      ACCOUNT_EMAIL_DOMAINS: [],
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: 1025,
      SMTP_USER: '',
      SMTP_PASS: '',
      MAIL_FROM: 'ReserveFlow <no-reply@reserveflow.test>',
      MAIL_REPLY_TO: 'no-reply@reserveflow.test',
      WORKER_ENABLED: true,
      DEMO_TOOLS_ENABLED: false,
      LOG_LEVEL: 'silent',
    } satisfies Env;
    // The boot sweep tick fails fast against the dead port; the runner logs and swallows it.
    const db = createDb('postgresql://unused:unused@127.0.0.1:9/unused');
    const first = startScheduler({ db, env, logger, transporter: stubTransporter([]) });
    const second = startScheduler({ db, env, logger, transporter: stubTransporter([]) });

    expect(first.health()).not.toBe(second.health());
    expect(Object.keys(second.health()).sort()).toEqual([
      'booking.sweep',
      'maintenance.daily',
      'notify.send',
    ]);

    // Stopping the first instance must not disable the survivor's kick or state.
    await first.stop();
    second.kick();
    expect(second.health()['booking.sweep']).toEqual({ lastSuccessAt: null });
    await second.stop();
    await db.$client.end();
  });
});

describe.skipIf(!ownerUrl)('jobs: sweep + outbox drain (database)', () => {
  const db = createDb(ownerUrl as string);
  const pool = db.$client;
  const roomIds = new Map<string, string>();
  let ownerId = '';

  const room = (code: string) => roomIds.get(code) as string;

  const cleanup = async () => {
    await pool.query(
      `DELETE FROM notifications
        WHERE recipient_email IN ('jb-owner@example.com', 'jb-admin@example.com',
                                  'jb-att@example.com')
           OR booking_id IN (SELECT id FROM bookings WHERE room_id = ANY($1::uuid[]))`,
      [[...roomIds.values()]],
    );
    await pool.query('DELETE FROM bookings WHERE room_id = ANY($1::uuid[])', [
      [...roomIds.values()],
    ]);
  };

  beforeAll(async () => {
    const department = await pool.query(
      `INSERT INTO departments (code, name) VALUES ('JBDEPT', 'Jobs Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    for (const [email, employeeCode, fullName, role] of [
      ['jb-owner@example.com', 'JB-001', 'JB Owner', 'EMPLOYEE'],
      ['jb-admin@example.com', 'JB-002', 'JB Admin', 'ADMIN'],
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
      if (email === 'jb-owner@example.com') {
        ownerId = user.rows[0].id as string;
      }
    }
    for (const code of ['jb-sweep-1', 'jb-sweep-2', 'jb-drain-1', 'jb-drain-2']) {
      const inserted = await pool.query(
        `INSERT INTO rooms (code, name, capacity, active) VALUES ($1, $2, 6, true)
         ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`,
        [code, `test: ${code}`],
      );
      roomIds.set(code, inserted.rows[0].id as string);
    }
    await cleanup();
  }, 30_000);

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  // Sweep tests run inside a rolled-back transaction: the sweep statements see the in-tx
  // bookings, the assertions read through the same client, and nothing leaks into the shared
  // test database (parallel suites keep their live bookings).

  it('auto-releases a no-show past LEAST(end, start+grace) with outbox and audit fan-out', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Started 45 min ago (grace 15 expired), ends in 15 min: released before end_at.
      const id = await insertBooking(client, {
        roomId: room('jb-sweep-1'),
        ownerId,
        title: 'test: jb no-show',
        start: minutesFromNow(-45),
        minutes: 60,
      });
      await client.query(
        `INSERT INTO booking_attendees (booking_id, email, name)
         VALUES ($1, 'jb-att@example.com', 'JB Att')`,
        [id],
      );

      await runSweepOnce(client, settings, logger);

      const booking = await client.query(
        'SELECT status, reason_code, version, auto_released_at FROM bookings WHERE id = $1',
        [id],
      );
      expect(booking.rows[0]).toMatchObject({
        status: 'AUTO_RELEASED',
        reason_code: 'NO_SHOW',
        version: 2,
      });
      expect(booking.rows[0].auto_released_at).not.toBeNull();

      const outbox = await client.query(
        `SELECT template_key, recipient_email, dedupe_key, payload FROM notifications
          WHERE booking_id = $1 ORDER BY template_key, recipient_email`,
        [id],
      );
      const released = outbox.rows.filter((r) => r.template_key === 'booking.auto_released');
      expect(released.map((r) => r.recipient_email)).toEqual([
        'jb-att@example.com',
        'jb-owner@example.com',
      ]);
      for (const r of released) {
        expect(r.dedupe_key).toBe('2'); // post-bump version
        expect(r.payload.version).toBe(2);
        expect(r.payload.room.code).toBe('jb-sweep-1');
      }
      const adminRows = outbox.rows.filter((r) => r.template_key === 'booking.auto_released_admin');
      expect(adminRows.map((r) => r.recipient_email)).toContain('jb-admin@example.com');

      const audit = await client.query(
        `SELECT action, actor_id, after FROM audit_logs
          WHERE entity_type = 'booking' AND entity_id = $1`,
        [id],
      );
      expect(audit.rows).toEqual([
        {
          action: 'booking.auto_release',
          actor_id: null,
          after: { status: 'AUTO_RELEASED', version: 2 },
        },
      ]);

      // Idempotence (DoD #6): a second run changes nothing and enqueues nothing.
      await runSweepOnce(client, settings, logger);
      const again = await client.query('SELECT version FROM bookings WHERE id = $1', [id]);
      expect(again.rows[0].version).toBe(2);
      const count = await client.query(
        'SELECT count(*)::int AS n FROM notifications WHERE booking_id = $1',
        [id],
      );
      expect(count.rows[0].n).toBe(outbox.rows.length);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 30_000);

  it('completes an ended CHECKED_IN booking with an audit row and no email', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = await insertBooking(client, {
        roomId: room('jb-sweep-2'),
        ownerId,
        title: 'test: jb checked-in ended',
        start: minutesFromNow(-90),
        minutes: 60,
        status: 'CHECKED_IN',
      });

      await runSweepOnce(client, settings, logger);

      const booking = await client.query('SELECT status, version FROM bookings WHERE id = $1', [
        id,
      ]);
      expect(booking.rows[0]).toEqual({ status: 'COMPLETED', version: 2 });
      const outbox = await client.query(
        'SELECT count(*)::int AS n FROM notifications WHERE booking_id = $1',
        [id],
      );
      expect(outbox.rows[0].n).toBe(0);
      const audit = await client.query(
        `SELECT action, actor_id FROM audit_logs WHERE entity_type = 'booking' AND entity_id = $1`,
        [id],
      );
      expect(audit.rows).toEqual([{ action: 'booking.complete', actor_id: null }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 30_000);

  it('AUTO_RELEASED wins at the boundary when grace outruns end_at; the gate falls back to COMPLETED', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 30-min booking that ended 15 min ago, grace 120 > duration: LEAST() = end_at,
      // and step order (release before complete) must make it AUTO_RELEASED (C2-03).
      const releasedId = await insertBooking(client, {
        roomId: room('jb-sweep-1'),
        ownerId,
        title: 'test: jb grace edge',
        start: minutesFromNow(-45),
        minutes: 30,
      });
      await runSweepOnce(client, { ...settings, checkin_grace_minutes: 120 }, logger);
      const released = await client.query('SELECT status FROM bookings WHERE id = $1', [
        releasedId,
      ]);
      expect(released.rows[0].status).toBe('AUTO_RELEASED');

      // Same shape with auto_release_enabled=false: step 1 skipped, step 2 completes it.
      const completedId = await insertBooking(client, {
        roomId: room('jb-sweep-2'),
        ownerId,
        title: 'test: jb release disabled',
        start: minutesFromNow(-45),
        minutes: 30,
      });
      await runSweepOnce(client, { ...settings, auto_release_enabled: false }, logger);
      const completed = await client.query('SELECT status FROM bookings WHERE id = $1', [
        completedId,
      ]);
      expect(completed.rows[0].status).toBe('COMPLETED');
      const outbox = await client.query(
        'SELECT count(*)::int AS n FROM notifications WHERE booking_id = $1',
        [completedId],
      );
      expect(outbox.rows[0].n).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 30_000);

  it('enqueues the owner reminder once, and re-arms it after a reschedule', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const start = minutesFromNow(30);
      const id = await insertBooking(client, {
        roomId: room('jb-sweep-1'),
        ownerId,
        title: 'test: jb reminder',
        start,
        minutes: 30,
      });

      await runSweepOnce(client, settings, logger);
      await runSweepOnce(client, settings, logger);

      const rows = await client.query(
        `SELECT recipient_email, dedupe_key, payload FROM notifications
          WHERE booking_id = $1 AND template_key = 'booking.reminder' ORDER BY id`,
        [id],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].recipient_email).toBe('jb-owner@example.com');
      expect(rows.rows[0].dedupe_key).toBe(String(Math.floor(start.getTime() / 1000)));
      const payload = rows.rows[0].payload;
      expect(new Date(payload.start_at).getTime()).toBe(start.getTime());
      expect(payload.room.code).toBe('jb-sweep-1');
      expect(payload.owner.email).toBe('jb-owner@example.com');
      expect(payload.attendees).toEqual([]);

      const newStart = new Date(start.getTime() + 15 * 60_000);
      await client.query('UPDATE bookings SET start_at = $1, end_at = $2 WHERE id = $3', [
        newStart.toISOString(),
        new Date(newStart.getTime() + 30 * 60_000).toISOString(),
        id,
      ]);
      await runSweepOnce(client, settings, logger);

      const after = await client.query(
        `SELECT dedupe_key FROM notifications
          WHERE booking_id = $1 AND template_key = 'booking.reminder' ORDER BY id`,
        [id],
      );
      expect(after.rows.map((r) => r.dedupe_key)).toEqual([
        String(Math.floor(start.getTime() / 1000)),
        String(Math.floor(newStart.getTime() / 1000)),
      ]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 30_000);

  it('skips the sweep round while another instance holds the job advisory lock', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const got = await holder.query(
        "SELECT pg_try_advisory_xact_lock(hashtext('job:booking.sweep')) AS ok",
      );
      expect(got.rows[0].ok).toBe(true);
      await expect(sweepRound(pool, settings, logger)).resolves.toBe(false);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  // ------------------------------------------------------------------ drain

  const publicBaseUrl = 'http://localhost:3000';
  const drainDeps = (transporter: Transporter) => ({
    transporter,
    config,
    publicBaseUrl,
    checkInGraceMinutes: 15,
    logger,
  });

  function payloadFor(
    bookingId: string,
    title: string,
    start: Date,
    minutes: number,
    code: string,
  ) {
    return {
      booking_id: bookingId,
      title,
      description: null,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
      headcount: 3,
      version: 1,
      room: { code, name: `test: ${code}` },
      owner: { email: 'jb-owner@example.com', name: 'JB Owner' },
      attendees: [{ email: 'jb-att@example.com', name: 'JB Att' }],
    };
  }

  async function insertNotification(input: {
    bookingId: string | null;
    templateKey: string;
    dedupeKey: string;
    recipient: string;
    payload: unknown;
  }): Promise<string> {
    const row = await pool.query(
      `INSERT INTO notifications (booking_id, template_key, dedupe_key, recipient_email, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id::text`,
      [
        input.bookingId,
        input.templateKey,
        input.dedupeKey,
        input.recipient,
        JSON.stringify(input.payload),
      ],
    );
    return row.rows[0].id as string;
  }

  const statusOf = async (id: string) => {
    const row = await pool.query(
      `SELECT status, attempts, last_error, provider_message_id, sent_at,
              extract(epoch FROM (next_attempt_at - now()))::int AS delay
         FROM notifications WHERE id = $1`,
      [id],
    );
    return row.rows[0];
  };

  let sentBookingId = '';
  let sentStart = new Date(0);

  it('drain: sends a confirmation with .ics REQUEST and a reminder without one', async () => {
    sentStart = minutesFromNow(120);
    sentBookingId = await insertBooking(pool, {
      roomId: room('jb-drain-1'),
      ownerId,
      title: 'test: jb drain sent',
      start: sentStart,
      minutes: 60,
    });
    const payload = payloadFor(sentBookingId, 'test: jb drain sent', sentStart, 60, 'jb-drain-1');
    const confirmedId = await insertNotification({
      bookingId: sentBookingId,
      templateKey: 'booking.confirmed',
      dedupeKey: '1',
      recipient: 'jb-owner@example.com',
      payload,
    });
    const reminderId = await insertNotification({
      bookingId: sentBookingId,
      templateKey: 'booking.reminder',
      dedupeKey: 'jb-r1',
      recipient: 'jb-owner@example.com',
      payload,
    });

    const sent: SentMail[] = [];
    await runDrainOnce(pool, drainDeps(stubTransporter(sent)));

    for (const id of [confirmedId, reminderId]) {
      const row = await statusOf(id);
      expect(row).toMatchObject({
        status: 'SENT',
        attempts: 1,
        provider_message_id: `<notif-${id}@reserveflow.test>`,
      });
      expect(row.sent_at).not.toBeNull();
    }
    const confirmedMail = sent.find(
      (mail) => mail.messageId === `<notif-${confirmedId}@reserveflow.test>`,
    );
    expect(confirmedMail?.to).toBe('jb-owner@example.com');
    expect(confirmedMail?.subject).toContain('ยืนยันการจอง');
    expect(confirmedMail?.icalEvent?.method).toBe('REQUEST');
    expect(confirmedMail?.icalEvent?.content).toContain(`UID:${sentBookingId}@reserveflow.test`);
    const reminderMail = sent.find(
      (mail) => mail.messageId === `<notif-${reminderId}@reserveflow.test>`,
    );
    expect(reminderMail?.subject).toContain('เตือนการจอง');
    expect(reminderMail?.icalEvent).toBeUndefined();
  }, 30_000);

  it('drain: failure backs off per the spec curve and dead-letters at attempt 8', async () => {
    const payload = payloadFor(sentBookingId, 'test: jb drain sent', sentStart, 60, 'jb-drain-1');
    const retryId = await insertNotification({
      bookingId: sentBookingId,
      templateKey: 'booking.confirmed',
      dedupeKey: '2',
      recipient: 'jb-owner@example.com',
      payload,
    });
    const deadId = await insertNotification({
      bookingId: sentBookingId,
      templateKey: 'booking.confirmed',
      dedupeKey: '3',
      recipient: 'jb-owner@example.com',
      payload,
    });
    await pool.query('UPDATE notifications SET attempts = 7 WHERE id = $1', [deadId]);

    await runDrainOnce(pool, drainDeps(stubTransporter([], 'jb smtp boom')));

    const retry = await statusOf(retryId);
    expect(retry).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'jb smtp boom' });
    expect(retry.delay).toBeGreaterThanOrEqual(25); // 2^0 * 30s
    expect(retry.delay).toBeLessThanOrEqual(35);
    const dead = await statusOf(deadId);
    expect(dead).toMatchObject({ status: 'FAILED', attempts: 8, last_error: 'jb smtp boom' });
  }, 30_000);

  it('drain: skips stale mail, still sends cancel/release, dead-letters unknown templates', async () => {
    const stalePayload = {
      ...payloadFor(sentBookingId, 'test: jb drain sent', sentStart, 60, 'jb-drain-1'),
      start_at: new Date(sentStart.getTime() + 15 * 60_000).toISOString(),
    };
    const staleReminderId = await insertNotification({
      bookingId: sentBookingId,
      templateKey: 'booking.reminder',
      dedupeKey: 'jb-r-stale',
      recipient: 'jb-owner@example.com',
      payload: stalePayload,
    });

    const cancelledStart = minutesFromNow(180);
    const cancelledBookingId = await insertBooking(pool, {
      roomId: room('jb-drain-2'),
      ownerId,
      title: 'test: jb drain cancelled',
      start: cancelledStart,
      minutes: 60,
      status: 'CANCELLED',
    });
    const cancelledPayload = payloadFor(
      cancelledBookingId,
      'test: jb drain cancelled',
      cancelledStart,
      60,
      'jb-drain-2',
    );
    const terminalConfirmId = await insertNotification({
      bookingId: cancelledBookingId,
      templateKey: 'booking.confirmed',
      dedupeKey: '1',
      recipient: 'jb-owner@example.com',
      payload: cancelledPayload,
    });
    const cancelMailId = await insertNotification({
      bookingId: cancelledBookingId,
      templateKey: 'booking.cancelled',
      dedupeKey: '2',
      recipient: 'jb-owner@example.com',
      payload: { ...cancelledPayload, version: 2, reason: 'room maintenance' },
    });

    const releasedStart = minutesFromNow(300);
    const releasedBookingId = await insertBooking(pool, {
      roomId: room('jb-drain-2'),
      ownerId,
      title: 'test: jb drain released',
      start: releasedStart,
      minutes: 60,
      status: 'AUTO_RELEASED',
    });
    const releasedPayload = {
      ...payloadFor(releasedBookingId, 'test: jb drain released', releasedStart, 60, 'jb-drain-2'),
      version: 2,
    };
    const releasedMailId = await insertNotification({
      bookingId: releasedBookingId,
      templateKey: 'booking.auto_released',
      dedupeKey: '2',
      recipient: 'jb-owner@example.com',
      payload: releasedPayload,
    });
    const adminMailId = await insertNotification({
      bookingId: releasedBookingId,
      templateKey: 'booking.auto_released_admin',
      dedupeKey: '2',
      recipient: 'jb-admin@example.com',
      payload: releasedPayload,
    });

    // A template key nothing renders any more (CB-01 removed booking.requested).
    const unknownId = await insertNotification({
      bookingId: null,
      templateKey: 'booking.requested',
      dedupeKey: 'jb-unknown-1',
      recipient: 'jb-owner@example.com',
      payload: {},
    });

    const sent: SentMail[] = [];
    await runDrainOnce(pool, drainDeps(stubTransporter(sent)));

    expect((await statusOf(staleReminderId)).status).toBe('SKIPPED');
    expect((await statusOf(terminalConfirmId)).status).toBe('SKIPPED');
    expect((await statusOf(cancelMailId)).status).toBe('SENT');
    expect((await statusOf(releasedMailId)).status).toBe('SENT');
    expect((await statusOf(adminMailId)).status).toBe('SENT');
    expect(await statusOf(unknownId)).toMatchObject({
      status: 'FAILED',
      last_error: 'no renderer',
    });

    const cancelMail = sent.find(
      (mail) => mail.messageId === `<notif-${cancelMailId}@reserveflow.test>`,
    );
    expect(cancelMail?.icalEvent?.method).toBe('CANCEL');
    expect(cancelMail?.text).toContain('เหตุผล: room maintenance');
    const releasedMail = sent.find(
      (mail) => mail.messageId === `<notif-${releasedMailId}@reserveflow.test>`,
    );
    expect(releasedMail?.icalEvent?.method).toBe('CANCEL');
    const adminMail = sent.find(
      (mail) => mail.messageId === `<notif-${adminMailId}@reserveflow.test>`,
    );
    expect(adminMail?.to).toBe('jb-admin@example.com');
    expect(adminMail?.icalEvent).toBeUndefined();
  }, 30_000);

  it('drain: sends account.set_password from its own payload shape, no .ics', async () => {
    const url = 'http://localhost:3000/set-password?token=jb-token-abc';
    const accountId = await insertNotification({
      bookingId: null,
      templateKey: 'account.set_password',
      dedupeKey: 'jb-token-abc',
      recipient: 'jb-owner@example.com',
      payload: { name: 'JB Owner', set_password_url: url },
    });

    const sent: SentMail[] = [];
    await runDrainOnce(pool, drainDeps(stubTransporter(sent)));

    expect(await statusOf(accountId)).toMatchObject({ status: 'SENT', attempts: 1 });
    const mail = sent.find((m) => m.messageId === `<notif-${accountId}@reserveflow.test>`);
    expect(mail?.to).toBe('jb-owner@example.com');
    expect(mail?.subject).toContain('ตั้งรหัสผ่าน');
    expect(mail?.text).toContain('เรียน คุณJB Owner');
    expect(mail?.text).toContain(url);
    expect(mail?.icalEvent).toBeUndefined();
  }, 30_000);

  // ------------------------------------------------------------ maintenance

  it('maintenance: purges expired auth artefacts and applies PII retention idempotently', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sessions (user_id, token, expires_at)
         VALUES ($1, 'jb-sess-expired', now() - interval '1 hour'),
                ($1, 'jb-sess-live', now() + interval '1 hour')`,
        [ownerId],
      );
      await client.query(
        `INSERT INTO verifications (identifier, value, expires_at)
         VALUES ('jb-ver-expired', 'x', now() - interval '1 hour'),
                ('jb-ver-live', 'x', now() + interval '1 hour')`,
      );
      await client.query(
        `INSERT INTO password_setup_tokens (user_id, token_hash, purpose, expires_at, used_at)
         VALUES ($1, 'jb-tok-expired', 'FORGOT', now() - interval '1 hour', NULL),
                ($1, 'jb-tok-used', 'INVITE', now() + interval '1 day', now()),
                ($1, 'jb-tok-live', 'INVITE', now() + interval '1 day', NULL)`,
        [ownerId],
      );

      // Ended ~26 months ago: past both the 12-month and the 24-month horizons.
      const oldStart = floorTo15(new Date(Date.now() - 800 * 86_400_000));
      const old = await client.query(
        `INSERT INTO bookings (room_id, owner_id, created_by, title, description,
                               special_request, reason, start_at, end_at, status,
                               confirmed_at, idempotency_key)
         VALUES ($1, $2, $2, 'test: jb ancient', 'secret agenda', 'projector please',
                 'moved offices', $3, $4, 'COMPLETED', $3, gen_random_uuid())
         RETURNING id`,
        [
          room('jb-sweep-1'),
          ownerId,
          oldStart.toISOString(),
          new Date(oldStart.getTime() + 3_600_000).toISOString(),
        ],
      );
      const oldId = old.rows[0].id as string;
      await client.query(
        `INSERT INTO booking_attendees (booking_id, email, name)
         VALUES ($1, 'jb-old-att@example.com', 'Old Att')`,
        [oldId],
      );
      await client.query(
        `INSERT INTO notifications (booking_id, template_key, dedupe_key, recipient_email,
                                    payload, created_at)
         VALUES ($1, 'booking.confirmed', '1', 'jb-old-att@example.com', '{}'::jsonb,
                 now() - interval '13 months')`,
        [oldId],
      );
      // A recent meeting must keep every free-text field.
      const recentStart = floorTo15(new Date(Date.now() - 30 * 86_400_000));
      const recent = await client.query(
        `INSERT INTO bookings (room_id, owner_id, created_by, title, description, start_at,
                               end_at, status, confirmed_at, idempotency_key)
         VALUES ($1, $2, $2, 'test: jb recent', 'keep me', $3, $4, 'COMPLETED', $3,
                 gen_random_uuid())
         RETURNING id`,
        [
          room('jb-sweep-2'),
          ownerId,
          recentStart.toISOString(),
          new Date(recentStart.getTime() + 3_600_000).toISOString(),
        ],
      );
      const recentId = recent.rows[0].id as string;

      await runMaintenanceOnce(client, logger);

      const sessionRows = await client.query(
        `SELECT token FROM sessions WHERE token LIKE 'jb-sess-%' ORDER BY token`,
      );
      expect(sessionRows.rows.map((r) => r.token)).toEqual(['jb-sess-live']);
      const verificationRows = await client.query(
        `SELECT identifier FROM verifications WHERE identifier LIKE 'jb-ver-%'`,
      );
      expect(verificationRows.rows.map((r) => r.identifier)).toEqual(['jb-ver-live']);
      const tokenRows = await client.query(
        `SELECT token_hash FROM password_setup_tokens WHERE token_hash LIKE 'jb-tok-%'`,
      );
      expect(tokenRows.rows.map((r) => r.token_hash)).toEqual(['jb-tok-live']);

      const attendeeCount = await client.query(
        'SELECT count(*)::int AS n FROM booking_attendees WHERE booking_id = $1',
        [oldId],
      );
      expect(attendeeCount.rows[0].n).toBe(0);
      const notificationCount = await client.query(
        'SELECT count(*)::int AS n FROM notifications WHERE booking_id = $1',
        [oldId],
      );
      expect(notificationCount.rows[0].n).toBe(0);

      const scrubbed = await client.query(
        'SELECT title, description, special_request, reason FROM bookings WHERE id = $1',
        [oldId],
      );
      expect(scrubbed.rows[0]).toEqual({
        title: RETENTION_TITLE,
        description: null,
        special_request: null,
        reason: null,
      });
      const kept = await client.query('SELECT title, description FROM bookings WHERE id = $1', [
        recentId,
      ]);
      expect(kept.rows[0]).toEqual({ title: 'test: jb recent', description: 'keep me' });

      // Idempotence: after one run the scrub predicate matches nothing any more.
      const candidates = await client.query(
        `SELECT count(*)::int AS n FROM bookings
          WHERE end_at < now() - interval '24 months'
            AND (title <> $1 OR description IS NOT NULL
                 OR special_request IS NOT NULL OR reason IS NOT NULL)`,
        [RETENTION_TITLE],
      );
      expect(candidates.rows[0].n).toBe(0);
      await runMaintenanceOnce(client, logger); // must not throw and changes nothing further
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 30_000);

  it('maintenance: skips the round while another instance holds the job advisory lock', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const got = await holder.query(
        "SELECT pg_try_advisory_xact_lock(hashtext('job:maintenance.daily')) AS ok",
      );
      expect(got.rows[0].ok).toBe(true);
      await expect(maintenanceRound(pool, logger)).resolves.toBe(false);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });
});
