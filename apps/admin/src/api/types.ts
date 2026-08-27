// Hand-written response shapes from the ADMIN API contract (apps/api route files are the
// source). Timestamps arrive rendered at +07:00, never `Z` — parse them, never re-shift,
// and never display the offset.
import type { BookingStatus, Role, UserStatus } from '@reserveflow/shared';

export interface Department {
  id: string;
  code: string;
  name: string;
}

export interface User {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  mobile: string | null;
  role: Role;
  status: UserStatus;
  department_id: string;
  last_login_at: string | null;
}

/** GET /api/v1/me — requireAuth, NOT requireAdmin: an EMPLOYEE gets a normal 200 here. */
export interface Me {
  user: User;
  department: Department;
  capabilities: { demo_check_in: boolean };
  session?: { expires_at: string };
}

export interface RoomFeature {
  key: string;
  name: string;
  icon: string | null;
  quantity: number;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  floor: string | null;
  location: string | null;
  description: string | null;
  capacity: number;
  photo_url: string | null;
  active: boolean;
  features: RoomFeature[];
  created_at: string;
  updated_at: string;
}

/** GET /features — the ONLY source of accepted feature keys (A7's chips). */
export interface FeatureCatalogEntry {
  key: string;
  name: string;
  icon: string | null;
}

/** Slim room shape used by /calendar. */
export interface RoomRef {
  id: string;
  code: string;
  name: string;
  floor: string | null;
  capacity: number;
}

