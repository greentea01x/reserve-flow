import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, CircleX, Clock3, DoorOpen } from 'lucide-react';
import { ApiClientError } from '../api/client';
import { useCheckInRoom } from '../api/mutations';
import { roomsQuery } from '../api/queries';
import type { CheckinWindowDetails } from '../api/types';
import { bkkTime, formatTimeRange } from '../lib/datetime';
import { COPY, checkinWindowMessage, errorMessage } from '../lib/i18n';
import { authedRoute } from './authed';

const failureReason = (error: unknown): string => {
  if (error instanceof ApiClientError) {
    const { code, details } = error.envelope;
    if (code === 'NOT_FOUND') {
      return COPY.checkin.unknownRoom;
    }
    if (code === 'CHECKIN_WINDOW_CLOSED') {
      const window = details as CheckinWindowDetails | undefined;
      if (window?.opens_at !== undefined) {
        return checkinWindowMessage(
          formatTimeRange(bkkTime(window.opens_at), bkkTime(window.closes_at)),
        );
      }
    }
  }
  return errorMessage(error);
};

/**
 * E10: the printed QR encodes /check-in/<roomCode>. The authed guard runs first
 * (logged-out → /login?redirect=… → back here). Check-in fires only on the
 * explicit "เปิดใช้งานการจอง" press — never on load (intent + the 10/min limit).
 * Re-scans after success return already_checked_in=true → same success modal.
 */
const CheckInPage = () => {
  const { roomCode } = checkInRoute.useParams();
  const { data: rooms } = useQuery(roomsQuery);
  const checkIn = useCheckInRoom();

  const room = rooms?.find((entry) => entry.code.toLowerCase() === roomCode.toLowerCase());
  const roomLabel =
    room !== undefined
      ? `${room.name}${room.floor !== null ? ` · ${COPY.bookingDetail.floorPrefix} ${room.floor}` : ''}`
      : roomCode;
  const booking = checkIn.data?.booking;

  return (
    <main className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-lg content-center p-4 md:p-8">
      <section className="relative overflow-hidden rounded-[2.25rem] bg-info-soft p-4 shadow-sm sm:p-6">
        <span
          aria-hidden="true"
          className="absolute -top-16 -right-16 size-48 rounded-full bg-white/35"
        />
        <span
          aria-hidden="true"
          className="absolute -bottom-20 -left-16 size-52 rounded-full bg-white/25"
        />

        <header className="relative flex items-center justify-between">
          <Link
            to="/bookings"
            aria-label={COPY.checkin.myBookings}
            className="grid size-10 place-items-center rounded-full bg-white/70 text-info hover:bg-white"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
          <h1 className="font-bold text-ink">{COPY.bookings.checkIn}</h1>
          <span aria-hidden="true" className="size-10" />
        </header>

        <div className="relative mt-7 rounded-[1.9rem] border border-white bg-white p-5 text-center shadow-sm sm:p-7">
          <p className="text-xl font-bold tracking-tight text-ink">{room?.name ?? roomCode}</p>
          {room?.floor !== null && room?.floor !== undefined ? (
            <p className="mt-1 text-sm text-muted">
              {COPY.bookingDetail.floorPrefix} {room.floor}
            </p>
          ) : null}

          {!checkIn.isSuccess ? (
            <>
              <div
                aria-hidden="true"
                className="mx-auto mt-6 grid aspect-square w-32 place-items-center rounded-2xl border border-line bg-g0 sm:w-36"
              >
                <span className="grid size-20 place-items-center rounded-xl border border-info/20 bg-white text-info">
                  <DoorOpen className="size-12" strokeWidth={1.5} />
                </span>
              </div>

              <p className="mx-auto mt-5 max-w-xs text-sm leading-6 text-ink2">
                {COPY.checkin.landingHint}
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
                <Clock3 aria-hidden="true" className="size-3.5" />
                {roomLabel}
              </p>

              <button
                type="button"
                disabled={checkIn.isPending}
                onClick={() => checkIn.mutate(roomCode)}
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-g7 px-5 font-bold text-white transition-transform active:scale-[0.99] disabled:opacity-60"
              >
                <DoorOpen aria-hidden="true" className="size-5" />
                {checkIn.isPending
                  ? COPY.checkin.checking
                  : checkIn.isError
                    ? COPY.checkin.retry
                    : COPY.checkin.activate}
              </button>
            </>
          ) : null}

          <div aria-live="assertive">
            {checkIn.isSuccess && booking !== undefined ? (
              <div role="status" className="mt-6 rounded-2xl border border-g2 bg-g0 p-5">
                <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-g7" />
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-g1 px-3 py-1 text-sm font-bold text-g7">
                  {COPY.checkin.successBadge}
                </span>
                <p className="mt-3 text-lg font-bold text-ink">{COPY.checkin.successHeadline}</p>
                <p className="mt-2 text-sm text-ink2 tabular-nums">
                  {room?.name ?? roomCode} ·{' '}
                  {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}
                </p>
                {booking.visibility !== 'BUSY' ? (
                  <p className="mt-1 text-sm text-ink2">{booking.title}</p>
                ) : null}
                <p className="mt-3 text-xs text-muted">{COPY.checkin.statusLine}</p>
              </div>
            ) : null}

            {checkIn.isError ? (
              <div role="alert" className="mt-4 rounded-2xl border border-r2 bg-r0 p-4">
                <CircleX aria-hidden="true" className="mx-auto size-7 text-r7" />
                <span className="mt-2 inline-flex rounded-full bg-r1 px-3 py-1 text-sm font-bold text-r7">
                  {COPY.checkin.failBadge}
                </span>
                <p className="mt-3 text-sm font-bold text-ink">{failureReason(checkIn.error)}</p>
                <Link
                  to="/bookings"
                  className="mt-3 inline-flex text-sm font-semibold text-r7 underline"
                >
                  {COPY.checkin.myBookings}
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
};

export const checkInRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/check-in/$roomCode',
  component: CheckInPage,
});
