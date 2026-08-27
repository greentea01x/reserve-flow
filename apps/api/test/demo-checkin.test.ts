import { describe, expect, it } from 'vitest';

import { demoCheckinReadyStart } from '../src/modules/bookings/service.js';

const HOUR_MS = 60 * 60_000;

describe('demo check-in timing', () => {
  it('uses the configured grid when that boundary is immediately check-in eligible', () => {
    const now = new Date('2026-08-26T12:20:00.000Z');
    const start = demoCheckinReadyStart(now, HOUR_MS, {
      slotIncrementMinutes: 30,
      openBeforeMinutes: 15,
      graceMinutes: 15,
    });

    expect(start.toISOString()).toBe('2026-08-26T12:30:00.000Z');
    expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime() - 15 * 60_000);
    expect(now.getTime()).toBeLessThan(start.getTime() + 15 * 60_000);
  });

  it('falls back to the database grid when a wider configured boundary is outside the window', () => {
    const now = new Date('2026-08-26T12:30:00.000Z');
    const start = demoCheckinReadyStart(now, HOUR_MS, {
      slotIncrementMinutes: 60,
      openBeforeMinutes: 15,
      graceMinutes: 15,
    });

    expect(start.toISOString()).toBe('2026-08-26T12:45:00.000Z');
    expect(start.getTime() % (15 * 60_000)).toBe(0);
  });

  it('fails instead of producing a time outside an unusually narrow check-in window', () => {
    expect(() =>
      demoCheckinReadyStart(new Date('2026-08-26T12:07:00.000Z'), HOUR_MS, {
        slotIncrementMinutes: 60,
        openBeforeMinutes: 0,
        graceMinutes: 1,
      }),
    ).toThrow('no database-aligned instant');
  });
});
