import { z } from 'zod';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Responses always render instants at the fixed +07:00 offset (§6.1 conventions).
 * Storage and every decision stay timestamptz UTC — APP_TZ is rendering only.
 */
export function toBangkokIso(value: Date): string;
export function toBangkokIso(value: Date | null): string | null;
export function toBangkokIso(value: Date | null): string | null {
  if (value === null) {
    return null;
  }

  return `${new Date(value.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, -1)}+07:00`;
}

/** Calendar facts of an instant in Asia/Bangkok. Fixed +07:00 — Thailand has no DST. */
export function bangkokParts(value: Date): {
  isoWeekday: number;
  minutesOfDay: number;
  date: string;
} {
  const shifted = new Date(value.getTime() + BANGKOK_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  return {
    isoWeekday: weekday === 0 ? 7 : weekday,
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10),
  };
}

/** UTC instant of Bangkok midnight for a `YYYY-MM-DD` date param (§6.1: date params are Bangkok). */
export function bangkokDateStart(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

/**
 * The only way a `YYYY-MM-DD` query param may enter: a REAL Bangkok date. A regex alone is
 * not enough — '9999-99-99' makes bangkokDateStart() return an Invalid Date whose
 * toISOString() throws (a 500 on a plainly bad request), and '2026-02-30' quietly rolls into
 * March, so compare the round trip. Years start at 1 because everything below that leaves
 * ISO's four-digit form and neither V8 nor Postgres agrees on what it means.
 */
export const bangkokDateParam = z
  .string()
  .regex(/^[1-9]\d{3}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'is not a real date');
