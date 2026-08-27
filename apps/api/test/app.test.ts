import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth/index.js';
import { authSchema } from '../src/auth/schema.js';
import { createDb } from '../src/db/index.js';
import { createLogger } from '../src/lib/logger.js';

// A Pool never connects until queried, so these routes still run with zero env/DB access.
const db = createDb('postgresql://unused:unused@127.0.0.1:9/unused');

const app = createApp({
  publicBaseUrl: 'http://localhost:3000',
  additionalAllowedOrigins: ['http://localhost:5174'],
  logger: createLogger('silent'),
  db,
  auth: createAuth({
    db: drizzle(db.$client, { schema: authSchema }),
    secret: 'x'.repeat(32),
    baseURL: 'http://localhost:3000',
  }),
  checkDatabase: async () => {
    throw new Error('healthz must not check the database');
  },
});

describe('API health check', () => {
  it('responds without environment or database access', async () => {
    const response = await app.request('/api/healthz');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('rejects an unsafe request from an unexpected origin', async () => {
    const response = await app.request('/api/v1/not-implemented', {
      method: 'POST',
      headers: { origin: 'https://example.invalid' },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Request origin is not allowed',
    });
  });

  it('allows an unsafe request from an explicitly allowed origin to reach routing', async () => {
    const response = await app.request('/api/v1/not-implemented', {
      method: 'POST',
      headers: { origin: 'http://localhost:5174' },
    });

    expect(response.status).toBe(404);
  });

  it('marks every API response Cache-Control: no-store', async () => {
    const ok = await app.request('/api/healthz');
    expect(ok.headers.get('cache-control')).toBe('no-store');

    // Error responses built by app.onError must carry it too.
    const forbidden = await app.request('/api/v1/not-implemented', {
      method: 'POST',
      headers: { origin: 'https://example.invalid' },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('cache-control')).toBe('no-store');
  });

  it('308-redirects non-API requests on a non-canonical host', async () => {
    const response = await app.request('/some/page?tab=2', {
      headers: { host: 'reserveflow-api.fly.dev' },
    });

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('http://localhost:3000/some/page?tab=2');
  });

  it('never host-redirects API requests', async () => {
    const response = await app.request('/api/healthz', {
      headers: { host: 'reserveflow-api.fly.dev' },
    });

    expect(response.status).toBe(200);
  });

  it('mounts demo check-in preparation only when the runtime explicitly enables it', async () => {
    const bookingId = '11111111-1111-4111-8111-111111111111';
    const disabled = await app.request(`/api/v1/bookings/${bookingId}/demo-check-in-ready`, {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(disabled.status).toBe(404);

    const enabledApp = createApp({
      publicBaseUrl: 'http://localhost:3000',
      logger: createLogger('silent'),
      db,
      auth: createAuth({
        db: drizzle(db.$client, { schema: authSchema }),
        secret: 'x'.repeat(32),
        baseURL: 'http://localhost:3000',
      }),
      demoToolsEnabled: true,
      checkDatabase: async () => {},
    });
    const enabled = await enabledApp.request(`/api/v1/bookings/${bookingId}/demo-check-in-ready`, {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(enabled.status).toBe(401);
  });
});

describe('readiness (/api/readyz)', () => {
  const auth = createAuth({
    db: drizzle(db.$client, { schema: authSchema }),
    secret: 'x'.repeat(32),
    baseURL: 'http://localhost:3000',
  });
  const readyApp = (options: {
    checkDatabase?: () => Promise<void>;
    sweepLastSuccessAt?: Date | null;
  }) =>
    createApp({
      publicBaseUrl: 'http://localhost:3000',
      logger: createLogger('silent'),
      db,
      auth,
      checkDatabase: options.checkDatabase ?? (async () => {}),
      ...(options.sweepLastSuccessAt === undefined
        ? {}
        : {
            jobsHealth: () => ({
              'booking.sweep': { lastSuccessAt: options.sweepLastSuccessAt as Date | null },
            }),
          }),
    });

  it('503s when the database check fails', async () => {
    const response = await readyApp({
      checkDatabase: async () => {
        throw new Error('db down');
      },
    }).request('/api/readyz');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'not_ready' });
  });

  it('is ready without a worker (no jobsHealth wired)', async () => {
    const response = await readyApp({}).request('/api/readyz');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ready' });
  });

  it('is ready while the sweep succeeded within the last 3 minutes', async () => {
    const response = await readyApp({
      sweepLastSuccessAt: new Date(Date.now() - 60_000),
    }).request('/api/readyz');
    expect(response.status).toBe(200);
  });

  it('503s when the sweep is stale (> 3 minutes) or has never succeeded', async () => {
    for (const lastSuccessAt of [new Date(Date.now() - 4 * 60_000), null]) {
      const response = await readyApp({ sweepLastSuccessAt: lastSuccessAt }).request('/api/readyz');
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        status: 'not_ready',
        reason: 'sweep_stale',
      });
    }
  });
});

describe('API docs', () => {
  it('serves the OpenAPI document covering the full route inventory', async () => {
    const response = await app.request('/api/openapi.json');

    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      openapi: string;
      paths: Record<
        string,
        {
          post?: {
            requestBody: {
              content: Record<
                string,
                { schema: { required?: string[]; additionalProperties?: boolean } }
              >;
            };
          };
        }
      >;
    };
    expect(document.openapi).toBe('3.1.0');
    // New route ⇒ new entry in src/docs.ts ⇒ new line here. Keep all three in step.
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/auth/change-password',
      '/api/auth/get-session',
      '/api/auth/sign-out',
      '/api/healthz',
      '/api/readyz',
      '/api/v1/auth/sign-in',
      '/api/v1/availability',
      '/api/v1/calendar',
      '/api/v1/me',
      '/api/v1/rooms',
      '/api/v1/rooms/{id}',
      '/api/v1/rooms/{id}/photo',
    ]);
    // The sign-in body documents itself from the live zod validator, not a copy.
    const signInBody =
      document.paths['/api/v1/auth/sign-in']?.post?.requestBody.content['application/json']?.schema;
    expect(signInBody?.required).toEqual(['employee_code', 'password']);
    expect(signInBody?.additionalProperties).toBe(false);

    const calendarPath = document.paths['/api/v1/calendar'] as unknown as {
      get: {
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  properties: {
                    bookings: {
                      items: {
                        allOf: { properties?: Record<string, unknown> }[];
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
    const calendarBookingSchema =
      calendarPath.get.responses[200].content['application/json'].schema.properties.bookings.items;
    expect(calendarBookingSchema.allOf[1]?.properties).toHaveProperty('owner_display_name');
  });

  it('serves Swagger UI pointed at the document', async () => {
    const response = await app.request('/api/docs');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('/api/openapi.json');
  });
});
