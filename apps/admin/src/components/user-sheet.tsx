import { ROLES, type Role } from '@reserveflow/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { ApiClientError } from '../api/client';
import { useAccountLink, useCreateUser, useUpdateUser } from '../api/mutations';
import { adminUserQuery, userFutureBookingsQuery, userLastChangeQuery } from '../api/queries';
import type { AdminUser, DepartmentOption } from '../api/types';
import { bkkDate, formatThaiDate, timeAgo } from '../lib/datetime';
import { COPY, errorMessage, ROLE_OPTION_HINTS } from '../lib/i18n';
import { useDialogOpen } from '../lib/use-dialog';
import { canHardDelete, userGuards } from '../lib/users';
import { controlClass, fieldLabelClass } from './filters';
import { Sheet } from './sheet';
import { InlineAlert } from './table';

/**
 * A9 — the right-hand drawer over A8, driven by the `?edit=` search param so it is
 * linkable, back-button-correct and reload-safe.
 *
 * The guards in §4.3 land here as PREVENTION, not as an error message after the click:
 * the own-row and last-admin cases disable the role select and hide the deactivate
 * trigger, each with a visible sentence bound to the field it constrains. The 409 is still
 * handled — two admins can demote each other concurrently.
 */

const buttonClass =
  'inline-flex min-h-10 items-center justify-center rounded-[11px] px-3.5 text-sm font-bold';

/** Server errors that belong on a field rather than at the top of the form. */
const fieldError = (error: unknown): { field: string; message: string } | null => {
  if (!(error instanceof ApiClientError)) {
    return null;
  }
  const details = error.envelope.details;
  if (typeof details !== 'object' || details === null) {
    return null;
  }
  const record = details as Record<string, unknown>;
  if (error.status === 409 && typeof record.field === 'string') {
    return {
      field: record.field,
      message: `${COPY.userSheet.duplicatePrefix} (${record.field})`,
    };
  }
  // 422: the address parses, the company just does not accept that domain.
  if (error.status === 422 && Array.isArray(record.issues)) {
    const issue = record.issues[0] as { path?: unknown[] } | undefined;
    if (issue?.path?.[0] === 'email') {
      return { field: 'email', message: COPY.userSheet.emailDomainError };
    }
  }
  return null;
};

interface UserFormProps {
  user: AdminUser | null;
  departments: DepartmentOption[];
  meId: string;
  activeAdmins: number;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onDeactivate: (user: AdminUser) => void;
  onReactivate: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}

