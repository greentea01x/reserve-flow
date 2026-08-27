import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { type AuditLogParams, auditLogsQuery, userSearchQuery } from '../api/queries';
import type { AuditLog } from '../api/types';
import { controlClass, fieldLabelClass } from '../components/filters';
import { Pager, pagerLinkClass } from '../components/pager';
import { AdminTable, EmptyCard } from '../components/table';
import { bkkDate, bkkTime, formatThaiDate } from '../lib/datetime';
import { AUDIT_ACTIONS, auditActionLabel, COPY, ENTITY_TYPE_LABELS } from '../lib/i18n';
import { authedRoute } from './authed';

/**
 * A12 — read-only, and there is no write endpoint and never will be: `audit_logs` is
 * protected by an UPDATE/DELETE trigger and by revoked grants.
 *
 * Two server facts shape this screen: sort is fixed at newest-first (no `sort` param
 * exists), and `total` is capped at 10,000 — so the pager renders "10,000+" and never
 * derives a last page from it.
 */

export interface AuditSearch {
  from?: string;
  to?: string;
  actor?: string;
  entity?: string;
  action?: string;
  page?: number;
}

const isFiltered = (search: AuditSearch): boolean =>
  search.from !== undefined ||
  search.to !== undefined ||
  search.actor !== undefined ||
  search.entity !== undefined ||
  search.action !== undefined;

const paramsOf = (search: AuditSearch): AuditLogParams => ({
  ...(search.from !== undefined && search.from !== '' ? { from: search.from } : {}),
  ...(search.to !== undefined && search.to !== '' ? { to: search.to } : {}),
  ...(search.actor !== undefined && search.actor !== '' ? { actor_id: search.actor } : {}),
  ...(search.entity !== undefined && search.entity !== '' ? { entity_type: search.entity } : {}),
  ...(search.action !== undefined && search.action !== '' ? { action: search.action } : {}),
  page: search.page ?? 1,
});

const patched = (prev: AuditSearch, patch: Partial<AuditSearch>): AuditSearch => {
  const next: AuditSearch = { ...prev, ...patch };
  delete next.page;
  for (const key of ['from', 'to', 'actor', 'entity', 'action'] as const) {
    if (next[key] === undefined || next[key] === '') {
      delete next[key];
    }
  }
  return next;
};

/** `mobile` / `password_hash` come back stripped — render the gap, do not reconstruct it. */
const DiffList = ({ label, value }: { label: string; value: unknown }) => (
  <div className="min-w-0">
    <p className="font-semibold text-muted text-xs">{label}</p>
    {typeof value !== 'object' || value === null ? (
      <p className="text-ink2 text-xs">{COPY.auditLogs.redacted}</p>
    ) : (
      <dl className="grid gap-0.5 text-xs">
        {Object.entries(value as Record<string, unknown>).map(([key, entry]) => (
          <div key={key} className="flex gap-1.5">
            <dt className="text-muted">{key}</dt>
            <dd className="min-w-0 break-words text-ink2">
              {entry === null || entry === undefined
                ? COPY.auditLogs.redacted
                : typeof entry === 'object'
                  ? JSON.stringify(entry)
                  : String(entry)}
            </dd>
          </div>
        ))}
      </dl>
    )}
  </div>
);

/** Only `booking` rows have a screen to open; the rest render their id as plain text. */
const EntityCell = ({ log }: { log: AuditLog }) => {
  const label = ENTITY_TYPE_LABELS[log.entity_type] ?? log.entity_type;
  if (log.entity_type !== 'booking') {
    return (
      <span className="text-ink2">
        {label}
        <small className="block truncate text-muted text-xs">{log.entity_id}</small>
      </span>
    );
  }
  return (
    <span className="text-ink2">
      {label}
      <Link
        to="/bookings/$bookingId"
        params={{ bookingId: log.entity_id }}
        className="block font-semibold text-g7 text-xs underline"
      >
        {COPY.auditLogs.viewEntity}
      </Link>
    </span>
  );
};

