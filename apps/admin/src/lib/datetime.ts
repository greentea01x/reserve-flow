// Asia/Bangkok display helpers. Bangkok is fixed UTC+7 with no DST, so a manual
// shift is exact — no Intl round-trips needed. Never show the +07:00 offset.

const BKK_OFFSET_MS = 7 * 3_600_000;

const THAI_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

/** Index = weekday − 1 (1 = Monday … 7 = Sunday, matching the API). */
const THAI_WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'] as const;

const shifted = (value: Date | string): Date => new Date(new Date(value).getTime() + BKK_OFFSET_MS);

/** Bangkok calendar date (YYYY-MM-DD) of an instant. */
export const bkkDate = (value: Date | string): string => shifted(value).toISOString().slice(0, 10);

/** Bangkok wall-clock time (HH:MM, 24h zero-padded) of an instant. */
export const bkkTime = (value: Date | string): string => shifted(value).toISOString().slice(11, 16);

export const todayBkk = (): string => bkkDate(new Date());

export const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** 1 = Monday … 7 = Sunday, matching business_hours.weekday. */
export const weekdayOf = (date: string): number =>
  ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

export const mondayOf = (date: string): string => addDays(date, 1 - weekdayOf(date));

/** "YYYY-MM-DD" + "HH:MM" → request-ready ISO at the Bangkok offset. */
export const bkkIso = (date: string, time: string): string => `${date}T${time}:00+07:00`;

/** "HH:MM" (or "HH:MM:SS") → minutes since midnight. */
export const timeToMinutes = (time: string): number =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export const minutesToTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Buddhist-era date, e.g. "26 ส.ค. 2569". Year is omitted only when asked (lists). */
export const formatThaiDate = (
  date: string,
  options?: { omitCurrentYear?: boolean; withWeekday?: boolean },
): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  let text = `${day} ${THAI_MONTHS[month - 1] ?? ''}`;
  if (!(options?.omitCurrentYear && date.slice(0, 4) === todayBkk().slice(0, 4))) {
    text += ` ${year + 543}`;
  }
  return options?.withWeekday ? `${THAI_WEEKDAYS[weekdayOf(date) - 1] ?? ''} ${text}` : text;
};

/** En-dash range, e.g. "08:30–17:30". */
export const formatTimeRange = (start: string, end: string): string => `${start}–${end}`;

/**
 * A9's "เข้าสู่ระบบล่าสุด {relative}". Intl.RelativeTimeFormat is native and speaks Thai —
 * a hand-rolled table would be more code and worse plurals.
 */
const relative = new Intl.RelativeTimeFormat('th', { numeric: 'auto' });

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60_000],
  ['hour', 3_600_000],
  ['day', 86_400_000],
  ['month', 2_592_000_000],
  ['year', 31_536_000_000],
];

export const timeAgo = (value: string): string => {
  const delta = new Date(value).getTime() - Date.now();
  let [unit, ms] = RELATIVE_STEPS[0] as [Intl.RelativeTimeFormatUnit, number];
  for (const [nextUnit, nextMs] of RELATIVE_STEPS) {
    if (Math.abs(delta) >= nextMs) {
      unit = nextUnit;
      ms = nextMs;
    }
  }
  return relative.format(Math.round(delta / ms), unit);
};

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} นาที`;
  }
  return rest === 0 ? `${hours} ชั่วโมง` : `${hours} ชั่วโมง ${rest} นาที`;
};
