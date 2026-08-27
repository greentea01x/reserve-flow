import { AppModeSwitch, type AppModeSwitchLabels } from '@reserveflow/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const Icon = (props: { className?: string; 'aria-hidden'?: boolean }) => <svg {...props} />;

const labels: AppModeSwitchLabels = {
  heading: 'โหมดการใช้งาน',
  groupLabel: 'สลับโหมดการใช้งาน',
  employee: 'ผู้ใช้',
  admin: 'แอดมิน',
  switchToEmployee: 'สลับไปโหมดผู้ใช้',
  switchToAdmin: 'สลับไปโหมดแอดมิน',
};

const render = (role: 'EMPLOYEE' | 'ADMIN' | 'FACILITY', currentMode: 'employee' | 'admin') =>
  renderToStaticMarkup(
    <AppModeSwitch
      role={role}
      currentMode={currentMode}
      labels={labels}
      employeeIcon={Icon}
      adminIcon={Icon}
    />,
  );

describe('AppModeSwitch', () => {
  it('offers the admin bundle from the employee experience', () => {
    const html = render('ADMIN', 'employee');

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/admin/"');
    expect(html).toContain('aria-label="สลับไปโหมดแอดมิน"');
  });

  it('offers the employee room list from the admin experience', () => {
    const html = render('ADMIN', 'admin');

    expect(html).toContain('href="/rooms"');
    expect(html).toContain('aria-label="สลับไปโหมดผู้ใช้"');
  });

  it('is absent for non-admin roles', () => {
    expect(render('EMPLOYEE', 'employee')).toBe('');
    expect(render('FACILITY', 'employee')).toBe('');
  });
});
