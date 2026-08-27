import { SlotGrid, type SlotGridCellState, type SlotGridSelection } from '@reserveflow/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { calendarQuery, settingsQuery } from '../api/queries';
import type { CalendarBookingView } from '../api/types';
import {
  addDays,
  bkkDate,
  bkkTime,
  formatDuration,
  formatThaiDate,
  formatTimeRange,
  minutesToTime,
  mondayOf,
  timeToMinutes,
  todayBkk,
} from '../lib/datetime';
import { selectDemoRooms } from '../lib/demo-rooms';
import { COPY } from '../lib/i18n';
import { dayInfo, slotBookable, slotHasElapsed } from '../lib/slots';
import { authedRoute } from './authed';

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export interface CalendarSearch {
  date?: string;
  view?: 'week';
  room?: string;
}

/** EMP-02: all board state lives in the URL so it survives reload/share. */
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

const controlClass =
  'min-h-9 rounded-[11px] border border-line bg-white px-3 text-sm font-semibold text-ink2 hover:bg-g0';
const selectClass =
  'min-h-10 w-full rounded-[11px] border border-border-input bg-white px-2.5 text-sm text-ink';

const bookingLabel = (booking: CalendarBookingView): string | undefined =>
  booking.visibility === 'BUSY' ? undefined : booking.title;

const busyCell = (booking: CalendarBookingView, blockStart: boolean): SlotGridCellState => {
  const label = bookingLabel(booking);
  return {
    kind: 'busy',
    ...(label !== undefined ? { label } : {}),
    ...(booking.owner_display_name !== undefined
      ? { secondaryLabel: `${COPY.calendar.bookerPrefix}: ${booking.owner_display_name}` }
      : {}),
    mine: booking.is_mine,
    blockStart,
  };
};

/** Keep elapsed/lead-time states current without refreshing the whole route. */
const useMinuteClock = (): Date => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeoutId = 0;
    const schedule = () => {
      const delay = 60_000 - (Date.now() % 60_000) + 50;
      timeoutId = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timeoutId);
  }, []);

  return now;
};

