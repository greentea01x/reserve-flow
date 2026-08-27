import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Eye, EyeOff, SearchX, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { availabilityQuery, roomsQuery, settingsQuery } from '../api/queries';
import type { AvailabilityRoom } from '../api/types';
import { QuickSearch } from '../components/quick-search';
import { RoomCard } from '../components/room-card';
import { bkkTime, formatThaiDate, formatTimeRange } from '../lib/datetime';
import { selectDemoRooms } from '../lib/demo-rooms';
import { AVAILABILITY_REASONS, COPY, errorMessage } from '../lib/i18n';
import { authedRoute } from './authed';

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PARAM = /^\d{2}:\d{2}$/;
export interface RoomsSearch {
  date?: string;
  start?: string;
  end?: string;
  headcount?: number;
  /** CSV of feature keys — mirrors the API query param. */
  features?: string;
}

const chooseButtonClass =
  'inline-flex min-h-11 w-full items-center justify-center rounded-full bg-g7 px-4 font-bold text-white hover:bg-olive-dark active:translate-y-px';
const linkButtonClass =
  'inline-flex min-h-11 w-full items-center justify-center rounded-full border border-line bg-white px-4 font-semibold text-ink2 hover:bg-g0';

/** E2: availability results for the searched window; failing rooms collapse with reasons. */
const RoomsPage = () => {
  const search = roomsRoute.useSearch();
  const { data: rooms } = useSuspenseQuery(roomsQuery);
  const [showHidden, setShowHidden] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const hasWindow =
    search.date !== undefined && search.start !== undefined && search.end !== undefined;
  const featureList = search.features === undefined ? [] : search.features.split(',');
  const availability = useQuery({
    ...availabilityQuery({
      date: search.date ?? '',
      start: search.start ?? '',
      end: search.end ?? '',
      ...(search.headcount !== undefined ? { headcount: search.headcount } : {}),
      ...(featureList.length > 0 ? { features: featureList } : {}),
    }),
    enabled: hasWindow,
  });

  const orderedRooms = selectDemoRooms(rooms);
  const roomById = new Map(orderedRooms.map((room) => [room.id, room]));
  const roomPosition = new Map(orderedRooms.map((room, index) => [room.id, index]));
  const entries = [...(availability.data?.rooms ?? [])]
    .filter((entry) => roomPosition.has(entry.room.id))
    .sort(
      (left, right) =>
        (roomPosition.get(left.room.id) ?? Number.MAX_SAFE_INTEGER) -
        (roomPosition.get(right.room.id) ?? Number.MAX_SAFE_INTEGER),
    );
  const availableEntries = entries.filter((entry) => entry.available);
  const hiddenEntries = entries.filter((entry) => !entry.available);
  // UX-04: nothing available → the reasons ARE the result, so show them expanded.
  const hiddenVisible = showHidden || availableEntries.length === 0;

  const chooseSearch = {
    date: search.date ?? '',
    start: search.start ?? '',
    end: search.end ?? '',
  };

  const card = (entry: AvailabilityRoom, eagerPhoto = false) => {
    const room = roomById.get(entry.room.id);
    if (room === undefined) {
      return null;
    }
    return (
      <RoomCard
        key={room.id}
        room={room}
        eagerPhoto={eagerPhoto}
        available={entry.available}
        {...(entry.busy_until !== undefined ? { busyAgain: bkkTime(entry.busy_until) } : {})}
        {...(entry.available
          ? {}
          : { reasons: entry.reasons.map((reason) => AVAILABILITY_REASONS[reason]) })}
        action={
          entry.available ? (
            <Link
              to="/bookings/new"
              search={{ room: room.id, ...chooseSearch }}
              className={chooseButtonClass}
            >
              {COPY.rooms.choose}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : (
            <Link
              to="/rooms/$roomId"
              params={{ roomId: room.id }}
              search={{ ...(search.date !== undefined ? { date: search.date } : {}) }}
              className={linkButtonClass}
            >
              {COPY.rooms.viewTimes}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          )
        }
      />
    );
  };

  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-balance text-3xl font-bold tracking-tight text-ink md:text-4xl">
            {COPY.rooms.title}
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-sm text-muted md:text-base">
            {COPY.rooms.promptSearch}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={showFilters}
          aria-controls="room-search-filters"
          onClick={() => setShowFilters((visible) => !visible)}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-bold transition-colors ${
            hasWindow
              ? 'border-g2/50 bg-g1 text-g7 hover:bg-g2/25'
              : 'border-line bg-white text-ink2 hover:bg-g0'
          }`}
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          {hasWindow ? COPY.rooms.filtersActive : COPY.quickSearch.title}
          {hasWindow && !availability.isPending && !availability.isError
            ? ` · ${availableEntries.length} ${COPY.rooms.hiddenSuffix}`
            : ''}
        </button>
      </header>

      <div id="room-search-filters" className={showFilters ? 'mt-5' : 'hidden'}>
        <QuickSearch
          key={`${search.date ?? ''}|${search.start ?? ''}|${search.end ?? ''}|${search.headcount ?? ''}|${search.features ?? ''}`}
          initial={{
            ...(search.date !== undefined ? { date: search.date } : {}),
            ...(search.start !== undefined ? { start: search.start } : {}),
            ...(search.end !== undefined ? { end: search.end } : {}),
            ...(search.headcount !== undefined ? { headcount: search.headcount } : {}),
            ...(featureList.length > 0 ? { features: featureList } : {}),
          }}
        />
      </div>

      {!hasWindow ? (
        <section aria-label={COPY.rooms.allRoomsTitle} className="mt-7">
          <h2 className="sr-only">{COPY.rooms.allRoomsTitle}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {orderedRooms.map((room, index) => (
              <RoomCard
                key={room.id}
                room={room}
                eagerPhoto={index === 0}
                badgeLabel={COPY.rooms.readyBadge}
                action={
                  <Link
                    to="/rooms/$roomId"
                    params={{ roomId: room.id }}
                    className={chooseButtonClass}
                  >
                    {COPY.rooms.choose}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                }
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-8">
          <h2 className="text-xl font-bold tracking-tight text-ink tabular-nums">
            {formatThaiDate(search.date ?? '', { withWeekday: true })} ·{' '}
            {formatTimeRange(search.start ?? '', search.end ?? '')}
            {search.headcount !== undefined ? ` · ${search.headcount} ${COPY.rooms.people}` : ''}
          </h2>
          <p className="sr-only" aria-live="polite">
            {availability.isPending
              ? COPY.states.loading
              : availability.isError
                ? ''
                : `${COPY.rooms.availableBadge} ${availableEntries.length} ${COPY.rooms.hiddenSuffix}`}
          </p>

          {availability.isPending ? (
            <div aria-busy="true" className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-96 animate-pulse rounded-[1.75rem] border border-line bg-white"
                />
              ))}
              <span className="sr-only">{COPY.states.loading}</span>
            </div>
          ) : availability.isError ? (
            <p
              role="alert"
              className="mt-5 rounded-2xl border border-r2 bg-r0 px-4 py-3 text-sm font-semibold text-r7"
            >
              {errorMessage(availability.error)}
            </p>
          ) : (
            <>
              {availableEntries.length === 0 ? (
                <div className="mt-5 grid min-h-40 place-items-center rounded-[1.75rem] border border-line bg-white p-6 text-center">
                  <div>
                    <SearchX aria-hidden="true" className="mx-auto size-8 text-muted" />
                    <p className="mt-3 text-sm font-semibold text-ink2">
                      {COPY.rooms.noneAvailable}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {availableEntries.map((entry, index) => card(entry, index === 0))}
                </div>
              )}

              {hiddenEntries.length > 0 && availableEntries.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={hiddenVisible}
                  aria-controls="rooms-outside-filters"
                  onClick={() => setShowHidden((value) => !value)}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink2 hover:bg-g0"
                >
                  {hiddenVisible ? (
                    <EyeOff aria-hidden="true" className="size-4" />
                  ) : (
                    <Eye aria-hidden="true" className="size-4" />
                  )}
                  {hiddenVisible
                    ? COPY.rooms.hideHidden
                    : `${COPY.rooms.hiddenPrefix} ${hiddenEntries.length} ${COPY.rooms.hiddenSuffix} · ${COPY.rooms.showHidden}`}
                </button>
              ) : null}

              {hiddenEntries.length > 0 ? (
                <div
                  id="rooms-outside-filters"
                  className={
                    hiddenVisible ? 'mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3' : 'hidden'
                  }
                >
                  {hiddenEntries.map((entry) => card(entry))}
                </div>
              ) : null}
            </>
          )}
        </section>
      )}
    </main>
  );
};

export const roomsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/rooms',
  validateSearch: (search: Record<string, unknown>): RoomsSearch => ({
    ...(typeof search.date === 'string' && DATE_PARAM.test(search.date)
      ? { date: search.date }
      : {}),
    ...(typeof search.start === 'string' && TIME_PARAM.test(search.start)
      ? { start: search.start }
      : {}),
    ...(typeof search.end === 'string' && TIME_PARAM.test(search.end) ? { end: search.end } : {}),
    ...(typeof search.headcount === 'number' &&
    Number.isInteger(search.headcount) &&
    search.headcount >= 1
      ? { headcount: search.headcount }
      : {}),
    ...(typeof search.features === 'string' && search.features !== ''
      ? { features: search.features }
      : {}),
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(roomsQuery),
    ]);
  },
  component: RoomsPage,
});
