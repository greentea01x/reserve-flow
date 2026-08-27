import { AppModeSwitch, type AppModeSwitchLabels } from '@reserveflow/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Building2,
  CalendarDays,
  ClipboardList,
  LogOut,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useSignOut } from '../api/mutations';
import { meQuery } from '../api/queries';
import { COPY } from '../lib/i18n';

interface NavItem {
  to: '/rooms' | '/calendar' | '/bookings' | '/profile';
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/bookings', label: COPY.nav.bookings, icon: ClipboardList },
  { to: '/calendar', label: COPY.nav.calendar, icon: CalendarDays },
  { to: '/profile', label: COPY.nav.profile, icon: UserRound },
];

const MOBILE_NAV_ITEMS: NavItem[] = [
  { to: '/rooms', label: COPY.nav.rooms, icon: Search },
  ...NAV_ITEMS,
];

const MODE_SWITCH_LABELS: AppModeSwitchLabels = {
  heading: COPY.nav.modeHeading,
  groupLabel: COPY.nav.modeLabel,
  employee: COPY.nav.employeeMode,
  admin: COPY.nav.adminMode,
  switchToEmployee: COPY.nav.switchToEmployee,
  switchToAdmin: COPY.nav.switchToAdmin,
};

const Brand = () => (
  <Link
    to="/rooms"
    search={{}}
    aria-label={COPY.brand}
    className="group flex min-w-0 items-center gap-3 rounded-2xl px-1.5 py-1 text-ink"
  >
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-g7 text-white shadow-card group-hover:bg-olive-dark"
    >
      <Building2 className="size-5" strokeWidth={2.2} />
    </span>
    <span className="min-w-0 leading-tight">
      <b className="block truncate text-lg tracking-[-0.02em]">{COPY.brand}</b>
      <small className="mt-0.5 block truncate text-xs font-medium text-muted">{COPY.company}</small>
    </span>
  </Link>
);

export const Shell = ({ children }: { children: ReactNode }) => {
  const { data: me } = useSuspenseQuery(meQuery);
  const signOut = useSignOut();

  return (
    <div className="min-h-screen bg-bg md:grid md:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-line/80 bg-surface px-4 py-5 md:flex lg:px-5 lg:py-6">
        <Brand />

        <Link
          to="/rooms"
          search={{}}
          activeProps={{ 'aria-current': 'page' }}
          className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-g7 px-4 text-sm font-bold text-white shadow-card hover:bg-olive-dark active:translate-y-px"
        >
          <Search className="size-4.5" aria-hidden="true" />
          {COPY.nav.rooms}
        </Link>

        <nav aria-label="เมนูหลัก" className="grid gap-1.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              search={{}}
              className="group flex min-h-11 items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-semibold text-ink2 hover:bg-surface-soft hover:text-ink aria-[current=page]:border-g2/40 aria-[current=page]:bg-g1 aria-[current=page]:font-bold aria-[current=page]:text-g7"
              activeProps={{ 'aria-current': 'page' }}
            >
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-xl bg-transparent group-aria-[current=page]:bg-surface"
              >
                <item.icon className="size-4.5" />
              </span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto grid gap-2.5 border-t border-line/80 pt-4">
          <AppModeSwitch
            role={me.user.role}
            currentMode="employee"
            labels={MODE_SWITCH_LABELS}
            employeeIcon={UserRound}
            adminIcon={ShieldCheck}
          />
          <div className="flex items-center gap-3 rounded-2xl bg-surface-soft p-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-g1 font-bold text-g7"
            >
              {me.user.full_name.charAt(0)}
            </span>
            <span className="min-w-0 text-sm leading-snug">
              <b className="block truncate text-ink">{me.user.full_name}</b>
              <small className="mt-0.5 block truncate text-xs text-muted">
                {me.department.name} · {me.user.employee_code}
              </small>
            </span>
          </div>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="flex min-h-10 items-center gap-3 rounded-2xl px-3 text-sm font-semibold text-ink2 hover:bg-r0 hover:text-r7 disabled:opacity-60"
          >
            <LogOut className="size-4.5" aria-hidden />
            {COPY.nav.signOut}
          </button>
        </div>
      </aside>

      <div className="min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </div>

      <nav
        aria-label="เมนูหลัก"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line/80 bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-soft backdrop-blur-xl md:hidden"
      >
        {MOBILE_NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            search={{}}
            className="my-1 flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[0.6875rem] leading-tight font-semibold text-muted hover:bg-surface-soft aria-[current=page]:bg-g1 aria-[current=page]:font-bold aria-[current=page]:text-g7"
            activeProps={{ 'aria-current': 'page' }}
          >
            <item.icon className="size-5" aria-hidden />
            <span className="line-clamp-2 max-w-full text-center">{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
};
