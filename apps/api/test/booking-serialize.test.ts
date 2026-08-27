import { describe, expect, it } from 'vitest';

import {
  type BookingRow,
  toCalendarBooking,
  toViewerBooking,
} from '../src/modules/bookings/serialize.js';

const row: BookingRow = {
  id: 'booking-1',
  room_id: 'room-1',
  start_at: new Date('2026-08-26T03:00:00.000Z'),
  end_at: new Date('2026-08-26T04:00:00.000Z'),
  status: 'CONFIRMED',
  is_private: true,
  title: 'Private roadmap',
  description: 'Secret detail',
  special_request: null,
  headcount: 4,
  version: 1,
  owner_id: 'owner-1',
  checked_in_at: null,
  checkin_method: null,
  created_at: new Date('2026-08-20T03:00:00.000Z'),
  updated_at: new Date('2026-08-20T03:00:00.000Z'),
  owner_full_name: 'สมชาย ใจดี',
  department_id: 'department-1',
  department_code: 'ENG',
  department_name: 'Engineering',
  attendee_count: 0,
  viewer_is_attendee: false,
  attendees: [],
};

const stranger = { id: 'stranger-1', role: 'EMPLOYEE' };
const facility = { id: 'facility-1', role: 'FACILITY' };

describe('calendar booking serialization', () => {
  it('adds only the owner display name to a private BUSY calendar view', () => {
    const booking = toCalendarBooking(row, stranger);

    expect(booking).toMatchObject({
      visibility: 'BUSY',
      owner_display_name: 'สมชาย ใจดี',
    });
    expect(booking).not.toHaveProperty('title');
    expect(booking).not.toHaveProperty('owner');
    expect(booking).not.toHaveProperty('description');
  });

  it('keeps non-calendar BUSY responses on the strict base allowlist', () => {
    const booking = toViewerBooking(row, stranger);

    expect(booking.visibility).toBe('BUSY');
    expect(booking).not.toHaveProperty('owner_display_name');
    expect(booking).not.toHaveProperty('title');
    expect(booking).not.toHaveProperty('owner');
  });

  it('does not disclose a private owner to an unrelated FACILITY viewer', () => {
    const booking = toCalendarBooking(row, facility);

    expect(booking.visibility).toBe('BUSY');
    expect(booking).not.toHaveProperty('owner_display_name');
    expect(booking).not.toHaveProperty('title');
    expect(booking).not.toHaveProperty('owner');
  });
});
