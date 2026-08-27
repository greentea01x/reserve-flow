import { describe, expect, it } from 'vitest';
import type { BookingView, BusinessHour, Holiday } from '../api/types';
import { bookingsOutsideHours } from './settings-impact';

const hours = (open: string, close: string): BusinessHour[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    is_open: weekday <= 5,
    open_time: weekday <= 5 ? open : null,
    close_time: weekday <= 5 ? close : null,
  }));

// 2026-08-26 is a Wednesday; 2026-08-29 is a Saturday.
const booking = (id: string, start: string, end: string): BookingView =>
  ({
    id,
    room_id: 'r1',
    start_at: start,
    end_at: end,
    status: 'CONFIRMED',
    is_private: false,
    is_mine: false,
    visibility: 'PUBLIC',
    title: id,
    owner: { id: 'u1', full_name: 'ผู้จอง', department: null },
    attendee_count: 0,
  }) as BookingView;

const ids = (rows: BookingView[]): string[] => rows.map((row) => row.id);

const NONE: Holiday[] = [];

describe('bookingsOutsideHours', () => {
  it('keeps a meeting inside the proposed window', () => {
    const rows = [booking('a', '2026-08-26T09:00:00.000+07:00', '2026-08-26T10:00:00.000+07:00')];
    expect(bookingsOutsideHours(rows, hours('08:30:00', '17:30:00'), NONE)).toEqual([]);
  });

  it('treats ending exactly at closing time as inside', () => {
    const rows = [booking('a', '2026-08-26T16:30:00.000+07:00', '2026-08-26T17:30:00.000+07:00')];
    expect(bookingsOutsideHours(rows, hours('08:30:00', '17:30:00'), NONE)).toEqual([]);
  });

  it('flags a meeting that now ends after closing time', () => {
    const rows = [booking('a', '2026-08-26T15:00:00.000+07:00', '2026-08-26T17:00:00.000+07:00')];
    expect(ids(bookingsOutsideHours(rows, hours('08:30:00', '16:00:00'), NONE))).toEqual(['a']);
  });

  it('flags a meeting that now starts before opening time', () => {
    const rows = [booking('a', '2026-08-26T08:00:00.000+07:00', '2026-08-26T09:00:00.000+07:00')];
    expect(ids(bookingsOutsideHours(rows, hours('08:30:00', '17:30:00'), NONE))).toEqual(['a']);
  });

  it('flags a meeting on a day that just became a holiday', () => {
    const rows = [booking('a', '2026-08-26T09:00:00.000+07:00', '2026-08-26T10:00:00.000+07:00')];
    const holidays: Holiday[] = [{ date: '2026-08-26', name: 'วันหยุดพิเศษ' }];
    expect(ids(bookingsOutsideHours(rows, hours('08:30:00', '17:30:00'), holidays))).toEqual(['a']);
  });

  it('flags a meeting on a weekday that was closed', () => {
    const rows = [booking('a', '2026-08-29T09:00:00.000+07:00', '2026-08-29T10:00:00.000+07:00')];
    expect(ids(bookingsOutsideHours(rows, hours('08:30:00', '17:30:00'), NONE))).toEqual(['a']);
  });
});
