/**
 * Deterministic, synthetic data for the employee-flow demo.
 *
 * Email addresses deliberately use the RFC 2606 `.example` namespace. They can never be
 * delivered to a real employee or confused with production identity data.
 */

export const DEMO_DEPARTMENTS = [
  { code: 'EXEC', name: 'ฝ่ายบริหาร' },
  { code: 'HR', name: 'ฝ่ายทรัพยากรบุคคล' },
  { code: 'FIN', name: 'ฝ่ายการเงิน' },
  { code: 'SALES', name: 'ฝ่ายขาย' },
  { code: 'MKT', name: 'ฝ่ายการตลาด' },
  { code: 'ENG', name: 'ฝ่ายวิศวกรรมและไอที' },
  { code: 'OPS', name: 'ฝ่ายปฏิบัติการ' },
  { code: 'CS', name: 'ฝ่ายบริการลูกค้า' },
] as const;

export type DemoDepartmentCode = (typeof DEMO_DEPARTMENTS)[number]['code'];

export type DemoUser = {
  employeeCode: string;
  fullName: string;
  email: string;
  departmentCode: DemoDepartmentCode;
  jobTitle: string;
  role: 'ADMIN' | 'EMPLOYEE';
};

const padEmployeeNumber = (number: number): string => number.toString().padStart(3, '0');

export const DEMO_JOB_TITLES = [
  'ผู้จัดการ',
  'ผู้ช่วยผู้จัดการ',
  'หัวหน้าทีม',
  'เจ้าหน้าที่อาวุโส',
  'เจ้าหน้าที่',
  'นักวิเคราะห์',
  'ผู้ประสานงาน',
  'ผู้เชี่ยวชาญ',
] as const;

/**
 * Stable pseudo-random assignment keeps database initialization repeatable while making the
 * employee list look naturally mixed. Multipliers are coprime to eight, so every department
 * and job title still receives exactly ten employees.
 */
export const DEMO_EMPLOYEES: readonly DemoUser[] = Array.from({ length: 80 }, (_, index) => {
  const number = index + 2;
  const padded = padEmployeeNumber(number);
  const department = DEMO_DEPARTMENTS[(index * 5 + 3) % DEMO_DEPARTMENTS.length];
  const jobTitle =
    DEMO_JOB_TITLES[
      (index * 3 + Math.floor(index / DEMO_JOB_TITLES.length)) % DEMO_JOB_TITLES.length
    ];
  if (department === undefined || jobTitle === undefined) {
    throw new Error('Demo employee assignment is incomplete');
  }
  return {
    employeeCode: `AU-${padded}`,
    fullName: `Demo Employee ${padded}`,
    email: `au${padded}@demo.reserveflow.example`,
    departmentCode: department.code,
    jobTitle,
    role: 'EMPLOYEE' as const,
  };
});

export const DEMO_ADMIN: DemoUser = {
  employeeCode: 'AU-001',
  fullName: 'Demo Administrator',
  email: 'admin@demo.reserveflow.example',
  departmentCode: 'EXEC',
  jobTitle: 'ผู้ดูแลระบบ',
  role: 'ADMIN',
};

export const DEMO_USERS: readonly DemoUser[] = [DEMO_ADMIN, ...DEMO_EMPLOYEES];

export const DEMO_FEATURES = [
  { key: 'microphone', name: 'Microphone', icon: 'mic' },
  { key: 'projector', name: 'Projector', icon: 'projector' },
] as const;

