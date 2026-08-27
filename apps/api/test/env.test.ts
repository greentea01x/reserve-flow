import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env.js';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://rf_app:secret@127.0.0.1:5432/reserveflow',
  DATABASE_URL_MIGRATE: 'postgresql://rf_owner:secret@127.0.0.1:5432/reserveflow',
  PUBLIC_BASE_URL: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  SMTP_HOST: '127.0.0.1',
  MAIL_FROM: 'ReserveFlow <no-reply@reserveflow.local>',
  MAIL_REPLY_TO: 'facility@reserveflow.local',
};

describe('environment safety', () => {
  it('boots without DATABASE_URL_MIGRATE: the running server never uses it, and production must not carry an owner credential', () => {
    const { DATABASE_URL_MIGRATE: _omitted, ...withoutMigrate } = validEnvironment;

    expect(() => loadEnv(withoutMigrate)).not.toThrow();
  });

  it('still validates DATABASE_URL_MIGRATE when it is supplied', () => {
    expect(() =>
      loadEnv({ ...validEnvironment, DATABASE_URL_MIGRATE: 'postgresql://x:y@host:6543/db' }),
    ).toThrow();
  });

  it('keeps demo tools disabled by default', () => {
    expect(loadEnv(validEnvironment).DEMO_TOOLS_ENABLED).toBe(false);
  });

  it.each([
    'postgresql://rf_app:secret@localhost:5432/reserveflow',
    'postgresql://rf_app:secret@127.0.0.2:5432/reserveflow',
    'postgresql://rf_app:secret@[::1]:5432/reserveflow',
  ])('allows demo tools only on a loopback application database (%s)', (databaseUrl) => {
    expect(
      loadEnv({
        ...validEnvironment,
        DATABASE_URL: databaseUrl,
        DEMO_TOOLS_ENABLED: 'true',
      }).DEMO_TOOLS_ENABLED,
    ).toBe(true);
  });

  it.each(['test', 'production'])('rejects demo tools when NODE_ENV=%s', (nodeEnvironment) => {
    expect(() =>
      loadEnv({
        ...validEnvironment,
        NODE_ENV: nodeEnvironment,
        DEMO_TOOLS_ENABLED: 'true',
      }),
    ).toThrow('may only be enabled when NODE_ENV=development');
  });

  it('rejects demo tools when the application database is not loopback', () => {
    expect(() =>
      loadEnv({
        ...validEnvironment,
        DATABASE_URL: 'postgresql://rf_app:secret@db.example.com:5432/reserveflow',
        DEMO_TOOLS_ENABLED: 'true',
      }),
    ).toThrow('requires DATABASE_URL to use a loopback host');
  });

  it('does not restrict normal production database configuration while demo tools are off', () => {
    expect(
      loadEnv({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://rf_app:secret@db.example.com:5432/reserveflow',
      }).DEMO_TOOLS_ENABLED,
    ).toBe(false);
  });
});
