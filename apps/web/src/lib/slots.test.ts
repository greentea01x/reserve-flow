import { describe, expect, it } from 'vitest';
import type { SettingsResponse } from '../api/types';
import { addDays, bkkDate, bkkTime, formatThaiDate, mondayOf, weekdayOf } from './datetime';
import { dayInfo, slotBookable, slotHasElapsed } from './slots';

const payload: SettingsResponse = {
  settings: {
    slot_increment_minutes: 30,
    min_duration_minutes: 60,
    max_duration_minutes: null,
    buffer_minutes: 0,
    max_advance_days: 30,
    min_lead_minutes: 0,
    checkin_open_before_minutes: 15,
    checkin_grace_minutes: 15,
    auto_release_enabled: true,
    reminder_minutes_before: 15,
  },
  business_hours: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    is_open: true,
    open_time: '08:30:00',
    close_time: '17:30:00',
  })),
  holidays: [{ date: '2026-12-07', name: 'ชดเชยวันพ่อ' }],
  server_time: '2026-08-25T12:00:00.000+07:00',
};

describe('datetime (fixed +07:00)', () => {
  it('converts instants to Bangkok date/time, crossing midnight', () => {
    expect(bkkDate('2026-08-25T18:30:00.000Z')).toBe('2026-08-26');
    expect(bkkTime('2026-08-26T14:00:00.000+07:00')).toBe('14:00');
  });

  it('weekday math matches the API convention (1=Mon…7=Sun)', () => {
    expect(weekdayOf('2026-08-24')).toBe(1);
    expect(weekdayOf('2026-08-30')).toBe(7);
    expect(mondayOf('2026-08-26')).toBe('2026-08-24');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('formats Buddhist-era dates', () => {
    expect(formatThaiDate('2026-08-26')).toBe('26 ส.ค. 2569');
  });
});

describe('dayInfo', () => {
  it('builds the 18 half-hour rows for an open weekday', () => {
    const day = dayInfo(payload, '2026-08-26');
    expect(day.open).toBe(true);
    expect(day.slots).toHaveLength(18);
    expect(day.slots[0]).toEqual({ start: '08:30', end: '09:00' });
    expect(day.slots.at(-1)).toEqual({ start: '17:00', end: '17:30' });
  });

  it('closes weekends and holidays', () => {
    expect(dayInfo(payload, '2026-08-29').open).toBe(false);
    const holiday = dayInfo(payload, '2026-12-07');
    expect(holiday.open).toBe(false);
    expect(holiday.holiday).toBe('ชดเชยวันพ่อ');
  });
});

describe('slotBookable', () => {
  const now = new Date('2026-08-26T14:01:00.000+07:00');

  it('rounds "now" up to the next increment on the current day', () => {
    expect(slotBookable(payload, '2026-08-26', '14:00', now)).toBe(false);
    expect(slotBookable(payload, '2026-08-26', '14:30', now)).toBe(true);
  });

  it('matches the server immediately around an exact slot boundary', () => {
    expect(
      slotBookable(payload, '2026-08-26', '14:00', new Date('2026-08-26T13:59:59.999+07:00')),
    ).toBe(true);
    expect(
      slotBookable(payload, '2026-08-26', '14:00', new Date('2026-08-26T14:00:00.000+07:00')),
    ).toBe(true);
    expect(
      slotBookable(payload, '2026-08-26', '14:00', new Date('2026-08-26T14:00:00.001+07:00')),
    ).toBe(false);
  });

  it('rejects past days and days beyond max_advance', () => {
    expect(slotBookable(payload, '2026-08-25', '10:00', now)).toBe(false);
    expect(slotBookable(payload, '2026-09-25', '10:00', now)).toBe(true);
    expect(slotBookable(payload, '2026-09-26', '10:00', now)).toBe(false);
  });
});

describe('slotHasElapsed', () => {
  const now = new Date('2026-08-26T14:01:00.000+07:00');

  it('marks only fully elapsed slots as past in Bangkok time', () => {
    expect(slotHasElapsed('2026-08-26', '14:00', now)).toBe(true);
    expect(slotHasElapsed('2026-08-26', '14:30', now)).toBe(false);
  });

  it('changes state exactly at the slot end boundary', () => {
    const boundary = new Date('2026-08-26T14:00:00.000+07:00');
    expect(slotHasElapsed('2026-08-26', '14:00', boundary)).toBe(true);
    expect(slotHasElapsed('2026-08-26', '14:30', boundary)).toBe(false);
  });

  it('distinguishes past dates from future booking restrictions', () => {
    expect(slotHasElapsed('2026-08-25', '17:30', now)).toBe(true);
    expect(slotHasElapsed('2026-08-27', '08:30', now)).toBe(false);
  });
});
