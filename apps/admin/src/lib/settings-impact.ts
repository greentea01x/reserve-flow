// A10's D-26 impact preview. Shrinking business hours or adding a holiday cannot cancel a
// committed booking — the server never re-validates one — but it CAN leave meetings sitting
// outside the hours the admin just declared. This is presentation of server data against
// the admin's own draft, not eligibility maths.
import type { BookingView, BusinessHour, Holiday } from '../api/types';
import { bkkDate, bkkTime, timeToMinutes, weekdayOf } from './datetime';

/**
 * The bookings in `bookings` that would fall outside the PROPOSED hours/holidays.
 * A booking is outside when its day became a holiday, its weekday became closed, or it
 * starts before opening / ends after closing. Ending exactly at closing time is inside.
 */
export const bookingsOutsideHours = (
  bookings: readonly BookingView[],
  hours: readonly BusinessHour[],
  holidays: readonly Holiday[],
): BookingView[] => {
  const byWeekday = new Map(hours.map((hour) => [hour.weekday, hour]));
  const holidayDates = new Set(holidays.map((holiday) => holiday.date));

  return bookings.filter((booking) => {
    const date = bkkDate(booking.start_at);
    if (holidayDates.has(date)) {
      return true;
    }
    const hour = byWeekday.get(weekdayOf(date));
    if (
      hour === undefined ||
      !hour.is_open ||
      hour.open_time === null ||
      hour.close_time === null
    ) {
      return true;
    }
    const start = timeToMinutes(bkkTime(booking.start_at));
    const end = timeToMinutes(bkkTime(booking.end_at));
    return start < timeToMinutes(hour.open_time) || end > timeToMinutes(hour.close_time);
  });
};
