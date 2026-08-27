import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { ApiClientError } from '../api/client';
import { meQuery } from '../api/queries';
import { Shell } from '../components/shell';
import { rootRoute } from './root';

const AuthedLayout = () => (
  <Shell>
    <Outlet />
  </Shell>
);

/** Pathless guard: every app screen (incl. /check-in/$roomCode later) lives under this. */
export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
        throw redirect({
          to: '/login',
          search: {
            redirect: location.href,
            ...(error.envelope.code === 'ACCOUNT_DISABLED' ? { reason: 'disabled' as const } : {}),
          },
        });
      }
      throw error;
    }
  },
  component: AuthedLayout,
});
