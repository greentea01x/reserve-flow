import {
  AppModeSwitch,
  type AppModeSwitchLabels,
  applyFontScale,
  currentFontScale,
  FONT_SCALES,
} from '@reserveflow/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  DoorOpen,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { type ComponentType, type ReactNode, useState } from 'react';
import { useSignOut } from '../api/mutations';
import { meQuery } from '../api/queries';
import { COPY } from '../lib/i18n';

const COLLAPSE_KEY = 'rf-admin-nav-collapsed';

interface NavItem {
  to:
    | '/'
    | '/calendar'
    | '/bookings'
    | '/rooms'
    | '/users'
    | '/reports'
    | '/settings'
    | '/audit-logs'
    | '/emails';
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  exact?: boolean;
}

/**
 * The spec's nav IA verbatim, plus A13 at position 9. All nine screens exist as of slice 3,
 * so all nine render — UX-19 forbids a nav entry with nowhere to go, in either direction.
 * Nothing approval-shaped exists here and never will (CB-01): no ⌛ คำขออนุมัติ.
 */
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: COPY.nav.dashboard, icon: LayoutDashboard, exact: true },
  { to: '/calendar', label: COPY.nav.calendar, icon: CalendarDays },
  { to: '/bookings', label: COPY.nav.bookings, icon: ClipboardList },
  { to: '/rooms', label: COPY.nav.rooms, icon: DoorOpen },
  { to: '/users', label: COPY.nav.users, icon: Users },
  { to: '/reports', label: COPY.nav.reports, icon: BarChart3 },
  { to: '/settings', label: COPY.nav.settings, icon: Settings },
  { to: '/audit-logs', label: COPY.nav.auditLogs, icon: ScrollText },
  // '/emails' (อีเมลที่ส่งไม่สำเร็จ) is intentionally unlisted: the demo has no mail relay, so the
  // screen only ever shows delivery failures. The route still resolves for anyone with the link.
];

const MODE_SWITCH_LABELS: AppModeSwitchLabels = {
  heading: COPY.nav.modeHeading,
  groupLabel: COPY.nav.modeLabel,
  employee: COPY.nav.employeeMode,
  admin: COPY.nav.adminMode,
  switchToEmployee: COPY.nav.switchToEmployee,
  switchToAdmin: COPY.nav.switchToAdmin,
};

export const Shell = ({ children }: { children: ReactNode }) => {
  const { data: me } = useSuspenseQuery(meQuery);
  const signOut = useSignOut();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [fontScale, setFontScale] = useState(currentFontScale);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1');
      return !value;
    });
  };

  return (
    <div
      // print:block — only the page content reaches paper (the A6 door sign relies on it).
      className={`min-h-screen bg-bg md:grid print:block ${
        collapsed ? 'md:grid-cols-[4.5rem_1fr]' : 'md:grid-cols-[15rem_1fr]'
      }`}
    >
      {/* First focusable element on every screen (A11Y). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-g7 focus:px-4 focus:py-2 focus:font-bold focus:text-white"
      >
        {COPY.skipLink}
      </a>

      <aside className="flex flex-col gap-5 border-line border-r bg-g0 px-3 py-5 md:sticky md:top-0 md:h-screen print:hidden">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-xl bg-linear-145 from-g1 to-y1 font-bold text-ink"
          >
            ◉
          </span>
          {collapsed ? null : (
            <span className="min-w-0">
              <b className="block truncate text-ink">{COPY.brand}</b>
              <small className="block truncate text-muted text-xs">{COPY.brandSub}</small>
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="admin-nav"
            aria-label={collapsed ? COPY.nav.expand : COPY.nav.collapse}
            className="ml-auto hidden size-9 shrink-0 place-items-center rounded-[11px] text-ink2 hover:bg-g1 hover:text-g7 md:grid"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4.5" aria-hidden />
            ) : (
              <PanelLeftClose className="size-4.5" aria-hidden />
            )}
          </button>
        </div>

        <nav id="admin-nav" aria-label={COPY.nav.label} className="grid gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              // Collapsed items keep an accessible name — an icon is not a name.
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              className={`flex min-h-10 items-center gap-2.5 rounded-[11px] px-3 py-2.5 font-semibold text-ink2 text-sm hover:bg-g1 hover:text-g7 aria-[current=page]:bg-g1 aria-[current=page]:text-g7 ${
                collapsed ? 'justify-center' : ''
              }`}
              activeProps={{ 'aria-current': 'page' }}
            >
              <item.icon className="size-4.5 shrink-0" aria-hidden />
              {collapsed ? null : item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto grid gap-3 border-line border-t pt-3.5">
          <AppModeSwitch
            role={me.user.role}
            currentMode="admin"
            labels={MODE_SWITCH_LABELS}
            employeeIcon={UserRound}
            adminIcon={ShieldCheck}
            collapsed={collapsed}
          />
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-y1 font-bold text-y7"
            >
              {me.user.full_name.charAt(0)}
            </span>
            {collapsed ? null : (
              <span className="min-w-0 text-sm">
                <b className="block truncate text-ink">{me.user.full_name}</b>
                <small className="block truncate text-muted text-xs">
                  {me.department.name} · {me.user.employee_code}
                </small>
              </span>
            )}
          </div>

          {collapsed ? null : (
            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className="text-muted text-xs">{COPY.nav.fontSize}</legend>
              <div className="flex flex-wrap gap-1">
                {FONT_SCALES.map((scale) => (
                  <button
                    key={scale.value}
                    type="button"
                    aria-pressed={fontScale === scale.value}
                    onClick={() => {
                      applyFontScale(scale.value);
                      setFontScale(scale.value);
                    }}
                    className={`inline-flex min-h-8 items-center rounded-full border px-2.5 font-semibold text-xs ${
                      fontScale === scale.value
                        ? 'border-g7 bg-g1 text-g7'
                        : 'border-line bg-white text-ink2 hover:bg-g0'
                    }`}
                  >
                    {scale.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            aria-label={collapsed ? COPY.nav.signOut : undefined}
            title={collapsed ? COPY.nav.signOut : undefined}
            className={`flex min-h-9 items-center gap-2 rounded-[11px] px-3 font-semibold text-ink2 text-sm hover:bg-r0 hover:text-r7 ${
              collapsed ? 'justify-center px-0' : ''
            }`}
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            {collapsed ? null : COPY.nav.signOut}
          </button>
          {/* A failed sign-out leaves the session live — say so instead of navigating away. */}
          {signOut.isError ? (
            <p role="alert" className="px-3 font-semibold text-r7 text-xs">
              {COPY.nav.signOutFailed}
            </p>
          ) : null}
        </div>
      </aside>

      {/* One <main> landmark for the whole app — screens render their own <header>. */}
      <main id="main" className="min-w-0">
        {children}
      </main>
    </div>
  );
};
