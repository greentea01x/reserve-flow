import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  assertDemoDatabaseIdentity,
  assertSafeExistingDemoState,
  DEMO_ADMIN,
  DEMO_BUSINESS_HOURS,
  DEMO_DEPARTMENTS,
  DEMO_EMPLOYEES,
  DEMO_JOB_TITLES,
  DEMO_OPERATIONAL_TABLES,
  DEMO_ROOM_FEATURES,
  DEMO_ROOMS,
  DEMO_SETTINGS,
  DEMO_USERS,
  EMPTY_DEMO_OPERATIONAL_ROWS,
  type ExistingDemoState,
  missingDemoUsers,
  readDemoSeedEnvironment,
} from '../src/db/demo-seed.js';
import { parseInitializeArguments, readInitializeEnvironment } from '../src/db/initialize.js';

const validEnvironment = {
  NODE_ENV: 'development',
  DEMO_DATABASE_URL: 'postgresql://rf_app:secret@127.0.0.1:5432/reserveflow_demo',
  DATABASE_URL: 'postgresql://must:not@be-used.example/production',
  BETTER_AUTH_SECRET: 'demo-auth-secret-that-is-at-least-32-chars',
  DEMO_ADMIN_PASSWORD: 'demo-admin-password-1',
  DEMO_EMPLOYEE_PASSWORD: 'demo-employee-password-1',
};

const validInitializeEnvironment = {
  NODE_ENV: 'development',
  INITIALIZE_DATABASE_URL: 'postgresql://rf_owner:secret@127.0.0.1:5432/reserveflow',
  INITIALIZE_ENVIRONMENT: 'development',
  INITIALIZE_CONFIRM: 'initialize:reserveflow',
  INITIALIZE_ADMIN_PASSWORD: 'initialize-admin-password-1',
  INITIALIZE_EMPLOYEE_PASSWORD: 'initialize-employee-password-1',
  BETTER_AUTH_SECRET: 'initialize-auth-secret-that-is-at-least-32-chars',
  // Neither is an initializer fallback if INITIALIZE_DATABASE_URL is absent.
  DATABASE_URL: 'postgresql://must:not@be-used.example/production',
  DATABASE_URL_MIGRATE: 'postgresql://must:not@be-used.example/production',
};

const emptyState: ExistingDemoState = {
  users: [],
  roomCodes: [],
  departmentCodes: [],
  operationalRows: EMPTY_DEMO_OPERATIONAL_ROWS,
};

