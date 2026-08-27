// Shared filter-control classes. Lifted from apps/web/src/routes/bookings.tsx so the two
// apps stay visually indistinguishable.

export const chipClass = (active: boolean): string =>
  `inline-flex min-h-8 items-center rounded-full border px-3 text-sm font-semibold ${
    active ? 'border-g7 bg-g1 text-g7' : 'border-line bg-white text-ink2 hover:bg-g0'
  }`;

export const fieldLabelClass = 'text-xs font-semibold text-ink2';

export const controlClass =
  'min-h-10 rounded-[11px] border border-border-input bg-white px-3 text-sm text-ink';
