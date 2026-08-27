import { SlotGrid, type SlotGridCellState } from '@reserveflow/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useMemo } from 'react';
import { calendarQuery, settingsQuery } from '../api/queries';
import type { CalendarBookingView } from '../api/types';
import { controlClass } from '../components/filters';
import {
  addDays,
  bkkDate,
  bkkTime,
  formatThaiDate,
  formatTimeRange,
  minutesToTime,
  mondayOf,
  timeToMinutes,
  todayBkk,
} from '../lib/datetime';
import { COPY } from '../lib/i18n';
import { dayInfo } from '../lib/slots';
import { authedRoute } from './authed';

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export interface CalendarSearch {
  date?: string;
  view?: 'week';
  room?: string;
}

const searchOf = (date: string | null, week: boolean, room: string | null): CalendarSearch => ({
  ...(date !== null && date !== todayBkk() ? { date } : {}),
  ...(week ? { view: 'week' as const } : {}),
  ...(room !== null ? { room } : {}),
});

const rangeOf = (search: CalendarSearch): { date: string; from: string; to: string } => {
  const date = search.date ?? todayBkk();
  if (search.view === 'week') {
    const monday = mondayOf(date);
    return { date, from: monday, to: addDays(monday, 6) };
  }
  return { date, from: date, to: date };
};

const navButtonClass =
  'min-h-9 rounded-[11px] border border-line bg-white px-3 font-semibold text-ink2 text-sm hover:bg-g0';

/** Admins receive FULL views, so every booking can show its title and owner. */
const busyCell = (booking: CalendarBookingView, blockStart: boolean): SlotGridCellState => ({
  kind: 'busy',
  ...(booking.visibility === 'BUSY' ? {} : { label: booking.title }),
  ...(booking.owner_display_name !== undefined
    ? { secondaryLabel: `ผู้จอง: ${booking.owner_display_name}` }
    : {}),
  blockStart,
  activatable: true,
});

