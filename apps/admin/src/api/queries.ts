import type { BookingStatus, Role, UserStatus } from '@reserveflow/shared';
import { queryOptions } from '@tanstack/react-query';
import { todayBkk } from '../lib/datetime';
import { apiFetch, apiRequest } from './client';
import type {
  AdminUserDetail,
  AdminUsersResponse,
  AuditLogsResponse,
  BookingsListResponse,
  BookingView,
  CalendarResponse,
  DepartmentOption,
  FeatureCatalogEntry,
  HeatmapResponse,
  Me,
  OutboxListResponse,
  OutcomesResponse,
  Room,
  SettingsDocument,
  UtilizationResponse,
} from './types';

/**
 * Auth source of truth. NOTE: /me is requireAuth, not requireAdmin — an EMPLOYEE gets a
 * normal 200 here, so the role check happens in the client (routes/authed.tsx), not by
 * waiting for data calls to 404.
 */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => apiFetch<Me>('/api/v1/me'),
  staleTime: 60_000,
  retry: false,
});

/**
 * The ETag is read off the response and kept: PUT /admin/settings needs it as `If-Match`
 * and there is no other way to get one. A1 uses the same cache entry for business_hours
 * and holidays, so there is exactly one settings read in the app.
 */
export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: async (): Promise<SettingsDocument> => {
    const { data, response } = await apiRequest<Omit<SettingsDocument, 'etag'>>('/api/v1/settings');
    return { ...data, etag: response.headers.get('etag') };
  },
  staleTime: 300_000,
});

/** include_inactive=true is ADMIN-only (403 otherwise) — the admin list needs closed rooms. */
export const adminRoomsQuery = queryOptions({
  queryKey: ['admin-rooms'],
  queryFn: async () =>
    (await apiFetch<{ data: Room[] }>('/api/v1/rooms?include_inactive=true')).data,
  staleTime: 300_000,
});

/** One room, including inactive ones (admin only). */
export const roomQuery = (roomId: string) =>
  queryOptions({
    queryKey: ['room', roomId],
    queryFn: () => apiFetch<Room>(`/api/v1/rooms/${roomId}`),
    staleTime: 300_000,
  });

/** The feature catalogue — the only way to learn the keys PUT /features accepts. */
export const featuresQuery = queryOptions({
  queryKey: ['features'],
  queryFn: async () => (await apiFetch<{ data: FeatureCatalogEntry[] }>('/api/v1/features')).data,
  staleTime: 300_000,
});

/**
 * D-26 impact preview: every future booking still holding a room. No `to` bound is sent —
 * the server refuses to create anything past max_advance_days, so "from today onwards" is
 * already the whole horizon and there is no window number to get wrong.
 * page_size=100 caps the list; `page.total` is the honest count.
 */
export const roomFutureBookingsQuery = (roomId: string) =>
  queryOptions({
    queryKey: ['room-future-bookings', roomId],
    queryFn: () =>
      apiFetch<BookingsListResponse>(
        `/api/v1/bookings?scope=all&room_id=${roomId}&from=${todayBkk()}&status=CONFIRMED,CHECKED_IN&sort=start_at&page_size=100`,
      ),
    staleTime: 30_000,
  });

/**
 * A10's D-26 impact preview: the committed bookings that a narrower set of business hours
 * would strand. The horizon is the CURRENT max_advance_days read from settings — never a
 * hard-coded 30, the key accepts up to 365.
 */
export const futureBookingsQuery = (to: string) =>
  queryOptions({
    queryKey: ['future-bookings', to],
    queryFn: () =>
      apiFetch<BookingsListResponse>(
        `/api/v1/bookings?scope=all&from=${todayBkk()}&to=${to}&status=CONFIRMED&sort=start_at&page_size=100`,
      ),
    staleTime: 60_000,
  });

/** A3's board. 1–31 days per request; `to` is inclusive. */
export const calendarQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['calendar', from, to],
    queryFn: () => apiFetch<CalendarResponse>(`/api/v1/calendar?from=${from}&to=${to}`),
    staleTime: 15_000,
  });

/**
 * A1's room tiles. /availability is the wrong endpoint for "is this free right now" — it
 * runs the full booking validator and answers 422 IN_PAST / MIN_DURATION. The calendar for
 * today is plain server data; the tile state is derived from it (lib/dashboard.ts).
 */
export const calendarDayQuery = (date: string) =>
  queryOptions({ ...calendarQuery(date, date), refetchInterval: 60_000 });

export interface BookingsListParams {
  from?: string;
  to?: string;
  room_id?: string;
  status?: BookingStatus;
  q?: string;
  page: number;
  sort: 'start_at' | '-start_at';
}

/** scope=all is what widens an admin's view past their own bookings — never omit it. */
const bookingsSearch = (params: Partial<BookingsListParams>): URLSearchParams => {
  const query = new URLSearchParams({ scope: 'all' });
  for (const key of ['from', 'to', 'room_id', 'status', 'q', 'sort'] as const) {
    const value = params[key];
    if (value !== undefined && value !== '') {
      query.set(key, value);
    }
  }
  return query;
};

