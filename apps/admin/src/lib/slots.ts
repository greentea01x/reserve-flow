// Slot rows for the read-only admin board (A3), derived from GET /settings.
// Deliberately narrower than the employee app's copy: `slotBookable` is booking-eligibility
// maths and the admin board books nothing, so it is not ported.
import type { SettingsResponse } from '../api/types';
import { minutesToTime, timeToMinutes, weekdayOf } from './datetime';

export interface DaySlot {
  start: string;
  end: string;
}

export interface DayInfo {
  open: boolean;
  holiday?: string;
  openMinutes: number;
  closeMinutes: number;
  slots: DaySlot[];
}

const CLOSED: DayInfo = { open: false, openMinutes: 0, closeMinutes: 0, slots: [] };

/** One Bangkok date's rows. Empty when the day is closed or a holiday. */
export const dayInfo = (payload: SettingsResponse, date: string): DayInfo => {
  const holiday = payload.holidays.find((entry) => entry.date === date);
  if (holiday) {
    return { ...CLOSED, holiday: holiday.name };
  }
  const hours = payload.business_hours.find((entry) => entry.weekday === weekdayOf(date));
  if (hours?.is_open !== true || hours.open_time === null || hours.close_time === null) {
    return CLOSED;
  }
  const increment = payload.settings.slot_increment_minutes;
  const openMinutes = timeToMinutes(hours.open_time);
  const closeMinutes = timeToMinutes(hours.close_time);
  const slots: DaySlot[] = [];
  for (let at = openMinutes; at + increment <= closeMinutes; at += increment) {
    slots.push({ start: minutesToTime(at), end: minutesToTime(at + increment) });
  }
  return { open: true, openMinutes, closeMinutes, slots };
};
