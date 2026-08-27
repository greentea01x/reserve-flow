import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { COPY } from '../lib/i18n';

export interface RouterContext {
  queryClient: QueryClient;
}

const NotFound = () => (
  <main className="grid min-h-screen place-items-center bg-bg p-6 text-center">
    <div>
      <p className="text-5xl font-bold text-g7" aria-hidden="true">
        404
      </p>
      <h1 className="mt-2 text-xl font-bold text-ink">{COPY.states.notFoundTitle}</h1>
      <Link
        to="/rooms"
        className="mt-6 inline-flex min-h-10 items-center rounded-xl bg-g7 px-4 font-semibold text-white"
      >
        {COPY.states.backHome}
      </Link>
    </div>
  </main>
);

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
});
