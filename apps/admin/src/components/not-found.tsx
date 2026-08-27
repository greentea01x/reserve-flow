import { COPY } from '../lib/i18n';

/**
 * C-15: the API answers 404 (never 403) for non-admins, so the app must not exist for
 * them either. This is the same page a bad URL gets — never "you are not an admin",
 * which would confirm the resource exists.
 */
export const NotFoundPage = () => (
  <main className="grid min-h-screen place-items-center bg-bg p-6 text-center">
    <div>
      <p className="text-5xl font-bold text-g7 tabular-nums" aria-hidden="true">
        404
      </p>
      <h1 className="mt-2 text-xl font-bold text-ink">{COPY.states.notFoundTitle}</h1>
      {/* Plain anchor: the employee app lives outside this router's /admin basepath. */}
      <a
        href="/"
        className="mt-6 inline-flex min-h-10 items-center rounded-xl bg-g7 px-4 font-semibold text-white"
      >
        {COPY.nav.employeeApp}
      </a>
    </div>
  </main>
);
