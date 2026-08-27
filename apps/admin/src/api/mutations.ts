import type { Role } from '@reserveflow/shared';
import { useMutation } from '@tanstack/react-query';
import { ApiClientError, apiFetch, apiRequest } from './client';
import { queryClient } from './query-client';
import type {
  AdminUser,
  BookingView,
  BusinessHour,
  CheckInResponse,
  DeactivateResponse,
  Holiday,
  ImportResult,
  Room,
  Settings,
  SettingsDocument,
} from './types';

/**
 * Note the missing /v1 — sign-out is a better-auth route mounted at /api/auth/*.
 *
 * The redirect hangs off onSuccess, never onSettled: navigating to /login after a FAILED
 * call tells the admin they signed out while their session cookie is still live. A 401/404
 * is the one failure that is really a success — the session is already gone.
 */
export const useSignOut = () =>
  useMutation({
    mutationFn: async () => {
      try {
        await apiFetch<unknown>('/api/auth/sign-out', { method: 'POST', json: {} });
      } catch (error) {
        if (!(error instanceof ApiClientError) || (error.status !== 401 && error.status !== 404)) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.clear();
      // Hard navigation drops all in-memory state and leaves the /admin basepath.
      window.location.href = '/login';
    },
  });

/**
 * `can` and `history` ride ONLY on GET /bookings/:id, so a write refetches instead of
 * seeding the detail cache from its own response — a seed would starve the page of both.
 */
const invalidateBooking = (bookingId: string) => {
  void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
  void queryClient.invalidateQueries({ queryKey: ['bookings'] });
  void queryClient.invalidateQueries({ queryKey: ['bookings-count'] });
  void queryClient.invalidateQueries({ queryKey: ['booking-audit', bookingId] });
  void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  void queryClient.invalidateQueries({ queryKey: ['room-future-bookings'] });
};

/**
 * POST /bookings/:id/cancel — the ONLY power an admin has over someone else's booking.
 * `reason` is a REQUIRED trimmed 3..1000 chars when the admin does not own the booking
 * (422 REASON_REQUIRED otherwise); it is emailed verbatim to the owner and attendees.
 * Cancelling an already-CANCELLED booking answers 200, not an error.
 */
export const useCancelBooking = (bookingId: string) =>
  useMutation({
    mutationFn: (reason: string) =>
      apiFetch<BookingView>(`/api/v1/bookings/${bookingId}/cancel`, {
        method: 'POST',
        json: { reason },
      }),
    // onSettled, not onSuccess: a 409 INVALID_STATUS_TRANSITION means reality moved on
    // (someone cancelled it first, or the meeting ended) — refetch so the admin sees it.
    onSettled: () => invalidateBooking(bookingId),
  });

/**
 * POST /bookings/:id/check-in. The server decides eligibility (`can.check_in`) and records
 * method ADMIN when the admin is uninvolved. 422 CHECKIN_WINDOW_CLOSED carries the window.
 */
export const useCheckInBooking = (bookingId: string) =>
  useMutation({
    mutationFn: () =>
      apiFetch<CheckInResponse>(`/api/v1/bookings/${bookingId}/check-in`, {
        method: 'POST',
        json: {},
      }),
    onSuccess: () => invalidateBooking(bookingId),
  });

const invalidateRooms = (roomId?: string) => {
  void queryClient.invalidateQueries({ queryKey: ['admin-rooms'] });
  void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  if (roomId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: ['room', roomId] });
  }
};

export interface RoomFeatureInput {
  key: string;
  quantity: number;
}

export interface CreateRoomBody {
  code: string;
  name: string;
  capacity: number;
  floor?: string | null;
  location?: string | null;
  description?: string | null;
  active?: boolean;
  features?: RoomFeatureInput[];
}

/** POST /admin/rooms. 409 VALIDATION_FAILED details.field='code' on a duplicate code. */
export const useCreateRoom = () =>
  useMutation({
    mutationFn: (body: CreateRoomBody) =>
      apiFetch<Room>('/api/v1/admin/rooms', { method: 'POST', json: body }),
    onSuccess: (room) => invalidateRooms(room.id),
  });

/**
 * PATCH /admin/rooms/:id. `code` is NOT patchable (CB-02) — it is printed on the door QR.
 * roomId travels in the variables so A6's per-card `เปิดให้จอง` and A7's form share one hook.
 */
export type UpdateRoomBody = Partial<Omit<CreateRoomBody, 'code' | 'features'>>;

export const useUpdateRoom = () =>
  useMutation({
    mutationFn: ({ roomId, body }: { roomId: string; body: UpdateRoomBody }) =>
      apiFetch<Room>(`/api/v1/admin/rooms/${roomId}`, { method: 'PATCH', json: body }),
    onSuccess: (room) => invalidateRooms(room.id),
  });

/** PUT /admin/rooms/:id/features — a BARE array, whole-list replace, separate from PATCH. */
export const useReplaceRoomFeatures = () =>
  useMutation({
    mutationFn: ({ roomId, features }: { roomId: string; features: RoomFeatureInput[] }) =>
      apiFetch<Room>(`/api/v1/admin/rooms/${roomId}/features`, { method: 'PUT', json: features }),
    onSuccess: (room) => invalidateRooms(room.id),
  });

