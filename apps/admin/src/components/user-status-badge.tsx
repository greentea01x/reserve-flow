import type { UserStatus } from '@reserveflow/shared';
import { Check, Clock, X } from 'lucide-react';
import { USER_STATUS_LABELS } from '../lib/i18n';

/**
 * A8/A9's account status. Separate from `StatusBadge` in @reserveflow/ui on purpose:
 * that one's props are typed to BookingStatus, and widening it would let a caller pass a
 * user status into a booking badge. Twenty lines beats a leaky union.
 *
 * A11Y-03: fill + lucide icon + Thai text. Never colour alone.
 */
const TONES: Record<UserStatus, { className: string; Icon: typeof Check }> = {
  ACTIVE: { className: 'bg-g1 text-g7', Icon: Check },
  INVITED: { className: 'bg-y1 text-y7', Icon: Clock },
  DISABLED: { className: 'bg-r1 text-r7', Icon: X },
};

export const UserStatusBadge = ({ status }: { status: UserStatus }) => {
  const { className, Icon } = TONES[status];

  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold text-xs ${className}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {USER_STATUS_LABELS[status]}
    </span>
  );
};
