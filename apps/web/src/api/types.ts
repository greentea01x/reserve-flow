// Hand-written response shapes from the API contract (apps/api route files are the source).
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

/** GET /api/v1/me (session) and POST /api/v1/auth/sign-in (no session). */
export interface Me {
  user: User;
  department: Department;
  capabilities: { demo_check_in: boolean };
  session?: { expires_at: string };
}

export interface SignInBody {
  employee_code: string;
  password: string;
  remember_me: boolean;
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

/** Slim room shape used by /availability and /calendar. */
export interface RoomRef {
  id: string;
  code: string;
  name: string;
  floor: string | null;
  capacity: number;
}

export type AvailabilityReason = 'BUSY' | 'CLOSED' | 'HOLIDAY' | 'CAPACITY' | 'MISSING_FEATURE';

export interface AvailabilityRoom {
  room: RoomRef;
  available: boolean;
  reasons: AvailabilityReason[];
  busy_until?: string;
}

export interface AvailabilityResponse {
  start: string;
  end: string;
  rooms: AvailabilityRoom[];
}

export interface BusinessHour {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  is_open: boolean;
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
  holidays: Holiday[];
  server_time: string;
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

/** Private booking, viewer not involved: render "ไม่ว่าง" only. */
export interface BookingBusy extends BookingBase {
  visibility: 'BUSY';
}

export interface BookingPublic extends BookingBase {
  visibility: 'PUBLIC';
  title: string;
  owner: Owner;
  attendee_count: number;
}

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
  reason_code: string | null;
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

/** Calendar-only display metadata. Private titles remain absent for BUSY viewers. */
export type CalendarBookingView = BookingView & { owner_display_name?: string };

export interface CalendarResponse {
  from: string;
  to: string;
  rooms: RoomRef[];
  /** Only weekdays occurring in range — full 7-row set comes from GET /settings. */
  business_hours: BusinessHour[];
  holidays: Holiday[];
  bookings: CalendarBookingView[];
}

export interface PageInfo {
  page: number;
  page_size: number;
  total: number;
}

export interface BookingsListResponse {
  data: BookingView[];
  page: PageInfo;
}

/** 409 SLOT_UNAVAILABLE details. */
export interface SlotUnavailableDetails {
  room_id: string;
  start_at: string;
  end_at: string;
  alternatives: { room_id: string; code: string; name: string }[];
  conflicting_booking_id?: string;
}

/** 409 VERSION_CONFLICT details. */
export interface VersionConflictDetails {
  current_version: number;
  current: BookingView;
}

/** 422 CHECKIN_WINDOW_CLOSED details. */
export interface CheckinWindowDetails {
  opens_at: string;
  closes_at: string;
}

export interface CheckInResponse {
  booking: BookingView;
  already_checked_in: boolean;
}