/**
 * POST /admin/rooms/:id/photo — multipart, field name `file`, ≤5 MB, JPEG/PNG/WebP.
 * Never set content-type by hand: the browser has to build the multipart boundary.
 * 413 = ไฟล์ใหญ่เกินกำหนด, 415 = ชนิดไฟล์ไม่รองรับ (both arrive as VALIDATION_FAILED).
 */
export const useUploadRoomPhoto = () =>
  useMutation({
    mutationFn: ({ roomId, file }: { roomId: string; file: File }) => {
      const body = new FormData();
      body.set('file', file);
      return apiFetch<{ photo_url: string }>(`/api/v1/admin/rooms/${roomId}/photo`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: (_data, { roomId }) => invalidateRooms(roomId),
  });

export const useDeleteRoomPhoto = () =>
  useMutation({
    mutationFn: ({ roomId }: { roomId: string }) =>
      apiFetch<null>(`/api/v1/admin/rooms/${roomId}/photo`, { method: 'DELETE' }),
    onSuccess: (_data, { roomId }) => invalidateRooms(roomId),
  });

// ---------------------------------------------------------------------------
// A8 / A9 — users
// ---------------------------------------------------------------------------

/**
 * The facet counts drive the last-admin guard (§4.3), so they are invalidated by EVERY user
 * write — a stale count is a guard that lets the last admin through.
 */
const invalidateUsers = (userId?: string) => {
  void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  void queryClient.invalidateQueries({ queryKey: ['user-facets'] });
  if (userId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: ['admin-user', userId] });
    void queryClient.invalidateQueries({ queryKey: ['user-last-change', userId] });
    void queryClient.invalidateQueries({ queryKey: ['user-future-bookings', userId] });
  }
};

export interface CreateUserBody {
  employee_code: string;
  full_name: string;
  email: string;
  mobile?: string;
  department_id: string;
}

/**
 * POST /admin/users. `role` at create accepts ONLY "EMPLOYEE", so it is not sent and the
 * A9 form disables the field on the create path — a select that silently ignores the
 * chosen value is worse than one that says when it applies.
 * 409 details.field = 'email' | 'employee_code'; 422 = disallowed email domain.
 */
export const useCreateUser = () =>
  useMutation({
    mutationFn: (body: CreateUserBody) =>
      apiFetch<AdminUser>('/api/v1/admin/users', { method: 'POST', json: body }),
    onSuccess: (user) => invalidateUsers(user.id),
  });

export interface UpdateUserBody {
  full_name?: string;
  email?: string;
  mobile?: string | null;
  department_id?: string;
  role?: Role;
}

/**
 * PATCH /admin/users/:id. `employee_code` is not patchable. 409 CANNOT_MODIFY_SELF fires
 * only for changing your OWN role — your own name/email/mobile/department stay editable.
 * 409 LAST_ADMIN when the demotion would leave zero active admins.
 */
export const useUpdateUser = () =>
  useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: UpdateUserBody }) =>
      apiFetch<AdminUser>(`/api/v1/admin/users/${userId}`, { method: 'PATCH', json: body }),
    onSuccess: (user) => invalidateUsers(user.id),
  });

/**
 * POST /admin/users/:id/deactivate — kills every session AND cancels every future
 * CONFIRMED/CHECKED_IN booking, emailing owner + attendees. `reason` is OPTIONAL here
 * (unlike the booking cancel, where it is required). The response lists the bookings it
 * actually cancelled: render them, do not just close and refetch (§4.2 phase 2).
 */
export const useDeactivateUser = () =>
  useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      apiFetch<DeactivateResponse>(`/api/v1/admin/users/${userId}/deactivate`, {
        method: 'POST',
        json: reason === '' ? {} : { reason },
      }),
    onSuccess: (result) => {
      invalidateUsers(result.user.id);
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookings-count'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

/** POST /admin/users/:id/reactivate. Cancelled bookings are NOT restored, no email is sent. */
export const useReactivateUser = () =>
  useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      apiFetch<AdminUser>(`/api/v1/admin/users/${userId}/reactivate`, {
        method: 'POST',
        json: {},
      }),
    onSuccess: (user) => invalidateUsers(user.id),
  });

/**
 * resend-invite (INVITED only, 7-day token) and reset-password (INVITED or ACTIVE, 24-hour
 * token, deletes every session). Both answer 202 {queued:1} and share ONE rate-limit budget:
 * 3/hour per target user, 30/hour per admin.
 */
export const useAccountLink = (purpose: 'resend-invite' | 'reset-password') =>
  useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      apiFetch<{ queued: number }>(`/api/v1/admin/users/${userId}/${purpose}`, {
        method: 'POST',
        json: {},
      }),
  });

