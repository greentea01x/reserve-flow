import { BOOKING_STATUSES, type BookingStatus } from '@reserveflow/shared';
import { useQueries, useSuspenseQueries } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  DoorOpen,
  FastForward,
  MapPin,
  Plus,
} from 'lucide-react';
import { useId } from 'react';
import { useCheckInBooking, usePrepareDemoCheckIn } from '../api/mutations';
import { bookingQuery, bookingsQuery, meQuery, roomsQuery } from '../api/queries';
import type { BookingFull, BookingView } from '../api/types';
import { BookingStatusBadge } from '../components/booking-status-badge';
import { EMPLOYEE_BOOKING_FILTERS } from '../lib/booking-filters';
import { bkkDate, bkkTime, formatThaiDate, formatTimeRange, todayBkk } from '../lib/datetime';
import { isDemoCheckInCandidate } from '../lib/demo-check-in';
import { COPY, errorMessage, STATUS_LABELS } from '../lib/i18n';
import { authedRoute } from './authed';

export interface BookingsSearch {
  tab?: 'history';
  status?: BookingStatus;
  page?: number;
}

const paramsOf = (search: BookingsSearch) => ({
  tab: search.tab === 'history' ? ('history' as const) : ('upcoming' as const),
  ...(search.status !== undefined ? { status: search.status } : {}),
  page: search.page ?? 1,
});

const rowTitle = (booking: BookingView): string =>
  booking.visibility === 'BUSY' ? COPY.bookingDetail.busyTitle : booking.title;

const rowSub = (booking: BookingView): string | null => {
  if (booking.visibility === 'BUSY') {
    return null;
  }
  return booking.is_private ? COPY.bookingDetail.privateBadge : null;
};

const chipClass = (active: boolean) =>
  `inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors ${
    active ? 'border-g7 bg-g1 text-g7' : 'border-line bg-white text-ink2 hover:bg-g0'
  }`;

const CARD_TONE: Record<BookingStatus, string> = {
  CONFIRMED: 'border-g2/70 bg-g0',
  CHECKED_IN: 'border-g2 bg-mint-soft',
  COMPLETED: 'border-line bg-n0',
  CANCELLED: 'border-r1 bg-r0',
  AUTO_RELEASED: 'border-y2 bg-y0',
};

const DEMO_CHECK_IN_COPY = {
  ready: 'เดโม: ทดลองเช็กอิน',
  preparing: 'กำลังเตรียมเดโม…',
  error: 'เตรียมเดโมเช็กอินไม่สำเร็จ',
} as const;

const DemoCheckInAction = ({ booking, roomCode }: { booking: BookingFull; roomCode: string }) => {
  const navigate = useNavigate({ from: '/bookings' });
  const prepare = usePrepareDemoCheckIn();
  const errorId = useId();

  const prepareDemo = () => {
    prepare.mutate(
      { bookingId: booking.id, version: booking.version },
      {
        onSuccess: () => {
          // This opens the real QR landing; check-in still requires its explicit button press.
          void navigate({ to: '/check-in/$roomCode', params: { roomCode } });
        },
      },
    );
  };

  return (
    <span className="grid max-w-64 justify-items-end gap-1">
      <button
        type="button"
        disabled={prepare.isPending}
        aria-describedby={prepare.isError ? errorId : undefined}
        onClick={prepareDemo}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-y2 bg-y0 px-3 text-xs font-bold text-y7 hover:bg-y1 disabled:opacity-60"
      >
        <FastForward aria-hidden="true" className="size-3.5" />
        {prepare.isPending ? DEMO_CHECK_IN_COPY.preparing : DEMO_CHECK_IN_COPY.ready}
      </button>
      {prepare.isError ? (
        <span id={errorId} role="alert" className="text-right text-r7 text-xs">
          {DEMO_CHECK_IN_COPY.error}: {errorMessage(prepare.error)}
        </span>
      ) : null}
    </span>
  );
};

