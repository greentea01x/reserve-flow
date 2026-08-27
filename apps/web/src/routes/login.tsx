import { createRoute, redirect, useRouter } from '@tanstack/react-router';
import { Building2, Eye, EyeOff, IdCard, LockKeyhole } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useSignIn } from '../api/mutations';
import { meQuery } from '../api/queries';
import { COPY, ERROR_MESSAGES, errorMessage } from '../lib/i18n';
import { rootRoute } from './root';

export interface LoginSearch {
  redirect?: string;
  /** The authed guard bounced a disabled account here — explain it. */
  reason?: 'disabled';
}

const inputClass =
  'min-h-[3.75rem] w-full rounded-none border border-line bg-bg py-3 pr-4 pl-14 text-base text-ink placeholder:text-muted/80 hover:border-border-input focus:border-g7 focus:bg-surface focus:ring-2 focus:ring-g1/70';

const LoginBrand = ({ compact = false }: { compact?: boolean }) => (
  <div className={`flex items-center gap-3 ${compact ? 'justify-center' : ''}`}>
    <span
      aria-hidden="true"
      className={`${compact ? 'size-10' : 'size-11'} grid shrink-0 place-items-center rounded-[14px] bg-g7 text-white shadow-card`}
    >
      <Building2 className="size-5" strokeWidth={2.2} />
    </span>
    <span className="leading-tight">
      <b className={`${compact ? 'text-lg' : 'text-xl'} block tracking-[-0.025em] text-ink`}>
        {COPY.brand}
      </b>
      <small className="mt-0.5 block text-xs font-medium text-muted">{COPY.company}</small>
    </span>
  </div>
);

/** The admin app is a separate bundle mounted at /admin/. A router push would resolve
 * inside this app's tree and 404, so leaving this origin's employee routes needs a real
 * document request — in prod that is what triggers the /admin/:path* rewrite. */
export const leavesThisApp = (path: string): boolean =>
  path === '/admin' || path.startsWith('/admin/');

/** Open-redirect guard: only internal paths ('/x', never '//host' or absolute URLs).
 * Enforced at the consumption points — parent routes pass raw search through, so
 * validateSearch alone cannot strip a hostile value from the merged search. */
export const safeInternalPath = (value: string | undefined): string =>
  value?.startsWith('/') && !value.startsWith('//') ? value : '/rooms';

