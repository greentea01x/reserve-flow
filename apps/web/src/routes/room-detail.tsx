import { SlotGrid, type SlotGridCellState, type SlotGridSelection } from '@reserveflow/ui';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  MapPin,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { calendarQuery, roomQuery, settingsQuery } from '../api/queries';
import { ThaiDatePickerField } from '../components/date-picker-field';
import { RoomPhoto } from '../components/room-photo';
import { selectionFromTimeRange } from '../lib/booking-flow';
import {
  addDays,
  bkkDate,
  bkkTime,
  formatDuration,
  formatThaiDate,
  formatTimeRange,
  minutesToTime,
  timeToMinutes,
  todayBkk,
} from '../lib/datetime';
import { COPY, errorMessage } from '../lib/i18n';
import { dayInfo, slotBookable } from '../lib/slots';
import { authedRoute } from './authed';

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PARAM = /^\d{2}:\d{2}$/;

export interface RoomDetailSearch {
  date?: string;
  start?: string;
  end?: string;
}

const selectClass =
  'min-h-12 w-full rounded-2xl border border-line bg-white px-3 text-sm font-medium text-ink hover:border-border-input';

/**
 * E3: room facts + Buddhist Era date picker + one-column SlotGrid with the paired native
 * selects (A11Y-05's guaranteed non-grid path), then "ดำเนินการจอง" → E4.
 */