describe('demo seed manifest', () => {
  it('defines exactly three equal-capacity rooms with identical equipment', () => {
    expect(DEMO_ROOMS.map(({ code, floor, capacity }) => ({ code, floor, capacity }))).toEqual([
      { code: 'horizon', floor: '4', capacity: 20 },
      { code: 'summit', floor: '5', capacity: 20 },
      { code: 'grove', floor: '2', capacity: 20 },
    ]);
    expect(DEMO_ROOM_FEATURES).toEqual([
      { key: 'microphone', quantity: 1 },
      { key: 'projector', quantity: 1 },
    ]);
    expect(DEMO_ROOMS.map(({ code, photoAsset }) => ({ code, photoAsset }))).toEqual([
      { code: 'horizon', photoAsset: 'room-horizon-card.jpg' },
      { code: 'summit', photoAsset: 'room-summit.jpg' },
      { code: 'grove', photoAsset: 'room-grove.jpg' },
    ]);
  });

  it('defines Thai descriptions for all three demo rooms', () => {
    expect(DEMO_ROOMS.map(({ code, description }) => ({ code, description }))).toEqual([
      {
        code: 'horizon',
        description: 'ห้องประชุมผู้บริหารพร้อมวิวเมืองแบบพาโนรามาและอุปกรณ์สำหรับการนำเสนอ',
      },
      {
        code: 'summit',
        description: 'ห้องประชุมสว่างทันสมัย เหมาะสำหรับเวิร์กช็อปและการทำงานร่วมกัน',
      },
      {
        code: 'grove',
        description: 'ห้องประชุมบรรยากาศสงบ พร้อมวิวสวนและแสงธรรมชาติที่นุ่มนวล',
      },
    ]);
  });

  it('defines 80 employees, one admin and ten employees in every canonical department', () => {
    expect(DEMO_DEPARTMENTS.map(({ code }) => code)).toEqual([
      'EXEC',
      'HR',
      'FIN',
      'SALES',
      'MKT',
      'ENG',
      'OPS',
      'CS',
    ]);
    expect(DEMO_USERS).toHaveLength(81);
    expect(DEMO_EMPLOYEES).toHaveLength(80);
    expect(DEMO_ADMIN).toMatchObject({
      employeeCode: 'AU-001',
      departmentCode: 'EXEC',
      jobTitle: 'ผู้ดูแลระบบ',
      role: 'ADMIN',
    });
    expect(DEMO_USERS.filter((user) => user.role === 'ADMIN')).toEqual([DEMO_ADMIN]);
    expect(DEMO_EMPLOYEES.every((employee) => employee.role === 'EMPLOYEE')).toBe(true);
    expect(DEMO_EMPLOYEES.map((employee) => employee.employeeCode)).toEqual(
      Array.from({ length: 80 }, (_, index) => `AU-${(index + 2).toString().padStart(3, '0')}`),
    );

    for (const department of DEMO_DEPARTMENTS) {
      expect(
        DEMO_EMPLOYEES.filter((employee) => employee.departmentCode === department.code),
      ).toHaveLength(10);
    }

    expect(new Set(DEMO_USERS.map((user) => user.employeeCode))).toHaveLength(81);
    expect(new Set(DEMO_USERS.map((user) => user.email))).toHaveLength(81);
    expect(DEMO_USERS.every((user) => user.email.endsWith('.example'))).toBe(true);
  });

  it('uses stable, evenly distributed department and Thai job-title assignments', () => {
    expect(DEMO_JOB_TITLES).toEqual([
      'ผู้จัดการ',
      'ผู้ช่วยผู้จัดการ',
      'หัวหน้าทีม',
      'เจ้าหน้าที่อาวุโส',
      'เจ้าหน้าที่',
      'นักวิเคราะห์',
      'ผู้ประสานงาน',
      'ผู้เชี่ยวชาญ',
    ]);

    for (const jobTitle of DEMO_JOB_TITLES) {
      expect(DEMO_EMPLOYEES.filter((employee) => employee.jobTitle === jobTitle)).toHaveLength(10);
    }

    const assignments = DEMO_EMPLOYEES.map(({ employeeCode, departmentCode, jobTitle }) => ({
      employeeCode,
      departmentCode,
      jobTitle,
    }));
    expect(assignments.slice(0, 8)).toEqual([
      { employeeCode: 'AU-002', departmentCode: 'SALES', jobTitle: 'ผู้จัดการ' },
      {
        employeeCode: 'AU-003',
        departmentCode: 'EXEC',
        jobTitle: 'เจ้าหน้าที่อาวุโส',
      },
      { employeeCode: 'AU-004', departmentCode: 'ENG', jobTitle: 'ผู้ประสานงาน' },
      {
        employeeCode: 'AU-005',
        departmentCode: 'FIN',
        jobTitle: 'ผู้ช่วยผู้จัดการ',
      },
      { employeeCode: 'AU-006', departmentCode: 'CS', jobTitle: 'เจ้าหน้าที่' },
      { employeeCode: 'AU-007', departmentCode: 'MKT', jobTitle: 'ผู้เชี่ยวชาญ' },
      { employeeCode: 'AU-008', departmentCode: 'HR', jobTitle: 'หัวหน้าทีม' },
      { employeeCode: 'AU-009', departmentCode: 'OPS', jobTitle: 'นักวิเคราะห์' },
    ]);
    expect(createHash('sha256').update(JSON.stringify(assignments)).digest('hex')).toBe(
      '7d59eb342cd820d4dd8ad142a04491f235b1575cf0bf7291b2133da41d75b0c2',
    );
  });

  it('defines all policy defaults and weekday-only 08:30–17:30 hours', () => {
    expect(DEMO_SETTINGS).toEqual({
      slot_increment_minutes: 30,
      min_duration_minutes: 60,
      max_duration_minutes: null,
      buffer_minutes: 0,
      max_advance_days: 30,
      min_lead_minutes: 0,
      checkin_open_before_minutes: 15,
      checkin_grace_minutes: 15,
      auto_release_enabled: true,
      reminder_minutes_before: 15,
    });
    expect(DEMO_BUSINESS_HOURS).toEqual([
      { weekday: 1, isOpen: true, openTime: '08:30', closeTime: '17:30' },
      { weekday: 2, isOpen: true, openTime: '08:30', closeTime: '17:30' },
      { weekday: 3, isOpen: true, openTime: '08:30', closeTime: '17:30' },
      { weekday: 4, isOpen: true, openTime: '08:30', closeTime: '17:30' },
      { weekday: 5, isOpen: true, openTime: '08:30', closeTime: '17:30' },
      { weekday: 6, isOpen: false, openTime: null, closeTime: null },
      { weekday: 7, isOpen: false, openTime: null, closeTime: null },
    ]);
  });

  it('references real local JPEG bytes from the downloaded Stitch handoff', async () => {
    const assetRoot = new URL(
      '../../../docs/stitch/pastel-corporate-room-manager/assets/',
      import.meta.url,
    );
    for (const room of DEMO_ROOMS) {
      const bytes = await readFile(new URL(room.photoAsset, assetRoot));
      expect([...bytes.subarray(0, 3)], room.photoAsset).toEqual([0xff, 0xd8, 0xff]);
      expect(bytes.byteLength, room.photoAsset).toBeGreaterThan(1_000);
    }
  });
});

