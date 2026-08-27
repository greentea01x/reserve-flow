import { z } from 'zod';

// Must stay identical to the bookings_status_valid CHECK in 0003_bookings.sql. Bookings are
// first come, first served: CONFIRMED is the first state, there is no approval step.
export const BOOKING_STATUSES = [
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'AUTO_RELEASED',
] as const;

export const BookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const ROLES = ['EMPLOYEE', 'ADMIN', 'FACILITY'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

// INVITED = the admin created the account but the password has never been set.
export const USER_STATUSES = ['INVITED', 'ACTIVE', 'DISABLED'] as const;
export const UserStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof UserStatusSchema>;