const RoomDetailPage = () => {
  const { roomId } = roomDetailRoute.useParams();
  const search = roomDetailRoute.useSearch();
  const navigate = useNavigate();
  const { data: room } = useSuspenseQuery(roomQuery(roomId));
  const { data: settings } = useSuspenseQuery(settingsQuery);

  const [date, setDate] = useState(search.date ?? todayBkk());
  const calendarResult = useQuery(calendarQuery(date, date));
  const calendar = calendarResult.data;

  const dateId = useId();
  const startId = useId();
  const endId = useId();

  const increment = settings.settings.slot_increment_minutes;
  const minDuration = settings.settings.min_duration_minutes;
  const maxDuration = settings.settings.max_duration_minutes;
  const minRows = Math.max(1, Math.ceil(minDuration / increment));
  const maxRows = maxDuration === null ? null : Math.floor(maxDuration / increment);

  const day = useMemo(() => dayInfo(settings, date), [settings, date]);
  const rows = day.slots;
  const [selection, setSelection] = useState<SlotGridSelection | null>(() =>
    selectionFromTimeRange(roomId, rows, search.start, search.end),
  );

  /** rowIndex → occupying booking cell (this room, this day). */
  const blocks = useMemo(() => {
    const map = new Map<number, { label?: string; mine: boolean; blockStart: boolean }>();
    if (calendar === undefined || !day.open) {
      return map;
    }
    for (const entry of calendar.bookings) {
      if (entry.room_id !== roomId || bkkDate(entry.start_at) !== date) {
        continue;
      }
      const startRow = Math.max(
        0,
        Math.floor((timeToMinutes(bkkTime(entry.start_at)) - day.openMinutes) / increment),
      );
      const endRow = Math.min(
        rows.length,
        Math.ceil((timeToMinutes(bkkTime(entry.end_at)) - day.openMinutes) / increment),
      );
      for (let row = startRow; row < endRow; row += 1) {
        map.set(row, {
          ...(entry.visibility !== 'BUSY' ? { label: entry.title } : {}),
          mine: entry.is_mine,
          blockStart: row === startRow,
        });
      }
    }
    return map;
  }, [calendar, day, date, roomId, increment, rows.length]);

  const getCell = (_columnKey: string, rowIndex: number): SlotGridCellState => {
    const hit = blocks.get(rowIndex);
    if (hit !== undefined) {
      return { kind: 'busy', ...hit };
    }
    const row = rows[rowIndex];
    return row !== undefined && slotBookable(settings, date, row.start)
      ? { kind: 'free' }
      : { kind: 'free', disabled: true };
  };

  const cellFree = (rowIndex: number): boolean => {
    const cell = getCell(roomId, rowIndex);
    return cell.kind === 'free' && !cell.disabled;
  };

  const selectionStillFree =
    selection === null ||
    calendar === undefined ||
    Array.from(
      { length: selection.endRow - selection.startRow },
      (_, offset) => selection.startRow + offset,
    ).every(cellFree);

  // A slot may have been taken while the user was filling E4. Never revive an
  // occupied/past URL range as a valid selection when they return to E3.
  useEffect(() => {
    if (calendar !== undefined && !selectionStillFree) {
      setSelection(null);
    }
  }, [calendar, selectionStillFree]);

  const anchorSelection = (rowIndex: number): SlotGridSelection => {
    let endRow = rowIndex + 1;
    while (
      endRow - rowIndex < minRows &&
      endRow < rows.length &&
      (maxRows === null || endRow - rowIndex < maxRows) &&
      cellFree(endRow)
    ) {
      endRow += 1;
    }
    return { columnKey: roomId, startRow: rowIndex, endRow };
  };

  const changeDate = (next: string) => {
    if (!DATE_PARAM.test(next)) {
      return; // cleared input — keep the last valid date
    }
    setDate(next);
    setSelection(null);
  };

  const selectionStart = selection === null ? undefined : rows[selection.startRow];
  const selectionEnd = selection === null ? undefined : rows[selection.endRow - 1];
  const selectionMinutes =
    selection === null ? 0 : (selection.endRow - selection.startRow) * increment;
  const selectionValid =
    selection !== null &&
    selectionStart !== undefined &&
    selectionEnd !== undefined &&
    selectionStillFree &&
    selectionMinutes >= minDuration &&
    (maxDuration === null || selectionMinutes <= maxDuration);

  const proceed = () => {
    if (!selectionValid || selectionStart === undefined || selectionEnd === undefined) {
      return;
    }
    void navigate({
      to: '/bookings/new',
      search: { room: roomId, date, start: selectionStart.start, end: selectionEnd.end },
    });
  };

  const featureNames = room.features.map((feature) => feature.name).join(' · ');
  const openHours = day.open
    ? formatTimeRange(minutesToTime(day.openMinutes), minutesToTime(day.closeMinutes))
    : null;
  const latestDate = addDays(todayBkk(), settings.settings.max_advance_days);

  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <Link
        to="/rooms"
        className="inline-flex min-h-10 items-center gap-2 rounded-full bg-g0 px-4 text-sm font-semibold text-ink2 transition-colors hover:bg-g1"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {COPY.rooms.title}
      </Link>

      <section className="mt-5 grid overflow-hidden rounded-[2rem] border border-line bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]">
        <RoomPhoto
          room={room}
          eager
          className="h-64 w-full rounded-[1.4rem] object-cover sm:h-80 lg:h-full lg:min-h-[22rem]"
        />
        <div className="flex flex-col justify-center p-5 md:p-7">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-peach-soft px-3 py-1.5 text-xs font-bold text-ink2">
            <Sparkles aria-hidden="true" className="size-3.5" />
            {COPY.roomDetail.autoApprove}
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink md:text-4xl">
            {room.name}
          </h1>
          {room.description !== null ? (
            <p className="mt-2 text-sm leading-6 text-muted">{room.description}</p>
          ) : null}

          <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-line bg-g0/60 p-3">
              <dt className="flex items-center gap-3 text-xs text-muted">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-g7">
                  <UsersRound aria-hidden="true" className="size-4" />
                </span>
                {COPY.roomDetail.capacity}
              </dt>
              <dd className="-mt-4 ml-12 font-semibold text-ink">
                {room.capacity} {COPY.rooms.people}
              </dd>
            </div>
            {featureNames !== '' ? (
              <div className="rounded-2xl border border-line bg-g0/60 p-3">
                <dt className="flex items-center gap-3 text-xs text-muted">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-g7">
                    <Sparkles aria-hidden="true" className="size-4" />
                  </span>
                  {COPY.roomDetail.features}
                </dt>
                <dd className="-mt-4 ml-12 font-semibold text-ink">{featureNames}</dd>
              </div>
            ) : null}
            {room.floor !== null ? (
              <div className="rounded-2xl border border-line bg-g0/60 p-3">
                <dt className="flex items-center gap-3 text-xs text-muted">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-g7">
                    <MapPin aria-hidden="true" className="size-4" />
                  </span>
                  {COPY.roomDetail.floor}
                </dt>
                <dd className="-mt-4 ml-12 font-semibold text-ink">{room.floor}</dd>
              </div>
            ) : null}
          </dl>

          {openHours !== null ? (
            <p className="mt-4 rounded-2xl bg-y0 px-4 py-3 text-xs text-y7 tabular-nums">
              <b>{COPY.roomDetail.hoursPrefix}:</b> {openHours} ·{' '}
              {COPY.roomDetail.minDurationPrefix} {formatDuration(minDuration)}
            </p>
          ) : null}
        </div>
      </section>

      <section
        aria-label={COPY.roomDetail.gridLabel}
        className="mt-6 rounded-[2rem] border border-line bg-white p-5 shadow-sm md:p-7"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink">
              {COPY.roomDetail.gridLabel}
            </h2>
            <p className="mt-1 text-sm text-muted">{formatThaiDate(date, { withWeekday: true })}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-g0 px-3 py-1.5 text-xs font-semibold text-ink2">
            <Clock3 aria-hidden="true" className="size-3.5" />
            {COPY.roomDetail.minDurationPrefix} {formatDuration(minDuration)}
          </span>
        </div>

        <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.8fr)]">
          <aside className="self-start rounded-[1.5rem] bg-g0 p-4 md:p-5">
            <label htmlFor={dateId} className="flex items-center gap-2 text-sm font-bold text-ink2">
              <CalendarDays aria-hidden="true" className="size-4 text-g7" />
              {COPY.roomDetail.pickDate}
            </label>
            <ThaiDatePickerField
              id={dateId}
              label={COPY.roomDetail.pickDate}
              value={date}
              min={todayBkk()}
              max={latestDate}
              onChange={changeDate}
              isDateDisabled={(nextDate) => !dayInfo(settings, nextDate).open}
              className={`${selectClass} mt-3`}
            />
            <p className="mt-2 text-xs text-muted">
              {COPY.roomDetail.maxAdvancePrefix} {formatThaiDate(latestDate)}
            </p>

            {openHours !== null ? (
              <div className="mt-5 border-t border-line pt-4">
                <p className="text-xs font-bold text-muted">{COPY.roomDetail.hoursPrefix}</p>
                <p className="mt-1 text-lg font-bold text-ink tabular-nums">{openHours}</p>
              </div>
            ) : null}
          </aside>

          <div className="min-w-0">
            {!day.open ? (
              <p className="rounded-2xl bg-n0 px-4 py-4 text-sm font-semibold text-ink2">
                {COPY.roomDetail.closedDay}
                {day.holiday !== undefined ? ` · ${day.holiday}` : ''}
              </p>
            ) : calendarResult.isPending ? (
              <div aria-busy="true" className="h-56 animate-pulse rounded-2xl bg-g0">
                <span className="sr-only">{COPY.states.loading}</span>
              </div>
            ) : calendarResult.isError ? (
              <p
                role="alert"
                className="rounded-2xl border border-r2 bg-r0 px-4 py-3 text-sm font-semibold text-r7"
              >
                {errorMessage(calendarResult.error)}
              </p>
            ) : (
              <>
                <div className="hidden sm:block">
                  <SlotGrid
                    label={COPY.roomDetail.gridLabel}
                    columns={[
                      {
                        key: roomId,
                        label: room.name,
                        ...(room.floor !== null
                          ? { sublabel: `${COPY.roomDetail.floor} ${room.floor}` }
                          : {}),
                      },
                    ]}
                    rows={rows}
                    getCell={getCell}
                    selection={selection}
                    onSelectionChange={setSelection}
                    minRows={minRows}
                    maxRows={maxRows}
                  />
                </div>

                {/* A11Y-05: native selects stay the guaranteed non-grid path. */}
                <div className="grid gap-3 sm:mt-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label htmlFor={startId} className="text-sm font-semibold text-ink2">
                      {COPY.calendar.startLabel}
                    </label>
                    <select
                      id={startId}
                      className={selectClass}
                      value={selectionStart?.start ?? ''}
                      onChange={(event) => {
                        const rowIndex = rows.findIndex((row) => row.start === event.target.value);
                        if (rowIndex >= 0) {
                          setSelection(anchorSelection(rowIndex));
                        }
                      }}
                    >
                      <option value="" disabled>
                        --:--
                      </option>
                      {rows.map((row, rowIndex) => (
                        <option key={row.start} value={row.start} disabled={!cellFree(rowIndex)}>
                          {row.start}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <label htmlFor={endId} className="text-sm font-semibold text-ink2">
                      {COPY.calendar.endLabel}
                    </label>
                    <select
                      id={endId}
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
                            let free = true;
                            for (let at = selection.startRow; at <= rowIndex; at += 1) {
                              free = free && cellFree(at);
                            }
                            const minutesLong = (rowIndex + 1 - selection.startRow) * increment;
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

                <div className="mt-4 rounded-2xl border border-info/15 bg-info-soft p-4">
                  <p className="text-sm text-info" aria-live="polite">
                    {selectionValid ? (
                      <>
                        {COPY.calendar.selectedPrefix}{' '}
                        <b className="tabular-nums">
                          {formatTimeRange(selectionStart?.start ?? '', selectionEnd?.end ?? '')} ·{' '}
                          {formatDuration(selectionMinutes)}
                        </b>
                      </>
                    ) : selection !== null ? (
                      `${COPY.roomDetail.minDurationPrefix} ${formatDuration(minDuration)}`
                    ) : (
                      COPY.calendar.noSelection
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={!selectionValid}
                    onClick={proceed}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-g7 px-6 font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50 sm:w-auto"
                  >
                    {COPY.calendar.proceed}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};

export const roomDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/rooms/$roomId',
  validateSearch: (search: Record<string, unknown>): RoomDetailSearch => ({
    ...(typeof search.date === 'string' && DATE_PARAM.test(search.date)
      ? { date: search.date }
      : {}),
    ...(typeof search.start === 'string' && TIME_PARAM.test(search.start)
      ? { start: search.start }
      : {}),
    ...(typeof search.end === 'string' && TIME_PARAM.test(search.end) ? { end: search.end } : {}),
  }),
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(roomQuery(params.roomId)),
      context.queryClient.ensureQueryData(settingsQuery),
    ]);
  },
  component: RoomDetailPage,
});