describe('demo seed safety', () => {
  it('requires DEMO_DATABASE_URL and never falls back to DATABASE_URL', () => {
    const { DEMO_DATABASE_URL: _, ...withoutDemoUrl } = validEnvironment;
    expect(() => readDemoSeedEnvironment(withoutDemoUrl)).toThrow('DEMO_DATABASE_URL is required');
  });

  it('refuses production mode, production-like targets and unsafe pool/TLS URLs', () => {
    expect(() => readDemoSeedEnvironment({ ...validEnvironment, NODE_ENV: 'production' })).toThrow(
      'disabled when NODE_ENV=production',
    );
    expect(() =>
      readDemoSeedEnvironment({
        ...validEnvironment,
        DEMO_DATABASE_URL: 'postgresql://rf_app:secret@db.prod.example/reserveflow_demo',
      }),
    ).toThrow('looks production-like');
    expect(() =>
      readDemoSeedEnvironment({
        ...validEnvironment,
        DEMO_DATABASE_URL: 'postgresql://rf_app:secret@db.example:6543/reserveflow_demo',
      }),
    ).toThrow('transaction pooler');
    expect(() =>
      readDemoSeedEnvironment({
        ...validEnvironment,
        DEMO_DATABASE_URL:
          'postgresql://rf_app:secret@db.example:5432/reserveflow_demo?sslmode=disable',
      }),
    ).toThrow('cannot disable TLS');
  });

  it('requires both an unmistakable demo name and the independent database marker', () => {
    expect(() =>
      readDemoSeedEnvironment({
        ...validEnvironment,
        DEMO_DATABASE_URL: 'postgresql://rf_app:secret@127.0.0.1:5432/postgres',
      }),
    ).toThrow('database name must end with `_demo`');

    expect(() => assertDemoDatabaseIdentity('reserveflow_demo', 'demo')).not.toThrow();
    expect(() => assertDemoDatabaseIdentity('postgres', 'demo')).toThrow('must end with `_demo`');
    expect(() => assertDemoDatabaseIdentity('reserveflow_demo', null)).toThrow(
      "reserveflow.environment='demo'",
    );
    expect(() => assertDemoDatabaseIdentity('reserveflow_demo', 'staging')).toThrow(
      "reserveflow.environment='demo'",
    );
    expect(() => assertDemoDatabaseIdentity('reserveflow_demo', 'DEMO')).toThrow(
      "reserveflow.environment='demo'",
    );
    expect(() => assertDemoDatabaseIdentity('prod_demo', 'demo')).toThrow('looks production-like');
  });

  it('accepts an explicit non-production target and validates seed-only passwords', () => {
    expect(readDemoSeedEnvironment(validEnvironment)).toMatchObject({
      databaseUrl: validEnvironment.DEMO_DATABASE_URL,
      adminPassword: validEnvironment.DEMO_ADMIN_PASSWORD,
      employeePassword: validEnvironment.DEMO_EMPLOYEE_PASSWORD,
    });
    expect(() =>
      readDemoSeedEnvironment({ ...validEnvironment, DEMO_EMPLOYEE_PASSWORD: 'too-short' }),
    ).toThrow('DEMO_EMPLOYEE_PASSWORD must be between 10 and 128 characters');
  });

  it('permits an empty database and preserves planned users on rerun', () => {
    expect(() => assertSafeExistingDemoState(emptyState)).not.toThrow();
    expect(missingDemoUsers(emptyState.users)).toHaveLength(81);

    const existing = {
      ...emptyState,
      users: [
        {
          email: DEMO_USERS[0]?.email ?? '',
          employeeCode: DEMO_USERS[0]?.employeeCode ?? '',
          hasCredential: true,
          accountCount: 1,
        },
      ],
    };
    expect(() => assertSafeExistingDemoState(existing)).not.toThrow();
    expect(missingDemoUsers(existing.users)).toHaveLength(80);
  });

  it('aborts before writes for unplanned identities, rooms or departments', () => {
    expect(() =>
      assertSafeExistingDemoState({
        ...emptyState,
        users: [
          {
            email: 'real.person@example.org',
            employeeCode: 'REAL001',
            hasCredential: true,
            accountCount: 1,
          },
        ],
      }),
    ).toThrow('unplanned user row(s) found');
    expect(() =>
      assertSafeExistingDemoState({ ...emptyState, roomCodes: ['unplanned-room'] }),
    ).toThrow('unplanned rooms found');
    expect(() =>
      assertSafeExistingDemoState({ ...emptyState, departmentCodes: ['OTHER'] }),
    ).toThrow('unplanned departments found');
  });

  it('refuses to repair an existing account by replacing its password', () => {
    const planned = DEMO_USERS[0];
    expect(planned).toBeDefined();
    expect(() =>
      assertSafeExistingDemoState({
        ...emptyState,
        users: [
          {
            email: planned?.email ?? '',
            employeeCode: planned?.employeeCode ?? '',
            hasCredential: false,
            accountCount: 0,
          },
        ],
      }),
    ).toThrow('passwords will not be reset');
  });

  it('refuses extra or non-canonical account rows for an otherwise planned user', () => {
    const planned = DEMO_USERS[0];
    expect(planned).toBeDefined();
    expect(() =>
      assertSafeExistingDemoState({
        ...emptyState,
        users: [
          {
            email: planned?.email ?? '',
            employeeCode: planned?.employeeCode ?? '',
            hasCredential: true,
            accountCount: 2,
          },
        ],
      }),
    ).toThrow('exactly one canonical credential account');
  });

  it('refuses every kind of operational history', () => {
    for (const table of DEMO_OPERATIONAL_TABLES) {
      expect(() =>
        assertSafeExistingDemoState({
          ...emptyState,
          operationalRows: { ...EMPTY_DEMO_OPERATIONAL_ROWS, [table]: 1 },
        }),
      ).toThrow(`operational data found (${table}=1)`);
    }
  });
});

