import type { ReactNode } from 'react';
import { COPY } from '../lib/i18n';

export const pagerLinkClass =
  'min-h-9 rounded-[11px] border border-line bg-white px-3 py-1.5 font-semibold text-ink2 aria-disabled:pointer-events-none aria-disabled:opacity-50';

export interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  /** Audit logs cap `total` at 10,000 — render "10,000+" and never derive a last page. */
  totalIsCapped?: boolean | undefined;
  /**
   * The caller owns the router-typed <Link> (each screen links to its own route with its
   * own search shape); this component owns the layout, the labels and aria-disabled.
   */
  renderLink: (targetPage: number, disabled: boolean, label: ReactNode) => ReactNode;
}

/**
 * Prev/next + "แสดง {from}–{to} จาก {total}". A numbered pager was rejected: more code and
 * more accessibility surface for no benefit, and it would diverge from the employee app.
 */
export const Pager = ({ page, pageSize, total, totalIsCapped, renderLink }: PagerProps) => {
  if (total === 0) {
    return null;
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const totalText = `${total.toLocaleString('en-US')}${totalIsCapped === true ? '+' : ''}`;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted tabular-nums">
        {COPY.pager.rangePrefix} {from}–{to} {COPY.pager.rangeMiddle} {totalText}
      </p>
      {totalPages > 1 ? (
        <nav
          aria-label={`${COPY.pager.pagePrefix} ${page}/${totalPages}`}
          className="flex items-center gap-3"
        >
          {renderLink(page - 1, page <= 1, <>← {COPY.pager.prev}</>)}
          <span className="text-muted tabular-nums">
            {COPY.pager.pagePrefix} {page}/{totalPages}
          </span>
          {renderLink(page + 1, page >= totalPages, <>{COPY.pager.next} →</>)}
        </nav>
      ) : null}
    </div>
  );
};
