import { SlotGrid, type SlotGridCellState, type SlotGridSelection } from '@reserveflow/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '../api/client';
import { useUpdateBooking } from '../api/mutations';
import { calendarQuery, settingsQuery } from '../api/queries';
import type { BookingFull, SlotUnavailableDetails } from '../api/types';
import {
  addDays,
  bkkDate,
  bkkIso,
  bkkTime,
  formatDuration,
  formatThaiDate,
  formatTimeRange,
  timeToMinutes,
  todayBkk,
} from '../lib/datetime';
import { COPY, ERROR_MESSAGES, errorMessage, keepsOldSlotMessage } from '../lib/i18n';
import { type DaySlot, dayInfo, slotBookable } from '../lib/slots';
import { ConflictAlert } from './conflict-alert';
import { ThaiDatePickerField } from './date-picker-field';

interface ReschedulePanelProps {
  /** FULL view with `version` — the detail page gates on can.reschedule. */
  booking: BookingFull;
  onClose: () => void;
}

const selectClass =
  'min-h-10 w-full rounded-[11px] border border-border-input bg-white px-2.5 text-sm text-ink';

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY_ROWS: DaySlot[] = [];

/**
 * E7: SlotGrid day picker + room switcher, prefilled with the current slot.
 * CB-03: a 409 leaves the booking on its old slot — say so, keep all state.
 */
