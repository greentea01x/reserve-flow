import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';

import { createAuth } from '../auth/index.js';
import { authSchema } from '../auth/schema.js';
import { withTx } from '../lib/tx.js';
import {
  assertDemoDatabaseIdentity,
  assertSafeDemoDatabaseUrl,
  assertSafeExistingDemoState,
  DEMO_ADMIN,
  DEMO_BUSINESS_HOURS,
  DEMO_DEPARTMENTS,
  DEMO_EMPLOYEES,
  DEMO_FEATURES,
  DEMO_ROOM_FEATURES,
  DEMO_ROOMS,
  DEMO_SETTINGS,
  DEMO_USERS,
  type DemoDepartmentCode,
  type DemoSeedEnvironment,
  type ExistingDemoState,
  type ExistingDemoUser,
  missingDemoUsers,
  readDemoSeedEnvironment,
} from './demo-seed.js';
import { createDb } from './index.js';

const SEED_LOCK_NAME = 'reserveflow:demo-seed:v1';
const INITIALIZE_LOCK_NAME = 'reserveflow:database-initialize:v1';
const REQUIRED_DEMO_TABLES = [
  'accounts',
  'audit_logs',
  'booking_attendees',
  'bookings',
  'business_hours',
  'departments',
  'features',
  'holidays',
  'notifications',
  'password_setup_tokens',
  'room_features',
  'rooms',
  'sessions',
  'settings',
  'users',
  'verifications',
] as const;
const PHOTO_ASSET_ROOT = new URL(
  '../../../../docs/stitch/pastel-corporate-room-manager/assets/',
  import.meta.url,
);

type Progress = (message: string) => void;

type DatabaseIdentity = {
  databaseName: string;
  environment: string | null;
};

type DepartmentRow = { id: string; code: DemoDepartmentCode };

