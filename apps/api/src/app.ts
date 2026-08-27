import { randomUUID } from 'node:crypto';

import { serveStatic } from '@hono/node-server/serve-static';
import { swaggerUI } from '@hono/swagger-ui';
import type { ErrorEnvelope } from '@reserveflow/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { Logger } from 'pino';

import type { Auth } from './auth/index.js';
import { createAuthRouter } from './auth/routes.js';
import { type Db, schema } from './db/index.js';
import { openApiDocument } from './docs.js';
import type { JobsHealth } from './jobs/index.js';
import { AppError, isDatabaseError, mapPostgresError } from './lib/errors.js';
import { clientIp } from './lib/http.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { createAuditRouter } from './modules/audit/routes.js';
import { createAvailabilityRouter } from './modules/availability/routes.js';
import { createBookingsRouter } from './modules/bookings/routes.js';
import { createCheckinRouter } from './modules/checkin/routes.js';
import { createDepartmentsRouter } from './modules/departments/routes.js';
import { createAdminNotificationsRouter } from './modules/notifications/routes.js';
import { createReportsRouter } from './modules/reports/routes.js';
import { createAdminRoomsRouter } from './modules/rooms/admin.js';
import { createRoomsRouter } from './modules/rooms/routes.js';
import { createAdminSettingsRouter } from './modules/settings/admin.js';
import { createSettingsRouter } from './modules/settings/routes.js';
import { createUsersRouter } from './modules/users/routes.js';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    logger: Logger;
    trustProxy: boolean;
  }
}

export type AppDependencies = {
  publicBaseUrl: string;
  additionalAllowedOrigins?: readonly string[];
  /** TRUST_PROXY: whether X-Forwarded-For may inform the advisory client IP. */
  trustProxy?: boolean;
  logger: Logger;
  db: Db;
  auth: Auth;
  checkDatabase: () => Promise<void>;
  /** Explicitly enabled local-only tools for preparing bookings for a check-in demo. */
  demoToolsEnabled?: boolean;
  /** Scheduler health for /readyz. Absent when this instance runs no worker (WORKER_ENABLED
   * false) — then there is no sweep here to go stale. */
  jobsHealth?: () => JobsHealth;
  /** Post-commit outbox kick (§5.7): booking mutations call it right after their transaction
   * commits so email leaves promptly instead of waiting for the 10s loop. Best-effort. */
  kickOutbox?: () => void;
  /** ACCOUNT_EMAIL_DOMAINS: domains an account's email may use. Empty accepts any domain. */
  accountEmailDomains?: readonly string[];
  /**
   * Directories holding the built SPA dists, relative to the process working directory.
   * Present only in the deploy image; when set, the API serves both SPAs itself so a bare
   * Fly URL is a complete deployment (staging) or a fallback origin (prod).
   */
  staticRoots?: { web: string; admin: string };
};

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowedBetterAuthPaths = new Set([
  '/api/auth/sign-out',
  '/api/auth/get-session',
  '/api/auth/change-password',
]);
const validRequestId = /^[A-Za-z0-9._:-]{1,128}$/;
/** The only paths allowed past the 64 KB body cap — see the limiter split in createApp. */
const largeUploadPaths = [
  /^\/api\/v1\/admin\/rooms\/[^/]+\/photo$/,
  /^\/api\/v1\/admin\/users\/import$/,
];

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

const requestIdMiddleware = createMiddleware(async (context, next) => {
  const suppliedRequestId = context.req.header('x-request-id');
  const requestId =
    suppliedRequestId !== undefined && validRequestId.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

  context.set('requestId', requestId);
  await next();
  context.header('x-request-id', requestId);
});

function hasExpectedOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (origin === undefined) {
    return false;
  }

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.origin === origin && allowedOrigins.has(parsedOrigin.origin);
  } catch {
    return false;
  }
}

