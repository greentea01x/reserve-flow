import { ROLES, type Role, USER_STATUSES, type UserStatus } from '@reserveflow/shared';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useAccountLink, useDeleteUser, useReactivateUser } from '../api/mutations';
import {
  type AdminUsersParams,
  adminUsersQuery,
  departmentsQuery,
  meQuery,
  userFacetsQuery,
} from '../api/queries';
import type { AdminUser, DeactivateResponse } from '../api/types';
import { ConfirmDialog } from '../components/confirm-dialog';
import { CsvImportDialog } from '../components/csv-import-dialog';
import { DeactivateDialog } from '../components/deactivate-dialog';
import { chipClass, controlClass, fieldLabelClass } from '../components/filters';
import { Pager, pagerLinkClass } from '../components/pager';
import { AdminTable, EmptyCard, InlineAlert } from '../components/table';
import { UserSheet } from '../components/user-sheet';
import { UserStatusBadge } from '../components/user-status-badge';
import { bkkDate, bkkTime, formatThaiDate, formatTimeRange } from '../lib/datetime';
import { COPY, errorMessage, ROLE_LABELS, USER_STATUS_LABELS } from '../lib/i18n';
import { useDialogOpen } from '../lib/use-dialog';
import { userGuards } from '../lib/users';
import { authedRoute } from './authed';

export interface UsersSearch {
  q?: string;
  role?: Role;
  status?: UserStatus;
  dept?: string;
  page?: number;
  /** A9's Sheet: a user uuid, or 'new'. Held in the URL so it survives a reload. */
  edit?: string;
}

const isFiltered = (search: UsersSearch): boolean =>
  search.q !== undefined ||
  search.role !== undefined ||
  search.status !== undefined ||
  search.dept !== undefined;

const paramsOf = (search: UsersSearch): AdminUsersParams => ({
  ...(search.q !== undefined && search.q !== '' ? { q: search.q } : {}),
  ...(search.role !== undefined ? { role: search.role } : {}),
  ...(search.status !== undefined ? { status: search.status } : {}),
  ...(search.dept !== undefined && search.dept !== '' ? { department_id: search.dept } : {}),
  page: search.page ?? 1,
});

/** Any filter change resets to page 1 and closes the sheet. */
const patched = (prev: UsersSearch, patch: Partial<UsersSearch>): UsersSearch => {
  const next: UsersSearch = { ...prev, ...patch };
  delete next.page;
  delete next.edit;
  for (const key of ['q', 'role', 'status', 'dept'] as const) {
    if (next[key] === undefined || next[key] === '') {
      delete next[key];
    }
  }
  return next;
};

const rowActionClass =
  'inline-flex min-h-8 items-center rounded-[9px] border border-line bg-white px-2.5 font-semibold text-ink2 text-xs hover:bg-g0';

