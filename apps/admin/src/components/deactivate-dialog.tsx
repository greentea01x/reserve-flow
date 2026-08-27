import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef } from 'react';
import { useDeactivateUser } from '../api/mutations';
import { userFutureBookingsQuery } from '../api/queries';
import type { AdminUser, DeactivateResponse } from '../api/types';
import { bkkDate, bkkTime, formatThaiDate, formatTimeRange } from '../lib/datetime';
import { COPY, errorMessage } from '../lib/i18n';
import { useDialogOpen } from '../lib/use-dialog';
import { ConfirmDialog } from './confirm-dialog';

/**
 * §4.2 — deactivation kills every session AND cancels the user's future bookings. Both
 * consequences are on screen with REAL numbers before the admin commits, never discovered
 * afterwards and never rendered with a guessed N.
 *
 * Phase 1 (here): read the user's future CONFIRMED/CHECKED_IN bookings; hold the confirm
 * button while it loads.
 * Phase 2 (the caller): the server returns the bookings it actually cancelled — render them
 * in an aria-live region rather than closing and refetching silently.
 */
const LIST_COLLAPSE_AT = 5;

export interface DeactivateDialogProps {
  user: AdminUser;
  onClose: () => void;
  onDone: (result: DeactivateResponse) => void;
}

export const DeactivateDialog = ({ user, onClose, onDone }: DeactivateDialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, true);
  const impact = useQuery(userFutureBookingsQuery(user.id));
  const deactivate = useDeactivateUser();

  const affected = impact.data?.data ?? [];
  const total = impact.data?.page.total ?? 0;

  const bookingsLine = impact.isPending
    ? COPY.deactivateDialog.checking
    : total === 0
      ? COPY.deactivateDialog.noneAffected
      : `${COPY.deactivateDialog.affectedPrefix} ${total} ${COPY.deactivateDialog.affectedSuffix}`;

  // The session bullet first, then the real count, then what survives — the order the admin
  // reads it in.
  const [sessions, ...rest] = COPY.deactivateDialog.consequences;
  const consequences = [sessions as string, bookingsLine, ...rest];

  const list =
    affected.length === 0 ? null : (
      <ul className="grid gap-1 text-sm">
        {affected.map((booking) => (
          <li key={booking.id}>
            <Link
              to="/bookings/$bookingId"
              params={{ bookingId: booking.id }}
              className="text-ink2 underline hover:text-g7"
            >
              <span className="tabular-nums">
                {formatThaiDate(bkkDate(booking.start_at), { omitCurrentYear: true })}{' '}
                {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}
              </span>
              {booking.visibility === 'BUSY' ? null : ` · ${booking.title}`}
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <ConfirmDialog
      ref={ref}
      title={`${COPY.deactivateDialog.titlePrefix} ${user.full_name}?`}
      context={`${user.employee_code} · ${user.department.name}`}
      consequences={consequences}
      reason="optional"
      reasonLabel={COPY.deactivateDialog.reasonLabel}
      confirmLabel={COPY.deactivateDialog.confirm}
      pendingLabel={COPY.deactivateDialog.pending}
      isPending={deactivate.isPending}
      // Never let the admin commit against a count that has not arrived yet.
      confirmDisabled={impact.isPending}
      error={deactivate.isError ? errorMessage(deactivate.error) : null}
      onConfirm={(reason) =>
        deactivate.mutate(
          { userId: user.id, reason },
          {
            onSuccess: (result) => {
              onDone(result);
              ref.current?.close();
            },
          },
        )
      }
      onClose={() => {
        deactivate.reset();
        onClose();
      }}
    >
      {list === null ? null : affected.length > LIST_COLLAPSE_AT ? (
        <details>
          <summary className="cursor-pointer font-semibold text-ink2 text-sm">
            {COPY.deactivateDialog.listLabelPrefix} ({total})
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto">{list}</div>
        </details>
      ) : (
        list
      )}
    </ConfirmDialog>
  );
};
