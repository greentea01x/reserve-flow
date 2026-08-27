import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useId } from 'react';
import {
  adminRoomsQuery,
  heatmapQuery,
  outcomesQuery,
  type ReportRange,
  utilizationQuery,
} from '../api/queries';
import type { HeatmapResponse } from '../api/types';
import { chipClass, controlClass, fieldLabelClass } from '../components/filters';
import { AdminTable, EmptyCard, InlineAlert } from '../components/table';
import { formatThaiDate, todayBkk } from '../lib/datetime';
import { COPY, errorMessage, thaiMonthYear, WEEKDAY_NAMES } from '../lib/i18n';
import { authedRoute } from './authed';

/**
 * A11. The three reports are read with useQuery, not useSuspenseQuery, for one reason: a
 * range longer than 366 days is a 400 from the server, and the page has to render its
 * filters plus the inline "เลือกช่วงได้ไม่เกิน 366 วัน" WITHOUT firing that request. A
 * suspended route cannot decline to fetch.
 */

const MAX_SPAN_DAYS = 366;
const DAY_MS = 86_400_000;

export interface ReportsSearch {
  from?: string;
  to?: string;
  room?: string;
  group_by?: 'room' | 'month';
}

const monthStartOf = (date: string) => `${date.slice(0, 7)}-01`;
const round1 = (value: number) => Math.round(value * 10) / 10;

const spanDays = (from: string, to: string): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

const rangeOf = (search: ReportsSearch): ReportRange => ({
  from: search.from ?? monthStartOf(todayBkk()),
  to: search.to ?? todayBkk(),
  ...(search.room !== undefined && search.room !== '' ? { room: search.room } : {}),
  group_by: search.group_by ?? 'room',
});

const KpiTile = ({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string | null;
}) => (
  <div className="rounded-2xl border border-line bg-white p-4">
    <p className="text-muted text-xs">{label}</p>
    <p className="mt-1 font-bold text-2xl text-ink tabular-nums">{value}</p>
    {caption !== null ? <p className="mt-1 text-muted text-xs tabular-nums">{caption}</p> : null}
  </div>
);

/**
 * A11Y-03: a single-hue ramp, and EVERY cell prints its number. Pastel-on-pastel is about
 * 1.05:1 and cannot carry meaning on its own; a green→red scale would also collide with the
 * booking-status colour semantics.
 */
const heatTone = (value: number, max: number): string => {
  if (value === 0 || max === 0) {
    return 'bg-white text-muted';
  }
  const ratio = value / max;
  if (ratio > 0.66) {
    return 'bg-g2 text-g7';
  }
  return ratio > 0.33 ? 'bg-g1 text-g7' : 'bg-g0 text-ink2';
};