describe('database initialize CLI safety', () => {
  it('requires the explicit --apply switch and rejects every other option', () => {
    expect(parseInitializeArguments(['--apply'])).toEqual({ apply: true });
    expect(() => parseInitializeArguments([])).toThrow('no-op unless --apply is provided');
    expect(() => parseInitializeArguments(['--reset'])).toThrow(
      'Unknown database initialization option: --reset',
    );
    expect(() => parseInitializeArguments(['--apply', '--force'])).toThrow(
      'Unknown database initialization option: --force',
    );
  });

  it('requires INITIALIZE_DATABASE_URL and never falls back to application or migration URLs', () => {
    const { INITIALIZE_DATABASE_URL: _, ...withoutInitializeUrl } = validInitializeEnvironment;
    expect(() => readInitializeEnvironment(withoutInitializeUrl)).toThrow(
      'INITIALIZE_DATABASE_URL is required',
    );
  });

  it.each([
    ['not-a-url', 'valid PostgreSQL URL'],
    ['https://db.example/reserveflow', 'must use postgres:// or postgresql://'],
    [
      'postgresql://rf_owner:secret@db.example:6543/reserveflow',
      'cannot use the Supabase transaction pooler',
    ],
    [
      'postgresql://rf_owner:secret@db.example:5432/reserveflow?sslmode=DISABLE',
      'cannot disable TLS',
    ],
    ['postgresql://rf_owner:secret@127.0.0.1:5432', 'must identify one PostgreSQL database'],
    [
      'postgresql://rf_owner:secret@127.0.0.1:5432/reserveflow%2Fnested',
      'must identify one PostgreSQL database',
    ],
  ])('rejects an unsafe initializer URL (%s)', (databaseUrl, expectedMessage) => {
    expect(() =>
      readInitializeEnvironment({
        ...validInitializeEnvironment,
        INITIALIZE_DATABASE_URL: databaseUrl,
      }),
    ).toThrow(expectedMessage);
  });

  it('requires a declared environment and confirmation tied to the decoded database name', () => {
    expect(() =>
      readInitializeEnvironment({ ...validInitializeEnvironment, INITIALIZE_ENVIRONMENT: 'qa' }),
    ).toThrow('INITIALIZE_ENVIRONMENT must be development, staging, or production');
    expect(() =>
      readInitializeEnvironment({
        ...validInitializeEnvironment,
        INITIALIZE_CONFIRM: 'initialize:another_database',
      }),
    ).toThrow('INITIALIZE_CONFIRM must equal initialize:reserveflow');

    expect(
      readInitializeEnvironment({
        ...validInitializeEnvironment,
        INITIALIZE_DATABASE_URL: 'postgresql://rf_owner:secret@127.0.0.1:5432/reserveflow%5Ftest',
        INITIALIZE_CONFIRM: 'initialize:reserveflow_test',
      }).databaseName,
    ).toBe('reserveflow_test');
  });

  it.each([
    {
      INITIALIZE_ENVIRONMENT: 'production',
      INITIALIZE_DATABASE_URL: 'postgresql://rf_owner:secret@db.example:5432/reserveflow',
      INITIALIZE_CONFIRM: 'initialize:reserveflow',
    },
    {
      NODE_ENV: 'production',
      INITIALIZE_ENVIRONMENT: 'staging',
      INITIALIZE_DATABASE_URL: 'postgresql://rf_owner:secret@db.example:5432/reserveflow',
      INITIALIZE_CONFIRM: 'initialize:reserveflow',
    },
    {
      INITIALIZE_ENVIRONMENT: 'staging',
      INITIALIZE_DATABASE_URL: 'postgresql://rf_owner:secret@db.prod.example:5432/reserveflow',
      INITIALIZE_CONFIRM: 'initialize:reserveflow',
    },
    {
      INITIALIZE_ENVIRONMENT: 'staging',
      INITIALIZE_DATABASE_URL: 'postgresql://rf_owner:secret@db.example:5432/reserveflow_live',
      INITIALIZE_CONFIRM: 'initialize:reserveflow_live',
    },
  ])('requires a second opt-in for every production-like signal', (overrides) => {
    expect(() =>
      readInitializeEnvironment({ ...validInitializeEnvironment, ...overrides }),
    ).toThrow('Production-like initialization requires INITIALIZE_ALLOW_PRODUCTION=true');
  });

  it('accepts an explicitly confirmed production target and preserves its environment label', () => {
    expect(
      readInitializeEnvironment({
        ...validInitializeEnvironment,
        NODE_ENV: 'production',
        INITIALIZE_DATABASE_URL:
          'postgresql://rf_owner:secret@db.prod.example:5432/reserveflow_prod?sslmode=verify-full',
        INITIALIZE_ENVIRONMENT: 'production',
        INITIALIZE_ALLOW_PRODUCTION: 'true',
        INITIALIZE_CONFIRM: 'initialize:reserveflow_prod',
      }),
    ).toMatchObject({
      databaseName: 'reserveflow_prod',
      databaseEnvironment: 'production',
      loopback: false,
    });
  });

  it.each([
    ['localhost', true],
    ['127.0.0.2', true],
    ['[::1]', true],
    ['127.0.0.1.example', false],
    ['db.example', false],
  ])('classifies initializer host %s as loopback=%s', (hostname, loopback) => {
    expect(
      readInitializeEnvironment({
        ...validInitializeEnvironment,
        INITIALIZE_DATABASE_URL: `postgresql://rf_owner:secret@${hostname}:5432/reserveflow`,
      }).loopback,
    ).toBe(loopback);
  });

  it('requires strong, distinct initializer credentials', () => {
    expect(() =>
      readInitializeEnvironment({ ...validInitializeEnvironment, BETTER_AUTH_SECRET: 'too-short' }),
    ).toThrow('BETTER_AUTH_SECRET must contain at least 32 characters');
    expect(() =>
      readInitializeEnvironment({
        ...validInitializeEnvironment,
        INITIALIZE_ADMIN_PASSWORD: 'too-short',
      }),
    ).toThrow('INITIALIZE_ADMIN_PASSWORD must be between 10 and 128 characters');
    expect(() =>
      readInitializeEnvironment({
        ...validInitializeEnvironment,
        INITIALIZE_EMPLOYEE_PASSWORD: validInitializeEnvironment.INITIALIZE_ADMIN_PASSWORD,
      }),
    ).toThrow('Admin and employee initialization passwords must be different');
  });

  it('returns only the explicitly supplied initializer configuration', () => {
    expect(readInitializeEnvironment(validInitializeEnvironment)).toEqual({
      databaseUrl: validInitializeEnvironment.INITIALIZE_DATABASE_URL,
      databaseName: 'reserveflow',
      databaseEnvironment: 'development',
      loopback: true,
      authSecret: validInitializeEnvironment.BETTER_AUTH_SECRET,
      adminPassword: validInitializeEnvironment.INITIALIZE_ADMIN_PASSWORD,
      employeePassword: validInitializeEnvironment.INITIALIZE_EMPLOYEE_PASSWORD,
    });
  });
});
