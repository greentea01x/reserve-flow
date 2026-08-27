import { AppError } from './errors.js';
import type { Settings } from './settings.js';
import { bangkokParts, toBangkokIso } from './time.js';

export type BusinessHoursDay = {
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
};

/**
 * Outcome of the shared window validator (§6.3.4 — availability and POST /bookings run the
 * same checks in the same order). HARD failures are request errors (422/400) everywhere;
 * CLOSED/HOLIDAY are soft: availability renders them as per-room `reasons`, bookings turn
 * them into 422 OUTSIDE_BUSINESS_HOURS.
 */
export type WindowVerdict =
  | { ok: true }
  | { ok: false; kind: 'HARD'; error: AppError }
  | {
      ok: false;
      kind: 'CLOSED';
      reason: 'CLOSED_DAY' | 'HOURS';
      openTime?: string;
      closeTime?: string;
    }
  | { ok: false; kind: 'HOLIDAY'; holidayName: string };

/**
 * §6.3.4 refinement shared by POST /bookings and GET /availability: `now + min_lead`
 * rounded up to the next slot boundary. Both endpoints must agree on IN_PAST or the UI
 * shows slots the create endpoint then rejects.
 */
export function earliestSlotStart(now: Date, settings: Settings): Date {
  const step = settings.slot_increment_minutes * 60_000;
  return new Date(Math.ceil((now.getTime() + settings.min_lead_minutes * 60_000) / step) * step);
}

/**
 * §5.10 `buffer_minutes`: the span a room must actually be free for, widened by the
 * inter-meeting gap on both sides. ONE function so the availability grid, the create probe
 * and the reschedule probe can never disagree about which slots are bookable — the grid
 * offering a slot POST /bookings then refuses is the bug this exists to prevent.
 *
 * At the default 0 it returns the request's own window, so the buffered path costs nothing.
 */
export function occupancyRange(
  start: Date,
  end: Date,
  settings: Pick<Settings, 'buffer_minutes'>,
): { from: Date; to: Date } {
  const buffer = settings.buffer_minutes * 60_000;
  return { from: new Date(start.getTime() - buffer), to: new Date(end.getTime() + buffer) };
}

function minutesOf(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function hard(error: AppError): WindowVerdict {
  return { ok: false, kind: 'HARD', error };
}

export function validateWindow(input: {
  start: Date;
  end: Date;
  now: Date;
  settings: Settings;
  /** ISO weekday (1 = Monday … 7 = Sunday) → company-wide hours row. Missing row = closed. */
  hours: ReadonlyMap<number, BusinessHoursDay>;
  /** Bangkok `YYYY-MM-DD` → holiday name, for at least the window's start date. */
  holidays: ReadonlyMap<string, string>;
  /**
   * §6.3.4 create refinement: `now + min_lead` rounded up to the next slot boundary
   * (earliestSlotStart above) — passed by bookings AND availability so both agree.
   */
  earliestStart?: Date;
}): WindowVerdict {
  const { start, end, now, settings } = input;

  if (end.getTime() <= start.getTime()) {
    return hard(new AppError('VALIDATION_FAILED', 'end_at must be after start_at'));
  }
  if (start.getTime() < (input.earliestStart ?? now).getTime()) {
    return hard(new AppError('IN_PAST', 'start_at is in the past'));
  }

  const durationMinutes = (end.getTime() - start.getTime()) / 60_000;
  if (durationMinutes < settings.min_duration_minutes) {
    return hard(
      new AppError('MIN_DURATION', 'Booking is shorter than the minimum duration', {
        details: { min_duration_minutes: settings.min_duration_minutes },
      }),
    );
  }
  if (settings.max_duration_minutes !== null && durationMinutes > settings.max_duration_minutes) {
    return hard(
      new AppError('MAX_DURATION', 'Booking is longer than the maximum duration', {
        details: { max_duration_minutes: settings.max_duration_minutes },
      }),
    );
  }
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes % settings.slot_increment_minutes !== 0
  ) {
    return hard(
      new AppError('SLOT_INCREMENT', 'Duration must be a multiple of the slot increment', {
        details: { slot_increment_minutes: settings.slot_increment_minutes },
      }),
    );
  }

  const latestStartAt = new Date(now.getTime() + settings.max_advance_days * 86_400_000);
  if (start.getTime() > latestStartAt.getTime()) {
    return hard(
      new AppError('MAX_ADVANCE', 'Booking starts beyond the advance window', {
        details: { latest_start_at: toBangkokIso(latestStartAt) },
      }),
    );
  }

  const startParts = bangkokParts(start);
  const endParts = bangkokParts(end);
  const day = input.hours.get(startParts.isoWeekday);
  if (day === undefined || !day.isOpen || day.openTime === null || day.closeTime === null) {
    return { ok: false, kind: 'CLOSED', reason: 'CLOSED_DAY' };
  }

  const holidayName = input.holidays.get(startParts.date);
  if (holidayName !== undefined) {
    return { ok: false, kind: 'HOLIDAY', holidayName };
  }

  // A window crossing Bangkok midnight can never fit inside one day's open hours.
  if (
    endParts.date !== startParts.date ||
    startParts.minutesOfDay < minutesOf(day.openTime) ||
    endParts.minutesOfDay > minutesOf(day.closeTime)
  ) {
    return {
      ok: false,
      kind: 'CLOSED',
      reason: 'HOURS',
      openTime: day.openTime,
      closeTime: day.closeTime,
    };
  }

  return { ok: true };
}
