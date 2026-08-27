// A1 derivations. All three are presentation of server data — no eligibility maths lives here.
import type { BookingView, BusinessHour, HeatmapResponse, Holiday, Room } from '../api/types';
import { addDays, bkkTime, weekdayOf } from './datetime';

/**
 * BR-13: "การจองเดือนนี้" is averaged over WORKING days elapsed, not calendar days —
 * dividing by calendar days understates it. Both bounds are inclusive Bangkok dates.
 */
export const workingDaysElapsed = (
  from: string,
  to: string,
  businessHours: BusinessHour[],
  holidays: Holiday[],
): number => {
  const openWeekdays = new Set(
    businessHours.filter((hour) => hour.is_open).map((hour) => hour.weekday),
  );
  const holidayDates = new Set(holidays.map((holiday) => holiday.date));

  let count = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (openWeekdays.has(weekdayOf(date)) && !holidayDates.has(date)) {
      count += 1;
    }
  }
  return count;
};

export type RoomTile =
  | { state: 'CLOSED' }
  | { state: 'IN_USE' }
  | { state: 'BUSY'; until: string }
  | { state: 'FREE' };

/**
 * A room's status right now. `ปิดปรับปรุง` wins over everything; a booking someone has
 * checked into reads `กำลังใช้งาน`; a confirmed-but-not-checked-in booking still holds the
 * room, so it reads `ไม่ว่างถึง {HH:MM}`. There is no "Pending review" state (CB-01).
 */
export const roomTileState = (room: Room, bookings: BookingView[], now: Date): RoomTile => {
  if (!room.active) {
    return { state: 'CLOSED' };
  }

  const instant = now.getTime();
  const holding = bookings.filter(
    (booking) =>
      booking.room_id === room.id &&
      (booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN') &&
      new Date(booking.start_at).getTime() <= instant &&
      instant < new Date(booking.end_at).getTime(),
  );

  if (holding.length === 0) {
    return { state: 'FREE' };
  }
  if (holding.some((booking) => booking.status === 'CHECKED_IN')) {
    return { state: 'IN_USE' };
  }
  const until = holding.reduce(
    (latest, booking) => Math.max(latest, new Date(booking.end_at).getTime()),
    0,
  );
  return { state: 'BUSY', until: bkkTime(new Date(until)) };
};

/** Heatmap cells are SPARSE — an absent cell means zero. Mon…Fri, index 0 = Monday. */
export const weekdayUsedHours = (cells: HeatmapResponse['cells']): number[] => {
  const totals = [0, 0, 0, 0, 0];
  for (const cell of cells) {
    const index = cell.weekday - 1;
    if (index >= 0 && index < totals.length) {
      totals[index] = (totals[index] ?? 0) + cell.used_hours;
    }
  }
  return totals;
};
