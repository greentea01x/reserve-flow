import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiClientError } from '../api/client';
import { useUpdateBooking } from '../api/mutations';
import type { BookingFull } from '../api/types';
import { COPY, ERROR_MESSAGES, errorMessage } from '../lib/i18n';

interface EditPanelProps {
  /** FULL view with `version` — the detail page gates on can.edit. */
  booking: BookingFull;
  /** For the warn-only headcount notice (D-30c); undefined when the room 404s. */
  roomCapacity?: number;
  onClose: () => void;
  onSaved: () => void;
}

const inputClass =
  'w-full rounded-[11px] border border-border-input bg-white px-3 py-2.5 text-base text-ink';

/** E5 แก้ไข: PATCH editable booking fields with optimistic concurrency. */
export const EditPanel = ({ booking, roomCapacity, onClose, onSaved }: EditPanelProps) => {
  const queryClient = useQueryClient();
  const update = useUpdateBooking(booking.id);

  const [title, setTitle] = useState(booking.title);
  const [description, setDescription] = useState(booking.description ?? '');
  const [specialRequest, setSpecialRequest] = useState(booking.special_request ?? '');
  const [headcount, setHeadcount] = useState(
    booking.headcount === null ? '' : String(booking.headcount),
  );
  const [isPrivate, setIsPrivate] = useState(booking.is_private);
  const [titleError, setTitleError] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);

  const titleId = useId();
  const descriptionId = useId();
  const specialRequestId = useId();
  const headcountId = useId();

  const headcountNumber = headcount === '' ? null : Number(headcount);
  const headcountValid =
    headcountNumber === null || (Number.isInteger(headcountNumber) && headcountNumber >= 1);
  const overCapacity =
    roomCapacity !== undefined && headcountNumber !== null && headcountNumber > roomCapacity;

  const descriptionValue = description.trim() === '' ? null : description.trim();
  const specialRequestValue = specialRequest.trim() === '' ? null : specialRequest.trim();
  const fieldPatch = {
    ...(title.trim() !== booking.title ? { title: title.trim() } : {}),
    ...(descriptionValue !== booking.description ? { description: descriptionValue } : {}),
    ...(specialRequestValue !== booking.special_request
      ? { special_request: specialRequestValue }
      : {}),
    ...(headcountValid && headcountNumber !== booking.headcount
      ? { headcount: headcountNumber }
      : {}),
    ...(isPrivate !== booking.is_private ? { is_private: isPrivate } : {}),
  };
  const fieldsChanged = Object.keys(fieldPatch).length > 0;
  const saving = update.isPending;

  const submit = async () => {
    if (saving) {
      return;
    }
    if (title.trim() === '') {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    setVersionConflict(false);
    try {
      await update.mutateAsync({ version: booking.version, ...fieldPatch });
      onSaved();
    } catch (error) {
      if (error instanceof ApiClientError && error.envelope.code === 'VERSION_CONFLICT') {
        setVersionConflict(true);
      }
    }
  };

  const showGenericError = update.isError && !versionConflict;

  return (
    <section
      aria-label={COPY.edit.title}
      className="mt-4 rounded-2xl border border-g2 bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">{COPY.edit.title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-9 rounded-[11px] border border-line bg-white px-3 text-sm font-semibold text-ink2 hover:bg-g0"
        >
          {COPY.edit.close}
        </button>
      </div>

      <div className="mt-3 grid gap-1.5">
        <label htmlFor={titleId} className="text-sm font-semibold text-ink2">
          {COPY.bookingForm.meetingTitle} *
        </label>
        <input
          id={titleId}
          className={inputClass}
          maxLength={200}
          required
          aria-invalid={titleError || undefined}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {titleError ? (
          <p className="text-xs font-semibold text-r7" role="alert">
            {COPY.bookingForm.titleRequired}
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-1.5">
        <label htmlFor={descriptionId} className="text-sm font-semibold text-ink2">
          {COPY.bookingForm.description}
        </label>
        <textarea
          id={descriptionId}
          className={`${inputClass} min-h-20`}
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2.5">
        <span>
          <b className="block text-sm text-ink">{COPY.bookingForm.privateTitle}</b>
          <small className="block text-xs text-muted">{COPY.bookingForm.privateHint}</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isPrivate}
          aria-label={COPY.bookingForm.privateTitle}
          onClick={() => setIsPrivate((value) => !value)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${isPrivate ? 'bg-g7' : 'bg-n1'}`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${isPrivate ? 'left-5.5' : 'left-0.5'}`}
          />
        </button>
      </div>

      <div className="mt-3 grid gap-1.5">
        <label htmlFor={headcountId} className="text-sm font-semibold text-ink2">
          {COPY.bookingForm.headcount}
        </label>
        <input
          id={headcountId}
          type="number"
          min={1}
          className={inputClass}
          value={headcount}
          onChange={(event) => setHeadcount(event.target.value)}
        />
        {overCapacity ? (
          <p className="rounded-xl bg-y1 px-3 py-2 text-xs font-semibold text-y7">
            {COPY.bookingForm.overCapacity} ({roomCapacity} {COPY.bookingForm.people})
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-1.5">
        <label htmlFor={specialRequestId} className="text-sm font-semibold text-ink2">
          {COPY.bookingForm.specialRequest}
        </label>
        <textarea
          id={specialRequestId}
          className={`${inputClass} min-h-20`}
          maxLength={1000}
          placeholder={COPY.bookingForm.specialRequestPlaceholder}
          value={specialRequest}
          onChange={(event) => setSpecialRequest(event.target.value)}
        />
      </div>

      <div aria-live="polite" className="mt-3 grid gap-2">
        {versionConflict ? (
          <div role="alert" className="rounded-xl border border-r2 bg-r0 p-4">
            <p className="text-sm font-bold text-r7">{ERROR_MESSAGES.VERSION_CONFLICT}</p>
            <button
              type="button"
              className="mt-2 min-h-9 rounded-[11px] border border-r2 bg-white px-3 text-sm font-bold text-r7 hover:bg-r1"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
                onClose();
              }}
            >
              {COPY.reschedule.reload}
            </button>
          </div>
        ) : showGenericError ? (
          <p
            role="alert"
            className="rounded-xl border border-r2 bg-r0 px-3.5 py-3 text-sm font-semibold text-r7"
          >
            {errorMessage(update.error)}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        disabled={saving || !fieldsChanged}
        onClick={() => void submit()}
        className="mt-3 min-h-11 rounded-[13px] bg-g7 px-5 font-bold text-white disabled:opacity-50"
      >
        {saving ? COPY.edit.pending : COPY.edit.save}
      </button>
    </section>
  );
};
