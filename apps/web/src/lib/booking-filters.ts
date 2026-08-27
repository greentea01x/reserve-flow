import type { BookingStatus } from '@reserveflow/shared';

/**
 * Employee-facing navigation is an explicit product choice, not a mirror of every
 * operational state the booking domain may add. AUTO_RELEASED remains supported by
 * the API and URL parser, and still renders when a matching booking is returned.
 */
export const EMPLOYEE_BOOKING_FILTERS = [
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly BookingStatus[];
