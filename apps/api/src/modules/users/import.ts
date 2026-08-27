import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { AppError } from '../../lib/errors.js';
import { type RequestMeta, withTx } from '../../lib/tx.js';
import { issueSetupToken, LAST_ADMIN_LOCK } from './service.js';

/**
 * POST /admin/users/import (FR-013 · U-07 · §6.3.6). An upsert keyed on `employee_code`, run
 * twice by the UI: `?dry_run=true` for the preview table, then for real.
 *
 * The file fails whole only on a bad header or a body that is too big — one bad row is that
 * row's `ERROR`, never the file's (U-07). The real run is ONE transaction holding
 * 'users:last-admin', so it is the fourth operation the LAST_ADMIN barrier covers: after
 * every row is applied at least one ACTIVE ADMIN must remain, or the whole file rolls back.
 */

export const IMPORT_HEADER = [
  'employee_code',
  'full_name',
  'email',
  'mobile',
  'department_code',
  'role',
] as const;

/** §6.3.6: ≤ 2 MB and ≤ 1000 rows. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;

const EMPLOYEE_CODE = /^[A-Za-z0-9-]{3,20}$/;
const MOBILE = /^0[0-9]{9}$/;
const ROLES = ['EMPLOYEE', 'ADMIN', 'FACILITY'] as const;

const rowSchema = z.object({
  employee_code: z.string().regex(EMPLOYEE_CODE, 'employee_code must match ^[A-Za-z0-9-]{3,20}$'),
  full_name: z.string().min(1).max(120),
  email: z.email().max(254),
  /** Blank means "leave it alone", not "clear it" — same for `role` below. */
  mobile: z.union([z.literal(''), z.string().regex(MOBILE, 'mobile must match ^0[0-9]{9}$')]),
  department_code: z.string().min(1).max(16),
  role: z.union([z.literal(''), z.enum(ROLES)]),
});

export type ImportAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';

export type ImportRowResult = {
  line: number;
  employee_code: string;
  action: ImportAction;
  message?: string;
};

export type ImportResult = {
  summary: { rows: number; create: number; update: number; skip: number; error: number };
  rows: ImportRowResult[];
};

/**
 * RFC 4180 enough for an HR export: quoted fields, doubled quotes inside them, CRLF or LF.
 * ponytail: no streaming and no dialect sniffing — the file is capped at 2 MB and the header
 * is fixed, so a 40-line reader beats a dependency.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
      started = true;
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      started = false;
    } else if (char !== '\r') {
      field += char;
      started = true;
    }
  }
  if (started || field !== '') {
    record.push(field);
    records.push(record);
  }
  return records;
}

type DepartmentRow = { id: string; code: string };
type ExistingRow = {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  mobile: string | null;
  role: string;
  status: string;
  department_id: string;
};

/** A row that survived validation and is going to be written. */
type Planned =
  | { kind: 'CREATE'; index: number; values: CreateValues }
  | { kind: 'UPDATE'; index: number; values: UpdateValues; before: ExistingRow };

type CreateValues = {
  employee_code: string;
  full_name: string;
  email: string;
  mobile: string | null;
  department_id: string;
  role: string;
};

type UpdateValues = CreateValues & { id: string };

type Queryable = Pick<PoolClient, 'query'>;

export type ImportInput = {
  actorId: string;
  dryRun: boolean;
  csv: string;
  publicBaseUrl: string;
  /** ACCOUNT_EMAIL_DOMAINS; empty accepts any domain. Same list POST /admin/users uses. */
  emailDomains: readonly string[];
} & RequestMeta;

