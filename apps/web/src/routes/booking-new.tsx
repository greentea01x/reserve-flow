import { useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { type FormEvent, useId, useRef, useState } from 'react';
import { ApiClientError } from '../api/client';
import { useCreateBooking } from '../api/mutations';
import { roomQuery } from '../api/queries';
import { queryClient } from '../api/query-client';
import type { SlotUnavailableDetails } from '../api/types';
import { ConflictAlert } from '../components/conflict-alert';
import { editTimeDestination } from '../lib/booking-flow';
import {
  bkkIso,
  formatDuration,
  formatThaiDate,
  formatTimeRange,
  timeToMinutes,
} from '../lib/datetime';
import { COPY, errorMessage } from '../lib/i18n';
import { authedRoute } from './authed';

const TIME_PARAM = /^\d{2}:\d{2}$/;
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export interface BookingNewSearch {
  room?: string;
  date?: string;
  start?: string;
  end?: string;
}

const inputClass =
  'min-h-12 w-full rounded-2xl border border-line bg-g0 px-3.5 py-2.5 text-base text-ink transition-colors hover:border-border-input focus:bg-white';

const BookingNewPage = () => {
  const search = bookingNewRoute.useSearch();
  const navigate = useNavigate();
  // beforeLoad guarantees these; the fallbacks only satisfy the type system.
  const roomId = search.room ?? '';
  const date = search.date ?? '';
  const start = search.start ?? '';
  const end = search.end ?? '';

  const { data: room } = useSuspenseQuery(roomQuery(roomId));
  const createBooking = useCreateBooking();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [specialRequest, setSpecialRequest] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [conflict, setConflict] = useState<SlotUnavailableDetails | null>(null);
  /** One key per submit press, REUSED on retry after network/5xx (same logical submit). */
  const idempotencyKey = useRef<string | null>(null);

  const titleId = useId();
  const descriptionId = useId();
  const specialRequestId = useId();
  const headcountId = useId();
  const titleInputRef = useRef<HTMLInputElement>(null);

  const durationMinutes = timeToMinutes(end) - timeToMinutes(start);
  const headcountNumber = headcount === '' ? undefined : Number(headcount);
  const overCapacity = headcountNumber !== undefined && headcountNumber > room.capacity;
  const featureNames = room.features.map((feature) => feature.name).join(', ');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (createBooking.isPending) {
      return;
    }
    if (title.trim() === '') {
      setTitleError(true);
      titleInputRef.current?.focus();
      return;
    }
    setTitleError(false);
    setConflict(null);
    idempotencyKey.current ??= crypto.randomUUID();
    createBooking.mutate(
      {
        idempotencyKey: idempotencyKey.current,
        body: {
          room_id: roomId,
          start_at: bkkIso(date, start),
          end_at: bkkIso(date, end),
          title: title.trim(),
          ...(description.trim() !== '' ? { description: description.trim() } : {}),
          ...(specialRequest.trim() !== '' ? { special_request: specialRequest.trim() } : {}),
          ...(headcountNumber !== undefined &&
          Number.isInteger(headcountNumber) &&
          headcountNumber >= 1
            ? { headcount: headcountNumber }
            : {}),
          ...(isPrivate ? { is_private: true } : {}),
        },
      },
      {
        onSuccess: ({ booking }) => {
          idempotencyKey.current = null;
          void navigate({
            to: '/bookings/$bookingId',
            params: { bookingId: booking.id },
            search: { created: true },
          });
        },
        onError: (error) => {
          // 4xx = the server judged this attempt; the next press is a new attempt
          // and gets a new key. Network errors / 5xx keep the key for a safe retry.
          if (error instanceof ApiClientError && error.status < 500) {
            idempotencyKey.current = null;
            if (
              error.envelope.code === 'SLOT_UNAVAILABLE' &&
              typeof error.envelope.details === 'object'
            ) {
              setConflict(error.envelope.details as SlotUnavailableDetails);
            }
          }
        },
      },
    );
  };

  const showGenericError =
    createBooking.isError &&
    conflict === null &&
    !(
      createBooking.error instanceof ApiClientError &&
      createBooking.error.envelope.code === 'SLOT_UNAVAILABLE'
    );

  return (
    <main className="mx-auto w-full max-w-6xl p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">
            {COPY.bookingForm.title}
          </h1>
          <p className="mt-2 text-sm text-muted md:text-base">{COPY.bookingForm.sub}</p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-g0 px-4 text-sm font-semibold text-ink2 hover:bg-g1"
          onClick={() => void navigate(editTimeDestination({ roomId, date, start, end }))}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {COPY.bookingForm.backToCalendar}
        </button>
      </header>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.65fr)]">
        <aside className="rounded-[2rem] border border-line bg-white p-5 shadow-sm lg:sticky lg:top-6 md:p-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-g1 px-3 py-1.5 text-xs font-bold text-g7">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            {COPY.roomDetail.autoApprove}
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-ink">{room.name}</h2>
          <dl className="mt-5 grid gap-1 text-sm">
            {(
              [
                [COPY.bookingForm.dateRow, formatThaiDate(date)],
                [COPY.bookingForm.timeRow, formatTimeRange(start, end)],
                [COPY.bookingForm.durationRow, formatDuration(durationMinutes)],
                [COPY.bookingForm.capacityRow, `${room.capacity} ${COPY.bookingForm.people}`],
                ...(featureNames !== '' ? [[COPY.bookingForm.featuresRow, featureNames]] : []),
              ] as [string, string][]
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex min-w-0 justify-between gap-3 border-b border-line py-3 first:pt-0"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="min-w-0 text-right font-semibold text-ink tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex gap-3 rounded-2xl bg-y0 p-4 text-y7">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p className="text-xs leading-5">{COPY.bookingForm.conflictCheckNote}</p>
          </div>
        </aside>

        <form
          className="rounded-[2rem] border border-line bg-white p-5 shadow-sm md:p-7"
          onSubmit={onSubmit}
          noValidate
        >
          <h2 className="text-2xl font-bold tracking-tight text-ink">
            {COPY.bookingForm.formTitle}
          </h2>

          <div className="mt-6 grid gap-2">
            <label htmlFor={titleId} className="text-sm font-semibold text-ink2">
              {COPY.bookingForm.meetingTitle} *
            </label>
            <input
              id={titleId}
              ref={titleInputRef}
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

          <div className="mt-5 grid gap-2">
            <label htmlFor={descriptionId} className="text-sm font-semibold text-ink2">
              {COPY.bookingForm.description}
            </label>
            <textarea
              id={descriptionId}
              className={`${inputClass} min-h-24 resize-y`}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-line bg-g0 px-4 py-3.5">
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

          <div className="mt-5 grid gap-2">
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
              <p className="rounded-2xl bg-y1 px-3 py-2 text-xs font-semibold text-y7">
                {COPY.bookingForm.overCapacity} ({room.capacity} {COPY.bookingForm.people})
              </p>
            ) : null}
          </div>

          <div className="mt-5 grid gap-2">
            <label htmlFor={specialRequestId} className="text-sm font-semibold text-ink2">
              {COPY.bookingForm.specialRequest}
            </label>
            <textarea
              id={specialRequestId}
              className={`${inputClass} min-h-24 resize-y`}
              maxLength={1000}
              placeholder={COPY.bookingForm.specialRequestPlaceholder}
              value={specialRequest}
              onChange={(event) => setSpecialRequest(event.target.value)}
            />
          </div>

          <div aria-live="polite" className="mt-5 grid gap-3">
            {conflict !== null ? (
              <ConflictAlert
                roomName={room.name}
                range={formatTimeRange(start, end)}
                details={conflict}
                onPickAnotherTime={() => {
                  // The board must show the just-taken slot as busy (contract E4: refetch).
                  void queryClient.invalidateQueries({ queryKey: ['calendar'] });
                  void queryClient.invalidateQueries({ queryKey: ['availability'] });
                  void navigate(editTimeDestination({ roomId, date, start, end }));
                }}
                onPickAlternative={(alternativeRoomId) => {
                  setConflict(null);
                  createBooking.reset();
                  void navigate({
                    to: '/bookings/new',
                    search: { room: alternativeRoomId, date, start, end },
                    replace: true,
                  });
                }}
              />
            ) : null}
            {showGenericError ? (
              <p
                role="alert"
                className="rounded-2xl border border-r2 bg-r0 px-4 py-3 text-sm font-semibold text-r7"
              >
                {errorMessage(createBooking.error)}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={createBooking.isPending}
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-g7 px-6 font-bold text-white transition-transform active:scale-[0.99] disabled:opacity-60"
          >
            {createBooking.isPending ? COPY.bookingForm.submitting : COPY.bookingForm.submit}
            {!createBooking.isPending ? <ArrowRight aria-hidden="true" className="size-4" /> : null}
          </button>
        </form>
      </div>
    </main>
  );
};

export const bookingNewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bookings/new',
  validateSearch: (search: Record<string, unknown>): BookingNewSearch => ({
    ...(typeof search.room === 'string' ? { room: search.room } : {}),
    ...(typeof search.date === 'string' && DATE_PARAM.test(search.date)
      ? { date: search.date }
      : {}),
    ...(typeof search.start === 'string' && TIME_PARAM.test(search.start)
      ? { start: search.start }
      : {}),
    ...(typeof search.end === 'string' && TIME_PARAM.test(search.end) ? { end: search.end } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (!search.room || !search.date || !search.start || !search.end) {
      throw redirect({ to: '/calendar', search: {} });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    if (deps.room !== undefined) {
      await context.queryClient.ensureQueryData(roomQuery(deps.room));
    }
  },
  component: BookingNewPage,
});
