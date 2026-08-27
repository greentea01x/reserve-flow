import { BOOKING_STATUSES, type BookingStatus } from '@reserveflow/shared';
import { StatusBadge } from '@reserveflow/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId } from 'react';
import { adminRoomsQuery, type BookingsListParams, bookingsQuery } from '../api/queries';
import type { BookingView } from '../api/types';
import { chipClass, controlClass, fieldLabelClass } from '../components/filters';
import { Pager, pagerLinkClass } from '../components/pager';
import { AdminTable, EmptyCard } from '../components/table';
import { bkkDate, bkkTime, formatThaiDate, formatTimeRange, todayBkk } from '../lib/datetime';
import { COPY, STATUS_LABELS } from '../lib/i18n';
import { authedRoute } from './authed';

export interface BookingsSearch {
  /** Bangkok YYYY-MM-DD. Absent = today; the empty string = deliberately cleared. */
  from?: string;
  to?: string;
  room?: string;
  status?: BookingStatus;
  q?: string;
  page?: number;
}

const isFiltered = (search: BookingsSearch): boolean =>
  search.from !== undefined ||
  search.to !== undefined ||
  search.room !== undefined ||
  search.status !== undefined ||
  search.q !== undefined;

const paramsOf = (search: BookingsSearch): BookingsListParams => {
  const from = search.from ?? todayBkk();
  const to = search.to ?? '';
  // Same rule the employee app uses for its กำลังจะถึง / ประวัติ tabs: a range that ends
  // before today is history, so the newest row is the interesting one.
  const sort = to !== '' && to < todayBkk() ? ('-start_at' as const) : ('start_at' as const);
  return {
    ...(from !== '' ? { from } : {}),
    ...(to !== '' ? { to } : {}),
    ...(search.room !== undefined && search.room !== '' ? { room_id: search.room } : {}),
    ...(search.status !== undefined ? { status: search.status } : {}),
    ...(search.q !== undefined && search.q !== '' ? { q: search.q } : {}),
    page: search.page ?? 1,
    sort,
  };
};

/** Any filter change resets to page 1. */
const patched = (prev: BookingsSearch, patch: Partial<BookingsSearch>): BookingsSearch => {
  const next: BookingsSearch = { ...prev, ...patch };
  delete next.page;
  for (const key of ['from', 'to', 'room', 'q'] as const) {
    if (next[key] === undefined) {
      delete next[key];
    }
  }
  return next;
};

