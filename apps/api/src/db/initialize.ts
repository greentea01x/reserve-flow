import { pathToFileURL } from 'node:url';

import { DEMO_ADMIN, type DemoSeedEnvironment } from './demo-seed.js';
import { initializeDatabase } from './seed.js';

type EnvironmentSource = Record<string, string | undefined>;

export type InitializeArguments = {
  apply: boolean;
};

export type InitializeEnvironment = DemoSeedEnvironment & {
  databaseName: string;
  databaseEnvironment: 'development' | 'staging' | 'production';
  loopback: boolean;
};

const productionMarker = /(^|[._/-])(prod|production|live)(?=$|[._/-])/i;

function required(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(`${name} is required for database initialization`);
  }
  return value;
}

function password(source: EnvironmentSource, name: string): string {
  const value = required(source, name);
  if (value.length < 10 || value.length > 128) {
    throw new Error(`${name} must be between 10 and 128 characters`);
  }
  return value;
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

function isLoopback(url: URL): boolean {
  const hostname = normalizedHostname(url);
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

export function parseInitializeArguments(args: readonly string[]): InitializeArguments {
  const allowed = new Set(['--apply']);
  const unknown = args.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) {
    throw new Error(`Unknown database initialization option: ${unknown.join(', ')}`);
  }

  const apply = args.includes('--apply');
  if (!apply) {
    throw new Error('Database initialization is a no-op unless --apply is provided');
  }

  return { apply };
}

export function readInitializeEnvironment(
  source: EnvironmentSource,
  arguments_?: InitializeArguments,
): InitializeEnvironment {
  if (arguments_ !== undefined && !arguments_.apply) {
    throw new Error('Database initialization is a no-op unless --apply is provided');
  }
  const databaseUrl = required(source, 'INITIALIZE_DATABASE_URL');
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('INITIALIZE_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('INITIALIZE_DATABASE_URL must use postgres:// or postgresql://');
  }
  if (parsed.port === '6543') {
    throw new Error(
      'INITIALIZE_DATABASE_URL cannot use the Supabase transaction pooler on port 6543',
    );
  }
  if (parsed.searchParams.get('sslmode')?.toLowerCase() === 'disable') {
    throw new Error('INITIALIZE_DATABASE_URL cannot disable TLS');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (databaseName === '' || databaseName.includes('/')) {
    throw new Error('INITIALIZE_DATABASE_URL must identify one PostgreSQL database');
  }

  const databaseEnvironment = required(source, 'INITIALIZE_ENVIRONMENT');
  if (!['development', 'staging', 'production'].includes(databaseEnvironment)) {
    throw new Error('INITIALIZE_ENVIRONMENT must be development, staging, or production');
  }
  const loopback = isLoopback(parsed);
  const productionLike =
    databaseEnvironment === 'production' ||
    source.NODE_ENV?.trim().toLowerCase() === 'production' ||
    productionMarker.test(normalizedHostname(parsed)) ||
    productionMarker.test(databaseName);
  if (productionLike && source.INITIALIZE_ALLOW_PRODUCTION?.trim() !== 'true') {
    throw new Error('Production-like initialization requires INITIALIZE_ALLOW_PRODUCTION=true');
  }
  const expectedConfirmation = `initialize:${databaseName}`;
  if (required(source, 'INITIALIZE_CONFIRM') !== expectedConfirmation) {
    throw new Error(`INITIALIZE_CONFIRM must equal ${expectedConfirmation}`);
  }

  const authSecret = required(source, 'BETTER_AUTH_SECRET');
  if (authSecret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  }
  const adminPassword = password(source, 'INITIALIZE_ADMIN_PASSWORD');
  const employeePassword = password(source, 'INITIALIZE_EMPLOYEE_PASSWORD');
  if (adminPassword === employeePassword) {
    throw new Error('Admin and employee initialization passwords must be different');
  }

  return {
    databaseUrl,
    databaseName,
    databaseEnvironment: databaseEnvironment as InitializeEnvironment['databaseEnvironment'],
    loopback,
    authSecret,
    adminPassword,
    employeePassword,
  };
}

const invokedPath = process.argv[1];
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;

if (isMain) {
  try {
    parseInitializeArguments(process.argv.slice(2));
    const environment = readInitializeEnvironment(process.env);
    const result = await initializeDatabase(
      environment,
      {
        databaseName: environment.databaseName,
        databaseEnvironment: environment.databaseEnvironment,
        allowMissingEnvironmentMarker: environment.loopback,
      },
      (message) => console.info(message),
    );
    console.info(
      `Database initialization complete: ${result.rooms} rooms, ${result.departments} departments, ` +
        `${result.employees} employees, ${result.admins} admin ` +
        `(${result.credentialsCreated} credential accounts created; existing passwords preserved).`,
    );
    console.info(`Admin account: ${DEMO_ADMIN.employeeCode}`);
    console.info('Employee accounts: AU-002–AU-081. Passwords were read from the environment.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database initialization failed');
    process.exitCode = 1;
  }
}
