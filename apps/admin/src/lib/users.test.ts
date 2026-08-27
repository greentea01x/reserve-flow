import { describe, expect, it } from 'vitest';
import type { AdminUser } from '../api/types';
import { canHardDelete, userGuards } from './users';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const user = (patch: Partial<AdminUser>): AdminUser => ({
  id: OTHER,
  employee_code: 'E002',
  full_name: 'สมหญิง ใจดี',
  email: 'somying@example.com',
  mobile: null,
  role: 'EMPLOYEE',
  status: 'ACTIVE',
  department: { id: 'd1', code: 'IT', name: 'ไอที' },
  last_login_at: null,
  disabled_at: null,
  created_at: '2026-08-01T09:00:00.000+07:00',
  bookings_count: 0,
  ...patch,
});

describe('userGuards', () => {
  it('leaves an ordinary employee unguarded', () => {
    expect(userGuards(user({}), ME, 3)).toEqual([]);
  });

  it('guards the admin’s own row', () => {
    expect(userGuards(user({ id: ME }), ME, 3)).toEqual(['self']);
  });

  it('guards the last ACTIVE admin', () => {
    expect(userGuards(user({ role: 'ADMIN' }), ME, 1)).toEqual(['last-admin']);
  });

  it('does not guard an admin while others remain', () => {
    expect(userGuards(user({ role: 'ADMIN' }), ME, 2)).toEqual([]);
  });

  it('does not count a DISABLED admin as the last one', () => {
    expect(userGuards(user({ role: 'ADMIN', status: 'DISABLED' }), ME, 1)).toEqual([]);
  });

  it('reports both reasons when the sole admin looks at their own row', () => {
    expect(userGuards(user({ id: ME, role: 'ADMIN' }), ME, 1)).toEqual(['self', 'last-admin']);
  });
});

describe('canHardDelete', () => {
  it('allows an invited account that never signed in and owns nothing', () => {
    expect(canHardDelete(user({ status: 'INVITED' }), ME)).toBe(true);
  });

  it('refuses once the account has signed in', () => {
    expect(
      canHardDelete(
        user({ status: 'INVITED', last_login_at: '2026-08-02T09:00:00.000+07:00' }),
        ME,
      ),
    ).toBe(false);
  });

  it('refuses an account that owns bookings', () => {
    expect(canHardDelete(user({ status: 'INVITED', bookings_count: 2 }), ME)).toBe(false);
  });

  it('refuses an ACTIVE account', () => {
    expect(canHardDelete(user({ status: 'ACTIVE' }), ME)).toBe(false);
  });

  it('refuses the admin’s own account', () => {
    expect(canHardDelete(user({ id: ME, status: 'INVITED' }), ME)).toBe(false);
  });
});
