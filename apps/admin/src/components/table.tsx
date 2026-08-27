import type { ReactNode } from 'react';

/**
 * A card + a NAMED, FOCUSABLE horizontal scroll region + a real <table>.
 * Deliberately not a data grid: no client sorting, no column resizing, no virtualisation.
 * Paging and sorting are server-side everywhere in this app.
 */
export interface AdminTableProps<T> {
  /** Accessible name — several dense tables per screen are indistinguishable without it. */
  label: string;
  columns: string[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Returns the <td> cells for one row; the wrapper <tr> is owned here. */
  renderRow: (row: T) => ReactNode;
  /** Optional per-row tint. Decoration only — a badge must carry the meaning. */
  rowClass?: (row: T) => string;
}

export const AdminTable = <T,>({
  label,
  columns,
  rows,
  rowKey,
  renderRow,
  rowClass,
}: AdminTableProps<T>) => (
  <section
    className="overflow-x-auto rounded-2xl border border-line bg-white"
    // A11Y: an overflow box only a mouse can scroll is a keyboard trap in the other
    // direction (WCAG 2.1.1) — the region is focusable and named, and the page itself
    // never scrolls sideways.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be keyboard-reachable
    tabIndex={0}
    aria-label={label}
  >
    <table className="w-full text-sm">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr className="border-b border-line text-left text-xs text-muted">
          {columns.map((column) => (
            <th key={column} scope="col" className="px-4 py-3 font-semibold whitespace-nowrap">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            className={`border-b border-line last:border-b-0 ${rowClass?.(row) ?? ''}`}
          >
            {renderRow(row)}
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

/** UX-15: every screen needs an empty state — one line of Thai, at most one CTA. */
export const EmptyCard = ({ message, action }: { message: string; action?: ReactNode }) => (
  <div className="grid min-h-48 place-items-center rounded-2xl border border-line bg-white p-6 text-center">
    <div>
      <p className="text-base font-bold text-ink2">{message}</p>
      {action !== undefined ? <div className="mt-3">{action}</div> : null}
    </div>
  </div>
);

/** UX-15: inline server errors are an Alert, never a toast. */
export const InlineAlert = ({ message }: { message: string }) => (
  <p
    role="alert"
    className="rounded-xl border border-r2 bg-r0 px-3.5 py-3 text-sm font-semibold text-r7"
  >
    {message}
  </p>
);
