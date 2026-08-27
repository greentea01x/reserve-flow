import { describe, expect, it } from 'vitest';

import { APP_TZ, BOOKING_STATUSES, POLICY_DEFAULTS, ROLES, USER_STATUSES } from '../src/index.js';

describe('shared contracts', () => {
  it('keeps the agreed enum literals and policy defaults', () => {
    // Mirrors bookings_status_valid in apps/api/drizzle/0003_bookings.sql.
    expect(BOOKING_STATUSES).toEqual([
      'CONFIRMED',
      'CHECKED_IN',
      'COMPLETED',
      'CANCELLED',
      'AUTO_RELEASED',
    ]);
    expect(ROLES).toEqual(['EMPLOYEE', 'ADMIN', 'FACILITY']);
    expect(USER_STATUSES).toEqual(['INVITED', 'ACTIVE', 'DISABLED']);
    expect(APP_TZ).toBe('Asia/Bangkok');
    expect(POLICY_DEFAULTS).toEqual({
      autoReleaseEnabled: true,
      bufferMinutes: 0,
      checkInGraceMinutes: 15,
      checkInOpensMinutesBefore: 15,
      maxAdvanceDays: 30,
      maxDurationMinutes: null,
      minDurationMinutes: 60,
      reminderMinutesBefore: 15,
      slotIncrementMinutes: 30,
    });
  });
});