type PhotoRow = {
  code: (typeof DEMO_ROOMS)[number]['code'];
  bytes: Buffer;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Demo seed verification failed: ${message}`);
  }
}

async function readRoomPhotos(): Promise<readonly PhotoRow[]> {
  return Promise.all(
    DEMO_ROOMS.map(async (room) => {
      const bytes = await readFile(new URL(room.photoAsset, PHOTO_ASSET_ROOT));
      if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw new Error(`Demo room image is not a JPEG: ${room.photoAsset}`);
      }
      return { code: room.code, bytes };
    }),
  );
}

async function assertMigratedTarget(client: PoolClient): Promise<DatabaseIdentity> {
  const target = await client.query<{
    database_name: string;
    environment: string | null;
  }>(
    `SELECT current_database() AS database_name,
            current_setting('reserveflow.environment', true) AS environment`,
  );
  const row = target.rows[0];
  if (row === undefined) {
    throw new Error('Could not inspect the database target');
  }

  const missingTables = await client.query<{ table_name: string }>(
    `SELECT required.table_name
       FROM unnest($1::text[]) AS required(table_name)
      WHERE to_regclass(format('public.%I', required.table_name)) IS NULL
      ORDER BY required.table_name`,
    [[...REQUIRED_DEMO_TABLES]],
  );
  if (missingTables.rowCount !== 0) {
    throw new Error(
      `Database is not fully migrated; missing tables: ${missingTables.rows
        .map((missing) => missing.table_name)
        .join(', ')}`,
    );
  }

  return { databaseName: row.database_name, environment: row.environment };
}

async function readExistingState(client: PoolClient): Promise<ExistingDemoState> {
  // One PoolClient executes one query at a time. Keep these sequential so seed preflight stays
  // compatible with pg 9, which removes concurrent client.query() calls.
  const users = await client.query<{
    email: string;
    employee_code: string;
    has_credential: boolean;
    account_count: number;
  }>(
    `SELECT u.email::text AS email, u.employee_code::text AS employee_code,
              EXISTS (
                SELECT 1 FROM accounts a
                 WHERE a.user_id = u.id
                   AND a.issuer = 'local:credential'
                   AND a.account_id = u.id::text
                   AND a.provider_id = 'credential'
                   AND a.password LIKE '$argon2id$%'
                   AND a.access_token IS NULL
                   AND a.refresh_token IS NULL
                   AND a.id_token IS NULL
                   AND a.access_token_expires_at IS NULL
                   AND a.refresh_token_expires_at IS NULL
                   AND a.scope IS NULL
              ) AS has_credential,
              (SELECT count(*)::int FROM accounts a WHERE a.user_id = u.id) AS account_count
         FROM users u
        ORDER BY u.employee_code`,
  );
  const rooms = await client.query<{ code: string }>('SELECT code FROM rooms ORDER BY code');
  const departments = await client.query<{ code: string }>(
    'SELECT code FROM departments ORDER BY code',
  );
  const operationalRowsResult = await client.query<ExistingDemoState['operationalRows']>(
    `SELECT (SELECT count(*)::int FROM bookings) AS bookings,
              (SELECT count(*)::int FROM booking_attendees) AS booking_attendees,
              (SELECT count(*)::int FROM sessions) AS sessions,
              (SELECT count(*)::int FROM verifications) AS verifications,
              (SELECT count(*)::int FROM password_setup_tokens) AS password_setup_tokens,
              (SELECT count(*)::int FROM notifications) AS notifications,
              (SELECT count(*)::int FROM audit_logs) AS audit_logs,
              (SELECT count(*)::int FROM holidays) AS holidays`,
  );
  const operationalRows = operationalRowsResult.rows[0];
  if (operationalRows === undefined) {
    throw new Error('Could not inspect operational demo tables');
  }

  return {
    users: users.rows.map((row) => ({
      email: row.email,
      employeeCode: row.employee_code,
      hasCredential: row.has_credential,
      accountCount: row.account_count,
    })),
    roomCodes: rooms.rows.map((row) => row.code),
    departmentCodes: departments.rows.map((row) => row.code),
    operationalRows,
  };
}

async function upsertDepartments(pool: Pool): Promise<Map<DemoDepartmentCode, string>> {
  return withTx(pool, async (client) => {
    const result = await client.query<DepartmentRow>(
      `INSERT INTO departments (code, name, active)
       SELECT seed_department.code, seed_department.name, true
         FROM jsonb_to_recordset($1::jsonb) AS seed_department(code text, name text)
       ON CONFLICT (code) DO UPDATE
         SET name = excluded.name, active = true
       RETURNING id, code`,
      [JSON.stringify(DEMO_DEPARTMENTS)],
    );
    assert(result.rowCount === DEMO_DEPARTMENTS.length, 'all departments must be upserted');
    return new Map(result.rows.map((row) => [row.code, row.id]));
  });
}

async function createMissingCredentials(
  pool: Pool,
  environment: DemoSeedEnvironment,
  departments: ReadonlyMap<DemoDepartmentCode, string>,
  existingUsers: readonly ExistingDemoUser[],
  progress: Progress,
): Promise<number> {
  const auth = createAuth({
    db: drizzle(pool, { schema: authSchema }),
    secret: environment.authSecret,
    baseURL: 'http://localhost:3000',
  });
  const missing = missingDemoUsers(existingUsers);

  // Deliberately sequential: each createUser performs a 64 MiB Argon2id hash. Parallelizing
  // 81 of those can exhaust a laptop or a small staging container.
  for (const [index, user] of missing.entries()) {
    const departmentId = departments.get(user.departmentCode);
    assert(departmentId !== undefined, `department ${user.departmentCode} must exist`);
    await auth.api.createUser({
      body: {
        email: user.email,
        password: user.role === 'ADMIN' ? environment.adminPassword : environment.employeePassword,
        name: user.fullName,
        role: user.role,
        data: {
          employee_code: user.employeeCode,
          department_id: departmentId,
          job_title: user.jobTitle,
          status: 'ACTIVE',
        },
      },
    });
    if ((index + 1) % 10 === 0 || index + 1 === missing.length) {
      progress(`Created ${index + 1}/${missing.length} missing credential accounts`);
    }
  }

  return missing.length;
}

async function normalizeDemoUsers(pool: Pool): Promise<void> {
  await withTx(pool, async (client) => {
    const result = await client.query(
      `UPDATE users AS u
          SET employee_code = profile.employee_code,
              email = profile.email,
              full_name = profile.full_name,
              department_id = department.id,
              job_title = profile.job_title,
              role = profile.role,
              status = 'ACTIVE',
              banned = false,
              ban_reason = NULL,
              ban_expires = NULL,
              disabled_at = NULL,
              failed_logins = 0,
              locked_until = NULL,
              email_verified = true
         FROM jsonb_to_recordset($1::jsonb) AS profile(
                employee_code text,
                email text,
                full_name text,
                department_code text,
                job_title text,
                role text
              ),
              departments AS department
        WHERE lower(u.employee_code::text) = lower(profile.employee_code)
          AND lower(u.email::text) = lower(profile.email)
          AND department.code = profile.department_code`,
      [
        JSON.stringify(
          DEMO_USERS.map((user) => ({
            employee_code: user.employeeCode,
            email: user.email,
            full_name: user.fullName,
            department_code: user.departmentCode,
            job_title: user.jobTitle,
            role: user.role,
          })),
        ),
      ],
    );
    assert(result.rowCount === DEMO_USERS.length, 'all demo users must be normalized');
  });
}

async function upsertMasterData(pool: Pool, photos: readonly PhotoRow[]): Promise<void> {
  const photosByCode = new Map(photos.map((photo) => [photo.code, photo.bytes]));

  await withTx(pool, async (client) => {
    await client.query(
      `INSERT INTO features (key, name, icon)
       SELECT seed_feature.key, seed_feature.name, seed_feature.icon
         FROM jsonb_to_recordset($1::jsonb) AS seed_feature(key text, name text, icon text)
       ON CONFLICT (key) DO UPDATE
         SET name = excluded.name, icon = excluded.icon`,
      [JSON.stringify(DEMO_FEATURES)],
    );

    const roomParameters: unknown[] = [];
    const roomValues = DEMO_ROOMS.map((room, index) => {
      const first = index * 7;
      roomParameters.push(
        room.code,
        room.name,
        room.floor,
        room.location,
        room.description,
        room.capacity,
        photosByCode.get(room.code),
      );
      return `($${first + 1}, $${first + 2}, $${first + 3}, $${first + 4}, $${first + 5}, $${first + 6}, $${first + 7}, true)`;
    });
    await client.query(
      `INSERT INTO rooms
         (code, name, floor, location, description, capacity, photo, active)
       VALUES ${roomValues.join(', ')}
       ON CONFLICT (code) DO UPDATE
         SET name = excluded.name,
             floor = excluded.floor,
             location = excluded.location,
             description = excluded.description,
             capacity = excluded.capacity,
             photo = excluded.photo,
             active = true`,
      roomParameters,
    );

    const roomCodes = DEMO_ROOMS.map((room) => room.code);
    await client.query(
      'DELETE FROM room_features WHERE room_id IN (SELECT id FROM rooms WHERE code = ANY($1::text[]))',
      [roomCodes],
    );
    await client.query(
      `INSERT INTO room_features (room_id, feature_key, quantity)
       SELECT room.id, feature.key, feature.quantity
         FROM rooms AS room
         CROSS JOIN jsonb_to_recordset($2::jsonb) AS feature(key text, quantity integer)
        WHERE room.code = ANY($1::text[])`,
      [roomCodes, JSON.stringify(DEMO_ROOM_FEATURES)],
    );

    await client.query(
      `INSERT INTO business_hours (weekday, is_open, open_time, close_time, updated_by)
       SELECT seed_hours.weekday, seed_hours.is_open,
              seed_hours.open_time, seed_hours.close_time, NULL
         FROM jsonb_to_recordset($1::jsonb) AS seed_hours(
                weekday smallint,
                is_open boolean,
                open_time time,
                close_time time
              )
       ON CONFLICT (weekday) DO UPDATE
         SET is_open = excluded.is_open,
             open_time = excluded.open_time,
             close_time = excluded.close_time,
             updated_by = NULL,
             updated_at = now()`,
      [
        JSON.stringify(
          DEMO_BUSINESS_HOURS.map((hours) => ({
            weekday: hours.weekday,
            is_open: hours.isOpen,
            open_time: hours.openTime,
            close_time: hours.closeTime,
          })),
        ),
      ],
    );

    await client.query(
      `INSERT INTO settings (key, value, updated_by)
       SELECT entry.key, entry.value, NULL
         FROM jsonb_each($1::jsonb) AS entry(key, value)
       ON CONFLICT (key) DO UPDATE
         SET value = excluded.value, updated_by = NULL, updated_at = now()`,
      [JSON.stringify(DEMO_SETTINGS)],
    );
  });
}

async function verifyDemoSeed(client: PoolClient): Promise<void> {
  const userCounts = await client.query<{
    total: number;
    employees: number;
    admins: number;
    credentials: number;
    account_rows: number;
    employee_job_titles: number;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE role = 'EMPLOYEE' AND status = 'ACTIVE')::int AS employees,
            count(*) FILTER (WHERE role = 'ADMIN' AND status = 'ACTIVE')::int AS admins,
            count(DISTINCT job_title) FILTER (
              WHERE role = 'EMPLOYEE' AND status = 'ACTIVE'
            )::int AS employee_job_titles,
            count(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM accounts a
                 WHERE a.user_id = users.id
                   AND a.issuer = 'local:credential'
                   AND a.account_id = users.id::text
                   AND a.provider_id = 'credential'
                   AND a.password LIKE '$argon2id$%'
                   AND a.access_token IS NULL
                   AND a.refresh_token IS NULL
                   AND a.id_token IS NULL
                   AND a.access_token_expires_at IS NULL
                   AND a.refresh_token_expires_at IS NULL
                   AND a.scope IS NULL
              )
            )::int AS credentials,
            (SELECT count(*)::int FROM accounts) AS account_rows
       FROM users`,
  );
  const counts = userCounts.rows[0];
  assert(counts?.total === 81, 'there must be exactly 81 users');
  assert(counts.employees === 80, 'there must be exactly 80 active employees');
  assert(counts.admins === 1, 'there must be exactly one active admin');
  assert(counts.employee_job_titles === 8, 'employees must be distributed across eight job titles');
  assert(counts.credentials === 81, 'every demo user must have a credential account');
  assert(counts.account_rows === 81, 'there must be exactly one account row per demo user');

  const profiles = await client.query<{
    employee_code: string;
    department_code: string;
    job_title: string;
    role: string;
  }>(
    `SELECT users.employee_code::text AS employee_code,
            department.code AS department_code,
            users.job_title,
            users.role
       FROM users
       JOIN departments AS department ON department.id = users.department_id
      ORDER BY users.employee_code`,
  );
  assert(profiles.rowCount === DEMO_USERS.length, 'every planned user profile must exist');
  const profilesByCode = new Map(
    profiles.rows.map((profile) => [profile.employee_code.toLowerCase(), profile]),
  );
  for (const planned of DEMO_USERS) {
    const profile = profilesByCode.get(planned.employeeCode.toLowerCase());
    assert(profile !== undefined, `profile ${planned.employeeCode} must exist`);
    assert(
      profile.department_code === planned.departmentCode,
      `${planned.employeeCode} department must match`,
    );
    assert(profile.job_title === planned.jobTitle, `${planned.employeeCode} job title must match`);
    assert(profile.role === planned.role, `${planned.employeeCode} role must match`);
  }

  const departments = await client.query<{ code: string; employee_count: number }>(
    `SELECT department.code,
            count(users.id) FILTER (
              WHERE users.role = 'EMPLOYEE' AND users.status = 'ACTIVE'
            )::int AS employee_count
       FROM departments AS department
       LEFT JOIN users ON users.department_id = department.id
      GROUP BY department.code
      ORDER BY department.code`,
  );
  assert(departments.rowCount === 8, 'there must be exactly eight departments');
  assert(
    departments.rows.every((department) => department.employee_count === 10),
    'each department must contain ten active employees',
  );

  const rooms = await client.query<{
    code: string;
    floor: string | null;
    capacity: number;
    active: boolean;
    photo_bytes: number | null;
    equipment: string[];
  }>(
    `SELECT room.code, room.floor, room.capacity, room.active,
            octet_length(room.photo)::int AS photo_bytes,
            array_agg(
              room_feature.feature_key || ':' || room_feature.quantity::text
              ORDER BY room_feature.feature_key
            ) AS equipment
       FROM rooms AS room
       LEFT JOIN room_features AS room_feature ON room_feature.room_id = room.id
      GROUP BY room.id
      ORDER BY room.code`,
  );
  assert(rooms.rowCount === 3, 'there must be exactly three rooms');
  const plannedRooms = new Map(DEMO_ROOMS.map((room) => [room.code, room]));
  for (const room of rooms.rows) {
    const planned = plannedRooms.get(room.code as (typeof DEMO_ROOMS)[number]['code']);
    assert(planned !== undefined, `room ${room.code} must be planned`);
    assert(room.capacity === 20, `${room.code} capacity must be 20`);
    assert(room.floor === planned.floor, `${room.code} floor must be ${planned.floor}`);
    assert(room.active, `${room.code} must be active`);
    assert((room.photo_bytes ?? 0) > 0, `${room.code} must have local photo bytes`);
    assert(
      JSON.stringify(room.equipment) === JSON.stringify(['microphone:1', 'projector:1']),
      `${room.code} must have exactly one microphone and one projector`,
    );
  }

  const hours = await client.query<{
    weekday: number;
    is_open: boolean;
    open_time: string | null;
    close_time: string | null;
  }>(
    `SELECT weekday, is_open,
            open_time::text AS open_time,
            close_time::text AS close_time
       FROM business_hours
      ORDER BY weekday`,
  );
  assert(hours.rowCount === 7, 'business_hours must contain all seven weekdays');
  for (const row of hours.rows) {
    const planned = DEMO_BUSINESS_HOURS[row.weekday - 1];
    assert(planned !== undefined, `weekday ${row.weekday} must be valid`);
    assert(row.is_open === planned.isOpen, `weekday ${row.weekday} open state must match`);
    assert(
      row.open_time === (planned.openTime === null ? null : `${planned.openTime}:00`),
      `weekday ${row.weekday} open time must match`,
    );
    assert(
      row.close_time === (planned.closeTime === null ? null : `${planned.closeTime}:00`),
      `weekday ${row.weekday} close time must match`,
    );
  }

  const settings = await client.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM settings WHERE key = ANY($1::text[]) ORDER BY key',
    [Object.keys(DEMO_SETTINGS)],
  );
  assert(
    settings.rowCount === Object.keys(DEMO_SETTINGS).length,
    'all ten required settings must exist',
  );
  for (const row of settings.rows) {
    const expected = DEMO_SETTINGS[row.key as keyof typeof DEMO_SETTINGS];
    assert(JSON.stringify(row.value) === JSON.stringify(expected), `setting ${row.key} must match`);
  }
}