const BookingsPage = () => {
  const search = bookingsRoute.useSearch();
  const params = paramsOf(search);
  const [{ data: list }, { data: rooms }, { data: me }] = useSuspenseQueries({
    queries: [bookingsQuery(params), roomsQuery, meQuery],
  });
  const checkIn = useCheckInBooking();

  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const roomName = (roomId: string) => roomsById.get(roomId)?.name ?? '';
  const today = todayBkk();

  // Self check-in eligibility is server-decided (can.check_in, never client math).
  // Only today's own CONFIRMED rows can possibly qualify, so only those fetch detail.
  const candidates =
    params.tab === 'upcoming'
      ? list.data.filter(
          (booking) =>
            booking.is_mine &&
            booking.status === 'CONFIRMED' &&
            bkkDate(booking.start_at) === today,
        )
      : [];
  const details = useQueries({ queries: candidates.map((booking) => bookingQuery(booking.id)) });
  const checkInIds = new Set(
    details.flatMap((result) =>
      result.data?.visibility === 'FULL' && result.data.can?.check_in ? [result.data.id] : [],
    ),
  );
  // ponytail: can.check_in refreshes with the query cache (~30s), not per-second.

  const totalPages = Math.max(1, Math.ceil(list.page.total / list.page.page_size));

  const actions = (booking: BookingView) => {
    const room = roomsById.get(booking.room_id);
    return (
      <span className="flex flex-wrap items-center justify-end gap-2">
        <Link
          to="/bookings/$bookingId"
          params={{ bookingId: booking.id }}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-semibold text-ink2 hover:bg-g0"
        >
          {COPY.bookings.detail}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
        {checkInIds.has(booking.id) ? (
          <button
            type="button"
            disabled={checkIn.isPending}
            onClick={() => checkIn.mutate({ bookingId: booking.id })}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-g7 px-3 text-xs font-bold text-white disabled:opacity-60"
          >
            <DoorOpen aria-hidden="true" className="size-3.5" />
            {COPY.bookings.checkIn}
          </button>
        ) : null}
        {import.meta.env.DEV &&
        me.capabilities.demo_check_in &&
        room !== undefined &&
        isDemoCheckInCandidate(booking) ? (
          <DemoCheckInAction booking={booking} roomCode={room.code} />
        ) : null}
      </span>
    );
  };

  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">
            {COPY.bookings.title}
          </h1>
          <p className="mt-2 text-sm text-muted md:text-base">{COPY.bookings.sub}</p>
        </div>
        <Link
          to="/calendar"
          search={{}}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-g7 px-5 py-2.5 font-bold text-white transition-transform active:scale-[0.98]"
        >
          <Plus aria-hidden="true" className="size-4" />
          {COPY.bookings.newBooking}
        </Link>
      </header>

      {/* Navigation links styled as tabs — no tablist roles without the full APG tabs contract. */}
      <nav aria-label={COPY.bookings.title} className="mt-7 flex gap-1 border-b border-line">
        {(
          [
            ['upcoming', COPY.bookings.tabUpcoming],
            ['history', COPY.bookings.tabHistory],
          ] as const
        ).map(([tab, label]) => (
          <Link
            key={tab}
            aria-current={params.tab === tab ? 'page' : undefined}
            to="/bookings"
            search={tab === 'history' ? { tab: 'history' } : {}}
            className={`min-h-11 border-b-2 px-4 py-2.5 text-sm font-bold ${
              params.tab === tab
                ? 'border-g7 text-g7'
                : 'border-transparent text-muted hover:text-ink2'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <p className="mt-4 flex items-center gap-2 rounded-2xl border border-info/20 bg-info-soft px-4 py-3 text-info text-sm">
        <Clock3 aria-hidden="true" className="size-4 shrink-0" />
        <span>{COPY.bookings.checkInHint}</span>
      </p>

      <nav aria-label={COPY.bookings.filterLabel} className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/bookings"
          search={params.tab === 'history' ? { tab: 'history' } : {}}
          aria-current={search.status === undefined ? 'true' : undefined}
          className={chipClass(search.status === undefined)}
        >
          {COPY.bookings.filterAll}
        </Link>
        {EMPLOYEE_BOOKING_FILTERS.map((status) => (
          <Link
            key={status}
            to="/bookings"
            search={{ ...(params.tab === 'history' ? { tab: 'history' as const } : {}), status }}
            aria-current={search.status === status ? 'true' : undefined}
            className={chipClass(search.status === status)}
          >
            {STATUS_LABELS[status]}
          </Link>
        ))}
      </nav>

      {checkIn.isError ? (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-r2 bg-r0 px-4 py-3 text-sm font-semibold text-r7"
        >
          {errorMessage(checkIn.error)}
        </p>
      ) : null}

      {list.data.length === 0 ? (
        <div className="mt-5 grid min-h-56 place-items-center rounded-[2rem] border border-line bg-white p-6 text-center shadow-sm">
          <div>
            <p className="text-base font-bold text-ink2">
              {params.tab === 'history' ? COPY.bookings.emptyHistory : COPY.bookings.emptyUpcoming}
            </p>
            <Link
              to="/calendar"
              search={{}}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-g7 px-5 font-bold text-white"
            >
              <Plus aria-hidden="true" className="size-4" />
              {COPY.bookings.emptyCta}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-5 grid gap-3">
            {list.data.map((booking) => (
              <li
                key={booking.id}
                className={`min-w-0 rounded-[1.75rem] border p-4 shadow-sm md:p-5 ${CARD_TONE[booking.status]}`}
              >
                <article className="grid min-w-0 gap-4 md:grid-cols-[11rem_minmax(0,1fr)_auto] md:items-center">
                  <div className="rounded-2xl bg-white/80 px-4 py-3">
                    <span className="flex items-center gap-2 text-xs font-semibold text-muted">
                      <CalendarDays aria-hidden="true" className="size-3.5" />
                      {formatThaiDate(bkkDate(booking.start_at), { omitCurrentYear: true })}
                    </span>
                    <b className="mt-1 block text-base text-ink tabular-nums">
                      {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}
                    </b>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        to="/bookings/$bookingId"
                        params={{ bookingId: booking.id }}
                        className="min-w-0 text-lg font-bold text-ink hover:text-g7"
                      >
                        {rowTitle(booking)}
                      </Link>
                      <span className="shrink-0 md:hidden">
                        <BookingStatusBadge status={booking.status} />
                      </span>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-ink2">
                      <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                      {roomName(booking.room_id)}
                    </p>
                    {rowSub(booking) !== null ? (
                      <p className="mt-1 text-xs text-muted">{rowSub(booking)}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 md:flex-col md:items-end">
                    <span className="hidden md:block">
                      <BookingStatusBadge status={booking.status} />
                    </span>
                    {actions(booking)}
                  </div>
                </article>
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <nav
              aria-label={`${COPY.bookings.pagePrefix} ${params.page}/${totalPages}`}
              className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm"
            >
              <Link
                to="/bookings"
                search={{ ...search, page: params.page - 1 }}
                disabled={params.page <= 1}
                aria-disabled={params.page <= 1}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 py-1.5 font-semibold text-ink2 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                {COPY.bookings.prevPage}
              </Link>
              <span className="text-muted tabular-nums">
                {COPY.bookings.pagePrefix} {params.page}/{totalPages}
              </span>
              <Link
                to="/bookings"
                search={{ ...search, page: params.page + 1 }}
                disabled={params.page >= totalPages}
                aria-disabled={params.page >= totalPages}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 py-1.5 font-semibold text-ink2 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              >
                {COPY.bookings.nextPage}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
};

export const bookingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bookings',
  validateSearch: (search: Record<string, unknown>): BookingsSearch => ({
    ...(search.tab === 'history' ? { tab: 'history' as const } : {}),
    ...(BOOKING_STATUSES.includes(search.status as BookingStatus)
      ? { status: search.status as BookingStatus }
      : {}),
    ...(typeof search.page === 'number' && Number.isInteger(search.page) && search.page > 1
      ? { page: search.page }
      : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(bookingsQuery(paramsOf(deps))),
      context.queryClient.ensureQueryData(roomsQuery),
    ]);
  },
  component: BookingsPage,
});
