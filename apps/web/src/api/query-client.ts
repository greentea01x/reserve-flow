import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './client';

// AUTH-04/X-04: a revoked/expired session must bounce on the very next request.
const handleAuthError = (error: unknown) => {
  if (
    error instanceof ApiClientError &&
    (error.envelope.code === 'UNAUTHENTICATED' || error.envelope.code === 'ACCOUNT_DISABLED') &&
    !window.location.pathname.startsWith('/login')
  ) {
    queryClient.clear();
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    // Carry the reason so the login page can explain the bounce (contract §4).
    const reason = error.envelope.code === 'ACCOUNT_DISABLED' ? '&reason=disabled' : '';
    window.location.href = `/login?redirect=${redirect}${reason}`;
  }
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      // No automatic retry — see the admin app's query-client for the whole story: a
      // scheduled retry pauses while the document is hidden, its promise never settles, and
      // a route loader awaiting it is stuck on the pending component forever.
      retry: false,
      staleTime: 30_000,
    },
  },
});
