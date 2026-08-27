import { describe, expect, it } from 'vitest';
import { editTimeDestination, selectionFromTimeRange } from './booking-flow';

const rows = [
  { start: '08:30', end: '09:00' },
  { start: '09:00', end: '09:30' },
  { start: '09:30', end: '10:00' },
  { start: '10:00', end: '10:30' },
];

describe('edit-time booking flow', () => {
  it('returns to the selected room with the original date and time range', () => {
    expect(
      editTimeDestination({
        roomId: 'room-horizon',
        date: '2026-08-26',
        start: '09:00',
        end: '10:00',
      }),
    ).toEqual({
      to: '/rooms/$roomId',
      params: { roomId: 'room-horizon' },
      search: { date: '2026-08-26', start: '09:00', end: '10:00' },
    });
  });

  it('restores a time range whose boundaries match the room grid', () => {
    expect(selectionFromTimeRange('room-horizon', rows, '09:00', '10:00')).toEqual({
      columnKey: 'room-horizon',
      startRow: 1,
      endRow: 3,
    });
  });

  it.each([
    [undefined, '10:00'],
    ['09:00', undefined],
    ['09:15', '10:00'],
    ['09:00', '10:15'],
    ['10:00', '09:00'],
  ])('rejects an invalid range (%s–%s)', (start, end) => {
    expect(selectionFromTimeRange('room-horizon', rows, start, end)).toBeNull();
  });
});