export async function importUsers(pool: Pool, input: ImportInput): Promise<ImportResult> {
  // A NUL reaches Postgres as 22021 on the citext[] batch lookup below — unmapped, so one
  // bad byte would 500 the whole file (even a dry run) instead of failing its own row.
  if (input.csv.includes('\u0000')) {
    throw new AppError('VALIDATION_FAILED', 'CSV must be UTF-8 text', {
      details: { reason: 'nul_byte' },
    });
  }
  const records = parseCsv(input.csv.replace(/^﻿/, ''));
  const header = records[0];
  if (header === undefined || !sameHeader(header)) {
    // Whole-file failure (U-07): there is nothing to preview if the columns are unknown.
    throw new AppError('VALIDATION_FAILED', 'CSV header must be exactly the documented columns', {
      details: { expected: IMPORT_HEADER, received: header ?? [] },
    });
  }
  const dataRows = records.slice(1).filter((record) => record.some((value) => value.trim() !== ''));
  if (dataRows.length > IMPORT_MAX_ROWS) {
    throw new AppError('VALIDATION_FAILED', `CSV must hold at most ${IMPORT_MAX_ROWS} rows`, {
      details: { rows: dataRows.length, max_rows: IMPORT_MAX_ROWS },
    });
  }

  if (input.dryRun) {
    // No lock and no transaction: nothing is written, so a snapshot of the current state is
    // exactly as good as the preview can be. The real run classifies again under the lock.
    return summarise((await classify(pool, dataRows, input)).results);
  }

  return withTx(pool, async (tx) => {
    // (1) the ONE global barrier, before any user row is read — U-01's fourth operation.
    await tx.query(LAST_ADMIN_LOCK);
    const { results, planned } = await classify(tx, dataRows, input);
    await apply(tx, planned, input);
    return summarise(results);
  });
}

function sameHeader(header: readonly string[]): boolean {
  return (
    header.length === IMPORT_HEADER.length &&
    IMPORT_HEADER.every((name, index) => header[index]?.trim().toLowerCase() === name)
  );
}

function summarise(results: ImportRowResult[]): ImportResult {
  const count = (action: ImportAction) => results.filter((row) => row.action === action).length;
  return {
    summary: {
      rows: results.length,
      create: count('CREATE'),
      update: count('UPDATE'),
      skip: count('SKIP'),
      error: count('ERROR'),
    },
    rows: results,
  };
}

/**
 * Every row is decided here — the dry run and the real run share this function, so the
 * preview an admin approved is the plan that runs. `line` counts records, header included,
 * which is the spreadsheet row number for any file without embedded newlines.
 */
