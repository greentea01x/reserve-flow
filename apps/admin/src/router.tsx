import { createRouter, type ErrorComponentProps, useRouter } from '@tanstack/react-router';
import { queryClient } from './api/query-client';
import { COPY, errorMessage } from './lib/i18n';
import { auditLogsRoute } from './routes/audit-logs';
import { authedRoute } from './routes/authed';
import { bookingDetailRoute } from './routes/booking-detail';
import { bookingsRoute } from './routes/bookings';
import { calendarRoute } from './routes/calendar';
import { dashboardRoute } from './routes/dashboard';
import { emailsRoute } from './routes/emails';
import { reportsRoute } from './routes/reports';
import { roomEditRoute, roomNewRoute } from './routes/room-form';
import { roomQrRoute } from './routes/room-qr';
import { roomsRoute } from './routes/rooms';
import { rootRoute } from './routes/root';
import { settingsRoute } from './routes/settings';
import { usersRoute } from './routes/users';

const PagePending = () => (
  <div className="grid min-h-[50vh] place-items-center p-6" aria-busy="true">
    <p className="animate-pulse text-muted">{COPY.states.loading}</p>
  </div>
);

const PageError = ({ error, reset }: ErrorComponentProps) => {
  const router = useRouter();

  return (
    <div role="alert" className="grid min-h-[50vh] place-items-center p-6 text-center">
      <div>
        <h1 className="font-bold text-ink text-lg">{COPY.states.errorTitle}</h1>
        <p className="mt-1 text-muted text-sm">{errorMessage(error)}</p>
        <button
          type="button"
          className="mt-4 min-h-10 rounded-xl bg-g7 px-4 font-bold text-white"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          {COPY.states.retry}
        </button>
      </div>
    </div>
  );
};

const routeTree = rootRoute.addChildren([
  authedRoute.addChildren([
    dashboardRoute,
    calendarRoute,
    bookingsRoute,
    bookingDetailRoute,
    roomsRoute,
    // Static before dynamic: /rooms/new must not be read as a room id.
    roomNewRoute,
    roomQrRoute,
    roomEditRoute,
    usersRoute,
    reportsRoute,
    settingsRoute,
    auditLogsRoute,
    emailsRoute,
  ]),
]);

export const router = createRouter({
  // The browser URL is /admin + the route path.
  basepath: '/admin',
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPendingComponent: PagePending,
  defaultErrorComponent: PageError,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
