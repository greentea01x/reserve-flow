import { isIP } from 'node:net';

import type { Context } from 'hono';
import type { z } from 'zod';

import { AppError } from './errors.js';

/**
 * Advisory only — audit context, never an auth factor. When TRUST_PROXY is off (the
 * default, incl. every test app) X-Forwarded-For is client-forgeable and ignored entirely.
 * When on, take the RIGHTMOST entry: proxies append, so the leftmost is whatever the
 * client typed. ponytail: rightmost is the nearest proxy's view (two proxies in prod means
 * it can be the edge, not the browser) — good enough for advisory audit rows.
 */
export function clientIp(context: Context): string | null {
  if (context.get('trustProxy') !== true) {
    return null;
  }
  const forwarded = context.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
  return forwarded !== undefined && isIP(forwarded) !== 0 ? forwarded : null;
}

export function parseBody<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid request body', {
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Action endpoints take optional bodies — an absent body reads as `{}`. */
export async function readJson(context: {
  req: { text: () => Promise<string> };
}): Promise<unknown> {
  const text = await context.req.text();
  if (text.trim() === '') {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Request body must be JSON');
  }
}
