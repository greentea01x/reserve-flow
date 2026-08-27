import type { Role } from '@reserveflow/shared';
import type { ComponentType } from 'react';

export type AppMode = 'employee' | 'admin';

interface ModeIconProps {
  className?: string;
  'aria-hidden'?: boolean;
}

export interface AppModeSwitchLabels {
  heading: string;
  groupLabel: string;
  employee: string;
  admin: string;
  switchToEmployee: string;
  switchToAdmin: string;
}

export interface AppModeSwitchProps {
  role: Role;
  currentMode: AppMode;
  labels: AppModeSwitchLabels;
  employeeIcon: ComponentType<ModeIconProps>;
  adminIcon: ComponentType<ModeIconProps>;
  collapsed?: boolean;
  employeeHref?: string;
  adminHref?: string;
}

interface ModeSegmentProps {
  active: boolean;
  collapsed: boolean;
  href: string;
  label: string;
  linkLabel: string;
  icon: ComponentType<ModeIconProps>;
}

const ModeSegment = ({
  active,
  collapsed,
  href,
  label,
  linkLabel,
  icon: Icon,
}: ModeSegmentProps) => {
  const className = `flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-2 font-bold text-xs ${
    active
      ? 'bg-g7 text-white shadow-card'
      : 'text-ink2 hover:bg-surface hover:text-g7 focus-visible:bg-surface'
  }`;
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
    </>
  );

  if (active) {
    return (
      <span aria-current="page" className={className} title={collapsed ? label : undefined}>
        {content}
      </span>
    );
  }

  return (
    <a
      href={href}
      aria-label={linkLabel}
      className={className}
      title={collapsed ? label : undefined}
    >
      {content}
    </a>
  );
};

/**
 * Cross-bundle navigation for administrators. These are plain anchors because the employee
 * and admin experiences are separate router bundles that share one authenticated origin.
 */
export const AppModeSwitch = ({
  role,
  currentMode,
  labels,
  employeeIcon,
  adminIcon,
  collapsed = false,
  employeeHref = '/rooms',
  adminHref = '/admin/',
}: AppModeSwitchProps) => {
  if (role !== 'ADMIN') {
    return null;
  }

  return (
    <nav
      aria-label={labels.groupLabel}
      className={`grid gap-1.5 ${collapsed ? 'justify-items-center' : ''}`}
    >
      <p className={collapsed ? 'sr-only' : 'px-1 text-muted text-xs'}>{labels.heading}</p>
      <div
        className={`grid gap-1 rounded-xl border border-line/80 bg-surface-soft p-1 ${
          collapsed ? 'w-11 grid-cols-1' : 'grid-cols-2'
        }`}
      >
        <ModeSegment
          active={currentMode === 'employee'}
          collapsed={collapsed}
          href={employeeHref}
          label={labels.employee}
          linkLabel={labels.switchToEmployee}
          icon={employeeIcon}
        />
        <ModeSegment
          active={currentMode === 'admin'}
          collapsed={collapsed}
          href={adminHref}
          label={labels.admin}
          linkLabel={labels.switchToAdmin}
          icon={adminIcon}
        />
      </div>
    </nav>
  );
};