export const bookingsQuery = (params: BookingsListParams) =>
  queryOptions({
    queryKey: ['bookings', params],
    queryFn: () => {
      const query = bookingsSearch(params);
      query.set('page', String(params.page));
      return apiFetch<BookingsListResponse>(`/api/v1/bookings?${query.toString()}`);
    },
  });

/** page.total with page_size=1 — the only aggregate the API exposes for bookings. */
export const bookingsCountQuery = (params: Partial<BookingsListParams>) =>
  queryOptions({
    queryKey: ['bookings-count', params],
    queryFn: async () => {
      const query = bookingsSearch(params);
      query.set('page_size', '1');
      const list = await apiFetch<BookingsListResponse>(`/api/v1/bookings?${query.toString()}`);
      return list.page.total;
    },
  });

export const bookingQuery = (bookingId: string) =>
  queryOptions({
    queryKey: ['booking', bookingId],
    queryFn: () => apiFetch<BookingView>(`/api/v1/bookings/${bookingId}`),
  });

/**
 * A5's change log. `history[]` on the booking carries no reason and only 6 mapped events;
 * the audit trail carries `reason`, `ip` and the full action set.
 */
export const bookingAuditQuery = (bookingId: string) =>
  queryOptions({
    queryKey: ['booking-audit', bookingId],
    queryFn: () =>
      apiFetch<AuditLogsResponse>(
        `/api/v1/admin/audit-logs?entity_type=booking&entity_id=${bookingId}&page_size=50`,
      ),
  });

/** All three reports share one window: from/to required, room_id optional, span ≤ 366 days. */
export interface ReportRange {
  from: string;
  to: string;
  room?: string;
  group_by?: 'room' | 'month';
}

const reportSearch = (range: ReportRange): string => {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (range.room !== undefined && range.room !== '') {
    query.set('room_id', range.room);
  }
  if (range.group_by !== undefined) {
    query.set('group_by', range.group_by);
  }
  return query.toString();
};

export const utilizationQuery = (range: ReportRange) =>
  queryOptions({
    queryKey: ['report-utilization', range],
    queryFn: () =>
      apiFetch<UtilizationResponse>(`/api/v1/admin/reports/utilization?${reportSearch(range)}`),
    staleTime: 300_000,
  });

export const outcomesQuery = (range: ReportRange) =>
  queryOptions({
    queryKey: ['report-outcomes', range],
    queryFn: () =>
      apiFetch<OutcomesResponse>(`/api/v1/admin/reports/outcomes?${reportSearch(range)}`),
    staleTime: 300_000,
  });

export const heatmapQuery = (range: ReportRange) =>
  queryOptions({
    queryKey: ['report-heatmap', range],
    queryFn: () =>
      apiFetch<HeatmapResponse>(`/api/v1/admin/reports/heatmap?${reportSearch(range)}`),
    staleTime: 300_000,
  });

/** A1's "อีเมลที่ส่งไม่สำเร็จ" row (NFR-5 / T-064). */
export const failedEmailsCountQuery = queryOptions({
  queryKey: ['failed-emails-count'],
  queryFn: async () => {
    const list = await apiFetch<OutboxListResponse>(
      '/api/v1/admin/notifications/emails?status=FAILED&page_size=1',
    );
    return list.page.total;
  },
  staleTime: 60_000,
});

// ---------------------------------------------------------------------------
// A8 / A9 — users
// ---------------------------------------------------------------------------

/** Feeds A8's ทีม/แผนก select and A9's department field. Unpaginated. */
export const departmentsQuery = queryOptions({
  queryKey: ['departments'],
  queryFn: async () =>
    (await apiFetch<{ data: DepartmentOption[] }>('/api/v1/departments?include_inactive=true'))
      .data,
  staleTime: 300_000,
});

export interface AdminUsersParams {
  q?: string;
  role?: Role;
  status?: UserStatus;
  department_id?: string;
  page: number;
}

const usersSearch = (params: Partial<AdminUsersParams>): URLSearchParams => {
  const query = new URLSearchParams();
  for (const key of ['q', 'role', 'status', 'department_id'] as const) {
    const value = params[key];
    if (value !== undefined && value !== '') {
      query.set(key, value);
    }
  }
  return query;
};

export const adminUsersQuery = (params: AdminUsersParams) =>
  queryOptions({
    queryKey: ['admin-users', params],
    queryFn: () => {
      const query = usersSearch(params);
      // §2.7: "เรียงตามชื่อ" — the server's own default, sent explicitly so the footer
      // line and the request cannot drift apart.
      query.set('sort', 'full_name');
      query.set('page', String(params.page));
      return apiFetch<AdminUsersResponse>(`/api/v1/admin/users?${query.toString()}`);
    },
  });

