import { z } from 'zod';

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

function isLoopbackDatabaseUrl(value: string): boolean {
  const hostname = new URL(value).hostname
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '');
  if (hostname === 'localhost' || hostname === '::1') {
    return true;
  }

  const octets = hostname.split('.').map(Number);
  return (
    octets.length === 4 &&
    octets[0] === 127 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  );
}

// sslmode=verify-full (with the Supabase CA baked into the image) is the expected prod shape.
const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/ })
  .refine((url) => !url.includes(':6543'), {
    message:
      'port 6543 is the Supabase TRANSACTION pooler: it breaks prepared statements and advisory-lock semantics (a session-level lock lands on a different backend for the next statement). Use the direct connection or the session pooler on :5432.',
  })
  .refine((url) => !url.includes('sslmode=disable'), {
    message: 'sslmode=disable is forbidden; use sslmode=verify-full (or omit it for local dev)',
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: postgresUrl,
    /**
     * Migration-only credential (the schema owner). `drizzle.config.ts` reads it straight from
     * `process.env`, so nothing in the running server needs it — requiring it here would force
     * the production container to carry an owner credential it never uses, and would crash-loop
     * a Fly machine that correctly withholds one. Still validated when present, so a typo in CI
     * fails loudly instead of silently pointing at the wrong database.
     */
    DATABASE_URL_MIGRATE: postgresUrl.optional(),
    PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }),
    // Behind the Fly proxy X-Forwarded-For is present but crosses two proxies in prod
    // (Vercel edge -> Fly), so any derived client IP stays advisory-only.
    TRUST_PROXY: booleanFromEnvironment.default(false),
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Comma-separated allowlist for account emails (§6.3.6). Empty = any domain. */
    ACCOUNT_EMAIL_DOMAINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((domain) => domain.trim().toLowerCase())
          .filter((domain) => domain !== ''),
      ),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    MAIL_FROM: z.string().min(1),
    MAIL_REPLY_TO: z.email(),
    WORKER_ENABLED: booleanFromEnvironment.default(false),
    /** Local-only booking time controls used to exercise the real check-in flow. */
    DEMO_TOOLS_ENABLED: booleanFromEnvironment.default(false),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((environment, context) => {
    if (!environment.DEMO_TOOLS_ENABLED) {
      return;
    }
    if (environment.NODE_ENV !== 'development') {
      context.addIssue({
        code: 'custom',
        path: ['DEMO_TOOLS_ENABLED'],
        message: 'may only be enabled when NODE_ENV=development',
      });
    }
    if (!isLoopbackDatabaseUrl(environment.DATABASE_URL)) {
      context.addIssue({
        code: 'custom',
        path: ['DEMO_TOOLS_ENABLED'],
        message: 'requires DATABASE_URL to use a loopback host',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'environment';
        return `- ${path}: ${issue.message}`;
      })
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
