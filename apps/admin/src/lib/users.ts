// A8/A9 guard logic (§4.3). The requirement is that the UI PREVENTS and EXPLAINS: a
// disabled control with no visible reason is not an explanation, and a 409 after the click
// is not prevention. These are pure functions so both the row and the sheet reach the same
// verdict from the same inputs.
import type { AdminUser } from '../api/types';

export type UserGuard = 'self' | 'last-admin';

/**
 * Why this account cannot be deactivated (or role-changed). Both can apply at once — the
 * only active admin looking at their own row gets both sentences, because they are two
 * different rules and fixing one does not lift the other.
 *
 * `activeAdmins` comes from GET /admin/users?role=ADMIN&status=ACTIVE&page_size=1 →
 * page.total. The server has no "is last admin" flag.
 */
export const userGuards = (
  user: Pick<AdminUser, 'id' | 'role' | 'status'>,
  meId: string,
  activeAdmins: number,
): UserGuard[] => {
  const guards: UserGuard[] = [];
  if (user.id === meId) {
    guards.push('self');
  }
  if (user.role === 'ADMIN' && user.status === 'ACTIVE' && activeAdmins <= 1) {
    guards.push('last-admin');
  }
  return guards;
};

/**
 * §1.2 / §2.8: hard delete is rendered ONLY when the account has no history — never
 * speculatively, and never as a disabled button. The server counts bookings AND authored
 * audit rows but exposes no flag for it, so this is the closest honest proxy: an invited
 * account that never signed in has authored nothing. A 409 USER_HAS_HISTORY is still
 * handled at the call site, because this can race.
 */
export const canHardDelete = (user: AdminUser, meId: string): boolean =>
  user.id !== meId &&
  user.status === 'INVITED' &&
  user.last_login_at === null &&
  user.bookings_count === 0;