/**
 * `actor_id` is uuid-only, so a free-text box that silently does nothing would be worse
 * than no filter at all: type at least 2 characters, pick a person, filter by their id.
 * The selected actor's NAME comes from the rows themselves — every row in a filtered
 * result carries it — so resolving the id costs no extra request.
 */
const ActorFilter = ({
  actorId,
  actorName,
  onPick,
}: {
  actorId: string | undefined;
  actorName: string | null;
  onPick: (id: string | undefined) => void;
}) => {
  const [term, setTerm] = useState('');
  const inputId = useId();
  const helperId = useId();
  const results = useQuery(userSearchQuery(term));

  if (actorId !== undefined) {
    return (
      <div className="grid gap-1">
        <span className={fieldLabelClass}>{COPY.auditLogs.actorLabel}</span>
        <span className="inline-flex min-h-10 items-center gap-2 rounded-[11px] border border-g7 bg-g1 px-3 font-semibold text-g7 text-sm">
          {actorName ?? actorId}
          <button
            type="button"
            onClick={() => onPick(undefined)}
            aria-label={COPY.auditLogs.actorClear}
            className="font-bold"
          >
            ✕
          </button>
        </span>
      </div>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const first = results.data?.data[0];
    if (first !== undefined) {
      onPick(first.id);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-1">
      <label htmlFor={inputId} className={fieldLabelClass}>
        {COPY.auditLogs.actorLabel}
      </label>
      <input
        id={inputId}
        type="search"
        value={term}
        maxLength={200}
        placeholder={COPY.auditLogs.actorPlaceholder}
        aria-describedby={helperId}
        onChange={(event) => setTerm(event.target.value)}
        className={`${controlClass} w-56 max-w-full`}
      />
      <small id={helperId} className="text-muted text-xs">
        {COPY.auditLogs.actorHelper}
      </small>
      {term.trim().length >= 2 ? (
        <ul className="grid max-h-40 gap-0.5 overflow-y-auto rounded-[11px] border border-line bg-white p-1">
          {results.data?.data.length === 0 ? (
            <li className="px-2 py-1 text-muted text-xs">{COPY.auditLogs.actorNoResults}</li>
          ) : null}
          {(results.data?.data ?? []).map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onPick(user.id)}
                className="w-full rounded-[9px] px-2 py-1.5 text-left text-ink2 text-xs hover:bg-g0"
              >
                {user.full_name} · {user.employee_code}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
};

const AuditLogsPage = () => {
  const search = auditLogsRoute.useSearch();
  const { data: list } = useSuspenseQuery(auditLogsQuery(paramsOf(search)));
  const navigate = useNavigate({ from: '/audit-logs' });
  const fromId = useId();
  const toId = useId();
  const entityId = useId();
  const actionId = useId();

  const setSearch = (patch: Partial<AuditSearch>) => {
    void navigate({ search: (prev: AuditSearch) => patched(prev, patch) });
  };

  return (
    <div className="p-4 md:p-6">
      <header>
        <h1 className="font-bold text-2xl text-ink">{COPY.auditLogs.title}</h1>
        <p className="text-muted text-sm">{COPY.auditLogs.sub}</p>
      </header>

      <div className="mt-4 flex flex-wrap items-start gap-3">
        <div className="grid gap-1">
          <label htmlFor={fromId} className={fieldLabelClass}>
            {COPY.auditLogs.fromLabel}
          </label>
          <input
            id={fromId}
            type="date"
            value={search.from ?? ''}
            onChange={(event) => setSearch({ from: event.target.value })}
            className={controlClass}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={toId} className={fieldLabelClass}>
            {COPY.auditLogs.toLabel}
          </label>
          <input
            id={toId}
            type="date"
            value={search.to ?? ''}
            onChange={(event) => setSearch({ to: event.target.value })}
            className={controlClass}
          />
        </div>
        <ActorFilter
          actorId={search.actor}
          actorName={list.data[0]?.actor?.full_name ?? null}
          onPick={(id) => setSearch({ actor: id ?? '' })}
        />
        <div className="grid gap-1">
          <label htmlFor={entityId} className={fieldLabelClass}>
            {COPY.auditLogs.entityTypeLabel}
          </label>
          <select
            id={entityId}
            value={search.entity ?? ''}
            onChange={(event) => setSearch({ entity: event.target.value })}
            className={controlClass}
          >
            <option value="">{COPY.auditLogs.all}</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={actionId} className={fieldLabelClass}>
            {COPY.auditLogs.actionLabel}
          </label>
          <select
            id={actionId}
            value={search.action ?? ''}
            onChange={(event) => setSearch({ action: event.target.value })}
            className={controlClass}
          >
            <option value="">{COPY.auditLogs.all}</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {auditActionLabel(action)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.data.length === 0 ? (
        <div className="mt-4">
          <EmptyCard
            message={COPY.auditLogs.empty}
            action={
              isFiltered(search) ? (
                <Link
                  to="/audit-logs"
                  search={{}}
                  className="inline-flex min-h-10 items-center rounded-[13px] bg-g7 px-4 font-bold text-white"
                >
                  {COPY.states.clearFilters}
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-4">
            <AdminTable
              label={COPY.auditLogs.tableLabel}
              columns={[
                COPY.auditLogs.colTime,
                COPY.auditLogs.colActor,
                COPY.auditLogs.colAction,
                COPY.auditLogs.colEntity,
                COPY.auditLogs.colReason,
                COPY.auditLogs.colIp,
              ]}
              rows={list.data}
              rowKey={(log) => String(log.id)}
              renderRow={(log) => (
                <>
                  <td className="px-4 py-3 text-ink2 tabular-nums whitespace-nowrap">
                    {formatThaiDate(bkkDate(log.created_at), { omitCurrentYear: true })}{' '}
                    {bkkTime(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-ink2">
                    {log.actor?.full_name ?? COPY.auditLogs.systemActor}
                  </td>
                  <td className="px-4 py-3">
                    <b className="text-ink">{auditActionLabel(log.action)}</b>
                    {/* <details>'s summary is exposed as a button with an expanded state —
                        a real disclosure, zero JS, no bare chevron. */}
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-muted text-xs">
                        {COPY.auditLogs.details}
                      </summary>
                      <div className="mt-1 grid gap-2 sm:grid-cols-2">
                        <DiffList label={COPY.auditLogs.before} value={log.before} />
                        <DiffList label={COPY.auditLogs.after} value={log.after} />
                      </div>
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    <EntityCell log={log} />
                  </td>
                  <td className="px-4 py-3 text-ink2 text-xs">{log.reason ?? ''}</td>
                  <td className="px-4 py-3 text-muted text-xs tabular-nums">{log.ip ?? ''}</td>
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
                to="/audit-logs"
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

export const auditLogsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/audit-logs',
  validateSearch: (search: Record<string, unknown>): AuditSearch => ({
    ...(typeof search.from === 'string' && search.from !== '' ? { from: search.from } : {}),
    ...(typeof search.to === 'string' && search.to !== '' ? { to: search.to } : {}),
    ...(typeof search.actor === 'string' && search.actor !== '' ? { actor: search.actor } : {}),
    ...(typeof search.entity === 'string' && ENTITY_TYPE_LABELS[search.entity] !== undefined
      ? { entity: search.entity }
      : {}),
    ...(typeof search.action === 'string' && search.action !== '' ? { action: search.action } : {}),
    ...(typeof search.page === 'number' && Number.isInteger(search.page) && search.page > 1
      ? { page: search.page }
      : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(auditLogsQuery(paramsOf(deps))),
  component: AuditLogsPage,
});
