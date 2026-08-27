import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';

import { type Db, schema } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import type { Auth } from './index.js';

export type Actor = typeof schema.users.$inferSelect;

declare module 'hono' {
  interface ContextVariableMap {
    actor: Actor;
    sessionExpiresAt: Date;
  }
}

export type AuthDependencies = {
  auth: Auth;
  db: Db;
};

/**
 * Resolves the session once per request (later middleware reuses the cached actor) and
 * re-checks `users.status` on the live row (spike §6 / S-01): deactivation deletes the
 * session rows, but a session that somehow survives is still refused here.
 */
export function createRequireAuth({ auth, db }: AuthDependencies) {
  return createMiddleware(async (context, next) => {
    if (context.get('actor') === undefined) {
      const session = await auth.api.getSession({ headers: context.req.raw.headers });
      if (session === null) {
        throw new AppError('UNAUTHENTICATED', 'Sign in required');
      }

      const [actor] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, session.user.id))
        .limit(1);
      if (actor === undefined || actor.status !== 'ACTIVE') {
        throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
      }

      context.set('actor', actor);
      context.set('sessionExpiresAt', new Date(session.session.expiresAt));
    }

    await next();
  });
}

/** Hidden resources (C-15): non-ADMIN callers get 404, never 403, on admin paths. */
export function createRequireAdmin(dependencies: AuthDependencies) {
  const requireAuth = createRequireAuth(dependencies);

  return createMiddleware(async (context, next) =>
    requireAuth(context, async () => {
      if (context.get('actor').role !== 'ADMIN') {
        throw new AppError('NOT_FOUND', 'Not found');
      }

      await next();
    }),
  );
}
