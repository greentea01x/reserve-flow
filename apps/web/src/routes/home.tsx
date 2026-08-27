import { createRoute, redirect } from '@tanstack/react-router';
import { authedRoute } from './authed';

/** Keep `/` as a guarded compatibility URL, but the product starts at room search. */
export const homeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/rooms', search: {} });
  },
});