/** Mounted only once its user has loaded, so every field initialises from real data. */
const UserForm = ({
  user,
  departments,
  meId,
  activeAdmins,
  onCancel,
  onSaved,
  onDeactivate,
  onReactivate,
  onDelete,
}: UserFormProps) => {
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [employeeCode, setEmployeeCode] = useState(user?.employee_code ?? '');
  const [mobile, setMobile] = useState(user?.mobile ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [departmentId, setDepartmentId] = useState(user?.department.id ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'EMPLOYEE');
  const [linkSent, setLinkSent] = useState(false);

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPassword = useAccountLink('reset-password');
  const lastChange = useQuery({
    ...userLastChangeQuery(user?.id ?? ''),
    enabled: user !== null,
  });
  // The red zone states how many bookings deactivation WILL cancel — that is the future
  // CONFIRMED/CHECKED_IN count, never `bookings_count` (which counts every booking the
  // account ever owned). Same query the dialog uses, so it is already warm when it opens.
  const impact = useQuery({
    ...userFutureBookingsQuery(user?.id ?? ''),
    enabled: user !== null && user.status !== 'DISABLED',
  });

  const nameId = useId();
  const codeId = useId();
  const codeHelperId = useId();
  const mobileId = useId();
  const mobileHelperId = useId();
  const emailId = useId();
  const departmentFieldId = useId();
  const roleId = useId();
  const roleHelperId = useId();
  const activeHelperId = useId();
  const errorId = useId();

  const guards = user === null ? [] : userGuards(user, meId, activeAdmins);
  const isSelf = guards.includes('self');
  const isLastAdmin = guards.includes('last-admin');
  const isDisabled = user?.status === 'DISABLED';

  const mutation = user === null ? createUser : updateUser;
  const invalid = fieldError(mutation.error);
  const generalError = mutation.isError && invalid === null ? errorMessage(mutation.error) : null;

  // Every constraint on this field is bound TO the field: both guards can apply at once
  // (§4.3), and the permanently disabled FACILITY option needs its reason too (§2.8).
  const roleHelpers = [
    user === null ? COPY.userSheet.roleCreateHelper : null,
    isSelf ? COPY.userSheet.roleSelfHelper : null,
    isLastAdmin ? COPY.userSheet.roleLastAdminHelper : null,
    COPY.userSheet.roleFacilityHelper,
  ].filter((line) => line !== null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (user === null) {
      createUser.mutate(
        {
          employee_code: employeeCode.trim(),
          full_name: fullName.trim(),
          email: email.trim(),
          ...(mobile.trim() === '' ? {} : { mobile: mobile.trim() }),
          department_id: departmentId,
        },
        {
          onSuccess: (created) =>
            onSaved(
              `${COPY.userSheet.savedPrefix} ${created.employee_code} ${COPY.userSheet.savedSuffix}`,
            ),
        },
      );
      return;
    }

    // Only what actually moved: PATCH takes a partial and rejects an empty body.
    const body = {
      ...(fullName.trim() === user.full_name ? {} : { full_name: fullName.trim() }),
      ...(email.trim() === user.email ? {} : { email: email.trim() }),
      ...(mobile.trim() === (user.mobile ?? '')
        ? {}
        : { mobile: mobile.trim() === '' ? null : mobile.trim() }),
      ...(departmentId === user.department.id ? {} : { department_id: departmentId }),
      ...(role === user.role ? {} : { role }),
    };
    if (Object.keys(body).length === 0) {
      onSaved(`${COPY.userSheet.savedPrefix} ${user.employee_code} ${COPY.userSheet.savedSuffix}`);
      return;
    }
    updateUser.mutate(
      { userId: user.id, body },
      {
        onSuccess: (saved) =>
          onSaved(
            `${COPY.userSheet.savedPrefix} ${saved.employee_code} ${COPY.userSheet.savedSuffix}`,
          ),
      },
    );
  };

  const describedBy = (field: string, ...extra: (string | null)[]): string | undefined =>
    [...extra, invalid?.field === field ? errorId : null].filter((id) => id !== null).join(' ') ||
    undefined;

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-1">
        <label htmlFor={nameId} className={fieldLabelClass}>
          {COPY.userSheet.fullNameLabel}
        </label>
        <input
          id={nameId}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          required
          maxLength={120}
          className={controlClass}
        />
      </div>

      <div className="grid gap-1">
        <label htmlFor={codeId} className={fieldLabelClass}>
          {COPY.userSheet.employeeCodeLabel}
        </label>
        <input
          id={codeId}
          value={employeeCode}
          onChange={(event) => setEmployeeCode(event.target.value)}
          required
          disabled={user !== null}
          pattern="[A-Za-z0-9\-]{3,20}"
          aria-invalid={invalid?.field === 'employee_code' || undefined}
          aria-describedby={describedBy('employee_code', codeHelperId)}
          className={`${controlClass} disabled:bg-n0 disabled:text-muted`}
        />
        <small id={codeHelperId} className="text-muted text-xs">
          {COPY.userSheet.employeeCodeHelper}
        </small>
      </div>

      <div className="grid gap-1">
        <label htmlFor={mobileId} className={fieldLabelClass}>
          {COPY.userSheet.mobileLabel}
        </label>
        <input
          id={mobileId}
          type="tel"
          value={mobile}
          onChange={(event) => setMobile(event.target.value)}
          pattern="0[0-9]{9}"
          aria-describedby={mobileHelperId}
          className={controlClass}
        />
        <small id={mobileHelperId} className="text-muted text-xs">
          {COPY.userSheet.mobileHelper}
        </small>
      </div>

      <div className="grid gap-1">
        <label htmlFor={emailId} className={fieldLabelClass}>
          {COPY.userSheet.emailLabel}
        </label>
        <input
          id={emailId}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          maxLength={254}
          aria-invalid={invalid?.field === 'email' || undefined}
          aria-describedby={describedBy('email')}
          className={controlClass}
        />
      </div>

      <div className="grid gap-1">
        <label htmlFor={departmentFieldId} className={fieldLabelClass}>
          {COPY.userSheet.departmentLabel}
        </label>
        <select
          id={departmentFieldId}
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
          required
          className={controlClass}
        >
          <option value="" disabled>
            —
          </option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1">
        <label htmlFor={roleId} className={fieldLabelClass}>
          {COPY.userSheet.roleLabel}
        </label>
        <select
          id={roleId}
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          // Create accepts EMPLOYEE only; §4.3 freezes your own role and the last admin's.
          disabled={user === null || isSelf}
          aria-describedby={roleHelperId}
          className={`${controlClass} disabled:bg-n0 disabled:text-muted`}
        >
          {ROLES.map((value) => (
            <option
              key={value}
              value={value}
              // FACILITY is Phase 1.1; demoting the last admin is refused before the click.
              disabled={value === 'FACILITY' || (isLastAdmin && value !== 'ADMIN')}
            >
              {ROLE_OPTION_HINTS[value]}
            </option>
          ))}
        </select>
        <small id={roleHelperId} className="text-muted text-xs">
          {roleHelpers.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </small>
      </div>

      {user === null ? null : (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-line p-3">
          <span className="min-w-0">
            <b className="block text-ink text-sm">{COPY.userSheet.activeLabel}</b>
            <small id={activeHelperId} className="block text-muted text-xs">
              {COPY.userSheet.activeHelper}
            </small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!isDisabled}
            aria-label={COPY.userSheet.activeLabel}
            aria-describedby={activeHelperId}
            // The switch never deactivates silently — both directions route through §4.2.
            disabled={!isDisabled && guards.length > 0}
            onClick={() => (isDisabled ? onReactivate(user) : onDeactivate(user))}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              isDisabled ? 'bg-n1' : 'bg-g7'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
                isDisabled ? 'left-0.5' : 'left-5.5'
              }`}
            />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-line bg-n0 p-3 text-sm">
        <b className="text-ink">{COPY.userSheet.passwordNoteLabel}</b>{' '}
        <span className="text-ink2">{COPY.userSheet.passwordNoteBody}</span>
        {user === null ? null : (
          <>
            <p className="mt-1 text-muted text-xs">{COPY.userSheet.passwordNoteConsequence}</p>
            <button
              type="button"
              disabled={resetPassword.isPending || user.status === 'DISABLED'}
              onClick={() =>
                resetPassword.mutate({ userId: user.id }, { onSuccess: () => setLinkSent(true) })
              }
              className="mt-2 font-semibold text-g7 text-sm underline disabled:opacity-50"
            >
              {resetPassword.isPending
                ? COPY.userSheet.resetPasswordPending
                : COPY.userSheet.resetPassword}
            </button>
          </>
        )}
      </div>

      {user === null ? null : (
        <p className="text-muted text-xs">
          {lastChange.data?.data[0] === undefined
            ? COPY.userSheet.auditUnknown
            : `${COPY.userSheet.auditPrefix} ${formatThaiDate(
                bkkDate(lastChange.data.data[0].created_at),
              )} ${COPY.userSheet.auditBy} ${
                lastChange.data.data[0].actor?.full_name ?? COPY.bookingDetail.systemActor
              }`}
          {' · '}
          {COPY.userSheet.auditLoginPrefix}{' '}
          {user.last_login_at === null
            ? COPY.userSheet.auditNeverLoggedIn
            : timeAgo(user.last_login_at)}
        </p>
      )}

      <div aria-live="polite" className="grid gap-2">
        {generalError !== null ? <InlineAlert message={generalError} /> : null}
        {invalid !== null ? (
          <p id={errorId} role="alert" className="font-semibold text-r7 text-sm">
            {invalid.message}
          </p>
        ) : null}
        {resetPassword.isError ? <InlineAlert message={errorMessage(resetPassword.error)} /> : null}
        {linkSent ? (
          <p role="status" className="font-semibold text-g7 text-sm">
            {COPY.userSheet.resetPasswordSent} · {COPY.userSheet.passwordNoteConsequence}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`${buttonClass} border border-line bg-white text-ink2 hover:bg-g0`}
        >
          {COPY.userSheet.cancel}
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className={`${buttonClass} bg-g7 text-white disabled:opacity-60`}
        >
          {mutation.isPending ? COPY.userSheet.saving : COPY.userSheet.save}
        </button>
      </div>

      {user === null ? null : isDisabled ? (
        <div className="rounded-xl border border-g2 bg-g0 p-3.5">
          <b className="block text-g7 text-sm">{COPY.userSheet.restoreTitle}</b>
          <p className="mt-1 text-ink2 text-sm">{COPY.userSheet.restoreBody}</p>
          <button
            type="button"
            onClick={() => onReactivate(user)}
            className={`${buttonClass} mt-2 border border-g2 bg-white text-g7`}
          >
            {COPY.userSheet.restoreTrigger}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-r2 bg-r0 p-3.5">
          <b className="block text-r7 text-sm">{COPY.userSheet.dangerTitle}</b>
          <p className="mt-1 text-ink2 text-sm">
            {impact.isPending ? (
              COPY.deactivateDialog.checking
            ) : (
              <>
                {COPY.userSheet.dangerBodyPrefix} {impact.data?.page.total ?? 0}{' '}
                {COPY.userSheet.dangerBodyMiddle} {COPY.userSheet.dangerBodyTail}
              </>
            )}
          </p>
          {/* §4.3: prevention is a visible sentence, not a disabled button with no reason. */}
          {guards.length > 0 ? (
            <ul className="mt-2 grid gap-0.5 font-semibold text-r7 text-sm">
              {guards.map((guard) => (
                <li key={guard}>
                  {guard === 'self' ? COPY.users.guardSelf : COPY.users.guardLastAdmin}
                </li>
              ))}
            </ul>
          ) : (
            <button
              type="button"
              onClick={() => onDeactivate(user)}
              className={`${buttonClass} mt-2 border border-r2 bg-white text-r7`}
            >
              {COPY.userSheet.dangerTrigger}
            </button>
          )}
        </div>
      )}

      {/* Rendered only when the account has no history — never speculatively, never disabled. */}
      {user !== null && canHardDelete(user, meId) ? (
        <div className="rounded-xl border border-r2 p-3.5">
          <b className="block text-r7 text-sm">{COPY.userSheet.deleteTitle}</b>
          <p className="mt-1 text-ink2 text-sm">{COPY.userSheet.deleteBody}</p>
          <button
            type="button"
            onClick={() => onDelete(user)}
            className={`${buttonClass} mt-2 border border-r2 bg-white text-r7`}
          >
            {COPY.userSheet.deleteTrigger}
          </button>
        </div>
      ) : null}
    </form>
  );
};

export interface UserSheetProps {
  /** A uuid, or 'new'. */
  editing: string;
  departments: DepartmentOption[];
  meId: string;
  activeAdmins: number;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDeactivate: (user: AdminUser) => void;
  onReactivate: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}

export const UserSheet = ({ editing, onClose, onSaved, ...rest }: UserSheetProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  // A successful save closes the sheet through the dialog rather than by unmounting it, so
  // the platform still returns focus to the row action that opened it. The message rides
  // along in a ref and is emitted once the close has actually happened.
  const savedMessage = useRef<string | null>(null);
  useDialogOpen(ref, true);
  const isNew = editing === 'new';
  // A non-suspense read so a deep link to a stale id degrades inside the sheet instead of
  // taking the whole list down with it.
  const user = useQuery({ ...adminUserQuery(editing), enabled: !isNew });

  return (
    <Sheet
      ref={ref}
      title={
        isNew
          ? COPY.userSheet.titleNew
          : `${COPY.userSheet.titleEditPrefix} · ${user.data?.employee_code ?? ''}`
      }
      closeLabel={COPY.userSheet.close}
      onClose={() => {
        onClose();
        if (savedMessage.current !== null) {
          onSaved(savedMessage.current);
          savedMessage.current = null;
        }
      }}
    >
      {isNew || user.data !== undefined ? (
        <UserForm
          // Fresh field state per account; the form initialises from real data at mount.
          key={editing}
          user={user.data ?? null}
          onCancel={() => ref.current?.close()}
          onSaved={(message) => {
            savedMessage.current = message;
            ref.current?.close();
          }}
          {...rest}
        />
      ) : user.isError ? (
        <InlineAlert message={errorMessage(user.error)} />
      ) : (
        <p aria-busy="true" className="text-muted">
          {COPY.states.loading}
        </p>
      )}
    </Sheet>
  );
};
