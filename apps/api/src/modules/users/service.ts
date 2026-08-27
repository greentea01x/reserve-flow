import { createHash, randomBytes } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { AppError } from '../../lib/errors.js';
import {
  decisionTime,
  enqueueEmails,
  insertAudit,
  lockRooms,
  type RequestMeta,
  withTx,
} from '../../lib/tx.js';
import { emailPayload } from '../bookings/service.js';

/**
 * Identity writers. Lock ORDER (05 §5.6, CF-01) for every one of them:
 * (1) the ONE global advisory lock 'users:last-admin' → (2) the involved users rows FOR
 * UPDATE ordered by id → (3) rooms by hashtext (deactivate only, resolved UNDER the user
 * lock) → (4) decision_time = clock_timestamp() after every lock. Rooms are never locked
 * before users: createBooking takes users FOR SHARE and then rooms, so the reverse order
 * here would close a deadlock cycle.
 */

/** Exported for import.ts, the fourth writer that has to take it. */
export const LAST_ADMIN_LOCK = "SELECT pg_advisory_xact_lock(hashtext('users:last-admin'))";

/** INVITE links live a week; a reset is an account-recovery action and expires in a day (D-29). */
const TOKEN_TTL: Record<TokenPurpose, string> = {
  INVITE: '7 days',
  RESET: '24 hours',
};

export type TokenPurpose = 'INVITE' | 'RESET';

type UserLockRow = {
  id: string;
  role: string;
  status: string;
  email: string;
  full_name: string;
  department_id: string;
};

export type CancelledBooking = {
  id: string;
  start_at: Date;
  end_at: Date;
  room: { id: string; code: string; name: string };
  status_before: string;
};

/**
 * §2.6 LAST_ADMIN, race-safe. The global advisory lock comes BEFORE any user row is read:
 * row locks alone are insufficient (C1-11) because two admins demoting each other touch two
 * different rows, both pass a per-row check, and the system ends with zero admins. Every op
 * that can remove an admin (PATCH role / deactivate / DELETE / CSV import) takes this same
 * lock, so the second one to arrive sees the count the first one left behind.
 *
 * It cannot be taken conditionally ("only when the target is an admin"): the answer to that
 * question is only trustworthy once the target row is locked, and taking the global lock
 * after a row lock inverts the CF-01 order and closes a deadlock cycle with every writer that
 * takes them the documented way round. What each holder CAN do is finish quickly — hence the
 * set-based cascade in deactivateUser.
 */
async function lockUsers(
  tx: PoolClient,
  ids: readonly string[],
): Promise<Map<string, UserLockRow>> {
  await tx.query(LAST_ADMIN_LOCK);
  const result = await tx.query<UserLockRow>(
    `SELECT id, role, status, email, full_name, department_id FROM users
      WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [[...new Set(ids)].sort()],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

/** Counted AFTER the row lock, inside the same tx as the write it guards. */
async function assertNotLastAdmin(tx: PoolClient, target: UserLockRow): Promise<void> {
  if (target.role !== 'ADMIN' || target.status !== 'ACTIVE') {
    return;
  }
  const result = await tx.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'",
  );
  if ((result.rows[0]?.count ?? 0) <= 1) {
    throw new AppError('LAST_ADMIN', 'The last active admin cannot be demoted or removed');
  }
}

function requireUser(rows: Map<string, UserLockRow>, id: string): UserLockRow {
  const row = rows.get(id);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'User not found');
  }
  return row;
}

/**
 * Token row + outbox row in the caller's transaction (C2-06): a token that exists without its
 * email is an invite nobody can redeem, and an email without a token is a dead link. Only the
 * sha256 hash is stored — the 32-byte base64url token exists solely in the mail. The new
 * token id is the dedupe_key, so a re-issue always produces a fresh notification (C1-05).
 */
export async function issueSetupToken(
  tx: PoolClient,
  input: {
    user: { id: string; email: string; full_name: string };
    purpose: TokenPurpose;
    createdBy: string;
    publicBaseUrl: string;
  },
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO password_setup_tokens (user_id, token_hash, purpose, expires_at, created_by)
     VALUES ($1, $2, $3, now() + $4::interval, $5) RETURNING id`,
    [
      input.user.id,
      createHash('sha256').update(token).digest('hex'),
      input.purpose,
      TOKEN_TTL[input.purpose],
      input.createdBy,
    ],
  );
  await enqueueEmails(tx, {
    bookingId: null,
    templateKey: 'account.set_password',
    dedupeKey: (inserted.rows[0] as { id: string }).id,
    recipients: [input.user.email],
    payload: {
      name: input.user.full_name,
      set_password_url: `${input.publicBaseUrl}/set-password?token=${token}`,
    },
  });
}

