import { Mic, Projector, Sparkles, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Room } from '../api/types';
import { COPY } from '../lib/i18n';
import { RoomPhoto } from './room-photo';

interface RoomCardProps {
  room: Room;
  /** ว่าง (green) / ไม่ว่าง (red); omitted = neutral listing (no searched window). */
  available?: boolean;
  /** "ว่างอีกครั้ง HH:MM" line for busy rooms (UX-05: the next free moment). */
  busyAgain?: string;
  /** Translated reason chips for rooms failing the filters (UX-04: shown, never hidden). */
  reasons?: string[];
  /** Neutral list-state badge; real availability still comes from `available`. */
  badgeLabel?: string;
  eagerPhoto?: boolean;
  action?: ReactNode;
}

const accentClass = (room: Room): string => {
  const code = room.code.toLowerCase();
  if (code.includes('horizon')) {
    return 'before:bg-peach-soft';
  }
  if (code.includes('summit')) {
    return 'before:bg-info-soft';
  }
  return 'before:bg-mint-soft';
};

/** E2 room result card: image-forward facts, verdict, reasons, and the caller-owned CTA. */
const FeatureIcon = ({ featureKey }: { featureKey: string }) => {
  if (featureKey.toLowerCase().includes('projector')) {
    return <Projector aria-hidden="true" className="size-3.5 text-muted" />;
  }
  if (featureKey.toLowerCase().includes('microphone')) {
    return <Mic aria-hidden="true" className="size-3.5 text-muted" />;
  }
  return <Sparkles aria-hidden="true" className="size-3.5 text-muted" />;
};

export const RoomCard = ({
  room,
  available,
  busyAgain,
  reasons,
  badgeLabel,
  eagerPhoto = false,
  action,
}: RoomCardProps) => {
  const subtitle = [
    ...(room.location !== null
      ? [room.location]
      : room.description !== null
        ? [room.description]
        : []),
    ...(room.floor !== null ? [`${COPY.roomDetail.floor} ${room.floor}`] : []),
  ].join(' · ');
  const showBadge = available !== undefined || badgeLabel !== undefined;
  const resolvedBadge =
    badgeLabel ?? (available === true ? COPY.rooms.availableBadge : COPY.rooms.busyBadge);

  return (
    <article
      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-[2rem] border border-line bg-white shadow-sm before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-1 ${accentClass(room)}`}
    >
      <div className="relative overflow-hidden bg-g0">
        <RoomPhoto
          room={room}
          eager={eagerPhoto}
          className="h-44 w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.025] sm:h-48"
        />
        {showBadge ? (
          <span
            className={`absolute top-3 right-3 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/70 px-3 py-1.5 text-xs font-bold shadow-sm backdrop-blur-sm ${
              available === false ? 'bg-r0/95 text-r7' : 'bg-white/90 text-g7'
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${
                available === false ? 'bg-r7' : 'bg-g7 motion-safe:animate-pulse'
              }`}
            />
            {resolvedBadge}
          </span>
        ) : null}
      </div>

      <div className="flex grow flex-col p-4">
        <div>
          <h3 className="text-balance text-xl font-bold tracking-tight text-ink">{room.name}</h3>
          {subtitle !== '' ? (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{subtitle}</p>
          ) : null}
        </div>

        <ul className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-ink2">
          <li className="inline-flex min-h-7 items-center gap-1.5 rounded-lg bg-g0 px-2.5">
            <UsersRound aria-hidden="true" className="size-4 text-muted" />
            {COPY.roomDetail.capacity}: {room.capacity}
          </li>
          {room.features.map((feature) => (
            <li
              key={feature.key}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-lg bg-g0 px-2.5"
            >
              <FeatureIcon featureKey={feature.key} />
              {feature.name}: {feature.quantity}
            </li>
          ))}
        </ul>

        {busyAgain !== undefined ? (
          <p className="mt-3 rounded-xl bg-r0 px-3 py-2 text-sm font-semibold text-r7 tabular-nums">
            {COPY.rooms.busyAgainPrefix} {busyAgain}
          </p>
        ) : null}
        {reasons !== undefined && reasons.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {reasons.map((reason) => (
              <li
                key={reason}
                className="rounded-full border border-r1 bg-r0 px-2.5 py-1 text-xs font-semibold text-r7"
              >
                {reason}
              </li>
            ))}
          </ul>
        ) : null}

        {action !== undefined ? (
          <div className="mt-auto border-t border-line pt-4 [&_a]:gap-2 [&_a]:rounded-full [&_a]:transition-transform [&_a]:active:scale-[0.98]">
            {action}
          </div>
        ) : null}
      </div>
    </article>
  );
};
