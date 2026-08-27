import { describe, expect, it } from 'vitest';
import { leavesThisApp, safeInternalPath } from './login';

describe('safeInternalPath', () => {
  it('keeps internal paths', () => {
    expect(safeInternalPath('/bookings')).toBe('/bookings');
    expect(safeInternalPath('/admin/users')).toBe('/admin/users');
  });

  it('refuses anything that could leave this origin', () => {
    for (const hostile of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '']) {
      expect(safeInternalPath(hostile)).toBe('/rooms');
    }
    expect(safeInternalPath(undefined)).toBe('/rooms');
  });
});

describe('leavesThisApp', () => {
  // A router push to the admin bundle renders this app's 404 instead — sign-in must hand
  // those targets to the browser so the /admin/ document (and its rewrite) is fetched.
  it('is true for the admin bundle', () => {
    expect(leavesThisApp('/admin')).toBe(true);
    expect(leavesThisApp('/admin/')).toBe(true);
    expect(leavesThisApp('/admin/users?edit=1')).toBe(true);
  });

  it('is false for employee routes, including look-alikes', () => {
    for (const path of ['/', '/bookings', '/calendar', '/administration', '/admins']) {
      expect(leavesThisApp(path)).toBe(false);
    }
  });
});
