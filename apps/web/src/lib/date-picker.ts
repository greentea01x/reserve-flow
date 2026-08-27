import { TZDate } from '@daypicker/react';

export const APP_TIME_ZONE = 'Asia/Bangkok';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Convert the app's Gregorian YYYY-MM-DD value to a Bangkok calendar date. */
export const isoDateToBangkokDate = (value: string): TZDate => {
  const match = ISO_DATE.exec(value);
  if (match === null) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = TZDate.tz(APP_TIME_ZONE, year, month - 1, day);

  // TZDate (like Date) normalizes impossible dates, so compare the calendar
  // fields to reject values such as 2026-04-31 instead of silently rolling on.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }

  return date;
};

/** Format an instant/date as the app's Gregorian YYYY-MM-DD in Bangkok. */
export const bangkokDateToIso = (date: Date): string => {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }
  const zoned = TZDate.tz(APP_TIME_ZONE, date);
  return `${zoned.getFullYear()}-${pad2(zoned.getMonth() + 1)}-${pad2(zoned.getDate())}`;
};
