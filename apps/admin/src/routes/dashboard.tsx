import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { Check, Clock, RotateCcw, Users, Wrench } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import {
  adminRoomsQuery,
  bookingsCountQuery,
  calendarDayQuery,
  heatmapQuery,
  outcomesQuery,
  settingsQuery,
  utilizationQuery,
} from '../api/queries';
import type { Room } from '../api/types';
import {
  type RoomTile,
  roomTileState,
  weekdayUsedHours,
  workingDaysElapsed,
} from '../lib/dashboard';
import { todayBkk } from '../lib/datetime';
import { COPY, thaiMonthYear } from '../lib/i18n';
import { authedRoute } from './authed';

const monthStartOf = (date: string) => `${date.slice(0, 7)}-01`;

const round1 = (value: number) => Math.round(value * 10) / 10;

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

const TILE_PRESENTATION: Record<
  RoomTile['state'],
  { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; styles: string }
> = {
  FREE: { icon: Check, styles: 'bg-g1 text-g7' },
  IN_USE: { icon: Users, styles: 'bg-g2 text-g7' },
  BUSY: { icon: Clock, styles: 'bg-r1 text-r7' },
  CLOSED: { icon: Wrench, styles: 'bg-n1 text-ink2' },
};

const tileLabel = (tile: RoomTile): string => {
  switch (tile.state) {
    case 'FREE':
      return COPY.dashboard.roomFree;
    case 'IN_USE':
      return COPY.dashboard.roomInUse;
    case 'BUSY':
      return `${COPY.dashboard.roomBusyUntilPrefix} ${tile.until}`;
    case 'CLOSED':
      return COPY.dashboard.roomClosed;
  }
};