const CalendarPage = () => {
  const search = calendarRoute.useSearch();
  const navigate = useNavigate();
  const { date, from, to } = rangeOf(search);
  const view = search.view === 'week' ? 'week' : 'day';
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { data: calendar } = useSuspenseQuery(calendarQuery(from, to));
  const filterSelectId = useId();

  const increment = settings.settings.slot_increment_minutes;
  const rooms = calendar.rooms;
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const filterRoom = search.room !== undefined && roomById.has(search.room) ? search.room : null;
  const weekRoom = (filterRoom !== null ? roomById.get(filterRoom) : undefined) ?? rooms[0];

  const day = useMemo(() => dayInfo(settings, date), [settings, date]);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(from, index)),
    [from],
  );
  const weekDayInfo = useMemo(
    () => new Map(weekDates.map((entry) => [entry, dayInfo(settings, entry)])),
    [weekDates, settings],
  );

  // Week rows span the widest open hours across the week; per-day gaps render closed.
  const weekSpan = useMemo(() => {
    const open = weekDates.flatMap((entry) => {
      const info = weekDayInfo.get(entry);
      return info?.open ? [info] : [];
    });
    if (open.length === 0) {
      return null;
    }
    return {
      openMinutes: Math.min(...open.map((info) => info.openMinutes)),
      closeMinutes: Math.max(...open.map((info) => info.closeMinutes)),
    };
  }, [weekDates, weekDayInfo]);

  const rows = useMemo(() => {
    if (view === 'day') {
      return day.slots;
    }
    if (weekSpan === null) {
      return [];
    }
    const list: { start: string; end: string }[] = [];
    for (let at = weekSpan.openMinutes; at + increment <= weekSpan.closeMinutes; at += increment) {
      list.push({ start: minutesToTime(at), end: minutesToTime(at + increment) });
    }
    return list;
  }, [view, day, weekSpan, increment]);

  const gridOpenMinutes = view === 'day' ? day.openMinutes : (weekSpan?.openMinutes ?? 0);

  /** cell key `${columnKey}:${rowIndex}` → the booking occupying it. */
  const blocks = useMemo(() => {
    const map = new Map<string, { booking: CalendarBookingView; blockStart: boolean }>();
    for (const booking of calendar.bookings) {
      const bookingDate = bkkDate(booking.start_at);
      const columnKey = view === 'day' ? booking.room_id : bookingDate;
      if (view === 'day' && bookingDate !== date) {
        continue;
      }
      if (view === 'week' && booking.room_id !== weekRoom?.id) {
        continue;
      }
      const startRow = Math.max(
        0,
        Math.floor((timeToMinutes(bkkTime(booking.start_at)) - gridOpenMinutes) / increment),
      );
      const endRow = Math.min(
        rows.length,
        Math.ceil((timeToMinutes(bkkTime(booking.end_at)) - gridOpenMinutes) / increment),
      );
      for (let row = startRow; row < endRow; row += 1) {
        map.set(`${columnKey}:${row}`, { booking, blockStart: row === startRow });
      }
    }
    return map;
  }, [calendar.bookings, view, date, weekRoom?.id, gridOpenMinutes, increment, rows.length]);

  const dayColumns = useMemo(() => {
    const visible = filterRoom !== null ? rooms.filter((room) => room.id === filterRoom) : rooms;
    return visible.map((room) => ({
      key: room.id,
      label: room.name,
      ...(room.floor !== null ? { sublabel: `${COPY.rooms.floorPrefix} ${room.floor}` } : {}),
    }));
  }, [rooms, filterRoom]);

  const weekColumns = useMemo(
    () =>
      weekDates.map((entry) => {
        const info = weekDayInfo.get(entry);
        const sublabel = info?.holiday ?? (info?.open ? undefined : COPY.calendar.closedShort);
        return {
          key: entry,
          label: formatThaiDate(entry, { omitCurrentYear: true, withWeekday: true }),
          ...(sublabel !== undefined ? { sublabel } : {}),
        };
      }),
    [weekDates, weekDayInfo],
  );

  const dayCell = (roomId: string, rowIndex: number): SlotGridCellState => {
    const hit = blocks.get(`${roomId}:${rowIndex}`);
    return hit ? busyCell(hit.booking, hit.blockStart) : { kind: 'free' };
  };

  const weekCell = (dateKey: string, rowIndex: number): SlotGridCellState => {
    const info = weekDayInfo.get(dateKey);
    const row = rows[rowIndex];
    if (info === undefined || row === undefined || !info.open) {
      return {
        kind: 'closed',
        ...(rowIndex === 0 && info?.holiday !== undefined ? { label: info.holiday } : {}),
      };
    }
    const startMinutes = timeToMinutes(row.start);
    if (startMinutes < info.openMinutes || startMinutes + increment > info.closeMinutes) {
      return { kind: 'closed' };
    }
    const hit = blocks.get(`${dateKey}:${rowIndex}`);
    return hit ? busyCell(hit.booking, hit.blockStart) : { kind: 'free' };
  };

  const goTo = (nextDate: string | null, nextWeek: boolean, nextRoom: string | null) =>
    void navigate({ to: '/calendar', search: searchOf(nextDate, nextWeek, nextRoom) });

  /** A booked cell opens A5 — never a booking form (book-on-behalf is Phase 1.1). */
  const openBooking = (columnKey: string, rowIndex: number) => {
    const hit = blocks.get(`${columnKey}:${rowIndex}`);
    if (hit !== undefined) {
      void navigate({ to: '/bookings/$bookingId', params: { bookingId: hit.booking.id } });
    }
  };

  const stepDays = view === 'week' ? 7 : 1;
  const boardClosed = view === 'day' ? !day.open : rows.length === 0;

  const listBookings = calendar.bookings
    .filter((booking) =>
      view === 'week'
        ? booking.room_id === weekRoom?.id
        : bkkDate(booking.start_at) === date &&
          (filterRoom === null || booking.room_id === filterRoom),
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div className="p-4 md:p-6">
      <header>
        <h1 className="font-bold text-2xl text-ink">{COPY.calendar.title}</h1>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={navButtonClass}
          onClick={() => goTo(null, view === 'week', filterRoom)}
        >
          {COPY.calendar.today}
        </button>
        <button
          type="button"
          aria-label={COPY.calendar.prev}
          className={navButtonClass}
          onClick={() => goTo(addDays(date, -stepDays), view === 'week', filterRoom)}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={COPY.calendar.next}
          className={navButtonClass}
          onClick={() => goTo(addDays(date, stepDays), view === 'week', filterRoom)}
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <h2 className="min-w-40 font-bold text-base text-ink">
          {view === 'day'
            ? formatThaiDate(date, { withWeekday: true })
            : `${formatThaiDate(from, { omitCurrentYear: true })} – ${formatThaiDate(to)}`}
        </h2>

        <div className="ml-auto flex items-center gap-2">
          <fieldset className="flex rounded-[11px] border border-line bg-white p-0.5">
            <legend className="sr-only">{COPY.calendar.viewLabel}</legend>
            {(['day', 'week'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                className="min-h-8 rounded-lg px-3 font-semibold text-ink2 text-sm aria-pressed:bg-g1 aria-pressed:text-g7"
                onClick={() => goTo(date, mode === 'week', filterRoom)}
              >
                {mode === 'day' ? COPY.calendar.dayView : COPY.calendar.weekView}
              </button>
            ))}
          </fieldset>
          <label htmlFor={filterSelectId} className="sr-only">
            {COPY.calendar.roomLabel}
          </label>
          <select
            id={filterSelectId}
            className={controlClass}
            value={filterRoom ?? (view === 'week' ? (weekRoom?.id ?? '') : '')}
            onChange={(event) =>
              goTo(date, view === 'week', event.target.value === '' ? null : event.target.value)
            }
          >
            {view === 'day' ? <option value="">{COPY.calendar.allRooms}</option> : null}
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {boardClosed ? (
        <div className="mt-4 grid min-h-48 place-items-center rounded-2xl border border-line bg-n0 p-6 text-center">
          <div>
            <p className="font-bold text-ink2 text-lg">{COPY.calendar.closedDay}</p>
            {day.holiday !== undefined ? (
              <p className="mt-1 text-muted text-sm">
                {COPY.calendar.holidayPrefix}: {day.holiday}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-line bg-white p-3">
          {/* SlotGrid owns the APG grid contract (roving tabindex, arrows, Home/End,
              Enter/Space, aria-live). Nothing here wraps or intercepts its keys. */}
          <SlotGrid
            label={COPY.calendar.gridLabel}
            columns={view === 'day' ? dayColumns : weekColumns}
            rows={rows}
            getCell={view === 'day' ? dayCell : weekCell}
            onActivateBusy={openBooking}
          />
          <p className="mt-3 text-muted text-xs">{COPY.calendar.readOnly}</p>
          <ul className="mt-2 flex flex-wrap gap-3 text-muted text-xs" aria-hidden="true">
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border border-line bg-white" />{' '}
              {COPY.calendar.legendFree}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border border-r2 bg-r1" /> {COPY.calendar.legendBusy}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border border-line bg-n0" />{' '}
              {COPY.calendar.legendClosed}
            </li>
          </ul>
        </div>
      )}

      <section className="mt-4" aria-label={COPY.calendar.listTitle}>
        <h2 className="font-bold text-ink2 text-sm">{COPY.calendar.listTitle}</h2>
        {listBookings.length === 0 ? (
          <p className="mt-2 text-muted text-sm">{COPY.calendar.listEmpty}</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {listBookings.map((booking) => (
              <li
                key={booking.id}
                className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
              >
                <Link
                  to="/bookings/$bookingId"
                  params={{ bookingId: booking.id }}
                  className="block hover:text-g7"
                >
                  <b className="text-ink tabular-nums">
                    {view === 'week'
                      ? `${formatThaiDate(bkkDate(booking.start_at), { omitCurrentYear: true })} · `
                      : ''}
                    {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}
                  </b>
                  <span className="text-muted">
                    {' '}
                    · {roomById.get(booking.room_id)?.name ?? ''} ·{' '}
                    {booking.visibility === 'BUSY' ? COPY.bookings.privateBadge : booking.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export const calendarRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/calendar',
  validateSearch: (search: Record<string, unknown>): CalendarSearch => ({
    ...(typeof search.date === 'string' && DATE_PARAM.test(search.date)
      ? { date: search.date }
      : {}),
    ...(search.view === 'week' ? { view: 'week' as const } : {}),
    ...(typeof search.room === 'string' && search.room !== '' ? { room: search.room } : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const { from, to } = rangeOf(deps);
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(calendarQuery(from, to)),
    ]);
  },
  component: CalendarPage,
});
