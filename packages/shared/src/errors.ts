import { z } from 'zod';

export const ERROR_CODES = [
  'SLOT_UNAVAILABLE',
  'VERSION_CONFLICT',
  'INVALID_STATUS_TRANSITION',
  'OUTSIDE_BUSINESS_HOURS',
  'MIN_DURATION',
  'MAX_DURATION',
  'SLOT_INCREMENT',
  'IN_PAST',
  'MAX_ADVANCE',
  'CHECKIN_WINDOW_CLOSED',
  'NO_BOOKING_IN_WINDOW',
  'IDEMPOTENCY_KEY_REQUIRED',
  'ROOM_INACTIVE',
  'REASON_REQUIRED',
  'FORBIDDEN',
  'FORBIDDEN_PRIVATE',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'ACCOUNT_LOCKED',
  'TOKEN_EXPIRED',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'LAST_ADMIN',
  'CANNOT_MODIFY_SELF',
  'USER_HAS_HISTORY',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  details?: unknown;
  request_id: string;
}