const CalendarPage = () => {
  const search = calendarRoute.useSearch();
  const navigate = useNavigate();
  const { date, from, to } = rangeOf(search);
  const view = search.view === 'week' ? 'week' : 'day';
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { data: calendar } = useSuspenseQuery(calendarQuery(from, to));
  const [selection, setSelection] = useState<SlotGridSelection | null>(null);
  const [panelRoom, setPanelRoom] = useState<string | null>(null);
  const now = useMinuteClock();
  const roomSelectId = useId();
  const startSelectId = useId();
  const endSelectId = useId();
  const filterSelectId = useId();

  const increment = settings.settings.slot_increment_minutes;
  const minDuration = settings.settings.min_duration_minutes;
  const maxDuration = settings.settings.max_duration_minutes;
  const minRows = Math.max(1, Math.ceil(minDuration / increment));
  const maxRows = maxDuration === null ? null : Math.floor(maxDuration / increment);

  const rooms = useMemo(() => selectDemoRooms(calendar.rooms), [calendar.rooms]);
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
      if (!roomById.has(booking.room_id)) {
        continue;
      }
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
  }, [
    calendar.bookings,
    roomById,
    view,
    date,
    weekRoom?.id,
    gridOpenMinutes,
    increment,
    rows.length,
  ]);

  // Selection only makes sense within one URL state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on any board change
  useEffect(() => setSelection(null), [date, view, filterRoom, rows]);

  const dayColumns = useMemo(() => {
    const visible = filterRoom !== null ? rooms.filter((room) => room.id === filterRoom) : rooms;
    return visible.map((room) => ({
      key: room.id,
      label: room.name,
      ...(room.floor !== null ? { sublabel: `ชั้น ${room.floor}` } : {}),
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
    if (hit) {
      return busyCell(hit.booking, hit.blockStart);
    }
    const row = rows[rowIndex];
    if (row === undefined) {
      return { kind: 'free', disabled: true };
    }
    if (slotHasElapsed(date, row.end, now)) {
      return { kind: 'past' };
    }
    return slotBookable(settings, date, row.start, now)
      ? { kind: 'free' }
      : { kind: 'free', disabled: true };
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
    if (hit) {
      return busyCell(hit.booking, hit.blockStart);
    }
    if (slotHasElapsed(dateKey, row.end, now)) {
      return { kind: 'past' };
    }
    // A week-view click books a min-duration slot outright, so the WHOLE span must
    // fit before close and be unoccupied — not just the clicked cell.
    let spanOpen = info.closeMinutes - startMinutes >= minDuration;
    for (let rw = rowIndex + 1; spanOpen && rw < rowIndex + minRows; rw += 1) {
      spanOpen = !blocks.has(`${dateKey}:${rw}`);
    }
    const bookable = spanOpen && slotBookable(settings, dateKey, row.start, now);
    return bookable ? { kind: 'free' } : { kind: 'free', disabled: true };
  };

  const cellFree = (columnKey: string, rowIndex: number): boolean => {
    const cell = view === 'day' ? dayCell(columnKey, rowIndex) : weekCell(columnKey, rowIndex);
    return cell.kind === 'free' && !cell.disabled;
  };

  const selectionStillFree =
    selection === null ||
    (roomById.has(selection.columnKey) &&
      Array.from(
        { length: selection.endRow - selection.startRow },
        (_, offset) => selection.startRow + offset,
      ).every((rowIndex) => cellFree(selection.columnKey, rowIndex)));

  // A minute boundary or refetched booking can invalidate an open selection.
  useEffect(() => {
    if (!selectionStillFree) {
      setSelection(null);
    }
  }, [selectionStillFree]);

  const anchorSelection = (roomId: string, rowIndex: number): SlotGridSelection => {
    let endRow = rowIndex + 1;
    while (
      endRow - rowIndex < minRows &&
      endRow < rows.length &&
      (maxRows === null || endRow - rowIndex < maxRows) &&
      cellFree(roomId, endRow)
    ) {
      endRow += 1;
    }
    return { columnKey: roomId, startRow: rowIndex, endRow };
  };

  const goTo = (nextDate: string | null, nextWeek: boolean, nextRoom: string | null) =>
    void navigate({ to: '/calendar', search: searchOf(nextDate, nextWeek, nextRoom) });

  /** E9: activating one's own booking block opens its detail page. */
  const openOwnBooking = (columnKey: string, rowIndex: number) => {
    const hit = blocks.get(`${columnKey}:${rowIndex}`);
    if (hit?.booking.is_mine) {
      void navigate({ to: '/bookings/$bookingId', params: { bookingId: hit.booking.id } });
    }
  };

  const stepDays = view === 'week' ? 7 : 1;

  // ----- selection facts for the panel + CTA -----
  const selectionStart = selection === null ? undefined : rows[selection.startRow];
  const selectionEnd = selection === null ? undefined : rows[selection.endRow - 1];
  const selectionRoom = selection === null ? undefined : roomById.get(selection.columnKey);
  const selectionMinutes =
    selection === null ? 0 : (selection.endRow - selection.startRow) * increment;
  const selectionValid =
    selection !== null &&
    selectionStart !== undefined &&
    selectionEnd !== undefined &&
    selectionRoom !== undefined &&
    selectionStillFree &&
    selectionMinutes >= minDuration &&
    (maxDuration === null || selectionMinutes <= maxDuration);
  const panelRoomId = selection?.columnKey ?? panelRoom ?? dayColumns[0]?.key ?? '';

  const proceed = () => {
    if (
      !selectionValid ||
      selection === null ||
      selectionStart === undefined ||
      selectionEnd === undefined
    ) {
      return;
    }
    void navigate({
      to: '/bookings/new',
      search: {
        room: selection.columnKey,
        date,
        start: selectionStart.start,
        end: selectionEnd.end,
      },
    });
  };

  const listBookings = calendar.bookings
    .filter((booking) => {
      if (!roomById.has(booking.room_id)) {
        return false;
      }
      return view === 'week'
        ? booking.room_id === weekRoom?.id
        : bkkDate(booking.start_at) === date &&
            (filterRoom === null || booking.room_id === filterRoom);
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const boardClosed = view === 'day' ? !day.open : rows.length === 0;

  return (
    <main className="p-4 md:p-6">
      <h1 className="text-2xl font-bold text-ink">{COPY.calendar.title}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={controlClass}
          onClick={() => goTo(null, view === 'week', filterRoom)}
        >
          {COPY.calendar.today}
        </button>
        <button
          type="button"
          aria-label={COPY.calendar.prev}
          className={controlClass}
          onClick={() => goTo(addDays(date, -stepDays), view === 'week', filterRoom)}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={COPY.calendar.next}
          className={controlClass}
          onClick={() => goTo(addDays(date, stepDays), view === 'week', filterRoom)}
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <h2 className="min-w-40 text-base font-bold text-ink">
          {view === 'day'
            ? formatThaiDate(date, { withWeekday: true })
            : `${formatThaiDate(from, { omitCurrentYear: true })} – ${formatThaiDate(to)}`}
        </h2>

        <div className="ml-auto flex items-center gap-2">
          <fieldset className="flex rounded-[11px] border border-line bg-white p-0.5">
            <legend className="sr-only">มุมมอง</legend>
            {(['day', 'week'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                className="min-h-8 rounded-lg px-3 text-sm font-semibold text-ink2 aria-pressed:bg-g1 aria-pressed:text-g7"
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
            className={`${selectClass} w-auto`}
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
            <p className="text-lg font-bold text-ink2">{COPY.calendar.closedDay}</p>
            {day.holiday !== undefined ? (
              <p className="mt-1 text-sm text-muted">
                {COPY.calendar.holidayPrefix}: {day.holiday}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 hidden rounded-2xl border border-line bg-white p-3 sm:block">
          <SlotGrid
            label={COPY.calendar.gridLabel}
            columns={view === 'day' ? dayColumns : weekColumns}
            rows={rows}
            getCell={view === 'day' ? dayCell : weekCell}
            onActivateBusy={openOwnBooking}
            {...(view === 'day'
              ? { selection, onSelectionChange: setSelection, minRows, maxRows }
              : {
                  onActivateCell: (dateKey: string, rowIndex: number) => {
                    const row = rows[rowIndex];
                    if (row === undefined || weekRoom === undefined) {
                      return;
                    }
                    void navigate({
                      to: '/bookings/new',
                      search: {
                        room: weekRoom.id,
                        date: dateKey,
                        start: row.start,
                        end: minutesToTime(timeToMinutes(row.start) + minDuration),
                      },
                    });
                  },
                })}
          />
          <ul className="mt-3 flex flex-wrap gap-3 text-xs text-muted" aria-hidden="true">
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border border-line bg-white" />{' '}
              {COPY.calendar.legendFree}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border border-r2 bg-r1" /> {COPY.calendar.legendBusy}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border border-g2 bg-g1" /> {COPY.calendar.legendMine}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border-2 border-g7 bg-g1" />{' '}
              {COPY.calendar.legendSelected}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border border-line bg-n0" />{' '}
              {COPY.calendar.legendClosed}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded border border-line bg-n1" />{' '}
              {COPY.calendar.legendPast}
            </li>
          </ul>
        </div>
      )}

      {/* A11Y-05: the native selects are the guaranteed non-grid path; on <640px
          they are the primary picker (the wide grid is hidden there). */}
      {view === 'day' && !boardClosed ? (
        <section
          aria-label={COPY.calendar.proceed}
          className="mt-4 rounded-2xl border border-line bg-white p-4"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label htmlFor={roomSelectId} className="text-sm font-semibold text-ink2">
                {COPY.calendar.roomLabel}
              </label>
              <select
                id={roomSelectId}
                className={selectClass}
                value={panelRoomId}
                onChange={(event) => {
                  const roomId = event.target.value;
                  setPanelRoom(roomId);
                  if (selection !== null) {
                    let free = true;
                    for (let row = selection.startRow; row < selection.endRow; row += 1) {
                      free = free && cellFree(roomId, row);
                    }
                    setSelection(free ? { ...selection, columnKey: roomId } : null);
                  }
                }}
              >
                {dayColumns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={startSelectId} className="text-sm font-semibold text-ink2">
                {COPY.calendar.startLabel}
              </label>
              <select
                id={startSelectId}
                className={selectClass}
                value={selectionStart?.start ?? ''}
                onChange={(event) => {
                  const rowIndex = rows.findIndex((row) => row.start === event.target.value);
                  if (rowIndex >= 0 && panelRoomId !== '') {
                    setSelection(anchorSelection(panelRoomId, rowIndex));
                  }
                }}
              >
                <option value="" disabled>
                  --:--
                </option>
                {rows.map((row, rowIndex) => (
                  <option
                    key={row.start}
                    value={row.start}
                    disabled={panelRoomId === '' || !cellFree(panelRoomId, rowIndex)}
                  >
                    {row.start}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={endSelectId} className="text-sm font-semibold text-ink2">
                {COPY.calendar.endLabel}
              </label>
              <select
                id={endSelectId}
                className={selectClass}
                value={selectionEnd?.end ?? ''}
                disabled={selection === null}
                onChange={(event) => {
                  if (selection === null) {
                    return;
                  }
                  const rowIndex = rows.findIndex((row) => row.end === event.target.value);
                  if (rowIndex >= selection.startRow) {
                    setSelection({ ...selection, endRow: rowIndex + 1 });
                  }
                }}
              >
                <option value="" disabled>
                  --:--
                </option>
                {selection !== null
                  ? rows.map((row, rowIndex) => {
                      if (rowIndex < selection.startRow) {
                        return null;
                      }
                      const lengthRows = rowIndex + 1 - selection.startRow;
                      let free = true;
                      for (let at = selection.startRow; at <= rowIndex; at += 1) {
                        free = free && cellFree(selection.columnKey, at);
                      }
                      const minutesLong = lengthRows * increment;
                      const valid =
                        free &&
                        minutesLong >= minDuration &&
                        (maxDuration === null || minutesLong <= maxDuration);
                      return (
                        <option key={row.end} value={row.end} disabled={!valid}>
                          {row.end}
                        </option>
                      );
                    })
                  : null}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink2">
              {selectionValid && selectionRoom !== undefined ? (
                <>
                  {COPY.calendar.selectedPrefix}{' '}
                  <b className="text-ink">
                    {selectionRoom.name} ·{' '}
                    {formatTimeRange(selectionStart?.start ?? '', selectionEnd?.end ?? '')} ·{' '}
                    {formatDuration(selectionMinutes)}
                  </b>
                </>
              ) : selection !== null ? (
                `จองขั้นต่ำ ${formatDuration(minDuration)}`
              ) : (
                COPY.calendar.noSelection
              )}
            </p>
            <button
              type="button"
              disabled={!selectionValid}
              onClick={proceed}
              className="min-h-11 rounded-[13px] bg-g7 px-5 font-bold text-white disabled:opacity-50"
            >
              {COPY.calendar.proceed}
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-4 sm:hidden" aria-label={COPY.calendar.dayListTitle}>
        <h3 className="text-sm font-bold text-ink2">{COPY.calendar.dayListTitle}</h3>
        {listBookings.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{COPY.calendar.noBookingsInRange}</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {listBookings.map((booking) => {
              const line = (
                <>
                  <b className="text-ink tabular-nums">
                    {view === 'week'
                      ? `${formatThaiDate(bkkDate(booking.start_at), { omitCurrentYear: true })} · `
                      : ''}
                    {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}
                  </b>
                  <span className="text-muted">
                    {' '}
                    · {roomById.get(booking.room_id)?.name ?? ''} ·{' '}
                    {bookingLabel(booking) ?? COPY.calendar.busyMasked}
                    {booking.owner_display_name !== undefined ? (
                      <>
                        {' · '}
                        {COPY.calendar.bookerPrefix}: {booking.owner_display_name}
                      </>
                    ) : null}
                  </span>
                </>
              );
              return (
                <li
                  key={booking.id}
                  className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
                >
                  {/* E9: own bookings link to their detail page. */}
                  {booking.is_mine ? (
                    <Link
                      to="/bookings/$bookingId"
                      params={{ bookingId: booking.id }}
                      className="block hover:text-g7"
                    >
                      {line}
                    </Link>
                  ) : (
                    line
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
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
