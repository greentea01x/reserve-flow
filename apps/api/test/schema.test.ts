import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The schema release gate (§5.2 "definition of done"). These assertions are about Postgres,
 * not about our code — they fail if a migration is edited in a way that quietly removes a
 * guarantee, which is exactly the class of mistake nothing else catches.
 *
 * Needs a database with all migrations applied:
 *   docker compose -f infra/compose.yml up -d postgres
 *   pnpm --filter @reserveflow/api exec drizzle-kit migrate
 *   TEST_DATABASE_URL=postgresql://rf_owner:...@127.0.0.1:5432/reserveflow pnpm test
 *
 * TEST_DATABASE_URL_APP (the rf_app role) additionally covers the grant assertions.
 */
const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL_APP;

describe.skipIf(!ownerUrl)('schema guarantees', () => {
  let owner: Pool;
  let roomId: string;
  let userId: string;

  const book = (title: string, start: string, end: string, status = 'CONFIRMED') =>
    owner.query(
      `INSERT INTO bookings (room_id, owner_id, created_by, title, start_at, end_at, status,
                             idempotency_key, confirmed_at)
       VALUES ($1,$2,$2,$3,$4,$5,$6, gen_random_uuid(), now()) RETURNING id`,
      [roomId, userId, title, start, end, status],
    );

  /** Postgres SQLSTATE of a failed query, or null if it unexpectedly succeeded. */
  const sqlstateOf = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? null;
    }
  };

  beforeAll(async () => {
    owner = new Pool({ connectionString: ownerUrl });
    // A fresh fixture per run: these tables are otherwise empty in a test database.
    await owner.query(`DELETE FROM bookings WHERE title LIKE 'test:%'`);
    const dept = await owner.query(
      `INSERT INTO departments (code, name) VALUES ('TESTDEPT','Test')
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    const user = await owner.query(
      `INSERT INTO users (full_name, email, employee_code, department_id, status)
       VALUES ('Test User','schema-test@example.com','TEST-001',$1,'INVITED')
       ON CONFLICT (email) DO UPDATE SET full_name = excluded.full_name RETURNING id`,
      [dept.rows[0].id],
    );
    const room = await owner.query(
      `INSERT INTO rooms (code, name, capacity) VALUES ('test-room','Test Room',10)
       ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    userId = user.rows[0].id;
    roomId = room.rows[0].id;
  });

  afterAll(async () => {
    await owner?.query(`DELETE FROM bookings WHERE title LIKE 'test:%'`);
    await owner?.end();
  });

  it('refuses two overlapping bookings that both hold the room', async () => {
    await book('test:holder', '2099-01-04 13:00+07', '2099-01-04 14:00+07');
    const code = await sqlstateOf(() =>
      book('test:overlap', '2099-01-04 13:30+07', '2099-01-04 14:30+07'),
    );
    // 23P01 = exclusion_violation, which the API maps to 409 SLOT_UNAVAILABLE.
    expect(code).toBe('23P01');
  });

  it('refuses an overlap against a CHECKED_IN booking too', async () => {
    await book('test:checkedin', '2099-01-05 09:00+07', '2099-01-05 10:00+07');
    await owner.query(
      `UPDATE bookings SET status='CHECKED_IN', checked_in_at=now(), checkin_method='SELF'
       WHERE title='test:checkedin'`,
    );
    const code = await sqlstateOf(() =>
      book('test:vs-checkedin', '2099-01-05 09:30+07', '2099-01-05 10:30+07'),
    );
    expect(code).toBe('23P01');
  });

  it('allows back-to-back bookings because the range is half-open', async () => {
    await book('test:first', '2099-01-06 13:00+07', '2099-01-06 14:00+07');
    await expect(
      book('test:second', '2099-01-06 14:00+07', '2099-01-06 15:00+07'),
    ).resolves.toBeDefined();
  });

  it('frees the slot when a booking reaches a terminal state', async () => {
    await book('test:tocancel', '2099-01-07 13:00+07', '2099-01-07 14:00+07');
    await owner.query(
      `UPDATE bookings SET status='CANCELLED', cancelled_at=now(), cancelled_by=$1,
              reason_code='OWNER_CANCELLED' WHERE title='test:tocancel'`,
      [userId],
    );
    await expect(
      book('test:reuse', '2099-01-07 13:00+07', '2099-01-07 14:00+07'),
    ).resolves.toBeDefined();
  });

  it('leaves the original booking untouched when a reschedule collides', async () => {
    const moving = await book('test:moving', '2099-01-08 09:00+07', '2099-01-08 10:00+07');
    await book('test:blocker', '2099-01-08 11:00+07', '2099-01-08 12:00+07');

    const code = await sqlstateOf(() =>
      owner.query(
        `UPDATE bookings SET start_at='2099-01-08 11:00+07', end_at='2099-01-08 12:00+07',
                version = version + 1 WHERE id = $1`,
        [moving.rows[0].id],
      ),
    );
    expect(code).toBe('23P01');

    // The constraint is immediate, so the whole UPDATE rolled back: same time, same version.
    const after = await owner.query(`SELECT start_at, version FROM bookings WHERE id = $1`, [
      moving.rows[0].id,
    ]);
    expect(after.rows[0].version).toBe(1);
    expect(new Date(after.rows[0].start_at).toISOString()).toBe('2099-01-08T02:00:00.000Z');
  });

  it('rejects times off the 15-minute grid', async () => {
    const code = await sqlstateOf(() =>
      book('test:offgrid', '2099-01-09 13:07+07', '2099-01-09 14:07+07'),
    );
    expect(code).toBe('23514');
  });

  it('keeps banned and status from drifting apart', async () => {
    const code = await sqlstateOf(() =>
      owner.query(`UPDATE users SET banned = true WHERE id = $1`, [userId]),
    );
    expect(code).toBe('23514');
  });

  it('makes audit_logs append-only, even for the schema owner', async () => {
    await owner.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ('test','user',$1)`,
      [userId],
    );
    // 42501 = insufficient_privilege, raised by the trigger rather than by a grant.
    expect(await sqlstateOf(() => owner.query(`DELETE FROM audit_logs WHERE action='test'`))).toBe(
      '42501',
    );
    expect(
      await sqlstateOf(() => owner.query(`UPDATE audit_logs SET action='x' WHERE action='test'`)),
    ).toBe('42501');
  });

  describe.skipIf(!appUrl)('runtime role', () => {
    let app: Pool;
    beforeAll(() => {
      app = new Pool({ connectionString: appUrl });
    });
    afterAll(async () => {
      await app?.end();
    });

    it('cannot DELETE bookings — cancelling is a status change', async () => {
      expect(await sqlstateOf(() => app.query('DELETE FROM bookings'))).toBe('42501');
      // ...but it can still read them, so this is a grant and not a broken connection.
      await expect(app.query('SELECT count(*) FROM bookings')).resolves.toBeDefined();
    });

    it('cannot rewrite audit_logs', async () => {
      expect(await sqlstateOf(() => app.query('DELETE FROM audit_logs'))).toBe('42501');
      expect(await sqlstateOf(() => app.query(`UPDATE audit_logs SET action='x'`))).toBe('42501');
    });
  });
});