export function createApp(dependencies: AppDependencies) {
  const app = new Hono();
  const allowedOrigins = new Set([
    new URL(dependencies.publicBaseUrl).origin,
    ...(dependencies.additionalAllowedOrigins ?? []).map((origin) => new URL(origin).origin),
  ]);

  app.use('*', requestIdMiddleware);
  app.use('*', async (context, next) => {
    context.set('trustProxy', dependencies.trustProxy ?? false);
    await next();
  });

  app.use(
    '*',
    createMiddleware(async (context, next) => {
      const startedAt = performance.now();
      const requestLogger = dependencies.logger.child({
        request_id: context.get('requestId'),
        method: context.req.method,
        path: context.req.path,
      });

      context.set('logger', requestLogger);
      await next();
      requestLogger.info(
        {
          status_code: context.res.status,
          duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
        },
        'request completed',
      );
    }),
  );

  app.use('*', secureHeaders());

  // The image serves the SPAs too, so a non-canonical host (e.g. the bare Fly URL in prod)
  // would otherwise become a second, half-broken origin: reads work, writes fail the Origin
  // check, and the __Host- cookie never travels there. Redirect everything but /api to the
  // canonical origin instead.
  const canonicalUrl = new URL(dependencies.publicBaseUrl);
  app.use(
    '*',
    createMiddleware(async (context, next) => {
      const host = context.req.header('host');
      if (host !== undefined && host !== canonicalUrl.host && !isApiPath(context.req.path)) {
        const requestUrl = new URL(context.req.url);
        return context.redirect(
          `${canonicalUrl.origin}${requestUrl.pathname}${requestUrl.search}`,
          308,
        );
      }

      await next();
    }),
  );

  // API responses must never be cached by Fly's edge or an intermediate proxy; a cached
  // availability grid is a double-booking-shaped bug. try/finally ensures responses built by
  // app.onError carry the header as well.
  app.use('/api/*', async (context, next) => {
    try {
      await next();
    } finally {
      context.header('Cache-Control', 'no-store');
    }
  });

  // The largest legal payload (50 attendees + 2000-char description) is well under 64 KB;
  // everything bigger is refused before any handler buffers it (sign-in is pre-auth). The
  // exceptions are the room photo (§4.4, 5 MB) and the user CSV import (§6.3.6, 2 MB), both
  // of which are skipped here and carry their own limiter INSIDE the route, behind
  // requireAdmin: applying it here would let an anonymous caller make us buffer megabytes on
  // a route it can never reach, and the 413-vs-404 difference would advertise the hidden
  // admin path to non-admins (C-15).
  const jsonBodyLimit = bodyLimit({
    maxSize: 64 * 1024,
    onError: () => {
      throw new AppError('VALIDATION_FAILED', 'Request body too large', { status: 413 });
    },
  });
  app.use('/api/*', (context, next) =>
    largeUploadPaths.some((path) => path.test(context.req.path))
      ? next()
      : jsonBodyLimit(context, next),
  );

  // Spec §0 general limit: 600/min per session (cookie value; IP/anon for cookie-less calls).
  const generalRateLimit = createRateLimiter(600);
  app.use('/api/*', async (context, next) => {
    const sid = context.req.header('cookie')?.match(/__Host-sid=([^;]+)/)?.[1];
    generalRateLimit(sid ?? clientIp(context) ?? 'anon');
    await next();
  });

  app.use(
    '*',
    createMiddleware(async (context, next) => {
      // Spec §0 CSRF: allowed Origin OR Sec-Fetch-Site: same-origin passes. (Rejection code
      // stays FORBIDDEN per the conventions contract — spec names CSRF_REJECTED; flagged.)
      if (
        !safeMethods.has(context.req.method.toUpperCase()) &&
        !hasExpectedOrigin(context.req.header('origin'), allowedOrigins) &&
        context.req.header('sec-fetch-site') !== 'same-origin'
      ) {
        throw new AppError('FORBIDDEN', 'Request origin is not allowed');
      }

      await next();
    }),
  );

  // Feature routers attach to this sub-application; operational probes stay at /api/*.
  // .route() copies routes at call time, so every router must attach before the mount below.
  const apiV1 = new Hono();
  apiV1.route('/', createAuthRouter(dependencies));
  apiV1.route('/', createAvailabilityRouter(dependencies));
  // Root-mounted: one factory serves /admin/users/* here and /departments below.
  apiV1.route('/', createUsersRouter(dependencies));
  apiV1.route('/', createDepartmentsRouter(dependencies));
  apiV1.route('/rooms', createRoomsRouter(dependencies));
  apiV1.route('/admin/rooms', createAdminRoomsRouter(dependencies));
  apiV1.route('/bookings', createBookingsRouter(dependencies));
  apiV1.route('/check-in', createCheckinRouter(dependencies));
  apiV1.route('/settings', createSettingsRouter(dependencies));
  // /admin/settings, /admin/business-hours, /admin/holidays.
  apiV1.route('/admin', createAdminSettingsRouter(dependencies));
  // Oversight: read-only, ADMIN-gated. No /admin/bookings/* namespace — admins act through
  // the same booking paths as everyone else, gated by role (§6.3.4).
  apiV1.route('/admin/reports', createReportsRouter(dependencies));
  apiV1.route('/admin/audit-logs', createAuditRouter(dependencies));
  // §6.3.9: outbox inspection + dead-letter retry, the §09 runbook's two hands.
  apiV1.route('/admin/notifications', createAdminNotificationsRouter(dependencies));
  app.route('/api/v1', apiV1);

  // C-13: only these three library routes are reachable over HTTP. Everything else under
  // /api/auth/* (sign-in/email, forget-password, all admin/* incl. ban/unban) answers 404,
  // so no path bypasses the /api/v1 wrapper guards.
  app.on(['GET', 'POST'], '/api/auth/*', async (context) => {
    if (!allowedBetterAuthPaths.has(context.req.path)) {
      return context.notFound();
    }
    // S-01 belt for the allowlisted routes too: better-auth checks `banned` only at session
    // CREATE, so get-session/change-password must re-check the live users.status the same
    // way requireAuth does. sign-out stays open — clearing a dead session is harmless.
    if (context.req.path !== '/api/auth/sign-out') {
      const session = await dependencies.auth.api.getSession({ headers: context.req.raw.headers });
      if (session !== null) {
        const [row] = await dependencies.db
          .select({ status: schema.users.status })
          .from(schema.users)
          .where(eq(schema.users.id, session.user.id))
          .limit(1);
        if (row === undefined || row.status !== 'ACTIVE') {
          throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
        }
      }
    }
    return dependencies.auth.handler(context.req.raw);
  });

  app.get('/api/healthz', (context) => context.json({ status: 'ok' }));

  app.get('/api/readyz', async (context) => {
    try {
      await dependencies.checkDatabase();
    } catch (error) {
      context.get('logger').warn({ err: error }, 'database readiness check failed');
      return context.json({ status: 'not_ready' }, 503);
    }
    // §5.7: a booking.sweep success older than 3 minutes (or none since boot) means the
    // worker in this instance is wedged — stop taking traffic on it.
    const sweep = dependencies.jobsHealth?.()['booking.sweep'];
    if (
      sweep !== undefined &&
      (sweep.lastSuccessAt === null || Date.now() - sweep.lastSuccessAt.getTime() > 3 * 60_000)
    ) {
      context
        .get('logger')
        .warn({ last_success_at: sweep.lastSuccessAt }, 'sweep readiness check failed');
      return context.json({ status: 'not_ready', reason: 'sweep_stale' }, 503);
    }
    return context.json({ status: 'ready' });
  });

  app.get('/api/openapi.json', (context) => context.json(openApiDocument));
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

  if (dependencies.staticRoots !== undefined) {
    const { web: webRoot, admin: adminRoot } = dependencies.staticRoots;

    // /admin/* comes off the admin dist (Vite base '/admin/', so the prefix is stripped
    // before file lookup), with an SPA fallback to the admin index for deep links.
    app.use(
      '/admin/*',
      serveStatic({
        root: adminRoot,
        rewriteRequestPath: (path) => path.replace(/^\/admin/, '') || '/',
      }),
    );
    app.get('/admin/*', serveStatic({ path: `${adminRoot}/index.html` }));

    // Everything else comes off the web dist, falling back to its index — except /api,
    // which must keep returning API 404s rather than an HTML shell.
    const serveWebAssets = serveStatic({ root: webRoot });
    const serveWebIndex = serveStatic({ path: `${webRoot}/index.html` });
    app.use('*', (context, next) =>
      isApiPath(context.req.path) ? next() : serveWebAssets(context, next),
    );
    app.get('*', (context, next) =>
      isApiPath(context.req.path) ? next() : serveWebIndex(context, next),
    );
  }

  app.onError((rawError, context) => {
    const requestId = context.get('requestId') ?? randomUUID();
    const requestLogger = context.get('logger') ?? dependencies.logger;

    // Safety net: known PostgreSQL constraint failures become public codes; services
    // handle the interesting ones (23P01 with alternatives, idempotent replays) themselves.
    const error =
      !(rawError instanceof AppError) && isDatabaseError(rawError)
        ? (mapPostgresError(rawError) ?? rawError)
        : rawError;

    if (error instanceof AppError) {
      if (error.code === 'RATE_LIMITED') {
        const retryAfter = (error.details as { retry_after_seconds?: unknown } | undefined)
          ?.retry_after_seconds;
        if (typeof retryAfter === 'number') {
          context.header('Retry-After', String(retryAfter));
        }
      }
      const envelope = {
        code: error.code,
        message: error.message,
        request_id: requestId,
        ...(error.details === undefined ? {} : { details: error.details }),
      } satisfies ErrorEnvelope;

      return context.json(envelope, error.status);
    }

    requestLogger.error({ err: error }, 'unhandled request error');
    const envelope = {
      code: 'INTERNAL',
      message: 'Internal server error',
      request_id: requestId,
    } satisfies ErrorEnvelope;

    return context.json(envelope, 500);
  });

  return app;
}
