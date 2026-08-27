import type { BookingFull, BookingView } from '../api/types';

/** Only an owned, editable-shape future booking can be shifted into the demo QR window. */
export function isDemoCheckInCandidate(
  booking: BookingView,
  nowMs = Date.now(),
): booking is BookingFull {
  return (
    booking.visibility === 'FULL' &&
    booking.is_mine &&
    booking.status === 'CONFIRMED' &&
    new Date(booking.start_at).getTime() > nowMs
  );
}