/** Supersedes whatever is outstanding, then issues one fresh token + email. */
async function reissueSetupToken(
  tx: PoolClient,
  input: {
    user: UserLockRow;
    purpose: TokenPurpose;
    createdBy: string;
    publicBaseUrl: string;
  },
): Promise<void> {
  await tx.query('DELETE FROM password_setup_tokens WHERE user_id = $1 AND used_at IS NULL', [
    input.user.id,
  ]);
  await tx.query(
    `UPDATE notifications SET status = 'SKIPPED'
      WHERE template_key = 'account.set_password' AND recipient_email = $1 AND status = 'PENDING'`,
    [input.user.email],
  );
  await issueSetupToken(tx, {
    user: input.user,
    purpose: input.purpose,
    createdBy: input.createdBy,
    publicBaseUrl: input.publicBaseUrl,
  });
}

// ---------------------------------------------------------------------------
// POST /admin/users — invite
// ---------------------------------------------------------------------------

export type CreateUserInput = {
  actorId: string;
  employeeCode: string;
  fullName: string;
  email: string;
  mobile: string | null;
  departmentId: string;
  publicBaseUrl: string;
} & RequestMeta;

/**
 * ponytail: a plain INSERT, not auth.api.createUser. Without a password the library writes
 * the users row and zero accounts rows — byte for byte what this does (spike 7a) — but it
 * runs on its own connection, so it cannot join this transaction and a later failure would
 * leave an INVITED account with no invite behind (C2-06). Every field rule is a DB CHECK
 * anyway, and generateId:false means Postgres makes the id either way.
 */