export const DEMO_ROOMS = [
  {
    code: 'horizon',
    name: 'Horizon Room',
    floor: '4',
    location: 'Executive Boardroom',
    description: 'ห้องประชุมผู้บริหารพร้อมวิวเมืองแบบพาโนรามาและอุปกรณ์สำหรับการนำเสนอ',
    capacity: 20,
    photoAsset: 'room-horizon-card.jpg',
  },
  {
    code: 'summit',
    name: 'Summit Room',
    floor: '5',
    location: 'Creative Space',
    description: 'ห้องประชุมสว่างทันสมัย เหมาะสำหรับเวิร์กช็อปและการทำงานร่วมกัน',
    capacity: 20,
    photoAsset: 'room-summit.jpg',
  },
  {
    code: 'grove',
    name: 'Grove Room',
    floor: '2',
    location: 'Garden Wing',
    description: 'ห้องประชุมบรรยากาศสงบ พร้อมวิวสวนและแสงธรรมชาติที่นุ่มนวล',
    capacity: 20,
    photoAsset: 'room-grove.jpg',
  },
] as const;

/** Every room gets this exact set; no inherited or room-specific extras. */
export const DEMO_ROOM_FEATURES = [
  { key: 'microphone', quantity: 1 },
  { key: 'projector', quantity: 1 },
] as const;

/** All ten required policy keys from SettingsSchema. */
export const DEMO_SETTINGS = {
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
} as const;

export const DEMO_BUSINESS_HOURS = Array.from({ length: 7 }, (_, index) => {
  const weekday = index + 1;
  const isOpen = weekday <= 5;
  return {
    weekday,
    isOpen,
    openTime: isOpen ? '08:30' : null,
    closeTime: isOpen ? '17:30' : null,
  };
});

export type DemoSeedEnvironment = {
  databaseUrl: string;
  authSecret: string;
  adminPassword: string;
  employeePassword: string;
};

type EnvironmentSource = Record<string, string | undefined>;

const productionMarker = /(^|[._/-])(prod|production|live)(?=$|[._/-])/i;