async function classify(
  client: Queryable,
  dataRows: readonly string[][],
  input: ImportInput,
): Promise<{ results: ImportRowResult[]; planned: Planned[] }> {
  const departments = await client.query<DepartmentRow>('SELECT id, code FROM departments');
  const departmentByCode = new Map(departments.rows.map((row) => [row.code, row.id]));

  const codes = dataRows.map((record) => (record[0] ?? '').trim());
  const existing = await client.query<ExistingRow>(
    `SELECT id, employee_code::text AS employee_code, full_name, email::text AS email, mobile,
            role, status, department_id
       FROM users WHERE employee_code = ANY($1::citext[])`,
    [codes],
  );
  const existingByCode = new Map(
    existing.rows.map((row) => [row.employee_code.toLowerCase(), row]),
  );
  // An email belonging to somebody NOT in this file collides just as hard (users_email_unique),
  // and a 23505 would roll the whole import back instead of marking one row. One query
  // answers for the batch.
  const emails = dataRows.map((record) => (record[2] ?? '').trim().toLowerCase());
  const emailOwners = await client.query<{ id: string; email: string }>(
    'SELECT id, email::text AS email FROM users WHERE email = ANY($1::citext[])',
    [emails],
  );
  const ownerIdByEmail = new Map(emailOwners.rows.map((row) => [row.email.toLowerCase(), row.id]));

  const results: ImportRowResult[] = [];
  const planned: Planned[] = [];
  const seenCodes = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  for (const [index, record] of dataRows.entries()) {
    const line = index + 2;
    const rawCode = (record[0] ?? '').trim();
    const fail = (message: string): void => {
      results.push({ line, employee_code: rawCode, action: 'ERROR', message });
    };

    if (record.length !== IMPORT_HEADER.length) {
      fail(`expected ${IMPORT_HEADER.length} columns, found ${record.length}`);
      continue;
    }
    const parsed = rowSchema.safeParse({
      employee_code: rawCode,
      full_name: (record[1] ?? '').trim(),
      email: (record[2] ?? '').trim(),
      mobile: (record[3] ?? '').trim(),
      department_code: (record[4] ?? '').trim().toUpperCase(),
      role: (record[5] ?? '').trim().toUpperCase(),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail(`${issue?.path.join('.') ?? 'row'}: ${issue?.message ?? 'is invalid'}`);
      continue;
    }
    const value = parsed.data;
    const codeKey = value.employee_code.toLowerCase();
    const emailKey = value.email.toLowerCase();

    const duplicateCode = seenCodes.get(codeKey);
    if (duplicateCode !== undefined) {
      fail(`employee_code already appears on line ${duplicateCode}`);
      continue;
    }
    const duplicateEmail = seenEmails.get(emailKey);
    if (duplicateEmail !== undefined) {
      fail(`email already appears on line ${duplicateEmail}`);
      continue;
    }

    const domain = value.email.slice(value.email.lastIndexOf('@') + 1).toLowerCase();
    if (input.emailDomains.length > 0 && !input.emailDomains.includes(domain)) {
      fail(`email domain is not allowed (${input.emailDomains.join(', ')})`);
      continue;
    }
    const departmentId = departmentByCode.get(value.department_code);
    if (departmentId === undefined) {
      fail(`unknown department_code ${value.department_code}`);
      continue;
    }

    const current = existingByCode.get(codeKey);
    const emailOwnerId = ownerIdByEmail.get(emailKey);
    if (emailOwnerId !== undefined && emailOwnerId !== current?.id) {
      fail('email already belongs to another account');
      continue;
    }
    // U-02, the same rule PATCH enforces: an admin never edits their own role, not even
    // through a file.
    if (current?.id === input.actorId && value.role !== '' && value.role !== current.role) {
      fail('you cannot change your own role');
      continue;
    }

    seenCodes.set(codeKey, line);
    seenEmails.set(emailKey, line);

    if (current === undefined) {
      planned.push({
        kind: 'CREATE',
        index: results.length,
        values: {
          employee_code: value.employee_code,
          full_name: value.full_name,
          email: value.email,
          mobile: value.mobile === '' ? null : value.mobile,
          department_id: departmentId,
          role: value.role === '' ? 'EMPLOYEE' : value.role,
        },
      });
      results.push({ line, employee_code: value.employee_code, action: 'CREATE' });
      continue;
    }

    // U-07: profile fields only. `status` and the password are never touched, and a blank
    // column means "leave it" — so re-running the same file is a no-op (all SKIP).
    const next: UpdateValues = {
      id: current.id,
      employee_code: current.employee_code,
      full_name: value.full_name,
      email: value.email,
      mobile: value.mobile === '' ? current.mobile : value.mobile,
      department_id: departmentId,
      role: value.role === '' ? current.role : value.role,
    };
    const unchanged =
      next.full_name === current.full_name &&
      next.email.toLowerCase() === current.email.toLowerCase() &&
      next.mobile === current.mobile &&
      next.department_id === current.department_id &&
      next.role === current.role;
    if (unchanged) {
      results.push({ line, employee_code: current.employee_code, action: 'SKIP' });
      continue;
    }
    planned.push({ kind: 'UPDATE', index: results.length, values: next, before: current });
    results.push({ line, employee_code: current.employee_code, action: 'UPDATE' });
  }

  return { results, planned };
}

async function apply(tx: PoolClient, planned: readonly Planned[], input: ImportInput) {
  const trail: { action: string; id: string; before: unknown; after: unknown }[] = [];

  // ponytail: creates stay a loop — each one needs its row id back before its invite token,
  // and the token is 32 random bytes per user, so there is nothing to batch but the audit.
  // Ceiling: ~2 round-trips × 1000 rows while the global lock is held. Collapse into an
  // INSERT … SELECT with the tokens pre-generated in JS if a seed ever feels it.
  for (const item of planned) {
    if (item.kind !== 'CREATE') {
      continue;
    }
    const values = item.values;
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO users (employee_code, full_name, email, mobile, department_id, role, status,
                          created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'INVITED', $7) RETURNING id`,
      [
        values.employee_code,
        values.full_name,
        values.email,
        values.mobile,
        values.department_id,
        values.role,
        input.actorId,
      ],
    );
    const id = (inserted.rows[0] as { id: string }).id;
    await issueSetupToken(tx, {
      user: { id, email: values.email, full_name: values.full_name },
      purpose: 'INVITE',
      createdBy: input.actorId,
      publicBaseUrl: input.publicBaseUrl,
    });
    trail.push({
      action: 'user.create',
      id,
      before: null,
      // S-12: `mobile` is deliberately absent from every audit payload in this module.
      after: {
        employee_code: values.employee_code,
        full_name: values.full_name,
        email: values.email,
        department_id: values.department_id,
        role: values.role,
        status: 'INVITED',
      },
    });
  }

  const updates = planned.filter((item) => item.kind === 'UPDATE');
  if (updates.length > 0) {
    // CF-01 step (2): the rows this file touches, FOR UPDATE ordered by id. The batched
    // UPDATE below would otherwise take its row locks in CSV order, and createBooking takes
    // FOR SHARE on two users in id order WITHOUT the global lock (lockUsersActive) — file
    // order against id order is a deadlock cycle. Sorting the jsonb array is not enough: the
    // planner is free to pick an order.
    await tx.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
      updates.map((item) => item.values.id).sort(),
    ]);
    await tx.query(
      `UPDATE users u
          SET full_name = x->>'full_name', email = x->>'email', mobile = x->>'mobile',
              department_id = (x->>'department_id')::uuid, role = x->>'role', updated_at = now()
         FROM jsonb_array_elements($1::jsonb) AS x
        WHERE u.id = (x->>'id')::uuid`,
      [JSON.stringify(updates.map((item) => item.values))],
    );
    for (const item of updates) {
      trail.push({
        // U-08: same two actions the single-user PATCH writes, so a user's history reads the
        // same whether the change arrived one at a time or in a file.
        action: item.values.role === item.before.role ? 'user.update' : 'user.role_change',
        id: item.values.id,
        before: {
          full_name: item.before.full_name,
          email: item.before.email,
          department_id: item.before.department_id,
          role: item.before.role,
        },
        after: {
          full_name: item.values.full_name,
          email: item.values.email,
          department_id: item.values.department_id,
          role: item.values.role,
        },
      });
    }
  }

  if (trail.length === 0) {
    return;
  }

  // U-01, checked once after the whole file is applied: a file may demote several admins, and
  // only the count that survives all of them is the invariant. Still inside the tx that holds
  // 'users:last-admin', so a PATCH/deactivate/DELETE racing this one sees our result or we
  // see theirs — never both halves of a plan that ends at zero admins.
  const admins = await tx.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'",
  );
  if ((admins.rows[0]?.count ?? 0) < 1) {
    throw new AppError('LAST_ADMIN', 'The last active admin cannot be demoted or removed');
  }

  // One statement for the whole trail. Every row carries this request's id (C-09), which is
  // what ties an import's user.create/user.update rows back together on the audit screen.
  await tx.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, ip,
                             request_id)
     SELECT $1::uuid, x->>'action', 'user', x->>'id', x->'before', x->'after', $2::inet, $3
       FROM jsonb_array_elements($4::jsonb) AS x`,
    [input.actorId, input.ip, input.requestId, JSON.stringify(trail)],
  );
}
