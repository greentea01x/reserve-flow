import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { roomQuery } from '../api/queries';
import { QrCode } from '../components/qr-code';
import { COPY } from '../lib/i18n';
import { notFoundOn404 } from '../lib/loader';
import { authedRoute } from './authed';

/**
 * The printable door sign. The QR encodes the employee app's check-in route, which is what
 * `POST /api/v1/check-in/rooms/:room_code` is reached through — so the payload is the room
 * CODE, never its uuid. `code` is immutable (CB-02), so a printed sign never goes stale.
 */
const RoomQrPage = () => {
  const { roomId } = roomQrRoute.useParams();
  const { data: room } = useSuspenseQuery(roomQuery(roomId));
  const url = `${window.location.origin}/check-in/${room.code}`;

  return (
    <div className="p-4 md:p-6">
      {/* print:hidden — the sign is the only thing that reaches paper. */}
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="font-bold text-2xl text-ink">
          {COPY.roomQr.title} · {room.name}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/rooms"
            className="inline-flex min-h-10 items-center rounded-[11px] border border-line bg-white px-4 font-semibold text-ink2 text-sm hover:bg-g0"
          >
            ← {COPY.roomQr.back}
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-10 items-center rounded-[13px] bg-g7 px-4 font-bold text-sm text-white"
          >
            {COPY.roomQr.print}
          </button>
        </div>
      </header>

      {/* A5/A4 portrait: the sheet keeps its proportions on paper and on screen. */}
      <section
        aria-label={COPY.roomQr.title}
        className="mx-auto mt-6 grid max-w-lg justify-items-center gap-4 rounded-2xl border border-line bg-white p-8 text-center print:mt-0 print:max-w-none print:rounded-none print:border-0"
      >
        <h2 className="font-bold text-3xl text-ink">{room.name}</h2>
        <p className="text-ink2">
          {COPY.roomQr.codeLabel}: <b className="tabular-nums">{room.code}</b>
          {room.floor !== null ? ` · ${COPY.rooms.floorPrefix} ${room.floor}` : ''}
        </p>

        <QrCode value={url} label={`${COPY.roomQr.qrAltPrefix} ${room.name}`} />

        <p className="font-bold text-ink text-xl">{COPY.roomQr.instruction}</p>
        <p className="break-all text-muted text-sm">
          {COPY.roomQr.urlLabel}: {url}
        </p>
      </section>
    </div>
  );
};

export const roomQrRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/rooms/$roomId/qr',
  loader: async ({ context, params }) => {
    await notFoundOn404(context.queryClient.ensureQueryData(roomQuery(params.roomId)));
  },
  component: RoomQrPage,
});