export type DemoSeedResult = {
  users: number;
  employees: number;
  admins: number;
  rooms: number;
  departments: number;
  credentialsCreated: number;
};

type SeedRunOptions = {
  lockName: string;
  assertIdentity: (identity: DatabaseIdentity) => void;
  targetDescription: string;
};

async function seedCanonicalDatabase(
  environment: DemoSeedEnvironment,
  options: SeedRunOptions,
  progress: Progress = () => {},
): Promise<DemoSeedResult> {
  const photos = await readRoomPhotos();
  const db = createDb(environment.databaseUrl);
  const pool = db.$client;
  let lockClient: PoolClient | undefined;
  let acquired = false;

  try {
    lockClient = await pool.connect();
    await lockClient.query(`SET statement_timeout = '60s'`);
    const lock = await lockClient.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1::text)) AS acquired',
      [options.lockName],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      throw new Error(
        `Another ${options.targetDescription} is already running; no changes were made`,
      );
    }

    const identity = await assertMigratedTarget(lockClient);
    options.assertIdentity(identity);
    const existing = await readExistingState(lockClient);
    assertSafeExistingDemoState(existing);
    progress('Safety preflight passed; target contains only planned identities');

    const departments = await upsertDepartments(pool);
    const credentialsCreated = await createMissingCredentials(
      pool,
      environment,
      departments,
      existing.users,
      progress,
    );
    await normalizeDemoUsers(pool);
    await upsertMasterData(pool, photos);
    assertSafeExistingDemoState(await readExistingState(lockClient));
    await verifyDemoSeed(lockClient);

    return {
      users: DEMO_USERS.length,
      employees: DEMO_EMPLOYEES.length,
      admins: 1,
      rooms: DEMO_ROOMS.length,
      departments: DEMO_DEPARTMENTS.length,
      credentialsCreated,
    };
  } finally {
    if (lockClient !== undefined) {
      if (acquired) {
        try {
          await lockClient.query('SELECT pg_advisory_unlock(hashtext($1::text))', [
            options.lockName,
          ]);
        } catch {
          // A dropped connection releases session advisory locks automatically.
        }
      }
      lockClient.release();
    }
    await pool.end();
  }
}

