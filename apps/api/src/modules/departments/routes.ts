import { Hono } from 'hono';
import { z } from 'zod';

import {
  type AuthDependencies,
  createRequireAdmin,
  createRequireAuth,
} from '../../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { clientIp, parseBody, readJson } from '../../lib/http.js';
import { insertAudit, withTx } from '../../lib/tx.js';

/**
 * Departments are never deleted: users.department_id is ON DELETE RESTRICT and DELETE is not
 * granted to rf_app on this table (0006_grants.sql). Closing one is `active = false`, which
 * takes it out of the pickers and leaves every member, every booking and every report alone.
 * `code` is immutable once created — it is what reports group by.
 */

const listSchema = z.object({ include_inactive: z.enum(['true', 'false']).optional() });

const createSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{2,16}$/),
  name: z.string().min(1).max(100),
});

const patchSchema = z
  .strictObject({
    name: z.string().min(1).max(100).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

type DepartmentRow = { id: string; code: string; name: string; active: boolean };

export function createDepartmentsRouter(dependencies: AuthDependencies) {
  const pool = dependencies.db.$client;
  const router = new Hono();
  const requireAuth = createRequireAuth(dependencies);
  const requireAdmin = createRequireAdmin(dependencies);

  router.get('/departments', requireAuth, async (context) => {
    const parsed = listSchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid departments query', {
        details: parsed.error.issues,
      });
    }
    const includeInactive = parsed.data.include_inactive === 'true';
    if (includeInactive && context.get('actor').role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', 'include_inactive requires the ADMIN role');
    }

    const rows = await pool.query<DepartmentRow>(
      `SELECT id, code, name, active FROM departments
        ${includeInactive ? '' : 'WHERE active'} ORDER BY code`,
    );
    return context.json({ data: rows.rows });
  });

  /**
   * §6.3.2, role `*`. The feature catalogue both room forms pick from and the only way a
   * client can learn which keys PUT /admin/rooms/:id/features will accept. It lives in this
   * router purely because /rooms is mounted under a prefix and this path is not.
   */
  router.get('/features', requireAuth, async (context) => {
    const rows = await pool.query('SELECT key, name, icon FROM features ORDER BY key');
    return context.json({ data: rows.rows });
  });

  router.post('/admin/departments', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const body = parseBody(createSchema, await readJson(context));

    const row = await withTx(pool, async (tx) => {
      const inserted = await tx.query<DepartmentRow>(
        'INSERT INTO departments (code, name) VALUES ($1, $2) RETURNING id, code, name, active',
        [body.code, body.name],
      );
      const created = inserted.rows[0] as DepartmentRow;
      await insertAudit(tx, {
        actorId: actor.id,
        action: 'department.create',
        entityType: 'department',
        entityId: created.id,
        after: { code: created.code, name: created.name, active: created.active },
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
      return created;
    });

    context.header('Location', `/api/v1/admin/departments/${row.id}`);
    return context.json(row, 201);
  });

  router.patch('/admin/departments/:id', requireAdmin, async (context) => {
    const actor = context.get('actor');
    const id = context.req.param('id');
    if (!z.uuid().safeParse(id).success) {
      throw new AppError('NOT_FOUND', 'Department not found');
    }
    const body = parseBody(patchSchema, await readJson(context));

    const row = await withTx(pool, async (tx) => {
      const current = await tx.query<DepartmentRow>(
        'SELECT id, code, name, active FROM departments WHERE id = $1 FOR UPDATE',
        [id],
      );
      const before = current.rows[0];
      if (before === undefined) {
        throw new AppError('NOT_FOUND', 'Department not found');
      }
      const updated = await tx.query<DepartmentRow>(
        `UPDATE departments SET name = coalesce($2::text, name),
                active = coalesce($3::boolean, active), updated_at = now()
          WHERE id = $1 RETURNING id, code, name, active`,
        [id, body.name ?? null, body.active ?? null],
      );
      const after = updated.rows[0] as DepartmentRow;
      await insertAudit(tx, {
        actorId: actor.id,
        action: 'department.update',
        entityType: 'department',
        entityId: id,
        before: { name: before.name, active: before.active },
        after: { name: after.name, active: after.active },
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
      return after;
    });

    return context.json(row);
  });

  return router;
}