export const adminUserQuery = (userId: string) =>
  queryOptions({
    queryKey: ['admin-user', userId],
    queryFn: () => apiFetch<AdminUserDetail>(`/api/v1/admin/users/${userId}`),
  });

const userTotal = async (params: Partial<AdminUsersParams>): Promise<number> => {
  const query = usersSearch(params);
  query.set('page_size', '1');
  return (await apiFetch<AdminUsersResponse>(`/api/v1/admin/users?${query.toString()}`)).page.total;
};

export interface UserFacets {
  role: Record<Role, number>;
  status: Record<UserStatus, number>;
  total: number;
  /** §4.3: the last-admin guard is computed from this, never from a 409 after the click. */
  activeAdmins: number;
}

/**
 * §2.7's chip counts and §4.3's last-admin guard, from the only aggregate the API exposes:
 * `page.total` on a page_size=1 read. Seven small requests, but the key carries NO filter
 * deps — they run on mount and after a user mutation, not on every filter change.
 * The counts are deliberately unfiltered: "ผู้ดูแลระบบที่ใช้งานอยู่ 1 คน" is a global
 * invariant, and a count that shifted with the department filter would misstate it.
 */
export const userFacetsQuery = queryOptions({
  queryKey: ['user-facets'],
  queryFn: async (): Promise<UserFacets> => {
    const [employee, admin, facility, active, invited, disabled, activeAdmins] = await Promise.all([
      userTotal({ role: 'EMPLOYEE' }),
      userTotal({ role: 'ADMIN' }),
      userTotal({ role: 'FACILITY' }),
      userTotal({ status: 'ACTIVE' }),
      userTotal({ status: 'INVITED' }),
      userTotal({ status: 'DISABLED' }),
      userTotal({ role: 'ADMIN', status: 'ACTIVE' }),
    ]);
    return {
      role: { EMPLOYEE: employee, ADMIN: admin, FACILITY: facility },
      status: { ACTIVE: active, INVITED: invited, DISABLED: disabled },
      total: employee + admin + facility,
      activeAdmins,
    };
  },
  staleTime: 60_000,
});

/**
 * §4.2 phase 1: the exact bookings a deactivation will cancel, fetched BEFORE the admin
 * commits. Never render the dialog with a guessed or hard-coded N.
 */
export const userFutureBookingsQuery = (userId: string) =>
  queryOptions({
    queryKey: ['user-future-bookings', userId],
    queryFn: () =>
      apiFetch<BookingsListResponse>(
        `/api/v1/bookings?scope=all&owner_id=${userId}&from=${todayBkk()}&status=CONFIRMED,CHECKED_IN&sort=start_at&page_size=100`,
      ),
    staleTime: 30_000,
  });

/** A9's "แก้ไขล่าสุด {date} โดย {actor}" line — the only source of who changed a user. */
export const userLastChangeQuery = (userId: string) =>
  queryOptions({
    queryKey: ['user-last-change', userId],
    queryFn: () =>
      apiFetch<AuditLogsResponse>(
        `/api/v1/admin/audit-logs?entity_type=user&entity_id=${userId}&page_size=1`,
      ),
    staleTime: 60_000,
  });

// ---------------------------------------------------------------------------
// A12 — audit logs
// ---------------------------------------------------------------------------

export interface AuditLogParams {
  entity_type?: string;
  actor_id?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
}

export const auditLogsQuery = (params: AuditLogParams) =>
  queryOptions({
    queryKey: ['audit-logs', params],
    queryFn: () => {
      const query = new URLSearchParams();
      for (const key of ['entity_type', 'actor_id', 'action', 'from', 'to'] as const) {
        const value = params[key];
        if (value !== undefined && value !== '') {
          query.set(key, value);
        }
      }
      query.set('page', String(params.page));
      // Sort is fixed server-side (id DESC, newest first) — there is no `sort` param.
      return apiFetch<AuditLogsResponse>(`/api/v1/admin/audit-logs?${query.toString()}`);
    },
  });

/** A12's actor picker: type-ahead over the user list, because `actor_id` is uuid-only. */
export const userSearchQuery = (term: string) =>
  queryOptions({
    queryKey: ['user-search', term],
    queryFn: () =>
      apiFetch<AdminUsersResponse>(
        `/api/v1/admin/users?q=${encodeURIComponent(term)}&page_size=10&sort=full_name`,
      ),
    enabled: term.trim().length >= 2,
    staleTime: 60_000,
  });

// ---------------------------------------------------------------------------
// A13 — email outbox
// ---------------------------------------------------------------------------

export interface OutboxParams {
  /** Comma-separated; an empty string means "ทั้งหมด". */
  status?: string;
  page: number;
}

export const outboxQuery = (params: OutboxParams) =>
  queryOptions({
    queryKey: ['outbox', params],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(params.page) });
      if (params.status !== undefined && params.status !== '') {
        query.set('status', params.status);
      }
      return apiFetch<OutboxListResponse>(`/api/v1/admin/notifications/emails?${query.toString()}`);
    },
  });
