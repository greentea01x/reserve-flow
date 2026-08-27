import { StatusBadge } from '@reserveflow/ui';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ApiClientError } from '../api/client';
import { useCancelBooking, useCheckInBooking } from '../api/mutations';
import { adminRoomsQuery, bookingAuditQuery, bookingQuery } from '../api/queries';
import type { CheckinWindowDetails } from '../api/types';
import { ConfirmDialog } from '../components/confirm-dialog';
import { InlineAlert } from '../components/table';
import { bkkDate, bkkTime, formatDuration, formatThaiDate, formatTimeRange } from '../lib/datetime';
import {
  auditActionLabel,
  COPY,
  checkinWindowMessage,
  errorMessage,
  TIMELINE_LABELS,
} from '../lib/i18n';
import { notFoundOn404 } from '../lib/loader';
import { authedRoute } from './authed';

const Row = ({ term, children }: { term: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-3 border-line border-b pb-2">
    <dt className="text-muted">{term}</dt>
    <dd className="text-right font-semibold text-ink">{children}</dd>
  </div>
);

const stamp = (at: string) =>
  `${formatThaiDate(bkkDate(at), { omitCurrentYear: true })} ${bkkTime(at)}`;

const actionButtonClass =
  'inline-flex min-h-10 items-center justify-center rounded-[11px] px-3.5 text-sm font-bold';

/** 422 CHECKIN_WINDOW_CLOSED carries the real window — show it instead of a generic line. */
const checkInErrorMessage = (error: unknown): string => {
  if (error instanceof ApiClientError && error.envelope.code === 'CHECKIN_WINDOW_CLOSED') {
    const details = error.envelope.details as CheckinWindowDetails | undefined;
    if (details?.opens_at !== undefined) {
      return checkinWindowMessage(
        formatTimeRange(bkkTime(details.opens_at), bkkTime(details.closes_at)),
      );
    }
  }
  return errorMessage(error);
};

const BookingDetailPage = () => {
  const { bookingId } = bookingDetailRoute.useParams();
  const { data: booking } = useSuspenseQuery(bookingQuery(bookingId));
  const { data: rooms } = useSuspenseQuery(adminRoomsQuery);
  // Non-suspense: a failed audit read must not take the whole detail page down with it.
  const audit = useQuery(bookingAuditQuery(bookingId));
  const checkIn = useCheckInBooking(bookingId);
  const cancel = useCancelBooking(bookingId);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  const [cancelled, setCancelled] = useState(false);
  const [staleError, setStaleError] = useState<string | null>(null);

  const room = rooms.find((entry) => entry.id === booking.room_id);
  const date = bkkDate(booking.start_at);
  const durationMinutes =
    (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000;
  // An ADMIN always gets FULL, including for private meetings — but branch on the
  // discriminator anyway, it is what the wire actually carries.
  const full = booking.visibility === 'FULL' ? booking : null;
  const title = booking.visibility === 'BUSY' ? COPY.bookings.privateBadge : booking.title;

  const cancelledBy =
    full?.cancel == null
      ? null
      : full.reason_code === 'ADMIN_CANCELLED'
        ? COPY.bookingDetail.cancelledByAdminPrefix
        : `${COPY.bookingDetail.cancelledByPrefix} ${full.cancel.cancelled_by?.full_name ?? full.owner.full_name}`;

  // E6/C2-03: what an admin may do comes strictly from the server's `can` — never recomputed.
  const can = full?.can;

  const confirmCancel = (reason: string) => {
    setStaleError(null);
    cancel.mutate(reason, {
      onSuccess: () => {
        cancelDialogRef.current?.close();
        setCancelled(true);
      },
      onError: (error) => {
        // Someone cancelled it first, or the meeting ended: close the dialog so the admin
        // reads the refetched truth rather than arguing with a stale row.
        if (
          error instanceof ApiClientError &&
          error.envelope.code === 'INVALID_STATUS_TRANSITION'
        ) {
          cancelDialogRef.current?.close();
          setStaleError(errorMessage(error));
        }
      },
    });
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      {/* Announcing on mount of a child is what makes a live region reliable — the node is
          always present, its contents are not. */}
      <div aria-live="polite" className="grid gap-3">
        {cancelled ? (
          <p
            role="status"
            className="rounded-xl border border-r2 bg-r0 px-3.5 py-3 font-bold text-r7 text-sm"
          >
            {COPY.cancelDialog.success}
          </p>
        ) : null}
        {staleError !== null ? <InlineAlert message={staleError} /> : null}
        {checkIn.isError ? <InlineAlert message={checkInErrorMessage(checkIn.error)} /> : null}
        {checkIn.isSuccess ? (
          <p
            role="status"
            className="rounded-xl border border-g2 bg-g0 px-3.5 py-3 font-bold text-g7 text-sm"
          >
            {checkIn.data.already_checked_in
              ? COPY.bookingDetail.alreadyCheckedIn
              : COPY.bookingDetail.checkedIn}
          </p>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={booking.status} />
          {booking.is_private ? (
            <span className="inline-flex items-center rounded-full bg-n1 px-2 py-1 font-medium text-ink2 text-sm">
              {COPY.bookings.privateBadge}
            </span>
          ) : null}
        </div>
        <h1 className="mt-3 font-bold text-2xl text-ink">{title}</h1>

        <dl className="mt-4 grid gap-2 text-sm">
          <Row term={COPY.bookingDetail.dateRow}>{formatThaiDate(date, { withWeekday: true })}</Row>
          <Row term={COPY.bookingDetail.timeRow}>
            <span className="tabular-nums">
              {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}
            </span>{' '}
            · {formatDuration(durationMinutes)}
          </Row>
          {room !== undefined ? (
            <Row term={COPY.bookingDetail.roomRow}>
              {room.name}
              {room.floor !== null ? ` · ${COPY.bookingDetail.floorPrefix} ${room.floor}` : ''}
            </Row>
          ) : null}
          {booking.visibility !== 'BUSY' ? (
            <Row term={COPY.bookingDetail.owner}>
              {booking.owner.full_name}
              {booking.owner.department !== null ? (
                <small className="block font-normal text-muted text-xs">
                  {booking.owner.department.name}
                </small>
              ) : null}
            </Row>
          ) : null}
          {full !== null && full.headcount !== null ? (
            <Row term={COPY.bookingDetail.headcount}>
              {full.headcount} {COPY.bookingDetail.people}
            </Row>
          ) : null}
          {full?.checkin != null ? (
            <Row term={COPY.bookingDetail.checkedInAt}>
              <span className="tabular-nums">{stamp(full.checkin.checked_in_at)}</span>
            </Row>
          ) : null}
        </dl>

        {full?.cancel != null ? (
          <p className="mt-4 rounded-xl border border-r2 bg-r0 px-3.5 py-3 font-semibold text-r7 text-sm">
            {cancelledBy}
            {full.cancel.reason !== null ? `: ${full.cancel.reason}` : ''}
          </p>
        ) : null}

        {full !== null && full.description !== null ? (
          <section className="mt-4">
            <h2 className="font-bold text-ink2 text-sm">{COPY.bookingDetail.description}</h2>
            <p className="mt-1 whitespace-pre-wrap text-ink text-sm">{full.description}</p>
          </section>
        ) : null}

        {full !== null && full.special_request !== null ? (
          <section className="mt-4">
            <h2 className="font-bold text-ink2 text-sm">{COPY.bookingDetail.specialRequest}</h2>
            <p className="mt-1 whitespace-pre-wrap text-ink text-sm">{full.special_request}</p>
          </section>
        ) : null}

        {full !== null && full.attendees.length > 0 ? (
          <section className="mt-4">
            <h2 className="font-bold text-ink2 text-sm">
              {COPY.bookingDetail.attendees} ({full.attendee_count})
            </h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {full.attendees.map((attendee) => (
                <li key={attendee.email} className="rounded-full bg-g0 px-3 py-1 text-ink2 text-sm">
                  {attendee.name ?? attendee.email}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* §2.3 admin action row, destructive last. The two mutations are rendered only
            from the server's `can`; .ics is a plain read any FULL viewer may perform. */}
        {full !== null ? (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-line border-t pt-4">
            {can?.check_in === true ? (
              <button
                type="button"
                disabled={checkIn.isPending}
                onClick={() => checkIn.mutate()}
                className={`${actionButtonClass} bg-g7 text-white disabled:opacity-60`}
              >
                {checkIn.isPending ? COPY.bookingDetail.checkingIn : COPY.bookingDetail.checkIn}
              </button>
            ) : null}
            <a
              href={`/api/v1/bookings/${bookingId}/ics`}
              className={`${actionButtonClass} border border-line bg-white text-ink2 hover:bg-g0`}
            >
              {COPY.bookingDetail.ics}
            </a>
            {can?.cancel === true ? (
              <button
                type="button"
                onClick={() => cancelDialogRef.current?.showModal()}
                className={`${actionButtonClass} border border-r2 bg-white text-r7 hover:bg-r0`}
              >
                {COPY.bookingDetail.cancel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {full?.history !== undefined && full.history.length > 0 ? (
        <section className="mt-4 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-bold text-ink2 text-sm">{COPY.bookingDetail.timeline}</h2>
          <ol className="mt-3 grid gap-2.5">
            {full.history.map((event) => (
              <li key={`${event.event}-${event.at}`} className="flex items-baseline gap-3 text-sm">
                <span className="w-28 shrink-0 text-muted text-xs tabular-nums">
                  {stamp(event.at)}
                </span>
                <span className="font-semibold text-ink">{TIMELINE_LABELS[event.event]}</span>
                <span className="text-muted">
                  · {event.actor?.full_name ?? COPY.bookingDetail.systemActor}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* history[] carries no reason and only six mapped events; the audit trail is the
          record that answers "who cancelled this, and why". */}
      <section className="mt-4 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-bold text-ink2 text-sm">{COPY.bookingDetail.changeLog}</h2>
        {audit.isError ? (
          <div className="mt-3">
            <InlineAlert
              message={`${COPY.bookingDetail.changeLogFailed} · ${errorMessage(audit.error)}`}
            />
          </div>
        ) : audit.isPending ? (
          <p className="mt-3 animate-pulse text-muted text-sm" aria-busy="true">
            {COPY.states.loading}
          </p>
        ) : audit.data.data.length === 0 ? (
          <p className="mt-3 text-muted text-sm">{COPY.bookingDetail.changeLogEmpty}</p>
        ) : (
          <ol className="mt-3 grid gap-2.5">
            {audit.data.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="w-28 shrink-0 text-muted text-xs tabular-nums">
                  {stamp(entry.created_at)}
                </span>
                <span className="text-muted">
                  {entry.actor?.full_name ?? COPY.bookingDetail.systemActor}
                </span>
                <span className="font-semibold text-ink">· {auditActionLabel(entry.action)}</span>
                {entry.reason !== null ? (
                  <span className="basis-full pl-31 text-r7 text-xs">
                    {COPY.bookingDetail.reasonPrefix}: {entry.reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <Link
        to="/bookings"
        search={{}}
        className="mt-4 inline-flex min-h-10 items-center rounded-[11px] border border-line bg-white px-4 font-semibold text-ink2 text-sm hover:bg-g0"
      >
        ← {COPY.bookingDetail.back}
      </Link>

      {/* §4.1: the reason is REQUIRED and is emailed verbatim to the owner and attendees.
          The confirm button stays disabled until it holds 3 trimmed characters. */}
      <ConfirmDialog
        ref={cancelDialogRef}
        title={COPY.cancelDialog.title}
        context={[
          title,
          room?.name,
          `${formatThaiDate(date)} ${formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}`,
          booking.visibility === 'BUSY'
            ? undefined
            : `${COPY.cancelDialog.ownerPrefix} ${booking.owner.full_name}`,
        ]
          .filter((part) => part !== undefined && part !== '')
          .join(' · ')}
        consequences={COPY.cancelDialog.consequences}
        reason="required"
        reasonLabel={COPY.cancelDialog.reasonLabel}
        reasonHelper={COPY.cancelDialog.reasonHelper}
        confirmLabel={COPY.cancelDialog.confirm}
        pendingLabel={COPY.cancelDialog.pending}
        isPending={cancel.isPending}
        error={cancel.isError ? errorMessage(cancel.error) : null}
        onConfirm={confirmCancel}
        onClose={() => cancel.reset()}
      />
    </div>
  );
};

export const bookingDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bookings/$bookingId',
  loader: async ({ context, params }) => {
    await Promise.all([
      notFoundOn404(context.queryClient.ensureQueryData(bookingQuery(params.bookingId))),
      context.queryClient.ensureQueryData(adminRoomsQuery),
    ]);
  },
  component: BookingDetailPage,
});