/** Seed a migrated, dedicated demo database. Never call this with the application's DB URL. */
export async function seedDemoDatabase(
  environment: DemoSeedEnvironment,
  progress: Progress = () => {},
): Promise<DemoSeedResult> {
  assertSafeDemoDatabaseUrl(environment.databaseUrl, process.env.NODE_ENV);
  return seedCanonicalDatabase(
    environment,
    {
      lockName: SEED_LOCK_NAME,
      assertIdentity: ({ databaseName, environment: targetEnvironment }) =>
        assertDemoDatabaseIdentity(databaseName, targetEnvironment),
      targetDescription: 'demo seed',
    },
    progress,
  );
}

export type InitializeDatabaseOptions = {
  databaseName: string;
  databaseEnvironment: 'development' | 'staging' | 'production';
  allowMissingEnvironmentMarker: boolean;
};

/** Initialize a migrated target after its CLI has performed explicit URL/confirmation checks. */
export async function initializeDatabase(
  environment: DemoSeedEnvironment,
  options: InitializeDatabaseOptions,
  progress: Progress = () => {},
): Promise<DemoSeedResult> {
  return seedCanonicalDatabase(
    environment,
    {
      lockName: INITIALIZE_LOCK_NAME,
      assertIdentity: ({ databaseName, environment: databaseEnvironment }) => {
        if (databaseName !== options.databaseName) {
          throw new Error(
            `Connected database ${databaseName} does not match confirmed target ${options.databaseName}`,
          );
        }
        if (
          databaseEnvironment !== options.databaseEnvironment &&
          !(options.allowMissingEnvironmentMarker && databaseEnvironment === null)
        ) {
          throw new Error(
            `Connected database environment marker must equal ${options.databaseEnvironment}`,
          );
        }
      },
      targetDescription: 'database initialization',
    },
    progress,
  );
}

const invokedPath = process.argv[1];
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;

if (isMain) {
  try {
    const environment = readDemoSeedEnvironment(process.env);
    const result = await seedDemoDatabase(environment, (message) => console.info(message));
    console.info(
      `Demo seed complete: ${result.rooms} rooms, ${result.departments} departments, ` +
        `${result.employees} employees, ${result.admins} admin ` +
        `(${result.credentialsCreated} credential accounts created; existing passwords preserved).`,
    );
    console.info(`Admin: ${DEMO_ADMIN.employeeCode} / ${DEMO_ADMIN.email}`);
    console.info(
      'Employee accounts: AU-002–AU-081 (passwords come from demo-only environment values).',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Demo seed failed');
    process.exitCode = 1;
  }
}