export interface BusinessHour {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  is_open: boolean;
  /** "HH:MM:SS" — Postgres `time`. */
  open_time: string | null;
  close_time: string | null;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface Settings {
  slot_increment_minutes: number;
  min_duration_minutes: number;
  max_duration_minutes: number | null;
  buffer_minutes: number;
  max_advance_days: number;
  min_lead_minutes: number;
  checkin_open_before_minutes: number;
  checkin_grace_minutes: number;
  auto_release_enabled: boolean;
  reminder_minutes_before: number;
}

export interface SettingsResponse {
  settings: Settings;
  business_hours: BusinessHour[];
  /** Spans this year AND next — filter client-side. */
  holidays: Holiday[];
  server_time: string;
}

/**
 * GET /settings carries an `ETag` header covering settings + business_hours + holidays
 * TOGETHER, and PUT /admin/settings requires it back as `If-Match`. It is the only
 * optimistic-concurrency mechanism in the whole API, so the read has to keep the header.
 */
export interface SettingsDocument extends SettingsResponse {
  etag: string | null;
}

/** GET /admin/users — `bookings_count` is what tells the UI whether DELETE will be refused. */
export interface AdminUser {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  mobile: string | null;
  role: Role;
  status: UserStatus;
  department: Department;
  last_login_at: string | null;
  disabled_at: string | null;
  created_at: string;
  bookings_count: number;
}

export interface AdminUsersResponse {
  data: AdminUser[];
  page: PageInfo;
}

/** GET /admin/users/:id — the list shape plus the 5 most recent bookings. */
export interface AdminUserDetail extends AdminUser {
  recent_bookings: BookingView[];
}

/** POST /admin/users/:id/deactivate — the cascade, reported as real rows. */
export interface DeactivateResponse {
  user: AdminUser;
  cancelled_bookings: {
    id: string;
    start_at: string;
    end_at: string;
    room: { id: string; code: string; name: string };
    status_before: 'CONFIRMED' | 'CHECKED_IN';
  }[];
}

export type ImportAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';

/** POST /admin/users/import — identical shape for the dry run and the real run. */
export interface ImportResult {
  summary: { rows: number; create: number; update: number; skip: number; error: number };
  rows: {
    /** Spreadsheet row number; the header is line 1. */
    line: number;
    employee_code: string;
    action: ImportAction;
    /** ERROR rows only. */
    message?: string;
  }[];
}

/** GET /departments — unpaginated, ordered by code. */
export interface DepartmentOption extends Department {
  active: boolean;
}

export interface Owner {
  id: string;
  full_name: string;
  department: Department | null;
}

export interface Attendee {
  email: string;
  name: string | null;
}

export type BookingHistoryEventName =
  | 'CREATED'
  | 'RESCHEDULED'
  | 'CHECKED_IN'
  | 'CANCELLED'
  | 'AUTO_RELEASED'
  | 'COMPLETED';

export interface BookingHistoryEvent {
  event: BookingHistoryEventName;
  at: string;
  /** null actor = ระบบ. */
  actor: { id: string; full_name: string } | null;
}

export interface BookingCan {
  edit: boolean;
  reschedule: boolean;
  cancel: boolean;
  check_in: boolean;
}

interface BookingBase {
  id: string;
  room_id: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  is_private: boolean;
  is_mine: boolean;
}

/** Private booking, viewer not involved. An ADMIN never receives this. */
export interface BookingBusy extends BookingBase {
  visibility: 'BUSY';
}

export interface BookingPublic extends BookingBase {
  visibility: 'PUBLIC';
  title: string;
  owner: Owner;
  attendee_count: number;
}

/** An ADMIN always gets FULL — including for is_private bookings. */
export interface BookingFull extends BookingBase {
  visibility: 'FULL';
  title: string;
  description: string | null;
  special_request: string | null;
  headcount: number | null;
  version: number;
  owner: Owner;
  attendee_count: number;
  attendees: Attendee[];
  checkin: { checked_in_at: string; method: 'SELF' | 'ADMIN' | 'QR' } | null;
  reason_code: 'OWNER_CANCELLED' | 'ADMIN_CANCELLED' | 'OWNER_DISABLED' | 'NO_SHOW' | null;
  cancel: {
    cancelled_at: string;
    cancelled_by: { id: string; full_name: string } | null;
    reason: string | null;
  } | null;
  created_at: string;
  updated_at: string;
  /** GET /bookings/:id only. */
  history?: BookingHistoryEvent[];
  /** GET /bookings/:id only — UI drives buttons from this, never recomputes. */
  can?: BookingCan;
}

export type BookingView = BookingBusy | BookingPublic | BookingFull;

/** Calendar-only label for the employee who owns the reservation. */
export type CalendarBookingView = BookingView & { owner_display_name?: string };

/** POST /bookings/:id/check-in. Idempotent — a repeat answers 200, already_checked_in. */
export interface CheckInResponse {
  booking: BookingView;
  already_checked_in: boolean;
}

/** details of a 422 CHECKIN_WINDOW_CLOSED. */
export interface CheckinWindowDetails {
  opens_at: string;
  closes_at: string;
}

export interface PageInfo {
  page: number;
  page_size: number;
  total: number;
  /** Audit logs only: `total` is capped at 10,000. */
  total_is_capped?: boolean;
}

export interface BookingsListResponse {
  data: BookingView[];
  page: PageInfo;
}

export interface CalendarResponse {
  from: string;
  to: string;
  /** ACTIVE rooms only — merge with GET /rooms?include_inactive=true for closed ones. */
  rooms: RoomRef[];
  business_hours: BusinessHour[];
  holidays: Holiday[];
  bookings: CalendarBookingView[];
}

/** GET /admin/reports/utilization */
export interface UtilizationRow {
  key: string;
  room: { id: string; code: string; name: string };
  period: string | null;
  available_hours: number;
  used_hours: number;
  booked_hours: number;
  /** null when available_hours = 0. */
  utilization_pct: number | null;
  completed: number;
  cancelled: number;
  auto_released: number;
  no_show_pct: number | null;
}

export interface UtilizationResponse {
  from: string;
  to: string;
  group_by: 'room' | 'month';
  rows: UtilizationRow[];
}

/** GET /admin/reports/outcomes */
export interface OutcomesResponse {
  from: string;
  to: string;
  totals: {
    created: number;
    completed: number;
    cancelled_by_owner: number;
    cancelled_by_admin: number;
    auto_released: number;
  };
  no_show_pct: number | null;
  by_day: {
    date: string;
    created: number;
    completed: number;
    cancelled_by_owner: number;
    cancelled_by_admin: number;
    auto_released: number;
  }[];
}

/** GET /admin/reports/heatmap — SPARSE: an absent cell means zero. */
export interface HeatmapResponse {
  from: string;
  to: string;
  cells: { weekday: number; hour: number; bookings: number; used_hours: number }[];
}

/** GET /admin/audit-logs */
export interface AuditLog {
  /** number, not uuid. */
  id: number;
  created_at: string;
  /** null ⇒ ระบบ. */
  actor: { id: string; full_name: string | null } | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  request_id: string | null;
}

export interface AuditLogsResponse {
  data: AuditLog[];
  page: PageInfo;
}

/** GET /admin/notifications/emails */
export interface OutboxEmail {
  id: number;
  template_key: string;
  booking_id: string | null;
  recipient_email: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  created_at: string;
}

export interface OutboxListResponse {
  data: OutboxEmail[];
  page: PageInfo;
}
