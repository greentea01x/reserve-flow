import pino, { type Logger } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

const redactedPaths = [
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  'request.headers.authorization',
  'email',
  'user.email',
  'body.email',
  'mobile',
  'mobileNumber',
  'mobile_number',
  'user.mobile',
  'user.mobileNumber',
  'user.mobile_number',
  'body.mobile',
  'body.mobileNumber',
  'body.mobile_number',
];

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const thaiPhonePattern = /(?<!\d)(?:\+66|66|0)(?:[\s-]?\d){8,9}(?!\d)/g;
const authorizationValuePattern = /\b(?:bearer|basic)\s+[A-Z0-9._~+/=-]+/gi;

function redactSensitiveText(value: string): string {
  return value
    .replace(authorizationValuePattern, '[REDACTED_AUTHORIZATION]')
    .replace(emailPattern, '[REDACTED_EMAIL]')
    .replace(thaiPhonePattern, '[REDACTED_MOBILE]');
}

function isSensitiveKey(key: string): boolean {
  const normalisedKey = key.replaceAll(/[-_]/g, '').toLowerCase();
  return (
    normalisedKey.includes('authorization') ||
    normalisedKey.includes('email') ||
    normalisedKey.includes('mobile')
  );
}

function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, seen));
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactLogValue(item, seen),
    ]),
  );
}

function redactLogObject(value: Record<string, unknown>): Record<string, unknown> {
  return redactLogValue(value) as Record<string, unknown>;
}

export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    redact: {
      paths: redactedPaths,
      censor: '[REDACTED]',
    },
    formatters: {
      bindings: redactLogObject,
      log: redactLogObject,
    },
    hooks: {
      logMethod(arguments_, method) {
        const redactedArguments = arguments_.map((argument) =>
          typeof argument === 'string' ? redactSensitiveText(argument) : argument,
        );
        Reflect.apply(method, this, redactedArguments);
      },
    },
    serializers: {
      err(error: Error) {
        return redactLogObject(pino.stdSerializers.err(error));
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
