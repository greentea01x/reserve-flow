import type { Transporter } from 'nodemailer';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';

import type { Db } from '../db/index.js';
import { createMailer, type MailerConfig, mailDomainFrom } from '../email/mailer.js';
import type { Env } from '../env.js';
import { loadSettings, type Settings } from '../lib/settings.js';
import { runDrainOnce } from './drain.js';
import { runMaintenanceOnce } from './maintenance.js';
import { runSweepOnce } from './sweep.js';

export type SchedulerDeps = {
  db: Db;
  env: Env;
  logger: Logger;
  /** Test seam; by default one is built from the SMTP env. */
  transporter?: Transporter;
};

export type JobsHealth = Readonly<Record<string, { lastSuccessAt: Date | null }>>;

export type Scheduler = {
  /** Best-effort immediate drain after an outbox-writing tx commits; the 10s loop backstops it. */
  kick: () => void;
  /** For /readyz: a booking.sweep success older than 3 minutes means the worker is wedged. */
  health: () => JobsHealth;
  /** Stops the timers, then resolves once every in-flight round has settled — the caller may
   * only close the pool after this promise resolves. */
  stop: () => Promise<void>;
};

/**
 * One round in one tx under pg_try_advisory_xact_lock('job:<name>'). Returns false when
 * another instance holds the lock — skip, never block; the tx scope self-releases it.
 */
async function lockedRound(
  pool: Pool,
  name: string,
  fn: (client: PoolClient) => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtext($1::text)) AS ok',
      [`job:${name}`],
    );
    if (lock.rows[0]?.ok !== true) {
      await client.query('ROLLBACK');
      return false;
    }
    await fn(client);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is going back to the pool either way
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function sweepRound(pool: Pool, settings: Settings, logger: Logger): Promise<boolean> {
  return lockedRound(pool, 'booking.sweep', (client) => runSweepOnce(client, settings, logger));
}

export async function maintenanceRound(pool: Pool, logger: Logger): Promise<boolean> {
  return lockedRound(pool, 'maintenance.daily', (client) => runMaintenanceOnce(client, logger));
}

/** Asia/Bangkok is UTC+7 with no DST, so 03:15 Bangkok is always 20:15 UTC (§5.7). */
export function msUntilBangkok0315(from: Date = new Date()): number {
  const next = new Date(from);
  next.setUTCHours(20, 15, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - from.getTime();
}

export function startScheduler(deps: SchedulerDeps): Scheduler {
  const { db, env, logger } = deps;
  const pool = db.$client;
  const config: MailerConfig = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
    replyTo: env.MAIL_REPLY_TO,
    domain: mailDomainFrom(env.MAIL_FROM),
  };
  const transporter = deps.transporter ?? createMailer(config);

  // All mutable scheduler state lives in this closure: startScheduler is reentrant, and two
  // instances (e.g. a test beside the server) never share or clobber each other's state.
  const jobState: Record<string, { lastSuccessAt: Date | null }> = {};
  const timers: NodeJS.Timeout[] = [];
  const inFlight = new Set<Promise<void>>();
  let stopped = false;

  // In-process overlap guard: a tick is skipped while the previous round still runs. Errors
  // are logged and swallowed — the next tick IS the retry; there is no job-level retry state.
  const runner = (name: string, fn: () => Promise<void>) => {
    const log = logger.child({ job: name });
    jobState[name] = { lastSuccessAt: null };
    let busy = false;
    return (): void => {
      if (stopped || busy) {
        return;
      }
      busy = true;
      const round = fn()
        .then(() => {
          jobState[name] = { lastSuccessAt: new Date() };
        })
        .catch((error: unknown) => log.error({ err: error }, 'job round failed'))
        .finally(() => {
          busy = false;
          inFlight.delete(round);
        });
      inFlight.add(round);
    };
  };

  const every = (name: string, ms: number, fn: () => Promise<void>, atBoot: boolean) => {
    const tick = runner(name, fn);
    timers.push(setInterval(tick, ms));
    if (atBoot) {
      tick();
    }
    return tick;
  };

  /** Chained setTimeout at 03:15 Asia/Bangkok; never runs at boot. */
  const daily = (name: string, fn: () => Promise<void>) => {
    const tick = runner(name, fn);
    const arm = (): void => {
      if (stopped) {
        return;
      }
      timers.push(
        setTimeout(() => {
          tick();
          arm();
        }, msUntilBangkok0315()),
      );
    };
    arm();
  };

  every(
    'booking.sweep',
    60_000,
    async () => {
      const settings = await loadSettings(db);
      await sweepRound(pool, settings, logger.child({ job: 'booking.sweep' }));
    },
    true,
  );
  const kickDrain = every(
    'notify.send',
    10_000,
    async () => {
      const settings = await loadSettings(db);
      await runDrainOnce(pool, {
        transporter,
        config,
        publicBaseUrl: env.PUBLIC_BASE_URL,
        checkInGraceMinutes: settings.checkin_grace_minutes,
        logger: logger.child({ job: 'notify.send' }),
      });
    },
    false,
  );
  daily('maintenance.daily', async () => {
    await maintenanceRound(pool, logger.child({ job: 'maintenance.daily' }));
  });

  logger.info(
    'scheduler started (booking.sweep 60s, notify.send 10s, maintenance.daily 03:15 Asia/Bangkok)',
  );

  return {
    // Post-commit kick (§5.7): deferred so the HTTP response never waits on a drain round.
    kick: () => {
      setImmediate(kickDrain);
    },
    health: () => jobState,
    stop: async () => {
      stopped = true;
      for (const timer of timers) {
        // clearTimeout clears both timeout and interval handles.
        clearTimeout(timer);
      }
      // In-flight rounds finish before the caller closes the pool.
      await Promise.allSettled(inFlight);
      logger.info('scheduler stopped');
    },
  };
}