/**
 * DELETE /admin/users/:id — 204. Refused with 409 USER_HAS_HISTORY when the account owns or
 * created any booking OR authored any audit row. The server exposes no "is deletable" flag,
 * so A9 only offers this for an invited account that never signed in and owns nothing; the
 * 409 is still handled, because that heuristic can race.
 */
export const useDeleteUser = () =>
  useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      apiFetch<null>(`/api/v1/admin/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateUsers(),
  });

/**
 * POST /admin/users/import. Two-step BY DESIGN: `dry_run=true` produces the preview table,
 * then the SAME file is posted again for real. No Idempotency-Key — the import upserts on
 * employee_code and is idempotent by construction.
 * Whole-file failures: 400 bad header, 400 too many rows, 413 too big, 415 wrong type,
 * 409 LAST_ADMIN (the real run only, rolling the entire file back).
 */
export const useImportUsers = () =>
  useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const body = new FormData();
      body.set('file', file);
      // No content-type by hand: the browser has to build the multipart boundary.
      return apiFetch<ImportResult>(`/api/v1/admin/users/import?dry_run=${String(dryRun)}`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: (_result, { dryRun }) => {
      if (!dryRun) {
        invalidateUsers();
      }
    },
  });

// ---------------------------------------------------------------------------
// A10 — settings, business hours, holidays
// ---------------------------------------------------------------------------

export type SettingsSection = 'settings' | 'business_hours' | 'holidays';

export interface SaveSettingsInput {
  /** From GET /settings. PUT /admin/settings refuses the write without it. */
  etag: string;
  settings: Settings;
  /** Sent only when the section changed; exactly 7 rows when it did. */
  businessHours?: BusinessHour[];
  /**
   * One entry per year whose list changed. Each PUT replaces that whole year, so a draft
   * spanning both years the page offers needs one call per year — sending only the year the
   * <select> happens to be showing would drop the other year's edits.
   */
  holidays?: { year: number; items: Holiday[] }[];
}

/**
 * The three writes are NOT atomic and the order is not a preference:
 *
 *  1. PUT /admin/settings — the ONLY If-Match-guarded write in the API. The ETag hashes
 *     settings + business_hours + holidays TOGETHER, so writing hours or holidays first
 *     changes the hash and the settings PUT then 409s against its own edit.
 *  2. PUT /admin/business-hours (bare array of 7, no If-Match)
 *  3. PUT /admin/holidays (one year, no If-Match)
 *
 * Step 1 runs even when the policy keys are unchanged: it is the only concurrency check the
 * document has, and skipping it would let this form silently revert somebody else's holiday
 * edit. The cost is an audit row whose before and after match.
 *
 * A failure at step 2 leaves step 1 committed, so this resolves with an outcome instead of
 * throwing — the page reports which half landed rather than a blanket success or failure.
 */
export interface SaveSettingsOutcome {
  saved: SettingsSection[];
  failed: { section: SettingsSection; error: unknown } | null;
  etag: string | null;
}

export const useSaveSettings = () =>
  useMutation({
    mutationFn: async (input: SaveSettingsInput): Promise<SaveSettingsOutcome> => {
      const saved: SettingsSection[] = [];
      let etag: string | null = null;
      try {
        const result = await apiRequest<SettingsDocument>('/api/v1/admin/settings', {
          method: 'PUT',
          headers: { 'if-match': input.etag },
          json: input.settings,
        });
        // The fresh ETag rides on the response — no second GET needed.
        etag = result.response.headers.get('etag');
        saved.push('settings');
      } catch (error) {
        return { saved, failed: { section: 'settings', error }, etag };
      }

      if (input.businessHours !== undefined) {
        try {
          await apiFetch<BusinessHour[]>('/api/v1/admin/business-hours', {
            method: 'PUT',
            json: input.businessHours,
          });
          saved.push('business_hours');
        } catch (error) {
          return { saved, failed: { section: 'business_hours', error }, etag };
        }
      }

      if (input.holidays !== undefined) {
        for (const year of input.holidays) {
          try {
            await apiFetch<{ holidays: Holiday[] }>('/api/v1/admin/holidays', {
              method: 'PUT',
              json: { year: year.year, holidays: year.items },
            });
          } catch (error) {
            return { saved, failed: { section: 'holidays', error }, etag };
          }
        }
        saved.push('holidays');
      }

      return { saved, failed: null, etag };
    },
    // Always refetch: even a partial save moved the document, and its ETag with it.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

// ---------------------------------------------------------------------------
// A13 — email outbox
// ---------------------------------------------------------------------------

/**
 * POST /admin/notifications/emails/:id/retry → 202 {queued:1}. Only a FAILED row can be
 * retried (409 INVALID_STATUS_TRANSITION otherwise), so the button exists only on FAILED rows.
 */
export const useRetryEmail = () =>
  useMutation({
    mutationFn: ({ id }: { id: number }) =>
      apiFetch<{ queued: number }>(`/api/v1/admin/notifications/emails/${id}/retry`, {
        method: 'POST',
        json: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['outbox'] });
      void queryClient.invalidateQueries({ queryKey: ['failed-emails-count'] });
    },
  });
