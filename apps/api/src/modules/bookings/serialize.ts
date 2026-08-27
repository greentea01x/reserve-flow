import { toBangkokIso } from '../../lib/time.js';

/**
 * One booking row plus the viewer-relative facts the SQL already computed. Property names
 * are the SQL aliases — calendar/list queries feed rows straight in.
 */
export type BookingRow = {
  id: string;
  room_id: string;
  start_at: Date;
  end_at: Date;
  status: string;
  is_private: boolean;
  title: string;
  description: string | null;
  special_request: string | null;
  headcount: number | null;
  version: number;
  owner_id: string;
  checked_in_at: Date | null;
  checkin_method: string | null;
  created_at: Date;
  updated_at: Date;
  /** Cancel facts — selected by detail/list/mutation queries; calendar omits them (it never
   * returns CANCELLED rows), so they stay optional. */
  reason_code?: string | null;
  reason?: string | null;
  cancelled_at?: Date | null;
  cancelled_by_id?: string | null;
  cancelled_by_name?: string | null;
  owner_full_name: string;
  /** Detail/mutation SELECT only (feeds /ics); never serialized to non-FULL viewers. */
  owner_email?: string;
  department_id: string | null;
  department_code: string | null;
  department_name: string | null;
  attendee_count: number;
  viewer_is_attendee: boolean;
  attendees: { email: string; name: string | null }[];
};

export type BookingViewer = { id: string; role: string };

/**
 * C-16: every booking leaves the API through here. Each level is built key-by-key from an
 * allowlist — masked fields are absent keys, never null. FACILITY level is Phase 1.1.
 * ponytail: `history[]` and `can{}` (FULL detail view) join with the booking-detail ticket —
 * they need the audit_logs join and the permission calculus that PATCH/cancel introduce.
 */
export function toViewerBooking(row: BookingRow, viewer: BookingViewer) {
  const isMine = row.owner_id === viewer.id;
  const seesFull = isMine || viewer.role === 'ADMIN' || row.viewer_is_attendee;
  const base = {
    id: row.id,
    room_id: row.room_id,
    start_at: toBangkokIso(row.start_at),
    end_at: toBangkokIso(row.end_at),
    status: row.status,
    is_private: row.is_private,
    is_mine: isMine,
  };

  if (!seesFull && row.is_private) {
    return { ...base, visibility: 'BUSY' as const };
  }

  const owner = {
    id: row.owner_id,
    full_name: row.owner_full_name,
    department:
      row.department_id === null
        ? null
        : { id: row.department_id, code: row.department_code, name: row.department_name },
  };

  if (!seesFull) {
    return {
      ...base,
      visibility: 'PUBLIC' as const,
      title: row.title,
      owner,
      attendee_count: row.attendee_count,
    };
  }

  return {
    ...base,
    visibility: 'FULL' as const,
    title: row.title,
    description: row.description,
    special_request: row.special_request,
    headcount: row.headcount,
    version: row.version,
    owner,
    attendee_count: row.attendee_count,
    attendees: row.attendees.map((attendee) => ({ email: attendee.email, name: attendee.name })),
    checkin:
      row.checked_in_at === null
        ? null
        : { checked_in_at: toBangkokIso(row.checked_in_at), method: row.checkin_method },
    reason_code: row.reason_code ?? null,
    cancel:
      row.cancelled_at == null
        ? null
        : {
            cancelled_at: toBangkokIso(row.cancelled_at),
            cancelled_by:
              row.cancelled_by_id == null
                ? null
                : { id: row.cancelled_by_id, full_name: row.cancelled_by_name ?? null },
            reason: row.reason ?? null,
          },
    created_at: toBangkokIso(row.created_at),
    updated_at: toBangkokIso(row.updated_at),
  };
}

export type BookingView = ReturnType<typeof toViewerBooking>;

/** Calendar-only extension: identify the reservation owner without widening BUSY details
 * on booking list/detail, check-in, or mutation responses. */
export function toCalendarBooking(row: BookingRow, viewer: BookingViewer) {
  const booking = toViewerBooking(row, viewer);
  if (viewer.role === 'FACILITY' && booking.visibility === 'BUSY') {
    return booking;
  }
  return {
    ...booking,
    owner_display_name: row.owner_full_name,
  };
}

export type CalendarBookingView = ReturnType<typeof toCalendarBooking>;
