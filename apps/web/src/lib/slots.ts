// Client-side slot math from GET /settings — mirrors the server's validateWindow
// gates so users rarely see 422s. Always derived from settings, never hardcoded.
import type { SettingsResponse } from '../api/types';
import { bkkIso, minutesToTime, timeToMinutes, weekdayOf } from './datetime';

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

/** Slot rows for one Bangkok date: empty when closed or a holiday. */
export const dayInfo = (payload: SettingsResponse, date: string): DayInfo => {
  const holiday = payload.holidays.find((entry) => entry.date === date);
  if (holiday) {
    return { ...CLOSED, holiday: holiday.name };
  }
  const hours = payload.business_hours.find((entry) => entry.weekday === weekdayOf(date));
  if (!hours?.is_open || !hours.open_time || !hours.close_time) {
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

/** Lead-time + max-advance gate for one slot start (IN_PAST / MAX_ADVANCE mirror). */
export const slotBookable = (
  payload: SettingsResponse,
  date: string,
  slotStart: string,
  now: Date = new Date(),
): boolean => {
  const incrementMs = payload.settings.slot_increment_minutes * 60_000;
  const earliestStart =
    Math.ceil((now.getTime() + payload.settings.min_lead_minutes * 60_000) / incrementMs) *
    incrementMs;
  const latestStart = now.getTime() + payload.settings.max_advance_days * 86_400_000;
  const start = new Date(bkkIso(date, slotStart)).getTime();
  return start >= earliestStart && start <= latestStart;
};

/** True only after the whole Bangkok wall-clock slot has elapsed. Lead-time and
 * max-advance restrictions intentionally do not count as past time. */
export const slotHasElapsed = (date: string, slotEnd: string, now: Date = new Date()): boolean => {
  return new Date(bkkIso(date, slotEnd)).getTime() <= now.getTime();
};
