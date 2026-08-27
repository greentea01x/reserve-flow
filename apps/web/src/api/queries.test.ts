import { describe, expect, it } from 'vitest';
import { BOOKING_DETAIL_REFRESH_MS, bookingDetailRefetchInterval } from './queries';
import type { BookingView } from './types';

describe('booking detail refresh cadence', () => {
  it('refreshes CONFIRMED eligibility and stops polling terminal bookings', () => {
    expect(bookingDetailRefetchInterval({ status: 'CONFIRMED' } as BookingView)).toBe(
      BOOKING_DETAIL_REFRESH_MS,
    );
    expect(bookingDetailRefetchInterval({ status: 'CHECKED_IN' } as BookingView)).toBe(false);
    expect(bookingDetailRefetchInterval({ status: 'AUTO_RELEASED' } as BookingView)).toBe(false);
    expect(bookingDetailRefetchInterval(undefined)).toBe(false);
  });
});
