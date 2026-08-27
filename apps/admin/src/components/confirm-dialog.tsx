import { type ReactNode, type RefObject, useId, useState } from 'react';
import { COPY, ERROR_MESSAGES } from '../lib/i18n';

/**
 * §4.0 — the confirmation pattern, decided once.
 *
 * Native <dialog> + showModal(): Esc, the focus trap, and focus-return-to-trigger all come
 * from the platform. No dialog library.
 *
 * The four rules, all enforced here:
 *  1. The destructive button is LAST in the DOM, so it is never the default focus. `กลับ`
 *     comes first; the reason <textarea>, when present, is first of all and takes focus.
 *  2. Consequences are stated in text-r7 BEFORE the buttons, including what is irreversible
 *     and who gets emailed.
 *  3. Errors and validation live in an aria-live="polite" wrapper between the field and the
 *     buttons, with role="alert" on each message.
 *  4. onClose resets reason + validation here, and the caller resets its mutation.
 */
export interface ConfirmDialogProps {
  /** The caller opens it with showModal() from the triggering button. */
  ref: RefObject<HTMLDialogElement | null>;
  title: string;
  /** Context line under the title, e.g. "{title} · {room} · {date} {time} · ผู้จอง {owner}". */
  context?: ReactNode;
  consequences: readonly string[];
  /** Extra detail below the consequences — an impact list, a count, a loading line. */
  children?: ReactNode;
  /**
   * 'danger' (default) paints the consequences and the confirm button red. 'neutral' is for
   * the consequential-but-not-destructive confirmations — reactivating an account is not
   * the inverse of disabling one and must not be dressed as a second destructive act.
   */
  tone?: 'danger' | 'neutral';
  reason?: 'none' | 'optional' | 'required';
  reasonLabel?: string;
  reasonHelper?: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending?: boolean;
  /** Holds the confirm button while an impact preview is still loading. */
  confirmDisabled?: boolean;
  /** Already-translated Thai. Never the server's envelope.message. */
  error?: string | null;
  onConfirm: (reason: string) => void;
  /** Reset the caller's mutation here. */
  onClose?: () => void;
}

const MIN_REASON = 3;

/**
 * Initial focus must land on the safe control even when `children` is an impact list of
 * booking links. React's `autoFocus` prop only calls .focus() at mount — a no-op inside a
 * dialog that has not been opened yet — while showModal()'s focusing steps look for the real
 * `autofocus` ATTRIBUTE and otherwise take the first focusable descendant. Set the attribute
 * from a ref, which runs before the effect that opens the dialog.
 */
const markAutofocus = (node: HTMLElement | null): void => {
  node?.setAttribute('autofocus', '');
};

const buttonClass =
  'inline-flex min-h-10 items-center justify-center rounded-[11px] px-3.5 text-sm font-bold';

export const ConfirmDialog = ({
  ref,
  title,
  context,
  consequences,
  children,
  tone = 'danger',
  reason: reasonMode = 'none',
  reasonLabel,
  reasonHelper,
  confirmLabel,
  pendingLabel,
  isPending = false,
  confirmDisabled = false,
  error = null,
  onConfirm,
  onClose,
}: ConfirmDialogProps) => {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const labelId = useId();
  const reasonId = useId();
  const helperId = useId();
  const reasonErrorId = useId();

  const trimmed = reason.trim();
  const reasonMissing = reasonMode === 'required' && trimmed.length < MIN_REASON;

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      onClose={() => {
        // A reopened dialog must never show the previous attempt's error.
        setReason('');
        setReasonError(false);
        onClose?.();
      }}
      className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-line bg-white p-5 backdrop:bg-black/40"
    >
      <h2 id={labelId} className="font-bold text-ink text-lg">
        {title}
      </h2>
      {context !== undefined ? <p className="mt-1 text-ink2 text-sm">{context}</p> : null}

      <ul className={`mt-3 grid gap-1 text-sm ${tone === 'danger' ? 'text-r7' : 'text-ink2'}`}>
        {consequences.map((line) => (
          <li key={line} className="flex gap-1.5">
            <span aria-hidden="true">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {children !== undefined ? <div className="mt-3">{children}</div> : null}

      {reasonMode === 'none' ? null : (
        <>
          <label htmlFor={reasonId} className="mt-4 block font-semibold text-ink2 text-sm">
            {reasonLabel}
          </label>
          {reasonHelper !== undefined ? (
            <p id={helperId} className="mt-0.5 text-muted text-xs">
              {reasonHelper}
            </p>
          ) : null}
          <textarea
            id={reasonId}
            ref={markAutofocus}
            value={reason}
            maxLength={500}
            required={reasonMode === 'required'}
            aria-invalid={reasonError || undefined}
            aria-describedby={
              [reasonHelper !== undefined ? helperId : null, reasonError ? reasonErrorId : null]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) {
                setReasonError(false);
              }
            }}
            onBlur={() => setReasonError(reasonMissing)}
            className="mt-1.5 min-h-20 w-full rounded-[11px] border border-border-input bg-white px-3 py-2.5 text-base text-ink aria-[invalid]:border-r7"
          />
        </>
      )}

      <div aria-live="polite" className="mt-2 grid gap-2">
        {reasonError ? (
          <p id={reasonErrorId} role="alert" className="font-semibold text-r7 text-xs">
            {ERROR_MESSAGES.REASON_REQUIRED}
          </p>
        ) : null}
        {error !== null ? (
          <p role="alert" className="font-semibold text-r7 text-sm">
            {error}
          </p>
        ) : null}
      </div>

      {/* Danger last: the safe way out is the first button, and the reason field above
          takes the initial focus when there is one. */}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          ref={reasonMode === 'none' ? markAutofocus : undefined}
          onClick={() => ref.current?.close()}
          className={`${buttonClass} border border-line bg-white text-ink2 hover:bg-g0`}
        >
          {COPY.confirm.back}
        </button>
        <button
          type="button"
          disabled={isPending || confirmDisabled || reasonMissing}
          onClick={() => onConfirm(trimmed)}
          className={`${buttonClass} text-white disabled:opacity-60 ${
            tone === 'danger' ? 'bg-r7' : 'bg-g7'
          }`}
        >
          {isPending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
};
