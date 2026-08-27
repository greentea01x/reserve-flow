import { describe, expect, it } from 'vitest';
import type { BookingFull } from '../api/types';
import { isDemoCheckInCandidate } from './demo-check-in';

const NOW = Date.parse('2026-08-26T03:00:00.000Z');

const booking = {
  id: 'booking-1',
  room_id: 'room-1',
  start_at: '2026-08-26T04:00:00.000Z',
  end_at: '2026-08-26T05:00:00.000Z',
  status: 'CONFIRMED',
  is_private: false,
  is_mine: true,
  visibility: 'FULL',
  title: 'Demo',
  description: null,
  special_request: null,
  headcount: null,
  version: 1,
  owner: { id: 'owner-1', full_name: 'Owner', department: null },
  attendee_count: 0,
  attendees: [],
  checkin: null,
  reason_code: null,
  cancel: null,
  created_at: '2026-08-25T03:00:00.000Z',
  updated_at: '2026-08-25T03:00:00.000Z',
} satisfies BookingFull;

describe('demo check-in candidate', () => {
  it('accepts only an owned future CONFIRMED full booking', () => {
    expect(isDemoCheckInCandidate(booking, NOW)).toBe(true);
    expect(isDemoCheckInCandidate({ ...booking, is_mine: false }, NOW)).toBe(false);
    expect(isDemoCheckInCandidate({ ...booking, status: 'CHECKED_IN' }, NOW)).toBe(false);
    expect(isDemoCheckInCandidate({ ...booking, start_at: '2026-08-26T02:59:00.000Z' }, NOW)).toBe(
      false,
    );
  });
});