const HeatmapTable = ({ cells }: { cells: HeatmapResponse['cells'] }) => {
  // Cells are SPARSE — an absent cell means zero, so the column set comes from what is there.
  const hours = [...new Set(cells.map((cell) => cell.hour))].sort((a, b) => a - b);
  const columns = hours.length > 0 ? hours : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const byKey = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell.used_hours]));
  const max = cells.reduce((peak, cell) => Math.max(peak, cell.used_hours), 0);

  return (
    <section
      className="overflow-x-auto rounded-2xl border border-line bg-white"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be keyboard-reachable
      tabIndex={0}
      aria-label={COPY.reports.heatmapTableLabel}
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{COPY.reports.heatmapTableLabel}</caption>
        <thead>
          <tr className="border-line border-b text-muted text-xs">
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              {COPY.reports.heatmapWeekdayCol}
            </th>
            {columns.map((hour) => (
              <th key={hour} scope="col" className="px-2 py-2 font-semibold tabular-nums">
                {String(hour).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAY_NAMES.map((name, index) => (
            <tr key={name} className="border-line border-b last:border-b-0">
              <th scope="row" className="px-3 py-2 text-left font-semibold text-ink2">
                {name}
              </th>
              {columns.map((hour) => {
                const value = byKey.get(`${index + 1}:${hour}`) ?? 0;
                return (
                  <td
                    key={hour}
                    // Every cell has its own accessible name — the number alone is
                    // meaningless to a screen reader moving across a grid.
                    aria-label={`${name} ${String(hour).padStart(2, '0')}:00 · ${value} ${COPY.reports.heatmapCellSuffix}`}
                    className={`px-2 py-2 text-center font-semibold tabular-nums ${heatTone(value, max)}`}
                  >
                    {round1(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

const ReportsPage = () => {
  const search = reportsRoute.useSearch();
  const range = rangeOf(search);
  const navigate = useNavigate({ from: '/reports' });
  const { data: rooms } = useSuspenseQuery(adminRoomsQuery);
  const fromId = useId();
  const toId = useId();
  const roomId = useId();

  const tooLong = spanDays(range.from, range.to) > MAX_SPAN_DAYS;
  const enabled = !tooLong && range.to >= range.from;

  const utilization = useQuery({ ...utilizationQuery(range), enabled });
  const outcomes = useQuery({ ...outcomesQuery(range), enabled });
  const heatmap = useQuery({ ...heatmapQuery(range), enabled });

  const setSearch = (patch: Partial<ReportsSearch>) => {
    void navigate({
      search: (prev: ReportsSearch) => {
        const next: ReportsSearch = { ...prev, ...patch };
        for (const key of ['from', 'to', 'room'] as const) {
          if (next[key] === undefined || next[key] === '') {
            delete next[key];
          }
        }
        return next;
      },
    });
  };

  const rows = utilization.data?.rows ?? [];
  const usedHours = rows.reduce((sum, row) => sum + row.used_hours, 0);
  const availableHours = rows.reduce((sum, row) => sum + row.available_hours, 0);
  const overall = availableHours === 0 ? null : round1((100 * usedHours) / availableHours);
  const topRoom = rows.reduce<(typeof rows)[number] | null>(
    (best, row) => (best === null || row.used_hours > best.used_hours ? row : best),
    null,
  );

  const hourTotals = new Map<number, number>();
  for (const cell of heatmap.data?.cells ?? []) {
    hourTotals.set(cell.hour, (hourTotals.get(cell.hour) ?? 0) + cell.used_hours);
  }
  const peakHour = [...hourTotals.entries()].reduce<[number, number] | null>(
    (best, entry) => (best === null || entry[1] > best[1] ? entry : best),
    null,
  );

  const totals = outcomes.data?.totals;
  const isPending = utilization.isPending || outcomes.isPending || heatmap.isPending;
  const error = utilization.error ?? outcomes.error ?? heatmap.error;
  const hasData = rows.some((row) => row.available_hours > 0 || row.used_hours > 0);

  return (
    <div className="p-4 md:p-6">
      <header>
        <h1 className="font-bold text-2xl text-ink">{COPY.reports.title}</h1>
        <p className="text-muted text-sm tabular-nums">
          {formatThaiDate(range.from)} – {formatThaiDate(range.to)} · {COPY.reports.subTail}
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label htmlFor={fromId} className={fieldLabelClass}>
            {COPY.reports.fromLabel}
          </label>
          <input
            id={fromId}
            type="date"
            value={range.from}
            onChange={(event) => setSearch({ from: event.target.value })}
            className={controlClass}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={toId} className={fieldLabelClass}>
            {COPY.reports.toLabel}
          </label>
          <input
            id={toId}
            type="date"
            value={range.to}
            onChange={(event) => setSearch({ to: event.target.value })}
            className={controlClass}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={roomId} className={fieldLabelClass}>
            {COPY.reports.roomLabel}
          </label>
          <select
            id={roomId}
            value={search.room ?? ''}
            onChange={(event) => setSearch({ room: event.target.value })}
            className={controlClass}
          >
            <option value="">{COPY.reports.allRooms}</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label={COPY.reports.groupByLabel} className="flex gap-1.5">
          {(
            [
              ['room', COPY.reports.groupByRoom],
              ['month', COPY.reports.groupByMonth],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              to="/reports"
              search={{ ...search, group_by: value }}
              aria-current={range.group_by === value ? 'true' : undefined}
              className={chipClass(range.group_by === value)}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <div aria-live="polite" className="mt-4 grid gap-3">
        {tooLong ? <InlineAlert message={COPY.reports.rangeTooLong} /> : null}
        {/* An inverted range disables all three queries — say why rather than rendering nothing. */}
        {range.to < range.from ? <InlineAlert message={COPY.reports.rangeInverted} /> : null}
        {error != null ? <InlineAlert message={errorMessage(error)} /> : null}
      </div>

      {!enabled ? null : isPending ? (
        <p aria-busy="true" className="mt-4 animate-pulse text-muted">
          {COPY.states.loading}
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label={COPY.reports.kpiUtilization}
              // Zero and unknown are different, and on this page the difference matters.
              value={overall === null ? '—' : `${overall}%`}
              caption={
                overall === null
                  ? COPY.reports.empty
                  : `${round1(usedHours)}/${round1(availableHours)} ${COPY.reports.hours}`
              }
            />
            <KpiTile
              label={COPY.reports.kpiTopRoom}
              value={topRoom === null || topRoom.used_hours === 0 ? '—' : topRoom.room.name}
              caption={
                topRoom === null || topRoom.used_hours === 0
                  ? null
                  : `${round1(topRoom.used_hours)} ${COPY.reports.hours}`
              }
            />
            <KpiTile
              label={COPY.reports.kpiPeakHour}
              value={
                peakHour === null
                  ? '—'
                  : `${String(peakHour[0]).padStart(2, '0')}:00–${String(peakHour[0] + 1).padStart(2, '0')}:00`
              }
              caption={peakHour === null ? null : `${round1(peakHour[1])} ${COPY.reports.hours}`}
            />
            <KpiTile
              label={COPY.reports.kpiAutoReleased}
              value={String(totals?.auto_released ?? 0)}
              caption={
                outcomes.data?.no_show_pct == null
                  ? null
                  : `${outcomes.data.no_show_pct}${COPY.reports.kpiAutoReleasedCaptionSuffix}`
              }
            />
          </div>

          <p className="mt-3 text-muted text-xs">{COPY.reports.divisorNote}</p>

          {hasData ? (
            <>
              <h2 className="mt-6 font-bold text-ink text-lg">{COPY.reports.utilizationTitle}</h2>
              <div className="mt-2">
                <AdminTable
                  label={COPY.reports.utilizationTableLabel}
                  columns={[
                    COPY.reports.colRoom,
                    ...(range.group_by === 'month' ? [COPY.reports.colPeriod] : []),
                    COPY.reports.colUsed,
                    COPY.reports.colAvailable,
                    COPY.reports.colUtilization,
                  ]}
                  rows={rows}
                  rowKey={(row) => row.key}
                  renderRow={(row) => (
                    <>
                      <td className="px-4 py-3 text-ink2">{row.room.name}</td>
                      {range.group_by === 'month' ? (
                        <td className="px-4 py-3 text-ink2">
                          {row.period === null ? '—' : thaiMonthYear(`${row.period}-01`)}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-ink2 tabular-nums">{row.used_hours}</td>
                      <td className="px-4 py-3 text-ink2 tabular-nums">{row.available_hours}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-12 shrink-0 font-semibold text-ink tabular-nums">
                            {row.utilization_pct === null ? '—' : `${row.utilization_pct}%`}
                          </span>
                          <span
                            aria-hidden="true"
                            className="h-2 w-24 overflow-hidden rounded-full bg-n0"
                          >
                            <span
                              className="block h-full rounded-full bg-g7"
                              style={{ width: `${Math.min(100, row.utilization_pct ?? 0)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                    </>
                  )}
                />
              </div>

              <h2 className="mt-6 font-bold text-ink text-lg">{COPY.reports.outcomesTitle}</h2>
              <dl className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
                {(
                  [
                    [COPY.reports.outcomeCreated, totals?.created ?? 0],
                    [COPY.reports.outcomeCompleted, totals?.completed ?? 0],
                    [COPY.reports.outcomeCancelledOwner, totals?.cancelled_by_owner ?? 0],
                    [COPY.reports.outcomeCancelledAdmin, totals?.cancelled_by_admin ?? 0],
                    [COPY.reports.outcomeAutoReleased, totals?.auto_released ?? 0],
                  ] as const
                ).map(([label, count]) => (
                  <div key={label} className="rounded-2xl border border-line bg-white p-4">
                    <dt className="text-muted text-xs">{label}</dt>
                    <dd className="mt-1 font-bold text-ink text-xl tabular-nums">
                      {count}
                      <span className="ml-1 font-normal text-muted text-xs">
                        {totals !== undefined && totals.created > 0
                          ? `${Math.round((1000 * count) / totals.created) / 10}%`
                          : ''}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>

              <h2 className="mt-6 font-bold text-ink text-lg">{COPY.reports.heatmapTitle}</h2>
              {/* The chart IS a table, so a decorative "ดูเป็นตาราง" disclosure would be noise. */}
              <p className="mt-1 text-muted text-xs">{COPY.reports.heatmapNote}</p>
              <div className="mt-2">
                <HeatmapTable cells={heatmap.data?.cells ?? []} />
              </div>
            </>
          ) : (
            <div className="mt-4">
              <EmptyCard message={COPY.reports.empty} />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const reportsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/reports',
  validateSearch: (search: Record<string, unknown>): ReportsSearch => ({
    ...(typeof search.from === 'string' && search.from !== '' ? { from: search.from } : {}),
    ...(typeof search.to === 'string' && search.to !== '' ? { to: search.to } : {}),
    ...(typeof search.room === 'string' && search.room !== '' ? { room: search.room } : {}),
    ...(search.group_by === 'month' ? { group_by: 'month' as const } : {}),
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(adminRoomsQuery),
  component: ReportsPage,
});
