import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useRetryEmail } from '../api/mutations';
import { type OutboxParams, outboxQuery } from '../api/queries';
import { chipClass } from '../components/filters';
import { Pager, pagerLinkClass } from '../components/pager';
import { AdminTable, EmptyCard, InlineAlert } from '../components/table';
import { bkkDate, bkkTime, formatThaiDate } from '../lib/datetime';
import { COPY, errorMessage, OUTBOX_STATUS_LABELS, templateLabel } from '../lib/i18n';
import { authedRoute } from './authed';

/**
 * A13. Small screen, high value: without it a silently failed cancellation email means
 * someone shows up to a room they no longer have.
 *
 * The list defaults to FAILED — that is the queue an admin is here to drain. Only a FAILED
 * row can be retried (409 INVALID_STATUS_TRANSITION otherwise), so `ส่งใหม่` exists only
 * there rather than being rendered everywhere and disabled.
 */

export interface EmailsSearch {
  /** '' means ทั้งหมด; absent means the FAILED default. */
  status?: string;
  page?: number;
}

const DEFAULT_STATUS = 'FAILED';

const statusOf = (search: EmailsSearch): string => search.status ?? DEFAULT_STATUS;

const paramsOf = (search: EmailsSearch): OutboxParams => ({
  status: statusOf(search),
  page: search.page ?? 1,
});

const STATUS_TONES: Record<string, string> = {
  FAILED: 'bg-r1 text-r7',
  PENDING: 'bg-y1 text-y7',
  SENT: 'bg-g1 text-g7',
  SKIPPED: 'bg-n1 text-ink2',
};

const EmailsPage = () => {
  const search = emailsRoute.useSearch();
  const status = statusOf(search);
  const { data: list } = useSuspenseQuery(outboxQuery(paramsOf(search)));
  const retry = useRetryEmail();
  const [retried, setRetried] = useState(false);

  const statusChip = (value: string, label: string) => (
    <Link
      key={value === '' ? 'all' : value}
      to="/emails"
      search={{ status: value }}
      aria-current={status === value ? 'true' : undefined}
      className={chipClass(status === value)}
    >
      {label}
    </Link>
  );

  return (
    <div className="p-4 md:p-6">
      <header>
        <h1 className="font-bold text-2xl text-ink">{COPY.emails.title}</h1>
        <p className="text-muted text-sm">{COPY.emails.sub}</p>
      </header>

      <nav aria-label={COPY.emails.statusFilterLabel} className="mt-4 flex flex-wrap gap-1.5">
        {Object.entries(OUTBOX_STATUS_LABELS).map(([value, label]) => statusChip(value, label))}
        {statusChip('', COPY.emails.all)}
      </nav>

      <div aria-live="polite" className="mt-4 grid gap-3">
        {retry.isError ? <InlineAlert message={errorMessage(retry.error)} /> : null}
        {retried ? (
          <p
            role="status"
            className="rounded-xl border border-g2 bg-g0 px-3.5 py-3 font-bold text-g7 text-sm"
          >
            {COPY.emails.retried}
          </p>
        ) : null}
      </div>

      {list.data.length === 0 ? (
        <div className="mt-4">
          {/* The good case, said calmly and with no CTA. */}
          <EmptyCard
            message={status === DEFAULT_STATUS ? COPY.emails.emptyFailed : COPY.emails.empty}
          />
        </div>
      ) : (
        <>
          <div className="mt-4">
            <AdminTable
              label={COPY.emails.tableLabel}
              columns={[
                COPY.emails.colTime,
                COPY.emails.colTemplate,
                COPY.emails.colRecipient,
                COPY.emails.colBooking,
                COPY.emails.colAttempts,
                COPY.emails.colActions,
              ]}
              rows={list.data}
              rowKey={(email) => String(email.id)}
              renderRow={(email) => (
                <>
                  <td className="px-4 py-3 text-ink2 tabular-nums whitespace-nowrap">
                    {formatThaiDate(bkkDate(email.created_at), { omitCurrentYear: true })}{' '}
                    {bkkTime(email.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <b className="text-ink">{templateLabel(email.template_key)}</b>
                    <span
                      className={`ml-2 inline-flex min-h-6 items-center rounded-full px-2.5 font-semibold text-xs ${
                        STATUS_TONES[email.status] ?? 'bg-n1 text-ink2'
                      }`}
                    >
                      {OUTBOX_STATUS_LABELS[email.status]}
                    </span>
                    {/* The runbook question is "why did it not go out" — last_error is
                        served verbatim and is the answer. */}
                    {email.last_error !== null ? (
                      <small className="mt-0.5 block break-words text-muted text-xs">
                        {email.last_error}
                      </small>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 break-all text-ink2">{email.recipient_email}</td>
                  <td className="px-4 py-3">
                    {email.booking_id === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <Link
                        to="/bookings/$bookingId"
                        params={{ bookingId: email.booking_id }}
                        className="font-semibold text-g7 text-xs underline"
                      >
                        {COPY.emails.viewBooking}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink2 tabular-nums">{email.attempts}</td>
                  <td className="px-4 py-3">
                    {email.status === 'FAILED' ? (
                      <button
                        type="button"
                        disabled={retry.isPending}
                        onClick={() => {
                          setRetried(false);
                          retry.mutate({ id: email.id }, { onSuccess: () => setRetried(true) });
                        }}
                        className="inline-flex min-h-8 items-center rounded-[9px] border border-line bg-white px-2.5 font-semibold text-ink2 text-xs hover:bg-g0 disabled:opacity-50"
                      >
                        {retry.isPending ? COPY.emails.retrying : COPY.emails.retry}
                      </button>
                    ) : null}
                  </td>
                </>
              )}
            />
          </div>

          <Pager
            page={list.page.page}
            pageSize={list.page.page_size}
            total={list.page.total}
            totalIsCapped={list.page.total_is_capped}
            renderLink={(targetPage, disabled, label) => (
              <Link
                to="/emails"
                search={{ ...search, page: targetPage }}
                disabled={disabled}
                aria-disabled={disabled}
                className={pagerLinkClass}
              >
                {label}
              </Link>
            )}
          />
        </>
      )}
    </div>
  );
};

export const emailsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/emails',
  validateSearch: (search: Record<string, unknown>): EmailsSearch => ({
    ...(typeof search.status === 'string' ? { status: search.status } : {}),
    ...(typeof search.page === 'number' && Number.isInteger(search.page) && search.page > 1
      ? { page: search.page }
      : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(outboxQuery(paramsOf(deps))),
  component: EmailsPage,
});
