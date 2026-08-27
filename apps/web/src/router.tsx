import { createRouter, type ErrorComponentProps, useRouter } from '@tanstack/react-router';
import { queryClient } from './api/query-client';
import { COPY, errorMessage } from './lib/i18n';
import { authedRoute } from './routes/authed';
import { bookingDetailRoute } from './routes/booking-detail';
import { bookingNewRoute } from './routes/booking-new';
import { bookingsRoute } from './routes/bookings';
import { calendarRoute } from './routes/calendar';
import { checkInRoute } from './routes/check-in';
import { homeRoute } from './routes/home';
import { loginRoute } from './routes/login';
import { profileRoute } from './routes/profile';
import { roomDetailRoute } from './routes/room-detail';
import { roomsRoute } from './routes/rooms';
import { rootRoute } from './routes/root';

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
        <h1 className="text-lg font-bold text-ink">{COPY.states.errorTitle}</h1>
        <p className="mt-1 text-sm text-muted">{errorMessage(error)}</p>
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
  loginRoute,
  authedRoute.addChildren([
    homeRoute,
    roomsRoute,
    roomDetailRoute,
    calendarRoute,
    bookingNewRoute,
    bookingDetailRoute,
    bookingsRoute,
    checkInRoute,
    profileRoute,
  ]),
]);

export const router = createRouter({
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
