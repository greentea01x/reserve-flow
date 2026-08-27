import type { ErrorCode } from '@reserveflow/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { DatabaseError } from 'pg';

const defaultStatusByCode: Partial<Record<ErrorCode, ContentfulStatusCode>> = {
  SLOT_UNAVAILABLE: 409,
  VERSION_CONFLICT: 409,
  INVALID_STATUS_TRANSITION: 409,
  OUTSIDE_BUSINESS_HOURS: 422,
  MIN_DURATION: 422,
  MAX_DURATION: 422,
  SLOT_INCREMENT: 422,
  IN_PAST: 422,
  MAX_ADVANCE: 422,
  // Spec contract §0/§6: outside-window check-in is a request problem, not a conflict.
  CHECKIN_WINDOW_CLOSED: 422,
  NO_BOOKING_IN_WINDOW: 422,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  ROOM_INACTIVE: 422,
  REASON_REQUIRED: 422,
  FORBIDDEN: 403,
  // Spec §3: non-FULL viewers asking for /bookings/:id/ics.
  FORBIDDEN_PRIVATE: 403,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
  ACCOUNT_LOCKED: 423,
  // §6.2: a set-password link that was already used, expired, or never existed.
  TOKEN_EXPIRED: 410,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  LAST_ADMIN: 409,
  // Spec §6.2 U-02: an admin may not change their own role, disable or delete themselves.
  CANNOT_MODIFY_SELF: 409,
  USER_HAS_HISTORY: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

type AppErrorOptions = {
  status?: ContentfulStatusCode;
  details?: unknown;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details: unknown | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? defaultStatusByCode[code] ?? 500;
    this.details = options.details;
  }
}

/** Duck-type for pg's DatabaseError: an Error carrying a 5-char SQLSTATE `code`. */
export function isDatabaseError(error: unknown): error is DatabaseError {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && code.length === 5;
}

/** 0003 checks that mirror request shape — zod catches these first; the DB is the floor. */
const inputShapedChecks = new Set([
  'bookings_title_length',
  'bookings_description_length',
  'bookings_special_request_length',
  'bookings_headcount_positive',
  'bookings_time_order',
  'bookings_15min_grid',
  'bookings_hard_max',
  'bookings_status_valid',
  'bookings_reason_code_valid',
  'bookings_checkin_method_valid',
  'booking_attendees_email_format',
  'rooms_code_format',
  'rooms_name_length',
  'rooms_description_length',
  'rooms_capacity_range',
  'room_features_quantity_positive',
  'business_hours_weekday_range',
  'business_hours_valid',
]);

/**
 * Every FK to users.id that is NOT ON DELETE CASCADE. DELETE /admin/users/:id prechecks
 * bookings + audit_logs, but the FK graph is wider than that precheck (an admin who issued
 * an invite, edited settings or cancelled someone's booking is equally undeletable); each of
 * these means the account has history, so the answer is the same 409 the precheck gives.
 */
const userReferenceConstraints = new Set([
  'bookings_owner_id_users_id_fk',
  'bookings_created_by_users_id_fk',
  'bookings_cancelled_by_users_id_fk',
  'bookings_checked_in_by_users_id_fk',
  'audit_logs_actor_id_users_id_fk',
  'users_created_by_users_id_fk',
  'password_setup_tokens_created_by_users_id_fk',
  'settings_updated_by_users_id_fk',
  'business_hours_updated_by_users_id_fk',
]);

const uniqueViolationField: Record<string, string> = {
  users_email_unique: 'email',
  users_employee_code_unique: 'employee_code',
  departments_code_unique: 'code',
  rooms_code_unique: 'code',
};

/**
 * Safety net mapping of known constraint failures to public codes, called from app.onError
 * AFTER the transaction rolled back (inside an aborted tx everything is 25P02). Returns
 * undefined for anything that must not surface as a user error: invariant checks firing
 * means our writer is buggy, and the idempotency/dedupe uniques are handled as replays at
 * the service level, never as errors.
 */
export function mapPostgresError(error: DatabaseError): AppError | undefined {
  const constraint = error.constraint;
  switch (error.code) {
    case '23P01':
      // The only EXCLUDE in the schema: bookings_no_overlap_confirmed (0004).
      return constraint === 'bookings_no_overlap_confirmed'
        ? new AppError('SLOT_UNAVAILABLE', 'The requested slot is no longer available', {
            cause: error,
          })
        : undefined;
    case '23505': {
      const field = constraint === undefined ? undefined : uniqueViolationField[constraint];
      return field === undefined
        ? undefined
        : new AppError('VALIDATION_FAILED', 'A record with this value already exists', {
            status: 409,
            details: { field },
            cause: error,
          });
    }
    case '23514':
      return constraint !== undefined && inputShapedChecks.has(constraint)
        ? new AppError('VALIDATION_FAILED', 'Request violates a data constraint', {
            details: { constraint },
            cause: error,
          })
        : undefined;
    case '23503':
      if (constraint !== undefined && userReferenceConstraints.has(constraint)) {
        return new AppError('USER_HAS_HISTORY', 'User is referenced by existing history', {
          details: { hint: 'deactivate' },
          cause: error,
        });
      }
      if (constraint === 'room_features_feature_key_features_key_fk') {
        return new AppError('VALIDATION_FAILED', 'Unknown feature key', {
          details: { field: 'features' },
          cause: error,
        });
      }
      if (constraint === 'users_department_id_departments_id_fk') {
        return new AppError('VALIDATION_FAILED', 'Department not found', {
          details: { field: 'department_id' },
          cause: error,
        });
      }
      return constraint === 'bookings_room_id_rooms_id_fk'
        ? new AppError('NOT_FOUND', 'Room not found', { cause: error })
        : undefined;
    default:
      return undefined;
  }
}
