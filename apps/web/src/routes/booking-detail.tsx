import { Countdown } from '@reserveflow/ui';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ApiClientError } from '../api/client';
import { useCancelBooking, useCheckInBooking } from '../api/mutations';
import { bookingQuery, roomQuery, settingsQuery } from '../api/queries';
import type { CheckinWindowDetails } from '../api/types';
import { BookingStatusBadge } from '../components/booking-status-badge';
import { EditPanel } from '../components/edit-panel';
import { ReschedulePanel } from '../components/reschedule-panel';
import { bkkDate, bkkTime, formatDuration, formatThaiDate, formatTimeRange } from '../lib/datetime';
import { COPY, checkinWindowMessage, errorMessage, TIMELINE_LABELS } from '../lib/i18n';
import { authedRoute } from './authed';

export interface BookingDetailSearch {
  created?: boolean;
}

const actionButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[11px] px-3.5 text-sm font-bold';

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
  const search = bookingDetailRoute.useSearch();
  const { data: booking } = useSuspenseQuery(bookingQuery(bookingId));
  // Non-suspense: GET /rooms/:id 404s for since-deactivated rooms — history must
  // stay viewable, so the room line just falls back to nothing.
  const { data: room } = useQuery(roomQuery(booking.room_id));
  const { data: settings } = useQuery(settingsQuery);
  const checkIn = useCheckInBooking();
  const cancel = useCancelBooking(bookingId);

  const [rescheduling, setRescheduling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);

  const date = bkkDate(booking.start_at);
  const startTime = bkkTime(booking.start_at);
  const endTime = bkkTime(booking.end_at);
  const durationMinutes =
    (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000;
  const title = booking.visibility === 'BUSY' ? COPY.bookingDetail.busyTitle : booking.title;

  // history/can ride only on the FULL detail view; masked views get no buttons.
  const full = booking.visibility === 'FULL' ? booking : null;
  const can = full?.can;

  const checkinClosesAt =
    settings === undefined
      ? null
      : new Date(
          Math.min(
            new Date(booking.end_at).getTime(),
            new Date(booking.start_at).getTime() + settings.settings.checkin_grace_minutes * 60_000,
          ),
        ).toISOString();

  const confirmCancel = () => {
    const trimmed = reason.trim();
    if (trimmed !== '' && trimmed.length < 3) {
      setReasonError(true);
      return;
    }
    setReasonError(false);
    // UX-12: nothing optimistic — the dialog closes only after the server answers.
    cancel.mutate(trimmed === '' ? {} : { reason: trimmed }, {
      onSuccess: () => cancelDialogRef.current?.close(),
    });
  };

  return (
    <main className="mx-auto max-w-2xl p-4 md:p-6">
      {search.created === true ? (
        <p
          role="status"
          className="mb-4 rounded-xl border border-g2 bg-g0 px-3.5 py-3 text-sm font-bold text-g7"
        >
          {COPY.bookingDetail.created}
        </p>
      ) : null}

      <div className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <BookingStatusBadge status={booking.status} />
          {booking.is_private ? (
            <span className="inline-flex items-center rounded-full bg-n1 px-2 py-1 text-sm font-medium text-ink2">
              {COPY.bookingDetail.privateBadge}
            </span>
          ) : null}
          {can?.check_in && checkinClosesAt !== null ? (
            <Countdown
              until={checkinClosesAt}
              format={(minutes) => `เหลือ ${minutes} ${COPY.bookingDetail.checkinCountdownSuffix}`}
            />
          ) : null}
        </div>
        <h1 className="mt-3 text-2xl font-bold text-ink">{title}</h1>
        {room !== undefined ? (
          <p className="mt-1 text-sm text-muted">
            {room.name}
            {room.floor !== null ? ` · ${COPY.bookingDetail.floorPrefix} ${room.floor}` : ''}
          </p>
        ) : null}

        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between gap-3 border-b border-line pb-2">
            <dt className="text-muted">{COPY.bookingForm.dateRow}</dt>
            <dd className="font-semibold text-ink">
              {formatThaiDate(date, { withWeekday: true })}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-line pb-2">
            <dt className="text-muted">{COPY.bookingForm.timeRow}</dt>
            <dd className="font-semibold text-ink tabular-nums">
              {formatTimeRange(startTime, endTime)} · {formatDuration(durationMinutes)}
            </dd>
          </div>
          {booking.visibility !== 'BUSY' ? (
            <div className="flex justify-between gap-3 border-b border-line pb-2">
              <dt className="text-muted">{COPY.bookingDetail.owner}</dt>
              <dd className="font-semibold text-ink">{booking.owner.full_name}</dd>
            </div>
          ) : null}
          {full !== null && full.headcount !== null ? (
            <div className="flex justify-between gap-3 border-b border-line pb-2">
              <dt className="text-muted">{COPY.bookingDetail.headcount}</dt>
              <dd className="font-semibold text-ink">
                {full.headcount} {COPY.bookingDetail.people}
              </dd>
            </div>
          ) : null}
        </dl>

        {full?.cancel != null ? (
          <p className="mt-4 rounded-xl border border-r2 bg-r0 px-3.5 py-3 text-sm font-semibold text-r7">
            {COPY.bookingDetail.cancelledByPrefix}{' '}
            {full.cancel.cancelled_by?.full_name ?? full.owner.full_name}
            {full.cancel.reason !== null ? `: ${full.cancel.reason}` : ''}
          </p>
        ) : null}

        {full !== null && full.description !== null ? (
          <section className="mt-4">
            <h2 className="text-sm font-bold text-ink2">{COPY.bookingDetail.description}</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{full.description}</p>
          </section>
        ) : null}

        {full !== null && full.special_request !== null ? (
          <section className="mt-4">
            <h2 className="text-sm font-bold text-ink2">{COPY.bookingDetail.specialRequest}</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{full.special_request}</p>
          </section>
        ) : null}

        {/* E6/C2-03: actions come strictly from server `can` — never recomputed. */}
        {can !== undefined ? (
          <div aria-live="polite" className="mt-5 grid gap-3 border-t border-line pt-4">
            {checkIn.isError ? (
              <p
                role="alert"
                className="rounded-xl border border-r2 bg-r0 px-3.5 py-3 text-sm font-semibold text-r7"
              >
                {checkInErrorMessage(checkIn.error)}
              </p>
            ) : null}
            {checkIn.isSuccess ? (
              <p
                role="status"
                className="rounded-xl border border-g2 bg-g0 px-3.5 py-3 text-sm font-bold text-g7"
              >
                {COPY.checkin.successBadge} · {COPY.checkin.successHeadline}
              </p>
            ) : null}
            {savedMessage !== null ? (
              <p
                role="status"
                className="rounded-xl border border-g2 bg-g0 px-3.5 py-3 text-sm font-bold text-g7"
              >
                {savedMessage}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {can.check_in ? (
                <button
                  type="button"
                  disabled={checkIn.isPending}
                  onClick={() => checkIn.mutate({ bookingId })}
                  className={`${actionButtonClass} bg-g7 text-white disabled:opacity-60`}
                >
                  {checkIn.isPending ? COPY.bookingDetail.checkingIn : COPY.bookingDetail.checkIn}
                </button>
              ) : null}
              {can.edit ? (
                <button
                  type="button"
                  aria-expanded={editing}
                  onClick={() => {
                    setSavedMessage(null);
                    setEditing((value) => !value);
                    setRescheduling(false);
                  }}
                  className={`${actionButtonClass} border border-line bg-white text-ink2 hover:bg-g0`}
                >
                  {COPY.bookingDetail.edit}
                </button>
              ) : null}
              {can.reschedule ? (
                <button
                  type="button"
                  aria-expanded={rescheduling}
                  onClick={() => {
                    setRescheduling((value) => !value);
                    setEditing(false);
                  }}
                  className={`${actionButtonClass} border border-line bg-white text-ink2 hover:bg-g0`}
                >
                  {COPY.bookingDetail.reschedule}
                </button>
              ) : null}
              {can.cancel ? (
                <button
                  type="button"
                  onClick={() => cancelDialogRef.current?.showModal()}
                  className={`${actionButtonClass} border border-r2 bg-white text-r7 hover:bg-r0`}
                >
                  {COPY.bookingDetail.cancel}
                </button>
              ) : null}
              <a
                href={`/api/v1/bookings/${bookingId}/ics`}
                className={`${actionButtonClass} border border-line bg-white text-ink2 hover:bg-g0`}
              >
                {COPY.bookingDetail.ics}
              </a>
            </div>
          </div>
        ) : null}
      </div>

      {rescheduling && full !== null ? (
        <ReschedulePanel booking={full} onClose={() => setRescheduling(false)} />
      ) : null}

      {editing && full !== null ? (
        <EditPanel
          booking={full}
          {...(room !== undefined ? { roomCapacity: room.capacity } : {})}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSavedMessage(COPY.edit.saved);
          }}
        />
      ) : null}

      {full?.history !== undefined && full.history.length > 0 ? (
        <section className="mt-4 rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink2">{COPY.bookingDetail.timeline}</h2>
          <ol className="mt-3 grid gap-2.5">
            {full.history.map((event) => (
              <li key={`${event.event}-${event.at}`} className="flex items-baseline gap-3 text-sm">
                <span className="w-28 shrink-0 text-xs text-muted tabular-nums">
                  {formatThaiDate(bkkDate(event.at), { omitCurrentYear: true })} {bkkTime(event.at)}
                </span>
                <span className="font-semibold text-ink">{TIMELINE_LABELS[event.event]}</span>
                {event.actor !== null ? (
                  <span className="text-muted">· {event.actor.full_name}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Link
        to="/bookings"
        className="mt-4 inline-flex min-h-10 items-center rounded-[11px] border border-line bg-white px-4 text-sm font-semibold text-ink2 hover:bg-g0"
      >
        ← {COPY.bookingDetail.backToList}
      </Link>

      {/* E8: native <dialog> — Esc + focus trap + focus return for free; the
          destructive button sits after the textarea so it is never default-focused. */}
      <dialog
        ref={cancelDialogRef}
        aria-labelledby={`${bookingId}-cancel-title`}
        onClose={() => {
          setReason('');
          setReasonError(false);
          cancel.reset();
        }}
        className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-line bg-white p-5 backdrop:bg-black/40"
      >
        <h2 id={`${bookingId}-cancel-title`} className="text-lg font-bold text-ink">
          {COPY.cancelDialog.title}
        </h2>
        <p className="mt-1 text-sm text-r7">{COPY.cancelDialog.consequences}</p>
        <label
          htmlFor={`${bookingId}-cancel-reason`}
          className="mt-4 block text-sm font-semibold text-ink2"
        >
          {COPY.cancelDialog.reasonLabel}
        </label>
        <textarea
          id={`${bookingId}-cancel-reason`}
          className="mt-1.5 min-h-20 w-full rounded-[11px] border border-border-input bg-white px-3 py-2.5 text-base text-ink"
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div aria-live="polite" className="mt-2 grid gap-2">
          {reasonError ? (
            <p role="alert" className="text-xs font-semibold text-r7">
              {COPY.cancelDialog.reasonTooShort}
            </p>
          ) : null}
          {cancel.isError ? (
            <p role="alert" className="text-sm font-semibold text-r7">
              {errorMessage(cancel.error)}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => cancelDialogRef.current?.close()}
            className={`${actionButtonClass} border border-line bg-white text-ink2 hover:bg-g0`}
          >
            {COPY.cancelDialog.keep}
          </button>
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={confirmCancel}
            className={`${actionButtonClass} bg-r7 text-white disabled:opacity-60`}
          >
            {cancel.isPending ? COPY.cancelDialog.pending : COPY.cancelDialog.confirm}
          </button>
        </div>
      </dialog>
    </main>
  );
};

export const bookingDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bookings/$bookingId',
  validateSearch: (search: Record<string, unknown>): BookingDetailSearch => ({
    ...(search.created === true ? { created: true } : {}),
  }),
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(bookingQuery(params.bookingId));
  },
  component: BookingDetailPage,
});