export async function createUser(pool: Pool, input: CreateUserInput): Promise<string> {
  return withTx(pool, async (tx) => {
    // Same global lock every other identity writer takes — uniform and free here, and it is
    // what keeps this INSERT out of the CSV import's window: the import classifies a row as
    // CREATE and inserts it later in the same tx, so an unserialised POST landing between the
    // two raises 23505 and rolls the WHOLE file back (U-07 wants one row's ERROR).
    await tx.query(LAST_ADMIN_LOCK);
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO users (employee_code, full_name, email, mobile, department_id, role, status,
                          created_by)
       VALUES ($1, $2, $3, $4, $5, 'EMPLOYEE', 'INVITED', $6) RETURNING id`,
      [
        input.employeeCode,
        input.fullName,
        input.email,
        input.mobile,
        input.departmentId,
        input.actorId,
      ],
    );
    const id = (inserted.rows[0] as { id: string }).id;

    await issueSetupToken(tx, {
      user: { id, email: input.email, full_name: input.fullName },
      purpose: 'INVITE',
      createdBy: input.actorId,
      publicBaseUrl: input.publicBaseUrl,
    });
    await insertAudit(tx, {
      actorId: input.actorId,
      action: 'user.create',
      entityType: 'user',
      entityId: id,
      // S-12: `mobile` is deliberately absent from every audit payload in this module.
      after: {
        employee_code: input.employeeCode,
        full_name: input.fullName,
        email: input.email,
        department_id: input.departmentId,
        role: 'EMPLOYEE',
        status: 'INVITED',
      },
      ip: input.ip,
      requestId: input.requestId,
    });
    return id;
  });
}

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id
// ---------------------------------------------------------------------------

export type UpdateUserPatch = {
  fullName?: string;
  email?: string;
  mobile?: string | null;
  departmentId?: string;
  role?: string;
};

export type UpdateUserInput = {
  actorId: string;
  userId: string;
  patch: UpdateUserPatch;
} & RequestMeta;

export async function updateUser(pool: Pool, input: UpdateUserInput): Promise<void> {
  const { patch } = input;
  await withTx(pool, async (tx) => {
    // The global lock is taken even when promoting: uniform, free, and it keeps this op in
    // the same queue as the demotions it might race with.
    const target = requireUser(await lockUsers(tx, [input.userId]), input.userId);

    if (patch.role !== undefined) {
      // U-02: name/email/mobile/department of your own account stay editable.
      if (input.userId === input.actorId) {
        throw new AppError('CANNOT_MODIFY_SELF', 'You cannot change your own role');
      }
      if (patch.role !== 'ADMIN') {
        await assertNotLastAdmin(tx, target);
      }
    }

    const params: unknown[] = [input.userId];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const sets: string[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (patch.fullName !== undefined) {
      sets.push(`full_name = ${bind(patch.fullName)}`);
      before.full_name = target.full_name;
      after.full_name = patch.fullName;
    }
    if (patch.email !== undefined) {
      sets.push(`email = ${bind(patch.email)}`);
      before.email = target.email;
      after.email = patch.email;
    }
    if (patch.mobile !== undefined) {
      // Written, never audited (S-12).
      sets.push(`mobile = ${bind(patch.mobile)}`);
    }
    if (patch.departmentId !== undefined) {
      sets.push(`department_id = ${bind(patch.departmentId)}::uuid`);
      before.department_id = target.department_id;
      after.department_id = patch.departmentId;
    }
    if (patch.role !== undefined) {
      sets.push(`role = ${bind(patch.role)}`);
      before.role = target.role;
      after.role = patch.role;
    }

    await tx.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    await insertAudit(tx, {
      actorId: input.actorId,
      // U-08: a role change takes effect on the caller's NEXT request (requireAuth re-reads
      // the row every time); it does not revoke their sessions.
      action:
        patch.role !== undefined && patch.role !== target.role ? 'user.role_change' : 'user.update',
      entityType: 'user',
      entityId: input.userId,
      before,
      after,
      ip: input.ip,
      requestId: input.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// POST /admin/users/:id/deactivate — the cascade (06 §6.3.6, C2-11)
// ---------------------------------------------------------------------------

export type DeactivateInput = {
  actorId: string;
  userId: string;
  reason: string | null;
} & RequestMeta;

export async function deactivateUser(
  pool: Pool,
  input: DeactivateInput,
): Promise<{ already: boolean; cancelled: CancelledBooking[] }> {
  return withTx(pool, async (tx) => {
    // (1)+(2): global lock, then the TARGET row FOR UPDATE — the actor's row used to be
    // locked here too and nothing ever read it back; the self-check below is an id
    // comparison. No status filter — the target may already be DISABLED, and FOR UPDATE is
    // stronger than the FOR SHARE booking writers take, so a create that authenticated a
    // moment ago cannot slip past (C1-10).
    const rows = await lockUsers(tx, [input.userId]);
    const target = requireUser(rows, input.userId);
    if (input.userId === input.actorId) {
      throw new AppError('CANNOT_MODIFY_SELF', 'You cannot deactivate your own account');
    }
    // U-04: repeating the call is a no-op with zero side effects, not an error.
    if (target.status === 'DISABLED') {
      return { already: true, cancelled: [] };
    }
    await assertNotLastAdmin(tx, target);

    // (3): the room set is resolved UNDER the user lock, so it cannot grow while we hold it.
    const roomRows = await tx.query<{ room_id: string }>(
      `SELECT DISTINCT room_id FROM bookings
        WHERE owner_id = $1 AND start_at > clock_timestamp()
          AND status IN ('CONFIRMED','CHECKED_IN')`,
      [input.userId],
    );
    await lockRooms(
      tx,
      roomRows.rows.map((row) => row.room_id),
    );

    // (4): every timestamp and every predicate below uses this one instant. It is later than
    // the resolver's clock_timestamp(), so `start_at > $now` can only be a SUBSET of the
    // rooms we just locked — no booking in an unlocked room is ever touched.
    const now = await decisionTime(tx);
    const at = now.toISOString();

    await tx.query(
      `UPDATE users SET status = 'DISABLED', banned = true, disabled_at = $2, updated_at = $2
        WHERE id = $1`,
      [input.userId, at],
    );
    // THIS is the revocation step. banned=true alone does not end a live session — the
    // better-auth admin plugin only checks it when a session is CREATED (spike 6a/6b).
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [input.userId]);

    // CHECKED_IN counts too (C2-11): someone who checked in ten minutes early and then got
    // disabled must not keep holding the room. Meetings already under way are untouched.
    const doomed = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM bookings
        WHERE owner_id = $1 AND start_at > $2 AND status IN ('CONFIRMED','CHECKED_IN')
        ORDER BY id FOR UPDATE`,
      [input.userId, at],
    );
    if (doomed.rows.length === 0) {
      await auditDisable(tx, input, []);
      return { already: false, cancelled: [] };
    }
    const statusBefore = new Map(doomed.rows.map((row) => [row.id, row.status]));

    const cancelled = await tx.query<{
      id: string;
      start_at: Date;
      end_at: Date;
      title: string;
      description: string | null;
      headcount: number | null;
      version: number;
      room_id: string;
      room_code: string;
      room_name: string;
    }>(
      `WITH updated AS (
         UPDATE bookings
            SET status = 'CANCELLED', cancelled_at = $2, cancelled_by = $3, reason = $4,
                reason_code = 'OWNER_DISABLED', version = version + 1, updated_at = $2
          WHERE id = ANY($1::uuid[]) AND status IN ('CONFIRMED','CHECKED_IN')
          RETURNING id, room_id, start_at, end_at, title, description, headcount, version
       )
       SELECT u.id, u.start_at, u.end_at, u.title, u.description, u.headcount, u.version,
              r.id AS room_id, r.code AS room_code, r.name AS room_name
         FROM updated u JOIN rooms r ON r.id = u.room_id
        ORDER BY u.start_at`,
      [[...statusBefore.keys()], at, input.actorId, input.reason],
    );

    const attendeeRows = await tx.query<{ booking_id: string; email: string; name: string | null }>(
      `SELECT booking_id, email, name FROM booking_attendees
        WHERE booking_id = ANY($1::uuid[]) ORDER BY email`,
      [[...statusBefore.keys()]],
    );
    const attendeesByBooking = new Map<string, { email: string; name: string | null }[]>();
    for (const row of attendeeRows.rows) {
      const list = attendeesByBooking.get(row.booking_id) ?? [];
      list.push({ email: row.email, name: row.name });
      attendeesByBooking.set(row.booking_id, list);
    }

    // Payloads are the only part that has to happen in JS, so build them all first and write
    // the outbox and the trail with ONE statement each. The loop this replaces cost
    // 1 + recipients round-trips PER booking while holding the global 'users:last-admin'
    // lock, which every other user-admin write queues behind — one leaver with a full
    // calendar serialised the whole admin identity surface.
    const mail: {
      booking_id: string;
      dedupe_key: string;
      recipient_email: string;
      payload: unknown;
    }[] = [];
    const trail: { id: string; before: unknown; after: unknown }[] = [];
    for (const row of cancelled.rows) {
      const attendees = attendeesByBooking.get(row.id) ?? [];
      const payload = emailPayload({
        booking: {
          id: row.id,
          title: row.title,
          description: row.description,
          start_at: row.start_at,
          end_at: row.end_at,
          headcount: row.headcount,
          version: row.version,
        },
        room: { code: row.room_code, name: row.room_name },
        owner: { email: target.email, fullName: target.full_name },
        attendees,
        reason: input.reason,
      });
      // §2.6 matrix: an admin cancel (deactivate included) notifies owner AND attendees.
      // Same lower-cased Set enqueueEmails applies, so the owner is not mailed twice for
      // being on their own attendee list.
      const recipients = new Set(
        [target.email, ...attendees.map((attendee) => attendee.email)].map((value) =>
          value.toLowerCase(),
        ),
      );
      for (const recipient of recipients) {
        mail.push({
          booking_id: row.id,
          dedupe_key: String(row.version),
          recipient_email: recipient,
          payload,
        });
      }
      trail.push({
        id: row.id,
        before: { status: statusBefore.get(row.id) },
        after: { status: 'CANCELLED', reason_code: 'OWNER_DISABLED' },
      });
    }

    await tx.query(
      `INSERT INTO notifications (booking_id, template_key, dedupe_key, recipient_email, payload)
       SELECT (x->>'booking_id')::uuid, 'booking.cancelled', x->>'dedupe_key',
              x->>'recipient_email', x->'payload'
         FROM jsonb_array_elements($1::jsonb) AS x
       ON CONFLICT ON CONSTRAINT notifications_dedupe DO NOTHING`,
      [JSON.stringify(mail)],
    );
    // Booking.history derives 1:1 from audit_logs — without these rows the owner would see a
    // CANCELLED booking with no cancellation event on it.
    await tx.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, reason,
                               ip, request_id)
       SELECT $1::uuid, 'booking.cancel', 'booking', x->>'id', x->'before', x->'after',
              $2, $3::inet, $4
         FROM jsonb_array_elements($5::jsonb) AS x`,
      [input.actorId, input.reason, input.ip, input.requestId, JSON.stringify(trail)],
    );

    await auditDisable(
      tx,
      input,
      cancelled.rows.map((row) => row.id),
    );
    return {
      already: false,
      cancelled: cancelled.rows.map((row) => ({
        id: row.id,
        start_at: row.start_at,
        end_at: row.end_at,
        room: { id: row.room_id, code: row.room_code, name: row.room_name },
        status_before: statusBefore.get(row.id) ?? 'CONFIRMED',
      })),
    };
  });
}

async function auditDisable(
  tx: PoolClient,
  input: DeactivateInput,
  cancelledIds: readonly string[],
): Promise<void> {
  await insertAudit(tx, {
    actorId: input.actorId,
    action: 'user.disable',
    entityType: 'user',
    entityId: input.userId,
    after: { status: 'DISABLED', cancelled_bookings: cancelledIds },
    reason: input.reason,
    ip: input.ip,
    requestId: input.requestId,
  });
}

// ---------------------------------------------------------------------------
// POST /admin/users/:id/reactivate — U-05
// ---------------------------------------------------------------------------

export type UserActionInput = { actorId: string; userId: string } & RequestMeta;

export async function reactivateUser(pool: Pool, input: UserActionInput): Promise<void> {
  await withTx(pool, async (tx) => {
    const target = requireUser(await lockUsers(tx, [input.userId]), input.userId);
    if (target.status !== 'DISABLED') {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        'Only a disabled account can be reactivated',
        {
          details: { status: target.status, action: 'REACTIVATE' },
        },
      );
    }
    // Back to where they were: ACTIVE if they ever set a password, INVITED if the invite is
    // still outstanding. status/banned/disabled_at move together or users_banned_mirror and
    // users_disabled_consistent reject the row.
    const account = await tx.query(
      `SELECT 1 FROM accounts
        WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL`,
      [input.userId],
    );
    const status = (account.rowCount ?? 0) > 0 ? 'ACTIVE' : 'INVITED';
    await tx.query(
      `UPDATE users SET status = $2, banned = false, disabled_at = NULL, updated_at = now()
        WHERE id = $1`,
      [input.userId, status],
    );
    // Cancelled bookings are NOT restored and no email goes out (U-05).
    await insertAudit(tx, {
      actorId: input.actorId,
      action: 'user.enable',
      entityType: 'user',
      entityId: input.userId,
      before: { status: 'DISABLED' },
      after: { status },
      ip: input.ip,
      requestId: input.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// POST /admin/users/:id/resend-invite and /reset-password
// ---------------------------------------------------------------------------

export type ReissueInput = UserActionInput & { purpose: TokenPurpose; publicBaseUrl: string };

export async function reissueInvite(pool: Pool, input: ReissueInput): Promise<void> {
  await withTx(pool, async (tx) => {
    const target = requireUser(await lockUsers(tx, [input.userId]), input.userId);
    const allowed = input.purpose === 'INVITE' ? ['INVITED'] : ['INVITED', 'ACTIVE'];
    if (!allowed.includes(target.status)) {
      throw new AppError('INVALID_STATUS_TRANSITION', 'Account is not in a state for this link', {
        details: { status: target.status, action: input.purpose },
      });
    }
    await reissueSetupToken(tx, {
      user: target,
      purpose: input.purpose,
      createdBy: input.actorId,
      publicBaseUrl: input.publicBaseUrl,
    });
    if (input.purpose === 'RESET') {
      // U-06: a reset means the account may be compromised — end every live session.
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [input.userId]);
    }
    await insertAudit(tx, {
      actorId: input.actorId,
      action: input.purpose === 'INVITE' ? 'user.invite_resend' : 'user.reset_password',
      entityType: 'user',
      entityId: input.userId,
      ip: input.ip,
      requestId: input.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id — U-03, hard delete of an account that was never used
// ---------------------------------------------------------------------------

export async function deleteUser(pool: Pool, input: UserActionInput): Promise<void> {
  if (input.userId === input.actorId) {
    throw new AppError('CANNOT_MODIFY_SELF', 'You cannot delete your own account');
  }
  await withTx(pool, async (tx) => {
    const target = requireUser(await lockUsers(tx, [input.userId]), input.userId);
    await assertNotLastAdmin(tx, target);

    const history = await tx.query<{ history: number }>(
      `SELECT (SELECT count(*) FROM bookings WHERE owner_id = $1 OR created_by = $1)
            + (SELECT count(*) FROM audit_logs WHERE actor_id = $1) AS history`,
      [input.userId],
    );
    if (Number(history.rows[0]?.history ?? 0) > 0) {
      throw new AppError('USER_HAS_HISTORY', 'User has history and cannot be deleted', {
        details: { hint: 'deactivate' },
      });
    }

    // Written BEFORE the DELETE, with the admin as actor: an audit row whose actor is the
    // row being deleted would block its own FK. sessions/accounts/password_setup_tokens
    // cascade; anything else still pointing at this user surfaces as 409 (mapPostgresError).
    await insertAudit(tx, {
      actorId: input.actorId,
      action: 'user.delete',
      entityType: 'user',
      entityId: input.userId,
      before: {
        full_name: target.full_name,
        email: target.email,
        role: target.role,
        status: target.status,
      },
      ip: input.ip,
      requestId: input.requestId,
    });
    await tx.query('DELETE FROM users WHERE id = $1', [input.userId]);
  });
}
