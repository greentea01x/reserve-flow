import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Search,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { roomsQuery, settingsQuery } from '../api/queries';
import { addDays, minutesToTime, timeToMinutes, todayBkk } from '../lib/datetime';
import { selectDemoRooms } from '../lib/demo-rooms';
import { COPY } from '../lib/i18n';
import { dayInfo, slotBookable } from '../lib/slots';
import { ThaiDatePickerField } from './date-picker-field';

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export interface QuickSearchInitial {
  date?: string;
  start?: string;
  end?: string;
  headcount?: number;
  features?: string[];
}

const selectClass =
  'min-h-11 w-full rounded-xl border border-line bg-surface-soft px-3 text-sm font-medium text-ink transition-colors hover:border-border-input focus:bg-white';

/**
 * E1/E2 "ค้นหาห้องว่าง" card: date + linked start/end selects (UX-03: changing the
 * start snaps the end to start+min duration; shorter end options are disabled),
 * headcount, and optional equipment chips. Submits to /rooms as URL search params.
 */
export const QuickSearch = ({ initial }: { initial?: QuickSearchInitial }) => {
  const navigate = useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { data: rooms } = useSuspenseQuery(roomsQuery);

  const minDuration = settings.settings.min_duration_minutes;
  const maxDuration = settings.settings.max_duration_minutes;

  const firstStartFor = (day: string): string | null => {
    const info = dayInfo(settings, day);
    const slot = info.slots.find(
      (entry) =>
        slotBookable(settings, day, entry.start) &&
        info.closeMinutes - timeToMinutes(entry.start) >= minDuration,
    );
    return slot?.start ?? null;
  };

  const snapEnd = (start: string): string => minutesToTime(timeToMinutes(start) + minDuration);

  const [date, setDate] = useState(initial?.date ?? todayBkk());
  const [start, setStart] = useState<string>(() => initial?.start ?? firstStartFor(date) ?? '');
  const [end, setEnd] = useState<string>(
    () => initial?.end ?? (start === '' ? '' : snapEnd(start)),
  );
  const [headcount, setHeadcount] = useState(
    initial?.headcount === undefined ? '' : String(initial.headcount),
  );
  const [features, setFeatures] = useState<string[]>(initial?.features ?? []);

  const dateId = useId();
  const startId = useId();
  const endId = useId();
  const headcountId = useId();

  const day = useMemo(() => dayInfo(settings, date), [settings, date]);
  const featureOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const room of selectDemoRooms(rooms)) {
      for (const feature of room.features) {
        options.set(feature.key, feature.name);
      }
    }
    return [...options.entries()];
  }, [rooms]);

  const changeDate = (next: string) => {
    if (!DATE_PARAM.test(next)) {
      return; // cleared input — keep the last valid date
    }
    setDate(next);
    const nextStart = firstStartFor(next);
    setStart(nextStart ?? '');
    setEnd(nextStart === null ? '' : snapEnd(nextStart));
  };

  const changeStart = (next: string) => {
    setStart(next);
    setEnd(snapEnd(next));
  };

  const headcountNumber = headcount === '' ? undefined : Number(headcount);
  const canSearch = day.open && start !== '' && end !== '';

  const submit = () => {
    if (!canSearch) {
      return;
    }
    void navigate({
      to: '/rooms',
      search: {
        date,
        start,
        end,
        ...(headcountNumber !== undefined &&
        Number.isInteger(headcountNumber) &&
        headcountNumber >= 1
          ? { headcount: headcountNumber }
          : {}),
        ...(features.length > 0 ? { features: features.join(',') } : {}),
      },
    });
  };

  return (
    <form
      aria-label={COPY.quickSearch.title}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="rounded-[1.5rem] border border-line bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-g1 text-g7">
          <Search aria-hidden="true" className="size-4.5" />
        </span>
        <h2 className="text-base font-bold tracking-tight text-ink">{COPY.quickSearch.title}</h2>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1.2fr)_minmax(7rem,0.8fr)_minmax(7rem,0.8fr)_minmax(8rem,0.8fr)_auto] lg:items-end">
        <div className="grid gap-1.5">
          <label
            htmlFor={dateId}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink2"
          >
            <CalendarDays aria-hidden="true" className="size-4 text-muted" />
            {COPY.quickSearch.dateLabel}
          </label>
          <ThaiDatePickerField
            id={dateId}
            name="search_date"
            label={COPY.quickSearch.dateLabel}
            value={date}
            min={todayBkk()}
            max={addDays(todayBkk(), settings.settings.max_advance_days)}
            onChange={changeDate}
            isDateDisabled={(nextDate) => !dayInfo(settings, nextDate).open}
            className={selectClass}
          />
        </div>
        <div className="grid gap-1.5">
          <label
            htmlFor={startId}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink2"
          >
            <Clock3 aria-hidden="true" className="size-4 text-muted" />
            {COPY.calendar.startLabel}
          </label>
          <select
            id={startId}
            name="search_start"
            className={selectClass}
            value={start}
            disabled={!day.open}
            onChange={(event) => changeStart(event.target.value)}
          >
            <option value="" disabled>
              --:--
            </option>
            {day.slots.map((slot) => (
              <option
                key={slot.start}
                value={slot.start}
                disabled={
                  !slotBookable(settings, date, slot.start) ||
                  day.closeMinutes - timeToMinutes(slot.start) < minDuration
                }
              >
                {slot.start}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label
            htmlFor={endId}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink2"
          >
            <Clock3 aria-hidden="true" className="size-4 text-muted" />
            {COPY.calendar.endLabel}
          </label>
          <select
            id={endId}
            name="search_end"
            className={selectClass}
            value={end}
            disabled={!day.open || start === ''}
            onChange={(event) => setEnd(event.target.value)}
          >
            <option value="" disabled>
              --:--
            </option>
            {day.slots.map((slot) => {
              const minutes =
                timeToMinutes(slot.end) - timeToMinutes(start === '' ? slot.end : start);
              const valid =
                minutes >= minDuration && (maxDuration === null || minutes <= maxDuration);
              return (
                <option key={slot.end} value={slot.end} disabled={!valid}>
                  {slot.end}
                </option>
              );
            })}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label
            htmlFor={headcountId}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink2"
          >
            <UsersRound aria-hidden="true" className="size-4 text-muted" />
            {COPY.quickSearch.headcountLabel}
          </label>
          <input
            id={headcountId}
            name="search_headcount"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={1}
            className={selectClass}
            value={headcount}
            onChange={(event) => setHeadcount(event.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={!canSearch}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-g7 px-5 text-sm font-bold text-white transition-transform hover:bg-olive-dark active:scale-[0.98] disabled:opacity-50 sm:col-span-2 lg:col-span-1 lg:w-auto"
        >
          {COPY.quickSearch.submit}
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </div>

      {!day.open ? (
        <p className="mt-4 rounded-2xl bg-n0 px-4 py-3 text-sm font-semibold text-ink2">
          {COPY.quickSearch.closedDay}
          {day.holiday !== undefined ? ` · ${day.holiday}` : ''}
        </p>
      ) : null}

      {featureOptions.length > 0 ? (
        <fieldset className="mt-3 border-t border-line pt-3">
          <legend className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-muted">
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            {COPY.quickSearch.featuresLabel}
          </legend>
          <div className="flex flex-wrap gap-2">
            {featureOptions.map(([key, name]) => {
              const active = features.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setFeatures(
                      active ? features.filter((entry) => entry !== key) : [...features, key],
                    )
                  }
                  className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                    active
                      ? 'border-g7 bg-g1 text-g7'
                      : 'border-line bg-white text-ink2 hover:bg-g0'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </form>
  );
};
