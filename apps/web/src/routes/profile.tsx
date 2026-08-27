import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { useChangePassword, useSignOut } from '../api/mutations';
import { meQuery } from '../api/queries';
import { applyFontScale, currentFontScale, FONT_SCALES } from '../lib/font-scale';
import { COPY } from '../lib/i18n';
import { authedRoute } from './authed';

const inputClass =
  'w-full rounded-[11px] border border-border-input bg-white px-3 py-2.5 text-base text-ink';

/** E11: contact info, change-password (X-04: other sessions revoked), font-size switch. */
const ProfilePage = () => {
  const { data: me } = useSuspenseQuery(meQuery);
  const signOut = useSignOut();
  const changePassword = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const [fontScale, setFontScale] = useState(currentFontScale);
  const currentId = useId();
  const newId = useId();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (changePassword.isPending) {
      return;
    }
    if (newPassword.length < 10) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
        },
      },
    );
  };

  return (
    <main className="p-4 md:p-6">
      <h1 className="text-2xl font-bold text-ink">{COPY.profile.title}</h1>

      <dl className="mt-4 max-w-md rounded-2xl border border-line bg-white p-4 text-sm">
        <div className="flex justify-between gap-3 border-b border-line py-2">
          <dt className="text-muted">ชื่อ</dt>
          <dd className="font-semibold text-ink">{me.user.full_name}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-line py-2">
          <dt className="text-muted">รหัสพนักงาน</dt>
          <dd className="font-semibold text-ink">{me.user.employee_code}</dd>
        </div>
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-muted">แผนก</dt>
          <dd className="font-semibold text-ink">{me.department.name}</dd>
        </div>
      </dl>

      <form
        className="mt-4 max-w-md rounded-2xl border border-line bg-white p-4"
        onSubmit={onSubmit}
        noValidate
      >
        <h2 className="text-lg font-bold text-ink">{COPY.profile.changePasswordTitle}</h2>
        <p className="mt-1 text-xs text-muted">{COPY.profile.revokeNote}</p>

        <div className="mt-3 grid gap-1.5">
          <label htmlFor={currentId} className="text-sm font-semibold text-ink2">
            {COPY.profile.currentPassword}
          </label>
          <input
            id={currentId}
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            className={inputClass}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>
        <div className="mt-3 grid gap-1.5">
          <label htmlFor={newId} className="text-sm font-semibold text-ink2">
            {COPY.profile.newPassword}{' '}
            <small className="font-normal text-muted">({COPY.profile.newPasswordHint})</small>
          </label>
          <input
            id={newId}
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            aria-invalid={tooShort || undefined}
            className={inputClass}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>

        <div aria-live="polite" className="mt-3 grid gap-2">
          {tooShort ? (
            <p role="alert" className="text-xs font-semibold text-r7">
              {COPY.profile.tooShort}
            </p>
          ) : null}
          {changePassword.isError ? (
            <p
              role="alert"
              className="rounded-xl border border-r2 bg-r0 px-3.5 py-3 text-sm font-semibold text-r7"
            >
              {COPY.profile.failed}
            </p>
          ) : null}
          {changePassword.isSuccess ? (
            <p
              role="status"
              className="rounded-xl border border-g2 bg-g0 px-3.5 py-3 text-sm font-bold text-g7"
            >
              {COPY.profile.success}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={changePassword.isPending}
          className="mt-3 min-h-10 rounded-[13px] bg-g7 px-4 font-bold text-white disabled:opacity-60"
        >
          {changePassword.isPending ? COPY.profile.pending : COPY.profile.submit}
        </button>
      </form>

      <section
        aria-label={COPY.profile.fontSizeTitle}
        className="mt-4 max-w-md rounded-2xl border border-line bg-white p-4"
      >
        <h2 className="text-lg font-bold text-ink">{COPY.profile.fontSizeTitle}</h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FONT_SCALES.map((scale) => (
            <button
              key={scale.value}
              type="button"
              aria-pressed={fontScale === scale.value}
              onClick={() => {
                applyFontScale(scale.value);
                setFontScale(scale.value);
              }}
              className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold ${
                fontScale === scale.value
                  ? 'border-g7 bg-g1 text-g7'
                  : 'border-line bg-white text-ink2 hover:bg-g0'
              }`}
            >
              {scale.label}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="mt-6 min-h-10 rounded-xl border border-r2 bg-r0 px-4 font-bold text-r7 disabled:opacity-60"
      >
        {COPY.nav.signOut}
      </button>
    </main>
  );
};

export const profileRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/profile',
  component: ProfilePage,
});
