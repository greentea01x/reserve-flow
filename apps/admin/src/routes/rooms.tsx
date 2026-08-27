import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { useUpdateRoom } from '../api/mutations';
import { adminRoomsQuery } from '../api/queries';
import type { Room } from '../api/types';
import { EmptyCard, InlineAlert } from '../components/table';
import { COPY, errorMessage } from '../lib/i18n';
import { authedRoute } from './authed';

const cardActionClass =
  'inline-flex min-h-9 items-center rounded-[11px] border border-line bg-white px-3 font-semibold text-ink2 text-sm hover:bg-g0';

const RoomCard = ({
  room,
  onReopen,
  reopening,
}: {
  room: Room;
  onReopen: (room: Room) => void;
  reopening: boolean;
}) => {
  const subtitle = [
    ...(room.description !== null ? [room.description] : []),
    ...(room.floor !== null ? [`${COPY.rooms.floorPrefix} ${room.floor}`] : []),
  ].join(' · ');

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white">
      <div className="relative">
        {room.photo_url !== null ? (
          <img src={room.photo_url} alt="" loading="lazy" className="h-32 w-full object-cover" />
        ) : (
          <div
            role="img"
            aria-label={`${COPY.rooms.photoAltPrefix} ${room.name}`}
            className="h-32 w-full bg-linear-145 from-g1 via-g0 to-y1"
          />
        )}
        {/* A11Y-03: icon + text, never colour alone. No approval pill exists (CB-01). */}
        <span
          className={`absolute top-2 left-2 inline-flex items-center rounded-full px-2.5 py-0.5 font-bold text-sm ${
            room.active ? 'bg-g1 text-g7' : 'bg-r1 text-r7'
          }`}
        >
          {room.active ? COPY.rooms.open : COPY.rooms.closed}
        </span>
      </div>

      <div className="flex grow flex-col gap-2 p-4">
        <h3 className="font-bold text-ink text-lg">{room.name}</h3>
        {subtitle !== '' ? <p className="text-muted text-sm">{subtitle}</p> : null}
        <ul className="flex flex-wrap gap-1.5 font-semibold text-ink2 text-xs">
          <li className="rounded-full bg-n0 px-2.5 py-1 tabular-nums">
            {room.capacity} {COPY.rooms.people}
          </li>
          {room.features.map((feature) => (
            <li key={feature.key} className="rounded-full bg-n0 px-2.5 py-1">
              {feature.name}
            </li>
          ))}
        </ul>

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Link to="/rooms/$roomId" params={{ roomId: room.id }} className={cardActionClass}>
            {COPY.rooms.edit}
          </Link>
          <Link to="/calendar" search={{ room: room.id }} className={cardActionClass}>
            {COPY.rooms.viewCalendar}
          </Link>
          {room.active ? (
            <Link to="/rooms/$roomId/qr" params={{ roomId: room.id }} className={cardActionClass}>
              {COPY.rooms.qr}
            </Link>
          ) : (
            // Reopening is not destructive and is not the inverse of closing — no dialog,
            // and the bookings that were already cancelled do not come back.
            <button
              type="button"
              disabled={reopening}
              onClick={() => onReopen(room)}
              className={`${cardActionClass} disabled:opacity-60`}
            >
              {reopening ? COPY.rooms.reopening : COPY.rooms.reopen}
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

const RoomsPage = () => {
  const { data: rooms } = useSuspenseQuery(adminRoomsQuery);
  const updateRoom = useUpdateRoom();
  const reopenedName = updateRoom.isSuccess && updateRoom.data.active ? updateRoom.data.name : null;

  return (
    <div className="p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl text-ink">{COPY.rooms.title}</h1>
          <p className="text-muted text-sm">
            <span className="tabular-nums">{rooms.length}</span> {COPY.rooms.countSuffix} ·{' '}
            {COPY.rooms.subTail}
          </p>
          {/* D-02: business hours are one set for all rooms. The mockup's per-room
              "จ–ศ 08:30–17:30" subline and its weekday chips block are both dead. */}
          <p className="mt-1 text-muted text-xs">{COPY.rooms.hoursNote}</p>
        </div>
        <Link
          to="/rooms/new"
          className="inline-flex min-h-10 items-center rounded-[13px] bg-g7 px-4 font-bold text-sm text-white"
        >
          {COPY.rooms.add}
        </Link>
      </header>

      <div aria-live="polite" className="mt-4 grid gap-3">
        {updateRoom.isError ? <InlineAlert message={errorMessage(updateRoom.error)} /> : null}
        {reopenedName !== null ? (
          <p
            role="status"
            className="rounded-xl border border-g2 bg-g0 px-3.5 py-3 font-bold text-g7 text-sm"
          >
            {reopenedName} · {COPY.rooms.reopened}
          </p>
        ) : null}
      </div>

      {rooms.length === 0 ? (
        <div className="mt-4">
          <EmptyCard
            message={COPY.rooms.empty}
            action={
              <Link
                to="/rooms/new"
                className="inline-flex min-h-10 items-center rounded-[13px] bg-g7 px-4 font-bold text-white"
              >
                {COPY.rooms.add}
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              reopening={updateRoom.isPending && updateRoom.variables.roomId === room.id}
              onReopen={(target) =>
                updateRoom.mutate({ roomId: target.id, body: { active: true } })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const roomsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/rooms',
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(adminRoomsQuery);
  },
  component: RoomsPage,
});