const UsersPage = () => {
  const search = usersRoute.useSearch();
  const params = paramsOf(search);
  const { data: list } = useSuspenseQuery(adminUsersQuery(params));
  const { data: departments } = useSuspenseQuery(departmentsQuery);
  const { data: facets } = useSuspenseQuery(userFacetsQuery);
  const { data: me } = useSuspenseQuery(meQuery);
  const navigate = useNavigate({ from: '/users' });

  const [deactivating, setDeactivating] = useState<AdminUser | null>(null);
  const [reactivating, setReactivating] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cascade, setCascade] = useState<DeactivateResponse | null>(null);
  const importRef = useRef<HTMLDialogElement>(null);
  const reactivateRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);

  const resendInvite = useAccountLink('resend-invite');
  const reactivate = useReactivateUser();
  const deleteUser = useDeleteUser();

  const deptId = useId();
  const searchId = useId();

  useDialogOpen(reactivateRef, reactivating !== null);
  useDialogOpen(deleteRef, deleting !== null);

  const setSearch = (patch: Partial<UsersSearch>) => {
    setStatus(null);
    setCascade(null);
    void navigate({ search: (prev: UsersSearch) => patched(prev, patch) });
  };

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    setSearch({ q: typeof value === 'string' ? value.trim() : '' });
  };

  const filterChip = (
    key: 'role' | 'status',
    value: Role | UserStatus | null,
    label: string,
    count: number | null,
  ) => {
    const active = value === null ? search[key] === undefined : search[key] === value;
    const next = patched(search, {});
    if (value === null) {
      delete next[key];
    } else {
      Object.assign(next, { [key]: value });
    }
    return (
      <Link
        key={`${key}-${value ?? 'all'}`}
        to="/users"
        search={next}
        aria-current={active ? 'true' : undefined}
        className={`${chipClass(active)} tabular-nums`}
      >
        {label}
        {count === null ? '' : ` ${count}`}
      </Link>
    );
  };

  return (
    <div className="p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl text-ink">{COPY.users.title}</h1>
          <p className="text-muted text-sm">
            <span className="tabular-nums">{facets.total}</span> {COPY.users.subAccounts} ·{' '}
            <span className="tabular-nums">{departments.length}</span> {COPY.users.subTeams} ·{' '}
            {COPY.users.subTail}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => importRef.current?.showModal()}
            className="inline-flex min-h-10 items-center rounded-[13px] border border-line bg-white px-4 font-bold text-ink2 text-sm hover:bg-g0"
          >
            {COPY.users.importCsv}
          </button>
          <Link
            to="/users"
            search={{ ...search, edit: 'new' }}
            className="inline-flex min-h-10 items-center rounded-[13px] bg-g7 px-4 font-bold text-sm text-white"
          >
            {COPY.users.add}
          </Link>
        </div>
      </header>

      {/* Two labelled groups, not one row: role and status are orthogonal and a single row
          reads as mutually exclusive when it is not. */}
      <nav aria-label={COPY.users.roleFilterLabel} className="mt-4 flex flex-wrap gap-1.5">
        {filterChip('role', null, COPY.users.filterAll, facets.total)}
        {ROLES.map((role) => filterChip('role', role, ROLE_LABELS[role], facets.role[role]))}
      </nav>
      <nav aria-label={COPY.users.statusFilterLabel} className="mt-2 flex flex-wrap gap-1.5">
        {filterChip('status', null, COPY.users.filterAll, null)}
        {USER_STATUSES.map((value) =>
          filterChip('status', value, USER_STATUS_LABELS[value], facets.status[value]),
        )}
      </nav>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label htmlFor={deptId} className={fieldLabelClass}>
            {COPY.users.departmentLabel}
          </label>
          <select
            id={deptId}
            className={controlClass}
            value={search.dept ?? ''}
            onChange={(event) => setSearch({ dept: event.target.value })}
          >
            <option value="">{COPY.users.allDepartments}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
        <form onSubmit={onSearchSubmit} className="flex items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor={searchId} className={fieldLabelClass}>
              {COPY.users.searchLabel}
            </label>
            <input
              id={searchId}
              name="q"
              type="search"
              maxLength={200}
              placeholder={COPY.users.searchPlaceholder}
              defaultValue={search.q ?? ''}
              key={search.q ?? ''}
              className={`${controlClass} w-64 max-w-full`}
            />
          </div>
          <button
            type="submit"
            className="min-h-10 rounded-[11px] border border-line bg-white px-3 font-semibold text-ink2 text-sm hover:bg-g0"
          >
            {COPY.users.searchSubmit}
          </button>
        </form>
      </div>

      {/* §6: the deactivation result appears where the admin's focus is not. */}
      <div aria-live="polite" className="mt-4 grid gap-3">
        {resendInvite.isError ? <InlineAlert message={errorMessage(resendInvite.error)} /> : null}
        {reactivate.isError ? <InlineAlert message={errorMessage(reactivate.error)} /> : null}
        {deleteUser.isError ? <InlineAlert message={errorMessage(deleteUser.error)} /> : null}
        {status !== null ? (
          <p
            role="status"
            className="rounded-xl border border-g2 bg-g0 px-3.5 py-3 font-bold text-g7 text-sm"
          >
            {status}
          </p>
        ) : null}
        {cascade !== null ? (
          <div
            role="status"
            className="rounded-xl border border-r2 bg-r0 px-3.5 py-3 text-r7 text-sm"
          >
            <b className="tabular-nums">
              {COPY.deactivateDialog.resultPrefix} {cascade.cancelled_bookings.length}{' '}
              {COPY.deactivateDialog.resultSuffix}
            </b>
            {cascade.cancelled_bookings.length > 0 ? (
              <ul className="mt-1 grid gap-0.5">
                {cascade.cancelled_bookings.map((booking) => (
                  <li key={booking.id} className="tabular-nums">
                    {formatThaiDate(bkkDate(booking.start_at), { omitCurrentYear: true })}{' '}
                    {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))} ·{' '}
                    {booking.room.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {list.data.length === 0 ? (
        <div className="mt-4">
          <EmptyCard
            message={isFiltered(search) ? COPY.users.empty : COPY.users.emptyNoFilters}
            action={
              isFiltered(search) ? (
                <Link
                  to="/users"
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
              label={COPY.users.tableLabel}
              columns={[
                COPY.users.colUser,
                COPY.users.colTeam,
                COPY.users.colRole,
                COPY.users.colStatus,
                COPY.users.colActions,
              ]}
              rows={list.data}
              rowKey={(user) => user.id}
              // Tint is decoration; the badge carries the meaning.
              rowClass={(user) =>
                user.id === search.edit ? 'bg-g0' : user.status === 'DISABLED' ? 'bg-r0' : ''
              }
              renderRow={(user) => {
                const guards = userGuards(user, me.user.id, facets.activeAdmins);
                return (
                  <>
                    <td className="px-4 py-3">
                      <b className="block text-ink">{user.full_name}</b>
                      <small className="block text-muted text-xs">
                        {[user.employee_code, user.email, user.mobile]
                          .filter((part) => part !== null && part !== '')
                          .join(' · ')}
                      </small>
                    </td>
                    <td className="px-4 py-3 text-ink2">{user.department.name}</td>
                    <td className="px-4 py-3 text-ink2">{ROLE_LABELS[user.role]}</td>
                    <td className="px-4 py-3">
                      <UserStatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {user.status === 'DISABLED' ? (
                          <button
                            type="button"
                            onClick={() => setReactivating(user)}
                            className={rowActionClass}
                          >
                            {COPY.users.reactivate}
                          </button>
                        ) : (
                          <>
                            <Link
                              to="/users"
                              search={{ ...search, edit: user.id }}
                              className={rowActionClass}
                            >
                              {COPY.users.edit}
                            </Link>
                            {user.status === 'INVITED' ? (
                              <button
                                type="button"
                                disabled={resendInvite.isPending}
                                onClick={() =>
                                  resendInvite.mutate(
                                    { userId: user.id },
                                    { onSuccess: () => setStatus(COPY.users.inviteResent) },
                                  )
                                }
                                className={`${rowActionClass} disabled:opacity-50`}
                              >
                                {COPY.users.resendInvite}
                              </button>
                            ) : null}
                            {/* §4.3: prevented and explained, not offered and then 409'd. */}
                            {guards.length > 0 ? (
                              <small className="text-muted text-xs">
                                {guards
                                  .map((guard) =>
                                    guard === 'self'
                                      ? COPY.users.guardSelf
                                      : COPY.users.guardLastAdmin,
                                  )
                                  .join(' · ')}
                              </small>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDeactivating(user)}
                                className={`${rowActionClass} text-r7 hover:bg-r0`}
                              >
                                {COPY.users.deactivate}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </>
                );
              }}
            />
          </div>

          <p className="mt-3 text-muted text-xs">{COPY.users.sortNote}</p>
          <Pager
            page={list.page.page}
            pageSize={list.page.page_size}
            total={list.page.total}
            renderLink={(targetPage, disabled, label) => (
              <Link
                to="/users"
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

      <CsvImportDialog
        ref={importRef}
        activeAdmins={facets.activeAdmins}
        onClose={() => undefined}
      />

      {search.edit !== undefined ? (
        <UserSheet
          key={search.edit}
          editing={search.edit}
          departments={departments}
          meId={me.user.id}
          activeAdmins={facets.activeAdmins}
          onClose={() => {
            void navigate({
              search: (prev: UsersSearch) => {
                const next = { ...prev };
                delete next.edit;
                return next;
              },
            });
          }}
          // The sheet closes itself first so focus returns to the row action; this only
          // has to announce the result.
          onSaved={(message) => {
            setStatus(message);
            setCascade(null);
          }}
          onDeactivate={setDeactivating}
          onReactivate={setReactivating}
          onDelete={setDeleting}
        />
      ) : null}

      {deactivating !== null ? (
        <DeactivateDialog
          user={deactivating}
          onClose={() => setDeactivating(null)}
          onDone={(result) => {
            setStatus(null);
            setCascade(result);
          }}
        />
      ) : null}

      {reactivating !== null ? (
        <ConfirmDialog
          ref={reactivateRef}
          // Reactivation is consequential but not destructive, and must not be dressed
          // as the inverse of a deactivation: the cancelled bookings do not come back.
          tone="neutral"
          title={`${COPY.reactivateDialog.titlePrefix} ${reactivating.full_name}?`}
          consequences={COPY.reactivateDialog.consequences}
          confirmLabel={COPY.reactivateDialog.confirm}
          pendingLabel={COPY.reactivateDialog.pending}
          isPending={reactivate.isPending}
          error={reactivate.isError ? errorMessage(reactivate.error) : null}
          onConfirm={() =>
            reactivate.mutate(
              { userId: reactivating.id },
              {
                onSuccess: (user) => {
                  setCascade(null);
                  setStatus(
                    `${COPY.users.reactivatedPrefix} ${user.employee_code} ${COPY.users.reactivatedSuffix} · ${COPY.users.reactivateCaveat}`,
                  );
                  reactivateRef.current?.close();
                },
              },
            )
          }
          onClose={() => {
            reactivate.reset();
            setReactivating(null);
          }}
        />
      ) : null}

      {deleting !== null ? (
        <ConfirmDialog
          ref={deleteRef}
          title={`${COPY.deleteUserDialog.titlePrefix} ${deleting.full_name}?`}
          context={`${deleting.employee_code} · ${deleting.email}`}
          consequences={COPY.deleteUserDialog.consequences}
          confirmLabel={COPY.deleteUserDialog.confirm}
          pendingLabel={COPY.deleteUserDialog.pending}
          isPending={deleteUser.isPending}
          error={deleteUser.isError ? errorMessage(deleteUser.error) : null}
          onConfirm={() =>
            deleteUser.mutate(
              { userId: deleting.id },
              {
                onSuccess: () => {
                  setCascade(null);
                  setStatus(COPY.deleteUserDialog.deleted);
                  deleteRef.current?.close();
                  void navigate({
                    search: (prev: UsersSearch) => {
                      const next = { ...prev };
                      delete next.edit;
                      return next;
                    },
                  });
                },
              },
            )
          }
          onClose={() => {
            deleteUser.reset();
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
};

export const usersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/users',
  validateSearch: (search: Record<string, unknown>): UsersSearch => ({
    ...(typeof search.q === 'string' && search.q !== '' ? { q: search.q } : {}),
    ...(ROLES.includes(search.role as Role) ? { role: search.role as Role } : {}),
    ...(USER_STATUSES.includes(search.status as UserStatus)
      ? { status: search.status as UserStatus }
      : {}),
    ...(typeof search.dept === 'string' && search.dept !== '' ? { dept: search.dept } : {}),
    ...(typeof search.page === 'number' && Number.isInteger(search.page) && search.page > 1
      ? { page: search.page }
      : {}),
    ...(typeof search.edit === 'string' && search.edit !== '' ? { edit: search.edit } : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(adminUsersQuery(paramsOf(deps))),
      context.queryClient.ensureQueryData(departmentsQuery),
      context.queryClient.ensureQueryData(userFacetsQuery),
    ]);
  },
  component: UsersPage,
});
