import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './client';

/**
 * The admin SPA has no login screen — `/login` lives outside this router's `/admin`
 * basepath, so a router `redirect()` cannot reach it. Hard-navigate and carry the
 * return URL (which includes `/admin/...`) so the user lands back where they were.
 */
export const redirectToLogin = (reason?: 'disabled'): void => {
  queryClient.clear();
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  const suffix = reason === 'disabled' ? '&reason=disabled' : '';
  window.location.href = `/login?redirect=${redirect}${suffix}`;
};

// AUTH-04/X-04: a revoked/expired session must bounce on the very next request.
const handleAuthError = (error: unknown) => {
  if (error instanceof ApiClientError) {
    if (error.envelope.code === 'UNAUTHENTICATED') {
      redirectToLogin();
    } else if (error.envelope.code === 'ACCOUNT_DISABLED') {
      redirectToLogin('disabled');
    }
  }
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      // No automatic retry. A retry is SCHEDULED, and react-query pauses a scheduled retry
      // while the document is hidden or offline — the promise then never settles, and a route
      // loader awaiting it hangs on the pending component forever, with no error boundary and
      // no way back. The error card's "ลองใหม่" button is the retry, and it always works.
      retry: false,
      staleTime: 30_000,
    },
  },
});
