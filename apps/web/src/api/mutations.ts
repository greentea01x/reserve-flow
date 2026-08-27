import { useMutation } from '@tanstack/react-query';
import { apiFetch, apiRequest } from './client';
import { meQuery } from './queries';
import { queryClient } from './query-client';
import type { BookingFull, BookingView, CheckInResponse, Me, SignInBody } from './types';

/** history/can only ride on GET /bookings/:id, so writes refetch instead of seeding. */
const invalidateBookingQueries = async (bookingId: string): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['booking', bookingId] }),
    queryClient.invalidateQueries({ queryKey: ['bookings'] }),
    queryClient.invalidateQueries({ queryKey: ['calendar'] }),
    queryClient.invalidateQueries({ queryKey: ['availability'] }),
  ]);
};

const invalidateBooking = (bookingId: string) => {
  void invalidateBookingQueries(bookingId);
};

export const useSignIn = () =>
  useMutation({
    mutationFn: (body: SignInBody) =>
      apiFetch<Me>('/api/v1/auth/sign-in', { method: 'POST', json: body }),
    onSuccess: (data) => {
      // Same serializer as /me minus session — seed the cache so the guard passes instantly.
      queryClient.setQueryData(meQuery.queryKey, data);
    },
  });

export interface CreateBookingBody {
  room_id: string;
  start_at: string;
  end_at: string;
  title: string;
  description?: string;
  is_private?: boolean;
  special_request?: string;
  headcount?: number;
  attendees?: { email: string; name?: string }[];
}

/**
 * POST /bookings. The caller owns the Idempotency-Key lifecycle: one
 * crypto.randomUUID() per submit press, REUSED on retry after network/5xx,
 * replaced only for a genuinely new attempt (e.g. new slot after a 409).
 */
export const useCreateBooking = () =>
  useMutation({
    mutationFn: async (input: { body: CreateBookingBody; idempotencyKey: string }) => {
      const { data, response } = await apiRequest<BookingFull>('/api/v1/bookings', {
        method: 'POST',
        json: input.body,
        idempotencyKey: input.idempotencyKey,
      });
      // 201 fresh vs 200 + Idempotent-Replayed — both are success.
      return { booking: data, replayed: response.headers.get('idempotent-replayed') === 'true' };
    },
    onSuccess: () => {
      // Never seed ['booking', id] from the POST body: `can`/`history` ride only on
      // GET /bookings/:id, and a fresh seed would starve the detail page of both.
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });

export interface UpdateBookingBody {
  version: number;
  title?: string;
  description?: string | null;
  is_private?: boolean;
  special_request?: string | null;
  headcount?: number | null;
  start_at?: string;
  end_at?: string;
  room_id?: string;
}

/** PATCH /bookings/:id — reschedule (E7) / edit fields (E5). On 409 the booking keeps its old slot (CB-03). */
export const useUpdateBooking = (bookingId: string) =>
  useMutation({
    mutationFn: (body: UpdateBookingBody) =>
      apiFetch<BookingView>(`/api/v1/bookings/${bookingId}`, { method: 'PATCH', json: body }),
    onSuccess: () => invalidateBooking(bookingId),
  });

/** PUT /bookings/:id/attendees — the ONLY way attendees change (server dedupes emails). */
export const useReplaceAttendees = (bookingId: string) =>
  useMutation({
    mutationFn: (body: { version: number; attendees: { email: string; name?: string }[] }) =>
      apiFetch<BookingView>(`/api/v1/bookings/${bookingId}/attendees`, {
        method: 'PUT',
        json: body,
      }),
    onSuccess: () => invalidateBooking(bookingId),
  });

/** better-auth passthrough (camelCase body). X-04: other sessions are revoked. */
export const useChangePassword = () =>
  useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiFetch<unknown>('/api/auth/change-password', {
        method: 'POST',
        json: { ...body, revokeOtherSessions: true },
      }),
  });

export const useCancelBooking = (bookingId: string) =>
  useMutation({
    mutationFn: (body: { reason?: string }) =>
      apiFetch<BookingView>(`/api/v1/bookings/${bookingId}/cancel`, { method: 'POST', json: body }),
    onSuccess: () => invalidateBooking(bookingId),
  });

/** Self check-in from list/detail. Idempotent server-side. */
export const useCheckInBooking = () =>
  useMutation({
    mutationFn: ({ bookingId }: { bookingId: string }) =>
      apiFetch<CheckInResponse>(`/api/v1/bookings/${bookingId}/check-in`, {
        method: 'POST',
        json: {},
      }),
    onSuccess: (_data, { bookingId }) => invalidateBooking(bookingId),
  });

/** E10 QR flow: the scanned sign encodes only the room code. */
export const useCheckInRoom = () =>
  useMutation({
    mutationFn: (roomCode: string) =>
      apiFetch<CheckInResponse>(`/api/v1/check-in/rooms/${encodeURIComponent(roomCode)}`, {
        method: 'POST',
      }),
    onSuccess: ({ booking }) => invalidateBooking(booking.id),
  });

/**
 * Development-only presenter tool. The caller is removed behind import.meta.env.DEV and the
 * authenticated server capability; after shifting, wait for caches before opening the real QR flow.
 */
export const usePrepareDemoCheckIn = () =>
  useMutation({
    mutationFn: ({ bookingId, version }: { bookingId: string; version: number }) =>
      apiFetch<BookingView>(`/api/v1/bookings/${bookingId}/demo-check-in-ready`, {
        method: 'POST',
        json: { version },
      }),
    onSuccess: (_booking, { bookingId }) => invalidateBookingQueries(bookingId),
  });

export const useSignOut = () =>
  useMutation({
    mutationFn: () => apiFetch<unknown>('/api/auth/sign-out', { method: 'POST', json: {} }),
    onSettled: () => {
      queryClient.clear();
      // Hard navigation drops all in-memory state.
      window.location.href = '/login';
    },
  });