function required(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(`${name} is required for the demo seed`);
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

/** Validate again at the execution boundary so callers cannot bypass the production guard. */
export function assertSafeDemoDatabaseUrl(databaseUrl: string, nodeEnvironment?: string): void {
  if (nodeEnvironment?.trim().toLowerCase() === 'production') {
    throw new Error('The demo seed is disabled when NODE_ENV=production');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DEMO_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DEMO_DATABASE_URL must use postgres:// or postgresql://');
  }
  if (parsed.port === '6543') {
    throw new Error('DEMO_DATABASE_URL cannot use the Supabase transaction pooler on port 6543');
  }
  if (parsed.searchParams.get('sslmode')?.toLowerCase() === 'disable') {
    throw new Error('DEMO_DATABASE_URL cannot disable TLS');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName.endsWith('_demo')) {
    throw new Error('DEMO_DATABASE_URL database name must end with `_demo`');
  }
  if (productionMarker.test(parsed.hostname) || productionMarker.test(parsed.pathname)) {
    throw new Error('DEMO_DATABASE_URL looks production-like; the demo seed refuses this target');
  }
}

/** The connected server must independently identify the target as a demo database. */
export function assertDemoDatabaseIdentity(
  databaseName: string,
  databaseEnvironment: string | null,
): void {
  if (!databaseName.endsWith('_demo')) {
    throw new Error('Connected database name must end with `_demo`; refusing demo seed');
  }
  if (productionMarker.test(databaseName)) {
    throw new Error('Connected database name looks production-like; refusing demo seed');
  }
  if (databaseEnvironment !== 'demo') {
    throw new Error(
      "Connected database must set reserveflow.environment='demo'; refusing demo seed",
    );
  }
}

/**
 * Seed-only environment validation. DATABASE_URL is intentionally never read here: a typo in
 * DEMO_DATABASE_URL must stop rather than silently target the application's normal database.
 */
export function readDemoSeedEnvironment(source: EnvironmentSource): DemoSeedEnvironment {
  const databaseUrl = required(source, 'DEMO_DATABASE_URL');
  assertSafeDemoDatabaseUrl(databaseUrl, source.NODE_ENV);

  const authSecret = required(source, 'BETTER_AUTH_SECRET');
  if (authSecret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  }

  return {
    databaseUrl,
    authSecret,
    adminPassword: password(source, 'DEMO_ADMIN_PASSWORD'),
    employeePassword: password(source, 'DEMO_EMPLOYEE_PASSWORD'),
  };
}

export type ExistingDemoUser = {
  email: string;
  employeeCode: string;
  hasCredential: boolean;
  accountCount: number;
};

export const DEMO_OPERATIONAL_TABLES = [
  'bookings',
  'booking_attendees',
  'sessions',
  'verifications',
  'password_setup_tokens',
  'notifications',
  'audit_logs',
  'holidays',
] as const;

export type DemoOperationalTable = (typeof DEMO_OPERATIONAL_TABLES)[number];

export const EMPTY_DEMO_OPERATIONAL_ROWS: Readonly<Record<DemoOperationalTable, number>> = {
  bookings: 0,
  booking_attendees: 0,
  sessions: 0,
  verifications: 0,
  password_setup_tokens: 0,
  notifications: 0,
  audit_logs: 0,
  holidays: 0,
};

export type ExistingDemoState = {
  users: readonly ExistingDemoUser[];
  roomCodes: readonly string[];
  departmentCodes: readonly string[];
  operationalRows: Readonly<Record<DemoOperationalTable, number>>;
};

const identityKey = (user: Pick<DemoUser, 'email' | 'employeeCode'>): string =>
  `${user.employeeCode.toUpperCase()}\u0000${user.email.toLowerCase()}`;

function preview(values: readonly string[]): string {
  const shown = values.slice(0, 5).join(', ');
  return values.length > 5 ? `${shown}, … (+${values.length - 5})` : shown;
}

/**
 * Refuse mixed/real databases before the first write. Existing planned users are preserved,
 * including their password hashes; a partial identity without a credential is an error rather
 * than an excuse to overwrite its authentication state.
 */
export function assertSafeExistingDemoState(state: ExistingDemoState): void {
  const plannedIdentities = new Set(DEMO_USERS.map(identityKey));
  const unplannedUsers = state.users.filter((user) => !plannedIdentities.has(identityKey(user)));
  if (unplannedUsers.length > 0) {
    throw new Error(
      `Refusing demo seed: ${unplannedUsers.length} unplanned user row(s) found (identifiers withheld)`,
    );
  }

  const usersWithUnsafeAccounts = state.users
    .filter((user) => !user.hasCredential || user.accountCount !== 1)
    .map((user) => user.employeeCode);
  if (usersWithUnsafeAccounts.length > 0) {
    throw new Error(
      `Refusing demo seed: existing users must have exactly one canonical credential account; passwords will not be reset (${preview(usersWithUnsafeAccounts)})`,
    );
  }

  const plannedRooms = new Set<string>(DEMO_ROOMS.map((room) => room.code));
  const unplannedRooms = state.roomCodes.filter((code) => !plannedRooms.has(code));
  if (unplannedRooms.length > 0) {
    throw new Error(`Refusing demo seed: unplanned rooms found (${preview(unplannedRooms)})`);
  }

  const plannedDepartments = new Set<string>(DEMO_DEPARTMENTS.map((department) => department.code));
  const unplannedDepartments = state.departmentCodes.filter(
    (code) => !plannedDepartments.has(code),
  );
  if (unplannedDepartments.length > 0) {
    throw new Error(
      `Refusing demo seed: unplanned departments found (${preview(unplannedDepartments)})`,
    );
  }

  const populatedOperationalTables = DEMO_OPERATIONAL_TABLES.filter(
    (table) => state.operationalRows[table] !== 0,
  );
  if (populatedOperationalTables.length > 0) {
    throw new Error(
      `Refusing demo seed: operational data found (${preview(
        populatedOperationalTables.map(
          (table) => `${table}=${state.operationalRows[table].toString()}`,
        ),
      )})`,
    );
  }
}

export function missingDemoUsers(existing: readonly ExistingDemoUser[]): readonly DemoUser[] {
  const present = new Set(existing.map(identityKey));
  return DEMO_USERS.filter((user) => !present.has(identityKey(user)));
}
