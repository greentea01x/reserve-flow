import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, notFound, Outlet } from '@tanstack/react-router';
import { ApiClientError } from '../api/client';
import { meQuery } from '../api/queries';
import { redirectToLogin } from '../api/query-client';
import type { Me } from '../api/types';
import { Shell } from '../components/shell';
import { rootRoute } from './root';

const AuthedLayout = () => {
  useSuspenseQuery(meQuery);

  return (
    <Shell>
      <Outlet />
    </Shell>
  );
};

/** Pathless guard: every admin screen lives under this. */
export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context }) => {
    let me: Me;
    try {
      me = await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
        // A router redirect cannot reach /login — it is outside the /admin basepath.
        redirectToLogin(error.envelope.code === 'ACCOUNT_DISABLED' ? 'disabled' : undefined);
        // The document is already unloading; never resolve, so no half-built screen
        // flashes and no further data call fires against a dead session.
        await new Promise(() => {});
      }
      throw error;
    }

    // /me is requireAuth, NOT requireAdmin — a signed-in EMPLOYEE gets a clean 200 here,
    // so the client has to decide. This must happen in beforeLoad, not in the component:
    // a child route's loader runs first, and letting it fire admin-only reads would show
    // a shell full of failed requests instead of one explained refusal.
    // C-15: the answer is the 404 every bad URL gets, never "you are not an admin" —
    // that would confirm the resource exists. FACILITY is an employee until Phase 1.1.
    if (me.user.role !== 'ADMIN') {
      throw notFound();
    }
  },
  component: AuthedLayout,
});
