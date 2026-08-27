import { describe, expect, it } from 'vitest';
import type { BookingView, BusinessHour, Room } from '../api/types';
import { roomTileState, weekdayUsedHours, workingDaysElapsed } from './dashboard';

const HOURS: BusinessHour[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  is_open: weekday <= 5,
  open_time: weekday <= 5 ? '08:30:00' : null,
  close_time: weekday <= 5 ? '17:30:00' : null,
}));

const room = (over: Partial<Room> = {}): Room => ({
  id: 'r1',
  code: 'meeting-a',
  name: 'ห้อง A',
  floor: null,
  location: null,
  description: null,
  capacity: 8,
  photo_url: null,
  active: true,
  features: [],
  created_at: '2026-01-01T00:00:00.000+07:00',
  updated_at: '2026-01-01T00:00:00.000+07:00',
  ...over,
});

const booking = (over: Partial<BookingView> & Pick<BookingView, 'status'>): BookingView =>
  ({
    id: 'b1',
    room_id: 'r1',
    start_at: '2026-08-25T09:00:00.000+07:00',
    end_at: '2026-08-25T10:00:00.000+07:00',
    is_private: false,
    is_mine: false,
    visibility: 'BUSY',
    ...over,
  }) as BookingView;

describe('workingDaysElapsed', () => {
  it('counts only open weekdays, both bounds inclusive', () => {
    // 2026-08-24 is a Monday; 2026-08-30 a Sunday → Mon–Fri = 5.
    expect(workingDaysElapsed('2026-08-24', '2026-08-30', HOURS, [])).toBe(5);
  });

  it('drops holidays that fall on an open weekday', () => {
    expect(
      workingDaysElapsed('2026-08-24', '2026-08-30', HOURS, [
        { date: '2026-08-26', name: 'วันหยุด' },
        { date: '2026-08-29', name: 'เสาร์ที่ไม่นับอยู่แล้ว' },
      ]),
    ).toBe(4);
  });

  it('is 1 on a single open day and 0 on a single closed day', () => {
    expect(workingDaysElapsed('2026-08-25', '2026-08-25', HOURS, [])).toBe(1);
    expect(workingDaysElapsed('2026-08-30', '2026-08-30', HOURS, [])).toBe(0);
  });
});

describe('roomTileState', () => {
  const now = new Date('2026-08-25T09:30:00.000+07:00');

  it('reports a closed room regardless of bookings', () => {
    expect(
      roomTileState(room({ active: false }), [booking({ status: 'CHECKED_IN' })], now),
    ).toEqual({ state: 'CLOSED' });
  });

  it('reports FREE when nothing overlaps now', () => {
    expect(
      roomTileState(
        room(),
        [
          booking({
            status: 'CONFIRMED',
            start_at: '2026-08-25T13:00:00.000+07:00',
            end_at: '2026-08-25T14:00:00.000+07:00',
          }),
        ],
        now,
      ),
    ).toEqual({ state: 'FREE' });
  });

  it('prefers IN_USE over BUSY when someone has checked in', () => {
    expect(roomTileState(room(), [booking({ status: 'CHECKED_IN' })], now)).toEqual({
      state: 'IN_USE',
    });
  });

  it('reports BUSY until the latest overlapping end time', () => {
    expect(
      roomTileState(
        room(),
        [
          booking({ status: 'CONFIRMED' }),
          booking({ id: 'b2', status: 'CONFIRMED', end_at: '2026-08-25T11:30:00.000+07:00' }),
        ],
        now,
      ),
    ).toEqual({ state: 'BUSY', until: '11:30' });
  });

  it('ignores other rooms and cancelled rows', () => {
    expect(
      roomTileState(
        room(),
        [
          booking({ id: 'b3', room_id: 'r2', status: 'CHECKED_IN' }),
          booking({ id: 'b4', status: 'CANCELLED' }),
        ],
        now,
      ),
    ).toEqual({ state: 'FREE' });
  });
});

describe('weekdayUsedHours', () => {
  it('sums Mon–Fri and treats absent cells as zero', () => {
    expect(
      weekdayUsedHours([
        { weekday: 1, hour: 9, bookings: 1, used_hours: 1.5 },
        { weekday: 1, hour: 10, bookings: 1, used_hours: 2 },
        { weekday: 5, hour: 14, bookings: 1, used_hours: 3 },
        { weekday: 7, hour: 10, bookings: 1, used_hours: 9 },
      ]),
    ).toEqual([3.5, 0, 0, 0, 3]);
  });
});
