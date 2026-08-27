import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import {
  type AuthDependencies,
  createRequireAdmin,
  createRequireAuth,
} from '../../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { clientIp, parseBody, readJson } from '../../lib/http.js';
import { createRateLimiter } from '../../lib/rate-limit.js';
import { toBangkokIso } from '../../lib/time.js';
import { type BookingRow, toViewerBooking } from '../bookings/serialize.js';
import { BOOKING_VIEW_SELECT } from '../bookings/service.js';
import { IMPORT_MAX_BYTES, importUsers } from './import.js';
import {
  createUser,
  deactivateUser,
  deleteUser,
  reactivateUser,
  reissueInvite,
  updateUser,
} from './service.js';

const EMPLOYEE_CODE = /^[A-Za-z0-9-]{3,20}$/;
const MOBILE = /^0[0-9]{9}$/;
const ROLES = ['EMPLOYEE', 'ADMIN', 'FACILITY'] as const;

const listSchema = z.object({
  q: z.string().max(200).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']).optional(),
  department_id: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      'full_name',
      '-full_name',
      'created_at',
      '-created_at',
      'last_login_at',
      '-last_login_at',
    ])
    .default('full_name'),
});

const createSchema = z.strictObject({
  employee_code: z.string().regex(EMPLOYEE_CODE),
  full_name: z.string().min(1).max(120),
  email: z.email().max(254),
  mobile: z.string().regex(MOBILE).optional(),
  department_id: z.uuid(),
  /** §6.3.6 spells this `role?: "EMPLOYEE"` — accounts are born as employees and are promoted
   * with PATCH, never at create. */
  role: z.literal('EMPLOYEE').optional(),
});