const LoginPage = () => {
  const router = useRouter();
  const search = loginRoute.useSearch();
  const signIn = useSignIn();
  const [employeeCode, setEmployeeCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const identifierId = useId();
  const passwordId = useId();
  const rememberMeId = useId();
  const formTitleId = useId();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (signIn.isPending) {
      return;
    }
    signIn.mutate(
      { employee_code: employeeCode, password, remember_me: rememberMe },
      {
        onSuccess: () => {
          const target = safeInternalPath(search.redirect);
          if (leavesThisApp(target)) {
            window.location.assign(target);
            return;
          }
          router.history.push(target);
        },
      },
    );
  };

  return (
    <main className="font-login min-h-screen bg-bg md:grid md:grid-cols-2">
      <aside className="relative hidden min-h-screen overflow-hidden bg-surface-strong md:flex md:flex-col">
        <div
          aria-hidden="true"
          className="absolute -top-36 -left-40 size-[32rem] rounded-full bg-g2/35 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -right-44 -bottom-44 size-[34rem] rounded-full bg-blush/80 blur-3xl"
        />

        <div className="relative z-10 px-8 pt-8 lg:px-12 lg:pt-10">
          <LoginBrand />
        </div>

        <div className="relative z-10 flex flex-1 items-center px-8 py-10 lg:px-12">
          <div className="mx-auto w-full max-w-xl">
            <h2 className="max-w-lg text-3xl leading-[1.25] font-bold tracking-[-0.025em] text-ink lg:text-4xl">
              {COPY.login.headline}
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-ink2 lg:text-lg">
              {COPY.login.sub}
            </p>

            <figure className="mt-9 overflow-hidden rounded-[2rem] border border-surface/70 bg-surface shadow-soft lg:mt-12">
              <img
                src="/images/login-room.jpg"
                alt=""
                width={1408}
                height={768}
                fetchPriority="high"
                className="aspect-[11/6] h-auto w-full object-cover"
              />
            </figure>
          </div>
        </div>
      </aside>

      <section className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-8 sm:px-6 md:min-h-0 lg:px-12">
        <div
          aria-hidden="true"
          className="absolute -top-32 -right-40 size-80 rounded-full bg-g1/65 blur-3xl md:hidden"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-36 -left-36 size-80 rounded-full bg-blush-soft blur-3xl md:hidden"
        />

        <div className="relative z-10 w-full max-w-[34rem]">
          <div className="mb-7 md:hidden">
            <LoginBrand compact />
          </div>

          <form
            className="rounded-[2.25rem] border border-line/60 bg-surface p-6 shadow-soft sm:p-12"
            onSubmit={onSubmit}
            aria-labelledby={formTitleId}
            aria-busy={signIn.isPending}
          >
            <header className="mb-10 text-left">
              <h1
                id={formTitleId}
                className="text-[1.75rem] font-semibold tracking-[-0.025em] text-ink"
              >
                {COPY.login.formTitle}
              </h1>
              <p className="mt-1 text-base text-ink2">{COPY.login.formSub}</p>
            </header>

            <div aria-live="polite">
              {signIn.isError ? (
                <div
                  role="alert"
                  className="mb-5 rounded-2xl border border-r2 bg-r0 px-4 py-3 text-sm font-semibold text-r7"
                >
                  {errorMessage(signIn.error)}
                </div>
              ) : search.reason === 'disabled' ? (
                <div
                  role="alert"
                  className="mb-5 rounded-2xl border border-r2 bg-r0 px-4 py-3 text-sm font-semibold text-r7"
                >
                  {ERROR_MESSAGES.ACCOUNT_DISABLED}
                </div>
              ) : null}
            </div>

            <div className="grid gap-7">
              <div className="grid gap-2.5">
                <label
                  htmlFor={identifierId}
                  className="text-xs font-semibold tracking-[0.04em] text-ink2"
                >
                  {COPY.login.identifier}
                </label>
                <div className="relative">
                  <IdCard
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted"
                  />
                  <input
                    id={identifierId}
                    name="employee_code"
                    className={inputClass}
                    autoComplete="username"
                    autoCapitalize="characters"
                    spellCheck={false}
                    required
                    maxLength={20}
                    placeholder={COPY.login.identifierPlaceholder}
                    value={employeeCode}
                    onChange={(event) => setEmployeeCode(event.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2.5">
                <label
                  htmlFor={passwordId}
                  className="text-xs font-semibold tracking-[0.04em] text-ink2"
                >
                  {COPY.login.password}
                </label>
                <div className="relative">
                  <LockKeyhole
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted"
                  />
                  <input
                    id={passwordId}
                    name="password"
                    className={`${inputClass} pr-14`}
                    type={passwordVisible ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    maxLength={128}
                    placeholder={COPY.login.passwordPlaceholder}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={passwordVisible ? COPY.login.hidePassword : COPY.login.showPassword}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center text-muted hover:text-ink"
                  >
                    {passwordVisible ? (
                      <EyeOff aria-hidden="true" className="size-6" />
                    ) : (
                      <Eye aria-hidden="true" className="size-6" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <label
              htmlFor={rememberMeId}
              className="mt-7 flex w-fit cursor-pointer items-center gap-2.5 text-sm text-ink2"
            >
              <input
                id={rememberMeId}
                name="remember_me"
                type="checkbox"
                className="size-5 rounded-sm border-line accent-g7"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              {COPY.login.rememberMe}
            </label>

            <button
              type="submit"
              disabled={signIn.isPending}
              className="mt-11 flex min-h-[3.65rem] w-full items-center justify-center rounded-full bg-g7 px-5 text-lg font-bold text-white shadow-card hover:bg-olive-dark active:translate-y-px disabled:translate-y-0 disabled:opacity-60"
            >
              {signIn.isPending ? COPY.login.submitting : COPY.login.submit}
            </button>

            <p className="mt-12 text-center text-xs leading-5 text-muted">{COPY.login.footer}</p>
          </form>
        </div>
      </section>
    </main>
  );
};

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    // Internal paths only — '//host' and absolute URLs would be an open redirect.
    ...(typeof search.redirect === 'string' &&
    search.redirect.startsWith('/') &&
    !search.redirect.startsWith('//')
      ? { redirect: search.redirect }
      : {}),
    ...(search.reason === 'disabled' ? { reason: 'disabled' as const } : {}),
  }),
  beforeLoad: async ({ context, search }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch {
      return; // not signed in — show the form
    }
    const target = safeInternalPath(search.redirect);
    if (leavesThisApp(target)) {
      window.location.assign(target);
      return;
    }
    throw redirect({ href: target });
  },
  component: LoginPage,
});