const rowSub = (booking: BookingView): string | null => {
  if (booking.visibility === 'BUSY') {
    return null;
  }
  const parts = [
    ...(booking.is_private ? [COPY.bookings.privateBadge] : []),
    ...(booking.attendee_count > 0
      ? [
          `${COPY.bookings.attendeesPrefix} ${booking.attendee_count} ${COPY.bookings.attendeesSuffix}`,
        ]
      : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : null;
};

const BookingsPage = () => {
  const search = bookingsRoute.useSearch();
  const params = paramsOf(search);
  const { data: list } = useSuspenseQuery(bookingsQuery(params));
  const { data: rooms } = useSuspenseQuery(adminRoomsQuery);
  const navigate = useNavigate({ from: '/bookings' });
  const fromId = useId();
  const toId = useId();
  const roomId = useId();
  const searchId = useId();

  const roomName = (id: string) => rooms.find((room) => room.id === id)?.name ?? '';
  const setSearch = (patch: Partial<BookingsSearch>) => {
    void navigate({ search: (prev: BookingsSearch) => patched(prev, patch) });
  };

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    setSearch({ q: typeof value === 'string' ? value.trim() : '' });
  };

  const statusChip = (status: BookingStatus | null, label: string) => {
    const active = status === null ? search.status === undefined : search.status === status;
    const next = patched(search, {});
    if (status === null) {
      delete next.status;
    } else {
      next.status = status;
    }
    return (
      <Link
        key={status ?? 'all'}
        to="/bookings"
        search={next}
        aria-current={active ? 'true' : undefined}
        className={chipClass(active)}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="p-4 md:p-6">
      <header>
        <h1 className="font-bold text-2xl text-ink">{COPY.bookings.title}</h1>
        <p className="text-muted text-sm">{COPY.bookings.sub}</p>
      </header>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label htmlFor={fromId} className={fieldLabelClass}>
            {COPY.bookings.fromLabel}
          </label>
          <input
            id={fromId}
            type="date"
            className={controlClass}
            value={search.from ?? todayBkk()}
            onChange={(event) => setSearch({ from: event.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={toId} className={fieldLabelClass}>
            {COPY.bookings.toLabel}
          </label>
          <input
            id={toId}
            type="date"
            className={controlClass}
            value={search.to ?? ''}
            onChange={(event) => setSearch({ to: event.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={roomId} className={fieldLabelClass}>
            {COPY.bookings.roomLabel}
          </label>
          <select
            id={roomId}
            className={controlClass}
            value={search.room ?? ''}
            onChange={(event) => setSearch({ room: event.target.value })}
          >
            <option value="">{COPY.bookings.allRooms}</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </div>
        <form onSubmit={onSearchSubmit} className="flex items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor={searchId} className={fieldLabelClass}>
              {COPY.bookings.searchLabel}
            </label>
            <input
              id={searchId}
              name="q"
              type="search"
              maxLength={200}
              defaultValue={search.q ?? ''}
              key={search.q ?? ''}
              className={`${controlClass} w-64 max-w-full`}
            />
          </div>
          <button
            type="submit"
            className="min-h-10 rounded-[11px] border border-line bg-white px-3 font-semibold text-ink2 text-sm hover:bg-g0"
          >
            {COPY.bookings.searchSubmit}
          </button>
        </form>
      </div>

      <nav aria-label={COPY.bookings.statusLabel} className="mt-3 flex flex-wrap gap-1.5">
        {statusChip(null, COPY.bookings.filterAll)}
        {BOOKING_STATUSES.map((status) => statusChip(status, STATUS_LABELS[status]))}
      </nav>

      {list.data.length === 0 ? (
        <div className="mt-4">
          <EmptyCard
            message={
              isFiltered(search) ? COPY.bookings.emptyFiltered : COPY.bookings.emptyNoFilters
            }
            action={
              isFiltered(search) ? (
                <Link
                  to="/bookings"
                  search={{}}
                  className="inline-flex min-h-10 items-center rounded-[13px] bg-g7 px-4 font-bold text-white"
                >
                  {COPY.states.clearFilters}
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-4">
            <AdminTable
              label={COPY.bookings.tableLabel}
              columns={[
                COPY.bookings.colMeeting,
                COPY.bookings.colWhen,
                COPY.bookings.colRoom,
                COPY.bookings.colOwner,
                COPY.bookings.colStatus,
                COPY.bookings.colActions,
              ]}
              rows={list.data}
              rowKey={(booking) => booking.id}
              renderRow={(booking) => (
                <>
                  <td className="px-4 py-3">
                    <Link
                      to="/bookings/$bookingId"
                      params={{ bookingId: booking.id }}
                      className="font-bold text-ink hover:text-g7"
                    >
                      {booking.visibility === 'BUSY' ? COPY.bookings.privateBadge : booking.title}
                    </Link>
                    {rowSub(booking) !== null ? (
                      <small className="block text-muted text-xs">{rowSub(booking)}</small>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink2">
                    {formatThaiDate(bkkDate(booking.start_at), { omitCurrentYear: true })}
                    <br />
                    <span className="tabular-nums">
                      {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink2">{roomName(booking.room_id)}</td>
                  <td className="px-4 py-3 text-ink2">
                    {booking.visibility === 'BUSY' ? (
                      '—'
                    ) : (
                      <>
                        {booking.owner.full_name}
                        {/* GAP: no employee_code rides on any booking payload — the owner's
                            department is the identifying detail the API does return. */}
                        {booking.owner.department !== null ? (
                          <small className="block text-muted text-xs">
                            {booking.owner.department.name}
                          </small>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={booking.status} />
                  </td>
                  <td className="px-4 py-3">
                    {/* Read-only slice. เช็กอินแทน / ยกเลิก need server capability flags,
                        which ride only on GET /bookings/:id — so they live on A5. */}
                    <Link
                      to="/bookings/$bookingId"
                      params={{ bookingId: booking.id }}
                      className="inline-flex min-h-8 items-center rounded-[9px] border border-line bg-white px-2.5 font-semibold text-ink2 text-xs hover:bg-g0"
                    >
                      {COPY.bookings.detail}
                    </Link>
                  </td>
                </>
              )}
            />
          </div>

          <Pager
            page={list.page.page}
            pageSize={list.page.page_size}
            total={list.page.total}
            renderLink={(targetPage, disabled, label) => (
              <Link
                to="/bookings"
                search={{ ...search, page: targetPage }}
                disabled={disabled}
                aria-disabled={disabled}
                className={pagerLinkClass}
              >
                {label}
              </Link>
            )}
          />
        </>
      )}
    </div>
  );
};

export const bookingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bookings',
  // Every filter lives in the URL: deep links and the back button must work.
  validateSearch: (search: Record<string, unknown>): BookingsSearch => ({
    ...(typeof search.from === 'string' ? { from: search.from } : {}),
    ...(typeof search.to === 'string' ? { to: search.to } : {}),
    ...(typeof search.room === 'string' && search.room !== '' ? { room: search.room } : {}),
    ...(BOOKING_STATUSES.includes(search.status as BookingStatus)
      ? { status: search.status as BookingStatus }
      : {}),
    ...(typeof search.q === 'string' && search.q !== '' ? { q: search.q } : {}),
    ...(typeof search.page === 'number' && Number.isInteger(search.page) && search.page > 1
      ? { page: search.page }
      : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(bookingsQuery(paramsOf(deps))),
      context.queryClient.ensureQueryData(adminRoomsQuery),
    ]);
  },
  component: BookingsPage,
});