const patchSchema = z
  .strictObject({
    full_name: z.string().min(1).max(120).optional(),
    email: z.email().max(254).optional(),
    mobile: z.string().regex(MOBILE).nullable().optional(),
    department_id: z.uuid().optional(),
    role: z.enum(ROLES).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

const deactivateSchema = z.strictObject({ reason: z.string().max(500).optional() });

/** §6.3.6: the CSV is capped at 2 MB, well above the 64 KB JSON cap app.ts skips for it. */
const importBodyLimit = bodyLimit({
  maxSize: IMPORT_MAX_BYTES,
  onError: () => {
    throw new AppError('VALIDATION_FAILED', 'CSV must be 2 MB or smaller', { status: 413 });
  },
});

/** §6.3.11: a search of at least 2 characters, or the first page of the directory. */
const directorySchema = z.object({
  q: z.string().trim().min(2).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const sortColumn: Record<string, string> = {
  full_name: 'u.full_name ASC',
  '-full_name': 'u.full_name DESC',
  created_at: 'u.created_at ASC',
  '-created_at': 'u.created_at DESC',
  last_login_at: 'u.last_login_at ASC NULLS LAST',
  '-last_login_at': 'u.last_login_at DESC NULLS LAST',
};

/** §6.3.6 User. `bookings_count` is what tells an admin whether DELETE will be refused. */
const USER_SELECT = `
  SELECT u.id, u.employee_code, u.full_name, u.email, u.mobile, u.role, u.status,
         u.last_login_at, u.disabled_at, u.created_at,
         d.id AS department_id, d.code AS department_code, d.name AS department_name,
         (SELECT count(*)::int FROM bookings b WHERE b.owner_id = u.id) AS bookings_count
    FROM users u JOIN departments d ON d.id = u.department_id`;

type UserRow = {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  mobile: string | null;
  role: string;
  status: string;
  last_login_at: Date | null;
  disabled_at: Date | null;
  created_at: Date;
  department_id: string;
  department_code: string;
  department_name: string;
  bookings_count: number;
};

function serializeUser(row: UserRow) {
  return {
    id: row.id,
    employee_code: row.employee_code,
    full_name: row.full_name,
    email: row.email,
    mobile: row.mobile,
    role: row.role,
    status: row.status,
    department: { id: row.department_id, code: row.department_code, name: row.department_name },
    last_login_at: toBangkokIso(row.last_login_at),
    disabled_at: toBangkokIso(row.disabled_at),
    created_at: toBangkokIso(row.created_at),
    bookings_count: row.bookings_count,
  };
}

export function createUsersRouter(
  dependencies: AuthDependencies & {
    publicBaseUrl: string;
    /** ACCOUNT_EMAIL_DOMAINS; empty means any domain is accepted. */
    accountEmailDomains?: readonly string[] | undefined;
    kickOutbox?: (() => void) | undefined;
  },
) {
  const pool = dependencies.db.$client;
  const router = new Hono();
  const requireAdmin = createRequireAdmin(dependencies);
  const requireAuth = createRequireAuth(dependencies);
  const kickOutbox = () => dependencies.kickOutbox?.();
  const emailDomains = dependencies.accountEmailDomains ?? [];
  // C1-43: a target can be mailed 3×/hour, one admin can send 30×/hour in total.
  const perTargetLimit = createRateLimiter(3, 3_600_000);
  const perAdminLimit = createRateLimiter(30, 3_600_000);

  /** Trust boundary: an admin typo must not create an account outside the company. */
  function assertEmailDomain(email: string): void {
    if (emailDomains.length === 0) {
      return;
    }
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
    if (!emailDomains.includes(domain)) {
      // §6.3.6 spells this rejection out: 422 with `details.issues[0].path === ['email']`,
      // so the admin form can point at the field. It is NOT the plain 400 a malformed body
      // gets — the address parses, the company just does not accept that domain.
      throw new AppError('VALIDATION_FAILED', 'Email domain is not allowed', {
        status: 422,
        details: {
          issues: [{ code: 'custom', path: ['email'], message: 'Email domain is not allowed' }],
          allowed_domains: emailDomains,
        },
      });
    }
  }

  /**
   * Lower-cased because Postgres stores uuids canonically: the mutation handlers look their
   * target up in a Map keyed by the value the database returned, and compare it to the
   * actor's id, so an upper-case path parameter would 404 on PATCH while GET answered 200 —
   * and would slip past the `userId === actorId` self-modification guards.
   */
  function userId(context: { req: { param: (name: string) => string | undefined } }): string {
    const id = context.req.param('id');
    if (id === undefined || !z.uuid().safeParse(id).success) {
      throw new AppError('NOT_FOUND', 'User not found');
    }
    return id.toLowerCase();
  }

  async function loadUser(id: string) {
    const result = await pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'User not found');
    }
    return serializeUser(row);
  }

  router.get('/admin/users', requireAdmin, async (context) => {
    const parsed = listSchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid users query', {
        details: parsed.error.issues,
      });
    }
    const query = parsed.data;

    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions: string[] = [];
    if (query.q !== undefined && query.q.trim() !== '') {
      const like = bind(`%${query.q.trim()}%`);
      conditions.push(
        `(u.employee_code::text ILIKE ${like} OR u.full_name ILIKE ${like} OR u.email::text ILIKE ${like})`,
      );
    }
    if (query.role !== undefined) {
      conditions.push(`u.role = ${bind(query.role)}`);
    }
    if (query.status !== undefined) {
      conditions.push(`u.status = ${bind(query.status)}`);
    }
    if (query.department_id !== undefined) {
      conditions.push(`u.department_id = ${bind(query.department_id)}::uuid`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // ponytail: two plain queries instead of the count(*) OVER() + probe dance the bookings
    // list needs — this table is small and never hot.
    const total = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users u ${where}`,
      params,
    );
    const rows = await pool.query<UserRow>(
      `${USER_SELECT} ${where}
        ORDER BY ${sortColumn[query.sort] as string}, u.id
        LIMIT ${bind(query.page_size)} OFFSET ${bind((query.page - 1) * query.page_size)}`,
      params,
    );

    return context.json({
      data: rows.rows.map(serializeUser),
      page: {
        page: query.page,
        page_size: query.page_size,
        total: total.rows[0]?.count ?? 0,
      },
    });
  });

  router.post('/admin/users', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const body = parseBody(createSchema, await readJson(context));
    assertEmailDomain(body.email);

    const id = await createUser(pool, {
      actorId: actor.id,
      employeeCode: body.employee_code,
      fullName: body.full_name,
      email: body.email,
      mobile: body.mobile ?? null,
      departmentId: body.department_id,
      publicBaseUrl: dependencies.publicBaseUrl,
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });
    kickOutbox(); // the create tx committed with its account.set_password row

    context.header('Location', `/api/v1/admin/users/${id}`);
    return context.json(await loadUser(id), 201);
  });

  /**
   * §6.3.6 / U-07. Declared BEFORE /admin/users/:id so `import` is never read as a uuid, and
   * two-step by design: the UI POSTs `?dry_run=true` for the preview table, the admin
   * approves it, and the same file is POSTed again for real.
   */
  router.post('/admin/users/import', requireAdmin, importBodyLimit, async (context) => {
    const actor = context.get('actor');
    const dryRun = context.req.query('dry_run') === 'true';

    const file = (await context.req.parseBody()).file;
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', 'multipart/form-data field `file` is required');
    }
    // The browser sends text/csv; Excel on Windows sends application/vnd.ms-excel for the
    // same bytes. Anything binary is refused here rather than parsed into 1000 ERROR rows.
    const type = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
    if (type !== '' && !['text/csv', 'text/plain', 'application/vnd.ms-excel'].includes(type)) {
      throw new AppError('VALIDATION_FAILED', 'Import file must be CSV', { status: 415 });
    }
    // Belt for a multipart envelope whose parts add up differently to Content-Length.
    if (file.size > IMPORT_MAX_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'CSV must be 2 MB or smaller', { status: 413 });
    }

    const result = await importUsers(pool, {
      actorId: actor.id,
      dryRun,
      csv: await file.text(),
      publicBaseUrl: dependencies.publicBaseUrl,
      emailDomains: emailDomains,
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });
    if (!dryRun && result.summary.create > 0) {
      kickOutbox(); // the import tx committed with its account.set_password rows
    }
    return context.json(result);
  });

  router.get('/admin/users/:id', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const id = userId(context);
    const user = await loadUser(id);
    const bookings = await pool.query<BookingRow>(
      `${BOOKING_VIEW_SELECT} WHERE b.owner_id = $2 ORDER BY b.start_at DESC LIMIT 5`,
      [actor.email, id],
    );
    return context.json({
      ...user,
      recent_bookings: bookings.rows.map((row) =>
        toViewerBooking(row, { id: actor.id, role: 'ADMIN' }),
      ),
    });
  });

  router.patch('/admin/users/:id', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const id = userId(context);
    const body = parseBody(patchSchema, await readJson(context));
    if (body.email !== undefined) {
      assertEmailDomain(body.email);
    }

    await updateUser(pool, {
      actorId: actor.id,
      userId: id,
      patch: {
        ...(body.full_name === undefined ? {} : { fullName: body.full_name }),
        ...(body.email === undefined ? {} : { email: body.email }),
        ...(body.mobile === undefined ? {} : { mobile: body.mobile }),
        ...(body.department_id === undefined ? {} : { departmentId: body.department_id }),
        ...(body.role === undefined ? {} : { role: body.role }),
      },
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });
    return context.json(await loadUser(id));
  });

  router.post('/admin/users/:id/deactivate', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const id = userId(context);
    const body = parseBody(deactivateSchema, await readJson(context));

    const result = await deactivateUser(pool, {
      actorId: actor.id,
      userId: id,
      reason: body.reason ?? null,
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });
    if (result.cancelled.length > 0) {
      kickOutbox(); // the cascade committed with its booking.cancelled rows
    }

    return context.json({
      user: await loadUser(id),
      cancelled_bookings: result.cancelled.map((booking) => ({
        id: booking.id,
        start_at: toBangkokIso(booking.start_at),
        end_at: toBangkokIso(booking.end_at),
        room: booking.room,
        status_before: booking.status_before,
      })),
    });
  });

  router.post('/admin/users/:id/reactivate', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const id = userId(context);
    await reactivateUser(pool, {
      actorId: actor.id,
      userId: id,
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });
    return context.json(await loadUser(id));
  });

  for (const [path, purpose] of [
    ['/admin/users/:id/resend-invite', 'INVITE'],
    ['/admin/users/:id/reset-password', 'RESET'],
  ] as const) {
    router.post(path, requireAdmin, async (context) => {
      const actor = context.get('actor');
      const id = userId(context);
      // Keyed on the target alone: C-13 budgets 3 account mails per hour per USER, across
      // both endpoints. Namespacing by purpose would hand the same inbox six.
      perTargetLimit(id);
      perAdminLimit(actor.id);

      await reissueInvite(pool, {
        actorId: actor.id,
        userId: id,
        purpose,
        publicBaseUrl: dependencies.publicBaseUrl,
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
      kickOutbox(); // the reissue tx committed with its account.set_password row
      return context.json({ queued: 1 }, 202);
    });
  }

  /**
   * §6.3.11, role `*`. The attendee picker (E4) is the only consumer and it needs an address,
   * so this returns strictly {id, full_name, email, department} for ACTIVE accounts — no
   * mobile, no role, no status, no last_login_at. Everything richer is behind /admin/users.
   */
  router.get('/directory/users', requireAuth, async (context) => {
    const parsed = directorySchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid directory query', {
        details: parsed.error.issues,
      });
    }
    const query = parsed.data;

    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    let where = "WHERE u.status = 'ACTIVE'";
    if (query.q !== undefined) {
      const like = bind(`%${query.q.trim()}%`);
      where += ` AND (u.full_name ILIKE ${like} OR u.email::text ILIKE ${like}
                      OR u.employee_code::text ILIKE ${like})`;
    }

    const total = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users u ${where}`,
      params,
    );
    const rows = await pool.query<{
      id: string;
      full_name: string;
      email: string;
      department_code: string;
      department_name: string;
    }>(
      `SELECT u.id, u.full_name, u.email,
              d.code AS department_code, d.name AS department_name
         FROM users u JOIN departments d ON d.id = u.department_id
         ${where}
        ORDER BY u.full_name, u.id
        LIMIT ${bind(query.page_size)} OFFSET ${bind((query.page - 1) * query.page_size)}`,
      params,
    );

    return context.json({
      data: rows.rows.map((row) => ({
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        department: { code: row.department_code, name: row.department_name },
      })),
      page: { page: query.page, page_size: query.page_size, total: total.rows[0]?.count ?? 0 },
    });
  });

  router.delete('/admin/users/:id', requireAdmin, async (context) => {
    const actor = context.get('actor');
    await deleteUser(pool, {
      actorId: actor.id,
      userId: userId(context),
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });
    return context.body(null, 204);
  });

  return router;
}
