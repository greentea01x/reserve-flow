import { queryOptions } from '@tanstack/react-query';
import { addDays, bkkIso, todayBkk } from '../lib/datetime';
import { apiFetch } from './client';
import type {
  AvailabilityResponse,
  BookingsListResponse,
  BookingView,
  CalendarResponse,
  Me,
  Room,
  SettingsResponse,
} from './types';

/** Auth source of truth. Guarded routes ensure this; 401 bounces to /login. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => apiFetch<Me>('/api/v1/me'),
  staleTime: 60_000,
  retry: false,
});

/** Slot math input. ETag'd server-side; a 5-min staleTime stands in for If-None-Match. */
export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: () => apiFetch<SettingsResponse>('/api/v1/settings'),
  staleTime: 300_000,
});

export const roomsQuery = queryOptions({
  queryKey: ['rooms'],
  queryFn: async () => (await apiFetch<{ data: Room[] }>('/api/v1/rooms')).data,
  staleTime: 300_000,
});

export const roomQuery = (roomId: string) =>
  queryOptions({
    queryKey: ['rooms', roomId],
    queryFn: () => apiFetch<Room>(`/api/v1/rooms/${roomId}`),
    staleTime: 300_000,
  });

export interface AvailabilityParams {
  date: string;
  start: string;
  end: string;
  headcount?: number;
  features?: string[];
}

/** E2: per-room availability with reasons — rooms are never silently filtered (UX-04). */
export const availabilityQuery = (params: AvailabilityParams) =>
  queryOptions({
    queryKey: ['availability', params],
    queryFn: () => {
      const query = new URLSearchParams({
        start: bkkIso(params.date, params.start),
        end: bkkIso(params.date, params.end),
      });
      if (params.headcount !== undefined) {
        query.set('headcount', String(params.headcount));
      }
      if (params.features !== undefined && params.features.length > 0) {
        query.set('features', params.features.join(','));
      }
      return apiFetch<AvailabilityResponse>(`/api/v1/availability?${query.toString()}`);
    },
    staleTime: 15_000,
  });

/** from/to are Bangkok YYYY-MM-DD; room filtering happens client-side (3 rooms). */
export const calendarQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['calendar', from, to],
    queryFn: () => apiFetch<CalendarResponse>(`/api/v1/calendar?from=${from}&to=${to}`),
    staleTime: 15_000,
  });

export const BOOKING_DETAIL_REFRESH_MS = 30_000;

/** Poll only while eligibility can still change from time passing. */
export const bookingDetailRefetchInterval = (booking: BookingView | undefined): number | false =>
  booking?.status === 'CONFIRMED' ? BOOKING_DETAIL_REFRESH_MS : false;

export const bookingQuery = (bookingId: string) =>
  queryOptions({
    queryKey: ['booking', bookingId],
    queryFn: () => apiFetch<BookingView>(`/api/v1/bookings/${bookingId}`),
    refetchInterval: (query) => bookingDetailRefetchInterval(query.state.data),
  });

export interface BookingsListParams {
  tab: 'upcoming' | 'history';
  status?: string;
  page: number;
}

/** E6: upcoming = from today ascending; history = up to yesterday descending. */
export const bookingsQuery = (params: BookingsListParams) =>
  queryOptions({
    queryKey: ['bookings', params],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(params.page) });
      if (params.tab === 'history') {
        query.set('to', addDays(todayBkk(), -1));
        query.set('sort', '-start_at');
      } else {
        query.set('from', todayBkk());
        query.set('sort', 'start_at');
      }
      if (params.status !== undefined) {
        query.set('status', params.status);
      }
      return apiFetch<BookingsListResponse>(`/api/v1/bookings?${query.toString()}`);
    },
  });
