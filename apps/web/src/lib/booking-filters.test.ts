import { describe, expect, it } from 'vitest';
import { EMPLOYEE_BOOKING_FILTERS } from './booking-filters';

describe('employee booking filters', () => {
  it('keeps operational auto-release out of the employee filter navigation', () => {
    expect(EMPLOYEE_BOOKING_FILTERS).toEqual(['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED']);
    expect(EMPLOYEE_BOOKING_FILTERS).not.toContain('AUTO_RELEASED');
  });
});