const RoomStatusCard = ({ room, tile }: { room: Room; tile: RoomTile }) => {
  const presentation = TILE_PRESENTATION[tile.state];
  return (
    <li className="rounded-2xl border border-line bg-white p-4">
      <h3 className="truncate font-bold text-ink text-sm">{room.name}</h3>
      <span
        className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-xs ${presentation.styles}`}
      >
        <presentation.icon className="size-3.5" aria-hidden />
        <span className="tabular-nums">{tileLabel(tile)}</span>
      </span>
    </li>
  );
};

const TaskRow = ({
  icon: Icon,
  label,
  count,
  sub,
  to,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  label: string;
  count: number;
  sub: string;
  /** The screen that can actually act on this row — slice 3 gave both of them one. */
  to: '/reports';
}) => (
  <li className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3">
    <Icon className="size-4.5 shrink-0 text-ink2" aria-hidden />
    <span className="min-w-0">
      <b className="block text-ink text-sm">
        {label} <span className="tabular-nums">({count})</span>
      </b>
      <small className="block text-muted text-xs">{sub}</small>
    </span>
    <Link
      to={to}
      className="ml-auto inline-flex min-h-8 shrink-0 items-center rounded-[9px] border border-line bg-white px-2.5 font-semibold text-ink2 text-xs hover:bg-g0"
    >
      {COPY.dashboard.taskView}
    </Link>
  </li>
);

const DashboardPage = () => {
  const today = todayBkk();
  const monthStart = monthStartOf(today);

  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { data: rooms } = useSuspenseQuery(adminRoomsQuery);
  const { data: calendar } = useSuspenseQuery(calendarDayQuery(today));
  const { data: confirmedToday } = useSuspenseQuery(
    bookingsCountQuery({ from: today, to: today, status: 'CONFIRMED' }),
  );
  const { data: checkedInToday } = useSuspenseQuery(
    bookingsCountQuery({ from: today, to: today, status: 'CHECKED_IN' }),
  );
  const { data: utilization } = useSuspenseQuery(utilizationQuery({ from: monthStart, to: today }));
  const { data: outcomes } = useSuspenseQuery(outcomesQuery({ from: monthStart, to: today }));
  const { data: heatmap } = useSuspenseQuery(heatmapQuery({ from: monthStart, to: today }));

  const usedHours = utilization.rows.reduce((sum, row) => sum + row.used_hours, 0);
  const availableHours = utilization.rows.reduce((sum, row) => sum + row.available_hours, 0);
  const workdays = workingDaysElapsed(
    monthStart,
    today,
    settings.business_hours,
    settings.holidays,
  );
  const barValues = weekdayUsedHours(heatmap.cells);
  const barMax = Math.max(...barValues);

  // ponytail: recomputed on render; the 60 s calendar refetch is what moves the clock on.
  const now = new Date();
  const tasks: ReactNode[] = [
    // The failed-email task row is intentionally omitted: this deployment has no mail relay, so
    // every notification fails and the row would be permanent noise. Restore it (and the '/emails'
    // nav entry in components/shell.tsx) once SMTP is wired to a real relay.
    ...(outcomes.totals.auto_released > 0
      ? [
          <TaskRow
            key="auto-released"
            icon={RotateCcw}
            label={COPY.dashboard.taskAutoReleased}
            count={outcomes.totals.auto_released}
            sub={COPY.dashboard.taskAutoReleasedSub}
            to="/reports"
          />,
        ]
      : []),
  ];

  return (
    <div className="p-4 md:p-6">
      {/* UX-19: the prototype's Export and 🔔 buttons were dead — there are no header actions. */}
      <header>
        <h1 className="font-bold text-2xl text-ink">{COPY.dashboard.title}</h1>
        <p className="text-muted text-sm">
          {COPY.dashboard.subPrefix} · {thaiMonthYear(today)}
        </p>
      </header>

      {/* Tile 1 is what replaces the prototype's dead "Pending approvals": the only thing on
          this dashboard a human can still act on today (T-045). */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label={COPY.dashboard.kpiTodayLabel}
          value={String(confirmedToday + checkedInToday)}
          caption={`${COPY.dashboard.kpiTodayCheckedIn} ${checkedInToday} · ${COPY.dashboard.kpiTodayWaiting} ${confirmedToday}`}
        />
        <KpiTile
          label={COPY.dashboard.kpiUtilizationLabel}
          // Zero and unknown are different: no open hours yet means "—", not "0%".
          value={availableHours === 0 ? '—' : `${round1((usedHours / availableHours) * 100)}%`}
          caption={
            availableHours === 0
              ? COPY.states.noData
              : `${round1(usedHours)}/${round1(availableHours)} ${COPY.dashboard.kpiUtilizationCaptionSuffix}`
          }
        />
        <KpiTile
          label={COPY.dashboard.kpiCreatedLabel}
          value={String(outcomes.totals.created)}
          caption={
            workdays === 0
              ? COPY.states.noData
              : // BR-13: divided by working days elapsed, never calendar days.
                `${COPY.dashboard.kpiCreatedCaptionPrefix} ${round1(outcomes.totals.created / workdays)}${COPY.dashboard.kpiCreatedCaptionSuffix}`
          }
        />
        <KpiTile
          label={COPY.dashboard.kpiNoShowLabel}
          value={outcomes.no_show_pct === null ? '—' : `${round1(outcomes.no_show_pct)}%`}
          caption={
            outcomes.no_show_pct === null
              ? COPY.states.noData
              : `${COPY.dashboard.kpiNoShowCaptionPrefix} ${outcomes.totals.auto_released} ${COPY.dashboard.kpiNoShowCaptionSuffix}`
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section
          aria-label={COPY.dashboard.chartTitle}
          className="rounded-2xl border border-line bg-white p-4"
        >
          <h2 className="font-bold text-ink text-lg">{COPY.dashboard.chartTitle}</h2>
          {barMax === 0 ? (
            <p className="mt-3 text-muted text-sm">{COPY.dashboard.chartEmpty}</p>
          ) : (
            <>
              <ul className="mt-3 grid gap-2" aria-hidden="true">
                {barValues.map((value, index) => (
                  <li
                    key={COPY.dashboard.weekdays[index]}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="w-16 shrink-0 text-muted">
                      {COPY.dashboard.weekdays[index]}
                    </span>
                    <span className="h-6 min-w-0 flex-1 rounded-[7px] bg-g0">
                      <span
                        className="flex h-6 items-center justify-end rounded-[7px] bg-g2 px-2 font-semibold text-g7 tabular-nums"
                        style={{ width: `${Math.max(8, (value / barMax) * 100)}%` }}
                      >
                        {round1(value)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {/* A11Y-10: every chart has a real table behind it. */}
              <details className="mt-3">
                <summary className="cursor-pointer font-semibold text-ink2 text-sm">
                  {COPY.dashboard.chartAsTable}
                </summary>
                <table className="mt-2 w-full text-sm">
                  <caption className="sr-only">{COPY.dashboard.chartTitle}</caption>
                  <thead>
                    <tr className="border-line border-b text-left text-muted text-xs">
                      <th scope="col" className="py-2 font-semibold">
                        {COPY.dashboard.chartColWeekday}
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        {COPY.dashboard.chartColHours}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {barValues.map((value, index) => (
                      <tr key={COPY.dashboard.weekdays[index]} className="border-line border-b">
                        <th scope="row" className="py-2 text-left font-normal text-ink2">
                          {COPY.dashboard.weekdays[index]}
                        </th>
                        <td className="py-2 text-ink tabular-nums">{round1(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </section>

        <section
          aria-label={COPY.dashboard.tasksTitle}
          className="rounded-2xl border border-line bg-white p-4"
        >
          <h2 className="font-bold text-ink text-lg">{COPY.dashboard.tasksTitle}</h2>
          {/* An empty block must SAY it is empty — a block that vanishes teaches admins to
              stop looking. The prototype's Conflict-group and Manual-approval rows are dead
              (CB-01); these two are what the API can actually feed. The "ดู" buttons land
              with their targets (A13 and A11, slice 3) rather than as dead links now. */}
          {tasks.length === 0 ? (
            <p className="mt-3 text-muted text-sm">{COPY.dashboard.tasksEmpty}</p>
          ) : (
            <ul className="mt-3 grid gap-2">{tasks}</ul>
          )}
        </section>
      </div>

      {/* No aria-live here: a 60 s poll must not interrupt a screen reader every minute. */}
      <section aria-label={COPY.dashboard.roomsTitle} className="mt-4">
        <h2 className="font-bold text-ink text-lg">{COPY.dashboard.roomsTitle}</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => (
            <RoomStatusCard
              key={room.id}
              room={room}
              tile={roomTileState(room, calendar.bookings, now)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
};

export const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  // No dashboard endpoint exists — A1 is composed from six reads.
  loader: async ({ context }) => {
    const today = todayBkk();
    const monthStart = monthStartOf(today);
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(adminRoomsQuery),
      context.queryClient.ensureQueryData(calendarDayQuery(today)),
      context.queryClient.ensureQueryData(
        bookingsCountQuery({ from: today, to: today, status: 'CONFIRMED' }),
      ),
      context.queryClient.ensureQueryData(
        bookingsCountQuery({ from: today, to: today, status: 'CHECKED_IN' }),
      ),
      context.queryClient.ensureQueryData(utilizationQuery({ from: monthStart, to: today })),
      context.queryClient.ensureQueryData(outcomesQuery({ from: monthStart, to: today })),
      context.queryClient.ensureQueryData(heatmapQuery({ from: monthStart, to: today })),
    ]);
  },
  component: DashboardPage,
});
