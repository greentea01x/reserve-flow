import { existsSync } from 'node:fs';

import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';

import { createApp } from './app.js';
import { createAuth } from './auth/index.js';
import { authSchema } from './auth/schema.js';
import { createDb } from './db/index.js';
import { loadEnv } from './env.js';
import { startScheduler } from './jobs/index.js';
import { createLogger } from './lib/logger.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
// One Pool, two drizzle heads: the app head (camelCase props + snake_case casing) and the
// better-auth head, whose property keys ARE the physical column names — not interchangeable.
const db = createDb(env.DATABASE_URL);
// Dev only: Vite serves the two SPAs on their own origins and proxies /api here, so a browser
// request never carries PUBLIC_BASE_URL as its Origin. Both CSRF walls need the same list —
// ours (createApp) and better-auth's own, which owns /api/auth/sign-out.
const devOrigins =
  env.NODE_ENV === 'development' ? ['http://localhost:5173', 'http://localhost:5174'] : [];
// Dev only. Sharing a demo over a tunnel gives the browser a public origin that is neither
// PUBLIC_BASE_URL nor a localhost port, and whose hostname changes on every restart. Our own
// CSRF wall still passes those requests through its `Sec-Fetch-Site: same-origin` fallback,
// but better-auth — which owns /api/auth/sign-out — checks the Origin with no such fallback,
// so a tunnelled visitor could sign in and then never sign out. Wildcards cover the moving
// hostname; production keeps the list empty, where there is exactly one known origin.
const devTunnelOrigins =
  env.NODE_ENV === 'development' ? ['https://*.ngrok-free.app', 'https://*.ngrok-free.dev'] : [];
const auth = createAuth({
  db: drizzle(db.$client, { schema: authSchema }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.PUBLIC_BASE_URL,
  trustedOrigins: [...devOrigins, ...devTunnelOrigins],
});

// Present only in the deploy image (Docker WORKDIR /app holds both SPA dists);
// absent in local dev, where Vite serves the SPAs and proxies /api here.
const staticRoots = { web: './apps/web/dist', admin: './apps/admin/dist' };
const hasStaticDists = existsSync(staticRoots.web) && existsSync(staticRoots.admin);

// Started before createApp so the app can carry the post-commit kick and the /readyz sweep
// health. Absent (no worker) both stay undefined and the app skips them.
const scheduler = env.WORKER_ENABLED ? startScheduler({ db, env, logger }) : undefined;

const app = createApp({
  publicBaseUrl: env.PUBLIC_BASE_URL,
  trustProxy: env.TRUST_PROXY,
  accountEmailDomains: env.ACCOUNT_EMAIL_DOMAINS,
  demoToolsEnabled: env.DEMO_TOOLS_ENABLED,
  ...(devOrigins.length > 0 ? { additionalAllowedOrigins: devOrigins } : {}),
  ...(hasStaticDists ? { staticRoots } : {}),
  ...(scheduler === undefined ? {} : { kickOutbox: scheduler.kick, jobsHealth: scheduler.health }),
  logger,
  db,
  auth,
  checkDatabase: async () => {
    await db.$client.query('select 1');
  },
});

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  ({ port }) => {
    logger.info({ port }, 'API listening');
  },
);

let isShuttingDown = false;

function shutDown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'shutting down');
  // Stop the timers now; hold on to the promise — jobs/index.ts's contract is that in-flight
  // rounds finish before the pool closes, so a drain round never hits an ended pool.
  const schedulerStopped = scheduler?.stop() ?? Promise.resolve();

  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'server shutdown failed');
      process.exitCode = 1;
    }

    void schedulerStopped
      .then(() => db.$client.end())
      .catch((shutdownError: unknown) => {
        logger.error({ err: shutdownError }, 'shutdown cleanup failed');
        process.exitCode = 1;
      });
  });
}

process.once('SIGINT', () => shutDown('SIGINT'));
process.once('SIGTERM', () => shutDown('SIGTERM'));