export const ReschedulePanel = ({ booking, onClose }: ReschedulePanelProps) => {
  const queryClient = useQueryClient();
  const originalDate = bkkDate(booking.start_at);
  const originalRange = formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at));

  const [date, setDate] = useState(originalDate);
  const [selection, setSelection] = useState<SlotGridSelection | null>(null);
  const [panelRoom, setPanelRoom] = useState(booking.room_id);
  const [conflict, setConflict] = useState<SlotUnavailableDetails | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const prefilled = useRef(false);

  const dateId = useId();
  const roomId = useId();
  const startId = useId();
  const endId = useId();

  const { data: settings } = useQuery(settingsQuery);
  const { data: calendar } = useQuery(calendarQuery(date, date));
  const update = useUpdateBooking(booking.id);

  const day = useMemo(
    () => (settings !== undefined ? dayInfo(settings, date) : null),
    [settings, date],
  );
  const rows = day?.slots ?? EMPTY_ROWS;
  const rooms = calendar?.rooms ?? [];

  const increment = settings?.settings.slot_increment_minutes ?? 30;
  const minDuration = settings?.settings.min_duration_minutes ?? 60;
  const maxDuration = settings?.settings.max_duration_minutes ?? null;
  const minRows = Math.max(1, Math.ceil(minDuration / increment));
  const maxRows = maxDuration === null ? null : Math.floor(maxDuration / increment);

  /** `${roomId}:${rowIndex}` → occupied; this booking's own slot counts as free. */
  const blocks = useMemo(() => {
    const map = new Map<string, { label?: string; mine: boolean; blockStart: boolean }>();
    if (calendar === undefined || day === null) {
      return map;
    }
    for (const entry of calendar.bookings) {
      if (entry.id === booking.id || bkkDate(entry.start_at) !== date) {
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
        map.set(`${entry.room_id}:${row}`, {
          ...(entry.visibility !== 'BUSY' ? { label: entry.title } : {}),
          mine: entry.is_mine,
          blockStart: row === startRow,
        });
      }
    }
    return map;
  }, [calendar, day, date, booking.id, increment, rows.length]);

  const getCell = (columnKey: string, rowIndex: number): SlotGridCellState => {
    const hit = blocks.get(`${columnKey}:${rowIndex}`);
    if (hit !== undefined) {
      return { kind: 'busy', ...hit };
    }
    const row = rows[rowIndex];
    return settings !== undefined && row !== undefined && slotBookable(settings, date, row.start)
      ? { kind: 'free' }
      : { kind: 'free', disabled: true };
  };

  const cellFree = (columnKey: string, rowIndex: number): boolean => {
    const cell = getCell(columnKey, rowIndex);
    return cell.kind === 'free' && !cell.disabled;
  };

  // Prefill once after the async settings query supplies this date's rows.
  useEffect(() => {
    if (prefilled.current || rows.length === 0 || date !== originalDate) {
      return;
    }

    const startRow = rows.findIndex((row) => row.start === bkkTime(booking.start_at));
    const endRow = rows.findIndex((row) => row.end === bkkTime(booking.end_at));
    prefilled.current = true;
    if (startRow >= 0 && endRow >= startRow) {
      setSelection({ columnKey: booking.room_id, startRow, endRow: endRow + 1 });
    }
  }, [booking.end_at, booking.room_id, booking.start_at, date, originalDate, rows]);

  const selectionStart = selection === null ? undefined : rows[selection.startRow];
  const selectionEnd = selection === null ? undefined : rows[selection.endRow - 1];
  const selectionMinutes =
    selection === null ? 0 : (selection.endRow - selection.startRow) * increment;
  const selectionValid =
    selection !== null &&
    selectionStart !== undefined &&
    selectionEnd !== undefined &&
    selectionMinutes >= minDuration &&
    (maxDuration === null || selectionMinutes <= maxDuration);
  const activeRoom = selection?.columnKey ?? panelRoom;

  const anchorSelection = (columnKey: string, rowIndex: number): SlotGridSelection => {
    let endRow = rowIndex + 1;
    while (
      endRow - rowIndex < minRows &&
      endRow < rows.length &&
      (maxRows === null || endRow - rowIndex < maxRows) &&
      cellFree(columnKey, endRow)
    ) {
      endRow += 1;
    }
    return { columnKey, startRow: rowIndex, endRow };
  };

  const changeDate = (next: string) => {
    // A cleared <input type=date> fires with '' — keep the last valid date instead
    // of issuing a guaranteed-400 calendar request.
    if (!DATE_PARAM.test(next)) {
      return;
    }
    setDate(next);
    setSelection(null);
    setConflict(null);
    update.reset();
  };

  const submit = () => {
    if (!selectionValid || selectionStart === undefined || selectionEnd === undefined) {
      return;
    }
    setConflict(null);
    setVersionConflict(false);
    update.mutate(
      {
        version: booking.version,
        room_id: selection.columnKey,
        start_at: bkkIso(date, selectionStart.start),
        end_at: bkkIso(date, selectionEnd.end),
      },
      {
        onSuccess: onClose,
        onError: (error) => {
          if (!(error instanceof ApiClientError)) {
            return;
          }
          if (
            error.envelope.code === 'SLOT_UNAVAILABLE' &&
            typeof error.envelope.details === 'object'
          ) {
            setConflict(error.envelope.details as SlotUnavailableDetails);
          }
          if (error.envelope.code === 'VERSION_CONFLICT') {
            setVersionConflict(true);
          }
        },
      },
    );
  };

  const showGenericError =
    update.isError &&
    conflict === null &&
    !versionConflict &&
    !(
      update.error instanceof ApiClientError &&
      (update.error.envelope.code === 'SLOT_UNAVAILABLE' ||
        update.error.envelope.code === 'VERSION_CONFLICT')
    );

  const conflictRoomName =
    conflict === null ? '' : (rooms.find((room) => room.id === conflict.room_id)?.name ?? '');

  return (
    <section
      aria-label={COPY.reschedule.title}
      className="mt-4 rounded-2xl border border-g2 bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">{COPY.reschedule.title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-9 rounded-[11px] border border-line bg-white px-3 text-sm font-semibold text-ink2 hover:bg-g0"
        >
          {COPY.reschedule.close}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {COPY.reschedule.currentSlot}:{' '}
        <b className="text-ink tabular-nums">
          {formatThaiDate(originalDate, { withWeekday: true })} · {originalRange}
        </b>
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={dateId} className="text-sm font-semibold text-ink2">
            {COPY.reschedule.dateLabel}
          </label>
          <ThaiDatePickerField
            id={dateId}
            label={COPY.reschedule.dateLabel}
            value={date}
            min={todayBkk()}
            max={
              settings === undefined
                ? date
                : addDays(todayBkk(), settings.settings.max_advance_days)
            }
            onChange={changeDate}
            isDateDisabled={
              settings === undefined ? undefined : (nextDate) => !dayInfo(settings, nextDate).open
            }
            className={selectClass}
            disabled={settings === undefined}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={roomId} className="text-sm font-semibold text-ink2">
            {COPY.calendar.roomLabel}
          </label>
          <select
            id={roomId}
            className={selectClass}
            value={activeRoom}
            onChange={(event) => {
              const nextRoom = event.target.value;
              setPanelRoom(nextRoom);
              if (selection !== null) {
                let free = true;
                for (let row = selection.startRow; row < selection.endRow; row += 1) {
                  free = free && cellFree(nextRoom, row);
                }
                setSelection(free ? { ...selection, columnKey: nextRoom } : null);
              }
            }}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {settings === undefined || calendar === undefined ? (
        <p className="mt-3 animate-pulse text-sm text-muted" aria-busy="true">
          {COPY.states.loading}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 rounded-xl bg-n0 px-3.5 py-3 text-sm font-semibold text-ink2">
          {COPY.reschedule.closedDay}
          {day?.holiday !== undefined ? ` · ${day.holiday}` : ''}
        </p>
      ) : (
        <>
          <div className="mt-3 hidden sm:block">
            <SlotGrid
              label={COPY.reschedule.gridLabel}
              columns={rooms.map((room) => ({
                key: room.id,
                label: room.name,
                ...(room.floor !== null ? { sublabel: `ชั้น ${room.floor}` } : {}),
              }))}
              rows={rows}
              getCell={getCell}
              selection={selection}
              onSelectionChange={setSelection}
              minRows={minRows}
              maxRows={maxRows}
            />
          </div>

          {/* A11Y-05: native selects stay the guaranteed non-grid path. */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                    setSelection(anchorSelection(activeRoom, rowIndex));
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
                    disabled={!cellFree(activeRoom, rowIndex)}
                  >
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
                        free = free && cellFree(selection.columnKey, at);
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
        </>
      )}

      <div aria-live="polite" className="mt-4 grid gap-3">
        {conflict !== null ? (
          <ConflictAlert
            roomName={conflictRoomName}
            range={formatTimeRange(bkkTime(conflict.start_at), bkkTime(conflict.end_at))}
            details={conflict}
            extraLine={keepsOldSlotMessage(`${formatThaiDate(originalDate)} ${originalRange}`)}
            onPickAnotherTime={() => {
              setConflict(null);
              update.reset();
              void queryClient.invalidateQueries({ queryKey: ['calendar'] });
            }}
            onPickAlternative={(alternativeRoomId) => {
              setConflict(null);
              update.reset();
              setPanelRoom(alternativeRoomId);
              setSelection((current) =>
                current === null ? null : { ...current, columnKey: alternativeRoomId },
              );
            }}
          />
        ) : null}
        {versionConflict ? (
          <div role="alert" className="rounded-xl border border-r2 bg-r0 p-4">
            <p className="text-sm font-bold text-r7">{ERROR_MESSAGES.VERSION_CONFLICT}</p>
            <button
              type="button"
              className="mt-2 min-h-9 rounded-[11px] border border-r2 bg-white px-3 text-sm font-bold text-r7 hover:bg-r1"
              onClick={() => {
                setVersionConflict(false);
                update.reset();
                void queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
              }}
            >
              {COPY.reschedule.reload}
            </button>
          </div>
        ) : null}
        {showGenericError ? (
          <p
            role="alert"
            className="rounded-xl border border-r2 bg-r0 px-3.5 py-3 text-sm font-semibold text-r7"
          >
            {errorMessage(update.error)}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink2">
          {selectionValid ? (
            <>
              {COPY.calendar.selectedPrefix}{' '}
              <b className="text-ink tabular-nums">
                {rooms.find((room) => room.id === selection?.columnKey)?.name ?? ''} ·{' '}
                {formatThaiDate(date, { omitCurrentYear: true })} ·{' '}
                {formatTimeRange(selectionStart?.start ?? '', selectionEnd?.end ?? '')}
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
          disabled={!selectionValid || update.isPending}
          onClick={submit}
          className="min-h-11 rounded-[13px] bg-g7 px-5 font-bold text-white disabled:opacity-50"
        >
          {update.isPending ? COPY.reschedule.pending : COPY.reschedule.confirm}
        </button>
      </div>
    </section>
  );
};
