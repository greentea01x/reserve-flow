import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { NotFoundPage } from '../components/not-found';

export interface RouterContext {
  queryClient: QueryClient;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});
