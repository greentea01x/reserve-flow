import { Building2 } from 'lucide-react';
import type { Room } from '../api/types';

const FALLBACKS = [
  'from-peach-soft via-white to-r1',
  'from-info-soft via-white to-g1',
  'from-mint-soft via-white to-y0',
] as const;

const fallbackFor = (room: Room): (typeof FALLBACKS)[number] => {
  let value = 0;
  for (const character of room.code) {
    value += character.codePointAt(0) ?? 0;
  }
  return FALLBACKS[value % FALLBACKS.length] ?? FALLBACKS[0];
};

interface RoomPhotoProps {
  room: Room;
  className: string;
  eager?: boolean;
}

/** Room photos are decorative beside a named room; the fallback remains visibly useful. */
export const RoomPhoto = ({ room, className, eager = false }: RoomPhotoProps) =>
  room.photo_url !== null ? (
    <img
      src={room.photo_url}
      alt=""
      width={960}
      height={540}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      className={className}
    />
  ) : (
    <div
      aria-hidden="true"
      className={`${className} grid place-items-center bg-linear-145 ${fallbackFor(room)}`}
    >
      <span className="grid place-items-center gap-2 text-center text-ink2/70">
        <Building2 className="size-10" strokeWidth={1.4} />
        <span className="text-xs font-bold tracking-[0.16em] uppercase">{room.code}</span>
      </span>
    </div>
  );
