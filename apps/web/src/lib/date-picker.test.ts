import { describe, expect, it } from 'vitest';
import { bangkokDateToIso, isoDateToBangkokDate } from './date-picker';

describe('date-picker ISO/Bangkok conversion', () => {
  it.each(['2026-08-25', '2026-12-31', '2027-01-01'])(
    'round-trips Gregorian date %s without changing the calendar day',
    (iso) => {
      expect(bangkokDateToIso(isoDateToBangkokDate(iso))).toBe(iso);
    },
  );

  it('formats an instant after Bangkok midnight as the next Gregorian date', () => {
    expect(bangkokDateToIso(new Date('2026-08-24T17:30:00.000Z'))).toBe('2026-08-25');
  });

  it.each(['', 'not-a-date', '25/08/2026', '2026-8-25', '2026-02-29', '2026-04-31', '2026-13-01'])(
    'rejects malformed or invalid ISO date %j',
    (iso) => {
      expect(() => isoDateToBangkokDate(iso)).toThrow();
    },
  );
});
