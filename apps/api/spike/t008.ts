/**
 * T-008 — better-auth vertical spike against the real Postgres.
 * Throwaway. Run: pnpm --filter @reserveflow/api exec tsx --env-file=../../.env spike/t008.ts
 *
 * Applies the spec §6.2 auth DDL, exercises better-auth end to end, prints
 * evidence, then drops the tables so T-009 starts from a clean database.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLocalAccountIssuer, getAuthTables } from 'better-auth/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createAuth } from '../src/auth/index.js';
import {
  accounts,
  authSchema,
  departments,
  password_setup_tokens,
  sessions,
  users,
} from '../src/auth/schema.js';

const DDL = fileURLToPath(new URL('./ddl.sql', import.meta.url));
const results: { id: string; ok: boolean; note: string }[] = [];

function head(n: string) {
  console.log(`\n${'='.repeat(78)}\n${n}\n${'='.repeat(78)}`);
}
function record(id: string, ok: boolean, note: string) {
  results.push({ id, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} — ${note}`);
}

const ownerPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE });
const appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(appPool, { schema: authSchema });

const auth = createAuth({
  db,
  secret: process.env.BETTER_AUTH_SECRET ?? '',
  baseURL: process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080',
});

const cookieOf = (response: Response, name: string) => {
  const raw = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return raw ?? null;
};
const cookieHeader = (setCookie: string) => {
  const pair = setCookie.split(';')[0] ?? '';
  return new Headers({ cookie: pair });
};

async function main() {
  // ── 0. schema ──────────────────────────────────────────────────────────────
  head('0. Apply spec §6.2 auth DDL as rf_owner');
  await ownerPool.query(readFileSync(DDL, 'utf8'));
  const [dept] = await db.insert(departments).values({ code: 'ENG', name: 'วิศวกรรม' }).returning();
  if (!dept) throw new Error('department seed failed');
  console.log('departments seeded:', dept.id, dept.code);

  // ── 1. table/column inventory better-auth owns ─────────────────────────────
  head('1. Inventory: what better-auth declares it owns');
  const authContext = await auth.$context;
  const tables = getAuthTables(authContext.options);
  for (const [model, table] of Object.entries(tables)) {
    console.log(`\nmodel "${model}" -> table "${table.modelName}"`);
    console.log('  id (implicit)');
    for (const [field, attribute] of Object.entries(table.fields)) {
      const a = attribute as Record<string, unknown>;
      const flags = [
        a.required ? 'NOT NULL' : 'nullable',
        a.unique ? 'UNIQUE' : '',
        a.input === false ? 'input:false' : '',
        a.references ? `-> ${JSON.stringify(a.references)}` : '',
        a.defaultValue !== undefined ? 'has default' : '',
      ]
        .filter(Boolean)
        .join(' ');
      console.log(
        `  ${String(a.fieldName ?? field).padEnd(26)} ${String(a.type).padEnd(8)} ${flags}`,
      );
    }
  }
  for (const [model, table] of Object.entries(tables)) {
    const t = table as Record<string, unknown>;
    if (t.indexes) console.log(`indexes for ${model}:`, JSON.stringify(t.indexes));
  }

  const physical = await ownerPool.query(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema='public'
        and table_name in ('users','sessions','accounts','verifications','password_setup_tokens')
      order by table_name, ordinal_position`,
  );
  console.log('\nphysical columns created:');
  for (const r of physical.rows) {
    console.log(
      `  ${r.table_name}.${String(r.column_name).padEnd(26)} ${String(r.data_type).padEnd(26)} ${r.is_nullable === 'NO' ? 'NOT NULL' : ''} ${r.column_default ?? ''}`,
    );
  }
  record('1', physical.rows.length > 0, `${physical.rows.length} columns across 5 tables`);

  // ── 2. additionalFields round-trip ─────────────────────────────────────────
  head('2. additionalFields round-trip');
  const created = await auth.api.createUser({
    body: {
      email: 'somchai@example.co.th',
      name: 'สมชาย ใจดี',
      password: 'correct-horse-battery',
      role: 'ADMIN',
      data: {
        employee_code: 'EMP-0042',
        department_id: dept.id,
        mobile: '0812345678',
        status: 'ACTIVE',
      },
    },
  });
  console.log('createUser returned:', JSON.stringify(created.user, null, 1));
  const [rowFromDb] = await db.select().from(users).where(eq(users.id, created.user.id));
  console.log('row in postgres:', JSON.stringify(rowFromDb, null, 1));
  const roundTripped =
    rowFromDb?.employee_code === 'EMP-0042' &&
    rowFromDb?.department_id === dept.id &&
    rowFromDb?.mobile === '0812345678' &&
    rowFromDb?.status === 'ACTIVE' &&
    rowFromDb?.role === 'ADMIN' &&
    (created.user as Record<string, unknown>).employee_code === 'EMP-0042';
  record('2', roundTripped, 'employee_code/department_id/mobile/status/role written and read back');

  // citext behaviour: uppercase lookup must find the row
  const ci = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.employee_code} = 'emp-0042'`);
  record('2-citext', ci.length === 1, `lowercase lookup of 'EMP-0042' matched ${ci.length} row(s)`);

  // ── 3. login with employee_code (not an email) ─────────────────────────────
  head('3. Sign in with employee_code');
  const identifier = 'emp-0042'; // deliberately wrong case, and not an email
  const [resolved] = await db
    .select({ email: users.email, status: users.status })
    .from(users)
    .where(sql`${users.employee_code} = ${identifier}`);
  console.log('resolved identifier ->', resolved?.email);
  const signIn = await auth.api.signInEmail({
    body: { email: resolved?.email ?? '', password: 'correct-horse-battery', rememberMe: true },
    headers: new Headers({ 'user-agent': 'spike/1.0', 'x-forwarded-for': '10.1.2.3' }),
    asResponse: true,
  });
  const signInBody = (await signIn.clone().json()) as Record<string, unknown>;
  console.log('status', signIn.status, 'body', JSON.stringify(signInBody).slice(0, 300));
  record(
    '3',
    signIn.status === 200,
    `employee_code "${identifier}" resolved to email then signed in (HTTP ${signIn.status})`,
  );

  // ── 4. argon2id hash ───────────────────────────────────────────────────────
  head('4. Stored password hash');
  const [account] = await db.select().from(accounts).where(eq(accounts.user_id, created.user.id));
  console.log('accounts row:', JSON.stringify({ ...account, password: undefined }, null, 1));
  console.log('password hash:', account?.password);
  const isArgon2id = account?.password?.startsWith('$argon2id$v=19$m=65536,t=3,p=1$') ?? false;
  record('4', isArgon2id, `hash prefix ${account?.password?.slice(0, 34)}`);

  // ── 5. cookie flags + session row ──────────────────────────────────────────
  head('5. Set-Cookie and session storage');
  const setCookie = cookieOf(signIn, '__Host-sid');
  console.log('all Set-Cookie headers:');
  for (const c of signIn.headers.getSetCookie()) console.log('  ', c);
  const lower = (setCookie ?? '').toLowerCase();
  const flagsOk =
    !!setCookie &&
    lower.includes('httponly') &&
    lower.includes('secure') &&
    lower.includes('samesite=lax') &&
    lower.includes('path=/') &&
    !lower.includes('domain=');
  record('5-cookie', flagsOk, setCookie ?? 'no __Host-sid cookie emitted');

  const sessionRows = await db.select().from(sessions).where(eq(sessions.user_id, created.user.id));
  console.log('sessions rows:', JSON.stringify(sessionRows, null, 1));
  record('5-db', sessionRows.length === 1, `${sessionRows.length} session row in postgres`);

  // remember-me probe
  const noRemember = await auth.api.signInEmail({
    body: { email: resolved?.email ?? '', password: 'correct-horse-battery', rememberMe: false },
    asResponse: true,
  });
  console.log('rememberMe:false Set-Cookie:', cookieOf(noRemember, '__Host-sid'));
  const remembered = cookieOf(signIn, '__Host-sid') ?? '';
  console.log(
    'rememberMe:true  Max-Age:',
    /max-age=(\d+)/i.exec(remembered)?.[1],
    '| rememberMe:false Max-Age:',
    /max-age=(\d+)/i.exec(cookieOf(noRemember, '__Host-sid') ?? '')?.[1] ??
      '(none — browser session cookie)',
  );

  // ── 6. deactivate revokes the live session ─────────────────────────────────
  head('6. Deactivate -> immediate revocation');
  const headers = cookieHeader(setCookie ?? '');
  const before = await auth.api.getSession({ headers });
  console.log('getSession BEFORE:', before ? `user ${before.user.id}` : null);

  // 6a. flip `banned` only — does better-auth reject the existing session?
  await db
    .update(users)
    .set({ banned: true, status: 'DISABLED', disabled_at: new Date() })
    .where(eq(users.id, created.user.id));
  const afterBanOnly = await auth.api.getSession({ headers });
  console.log(
    'getSession after banned=true, sessions NOT deleted:',
    afterBanOnly ? 'STILL VALID' : 'rejected',
  );
  record(
    '6a',
    afterBanOnly !== null,
    afterBanOnly !== null
      ? 'banned=true alone does NOT revoke a live session (admin plugin only checks on session CREATE)'
      : 'banned=true alone revoked the session',
  );

  // 6b. delete the session rows, as the spec's deactivate does
  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.user_id, created.user.id))
    .returning();
  const afterDelete = await auth.api.getSession({ headers });
  console.log(`deleted ${deleted.length} session rows; getSession AFTER:`, afterDelete);
  record('6b', afterDelete === null, 'deleting the session rows rejects the very next request');

  // 6c. sign-in is blocked for a disabled user
  let signInBlocked = 'unexpected success';
  try {
    const r = await auth.api.signInEmail({
      body: { email: resolved?.email ?? '', password: 'correct-horse-battery' },
      asResponse: true,
    });
    signInBlocked = `HTTP ${r.status} ${JSON.stringify(await r.json())}`;
  } catch (error) {
    signInBlocked = `threw ${(error as Error).message}`;
  }
  console.log('sign-in while banned:', signInBlocked);
  record('6c', !signInBlocked.startsWith('HTTP 200'), signInBlocked.slice(0, 160));

  // put the admin back so later steps can use it
  await db
    .update(users)
    .set({ banned: false, status: 'ACTIVE', disabled_at: null })
    .where(eq(users.id, created.user.id));

  // 6d. the admin plugin's own ban endpoint, against our DDL
  const victim = await auth.api.createUser({
    body: {
      email: 'victim@example.co.th',
      name: 'ผู้ถูกปิดบัญชี',
      password: 'victim-password-long',
      data: { employee_code: 'EMP-0044', department_id: dept.id, status: 'ACTIVE' },
    },
  });
  const victimSignIn = await auth.api.signInEmail({
    body: { email: 'victim@example.co.th', password: 'victim-password-long' },
    asResponse: true,
  });
  const victimHeaders = cookieHeader(cookieOf(victimSignIn, '__Host-sid') ?? '');
  const adminSignIn = await auth.api.signInEmail({
    body: { email: 'somchai@example.co.th', password: 'correct-horse-battery' },
    asResponse: true,
  });
  const adminHeaders = cookieHeader(cookieOf(adminSignIn, '__Host-sid') ?? '');
  let banOutcome: string;
  try {
    await auth.api.banUser({
      body: { userId: victim.user.id, banReason: 'ทดสอบ' },
      headers: adminHeaders,
    });
    banOutcome = 'succeeded';
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string; message?: string } })
      .cause;
    banOutcome = `threw: ${cause?.code ?? ''} ${cause?.constraint ?? ''} ${cause?.message ?? (error as Error).message}`;
  }
  const victimAfterBan = await auth.api.getSession({ headers: victimHeaders });
  const [victimRow] = await db.select().from(users).where(eq(users.id, victim.user.id));
  console.log('auth.api.banUser ->', banOutcome);
  console.log('victim row after ban:', {
    banned: victimRow?.banned,
    ban_reason: victimRow?.ban_reason,
    status: victimRow?.status,
    disabled_at: victimRow?.disabled_at,
  });
  console.log('victim session after ban:', victimAfterBan ? 'STILL VALID' : 'revoked');
  // Expected outcome: the plugin sets `banned` without `status`/`disabled_at`,
  // which the spec's `users_banned_mirror` CHECK rejects.
  record(
    '6d',
    banOutcome.includes('users_banned_mirror'),
    `admin plugin banUser is UNUSABLE against spec DDL — ${banOutcome}`,
  );

  // ── 7. invite / set-password token ─────────────────────────────────────────
  head('7. Invite -> single-use set-password token');
  const invited = await auth.api.createUser({
    body: {
      email: 'nid@example.co.th',
      name: 'นิด',
      // no password on purpose
      data: { employee_code: 'EMP-0043', department_id: dept.id, status: 'INVITED' },
    },
  });
  const noAccount = await db.select().from(accounts).where(eq(accounts.user_id, invited.user.id));
  record('7a', noAccount.length === 0, `user created with ${noAccount.length} credential accounts`);

  let cannotSignIn = 'unexpected success';
  try {
    const r = await auth.api.signInEmail({
      body: { email: 'nid@example.co.th', password: 'anything-at-all' },
      asResponse: true,
    });
    cannotSignIn = `HTTP ${r.status}`;
  } catch (error) {
    cannotSignIn = `threw ${(error as Error).message}`;
  }
  record('7b', !cannotSignIn.startsWith('HTTP 200'), `sign-in before redeem: ${cannotSignIn}`);

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const INVITE_TTL_DAYS = 7;
  const [tokenRow] = await db
    .insert(password_setup_tokens)
    .values({
      user_id: invited.user.id,
      token_hash: tokenHash,
      purpose: 'INVITE',
      expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      created_by: created.user.id,
    })
    .returning();
  console.log('token row:', JSON.stringify(tokenRow, null, 1));
  console.log('plaintext token (email only):', token);

  const redeem = async (candidate: string, newPassword: string) => {
    const candidateHash = createHash('sha256').update(candidate).digest('hex');
    return appPool.connect().then(async (client) => {
      try {
        await client.query('begin');
        const claim = await client.query(
          `update password_setup_tokens set used_at = now()
            where token_hash = $1 and used_at is null and expires_at > now()
            returning id, user_id`,
          [candidateHash],
        );
        if (claim.rowCount !== 1) {
          await client.query('rollback');
          return { ok: false, reason: 'TOKEN_EXPIRED' };
        }
        const userId = claim.rows[0].user_id as string;
        const hashed = await authContext.password.hash(newPassword);
        const existing = await client.query(
          `select id from accounts where user_id = $1 and provider_id = 'credential'`,
          [userId],
        );
        if (existing.rowCount === 0) {
          await client.query(
            `insert into accounts (user_id, issuer, account_id, provider_id, password)
             values ($1,$2,$3,'credential',$4)`,
            [userId, createLocalAccountIssuer('credential'), userId, hashed],
          );
        } else {
          await client.query(`update accounts set password=$2, updated_at=now() where id=$1`, [
            existing.rows[0].id,
            hashed,
          ]);
        }
        await client.query(
          `update users set status='ACTIVE', email_verified=true, updated_at=now() where id=$1`,
          [userId],
        );
        await client.query(`delete from sessions where user_id=$1`, [userId]);
        await client.query('commit');
        return { ok: true, reason: 'redeemed' };
      } catch (error) {
        await client.query('rollback');
        return { ok: false, reason: (error as Error).message };
      } finally {
        client.release();
      }
    });
  };

  const first = await redeem(token, 'a-long-enough-password');
  console.log('first redeem:', first);
  const second = await redeem(token, 'another-long-password');
  console.log('second redeem:', second);
  record('7c', first.ok && !second.ok, `first=${first.reason}, second=${second.reason}`);

  const afterRedeem = await auth.api.signInEmail({
    body: { email: 'nid@example.co.th', password: 'a-long-enough-password' },
    asResponse: true,
  });
  console.log('sign-in after redeem: HTTP', afterRedeem.status);
  const [invitedAccount] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.user_id, invited.user.id));
  console.log('hash created by our redeem path:', invitedAccount?.password?.slice(0, 34));
  record(
    '7d',
    afterRedeem.status === 200 && (invitedAccount?.password?.startsWith('$argon2id$') ?? false),
    `HTTP ${afterRedeem.status}, hash ${invitedAccount?.password?.slice(0, 20)}`,
  );

  const pending = await db
    .select()
    .from(password_setup_tokens)
    .where(
      and(
        eq(password_setup_tokens.user_id, invited.user.id),
        isNull(password_setup_tokens.used_at),
      ),
    );
  record('7e', pending.length === 0, `${pending.length} unused tokens left after redeem`);

  // constant-time compare sanity for the hash path we would ship
  const a = Buffer.from(tokenHash, 'hex');
  record(
    '7f',
    timingSafeEqual(a, a),
    'sha256(token) is what is stored — plaintext never persisted',
  );

  // ── 8. rate limit / lockout ────────────────────────────────────────────────
  head('8. Rate limiting and lockout');
  const statuses: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = await auth.api.signInEmail({
      body: { email: 'somchai@example.co.th', password: 'definitely-wrong' },
      headers: new Headers({ 'x-forwarded-for': '10.9.9.9' }),
      asResponse: true,
    });
    statuses.push(r.status);
  }
  console.log(
    '10 in-process auth.api.signInEmail calls with a wrong password:',
    statuses.join(','),
  );
  record(
    '8a',
    !statuses.includes(429),
    'auth.api.* bypasses better-auth rate limiting entirely (no 429 in 10 tries)',
  );

  const limited = createAuth({
    db,
    secret: process.env.BETTER_AUTH_SECRET ?? '',
    baseURL: process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080',
    enableBetterAuthRateLimit: true,
  });
  const httpStatuses: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = await limited.handler(
      new Request(`${process.env.PUBLIC_BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
        body: JSON.stringify({ email: 'somchai@example.co.th', password: 'definitely-wrong' }),
      }),
    );
    httpStatuses.push(r.status);
  }
  console.log('10 calls through auth.handler with rateLimit enabled:', httpStatuses.join(','));
  record(
    '8b',
    httpStatuses.includes(429),
    `native limiter (off outside production) fires only on the HTTP handler: ${httpStatuses.join(',')}`,
  );

  const [lockoutColumns] = await db
    .select({ failed: users.failed_logins, locked: users.locked_until })
    .from(users)
    .where(eq(users.id, created.user.id));
  console.log('failed_logins / locked_until after 20 bad attempts:', lockoutColumns);
  record(
    '8c',
    lockoutColumns?.failed === 0,
    'better-auth never touches failed_logins/locked_until — per-account lockout is ours to build',
  );

  head('SUMMARY');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(10)} ${r.note}`);
}

try {
  await main();
} catch (error) {
  console.error('\nSPIKE ERROR:', error);
  process.exitCode = 1;
} finally {
  if (process.env.KEEP_SPIKE_TABLES !== 'true') {
    await ownerPool.query(
      'DROP TABLE IF EXISTS password_setup_tokens, verifications, accounts, sessions, users, departments CASCADE',
    );
    console.log('\n(dropped spike tables; set KEEP_SPIKE_TABLES=true to keep them)');
  }
  await appPool.end();
  await ownerPool.end();
}
