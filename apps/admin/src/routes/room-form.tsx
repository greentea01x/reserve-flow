import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId, useRef, useState } from 'react';
import {
  type CreateRoomBody,
  useCreateRoom,
  useDeleteRoomPhoto,
  useReplaceRoomFeatures,
  useUpdateRoom,
  useUploadRoomPhoto,
} from '../api/mutations';
import { featuresQuery, roomFutureBookingsQuery, roomQuery } from '../api/queries';
import type { BookingView, Room } from '../api/types';
import { ConfirmDialog } from '../components/confirm-dialog';
import { controlClass, fieldLabelClass } from '../components/filters';
import { InlineAlert } from '../components/table';
import { bkkDate, bkkTime, formatThaiDate, formatTimeRange } from '../lib/datetime';
import { COPY, errorMessage } from '../lib/i18n';
import { notFoundOn404 } from '../lib/loader';
import {
  featureListChanged,
  invalidFields,
  photoErrorMessage,
  saveErrorMessage,
} from '../lib/room-form';
import { authedRoute } from './authed';

const ROOM_CODE = /^[a-z0-9-]{2,32}$/;
const COLLAPSE_LIST_ABOVE = 5;

const bookingLine = (booking: BookingView, roomName: string): string =>
  [
    formatThaiDate(bkkDate(booking.start_at), { omitCurrentYear: true }),
    formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at)),
    roomName,
    booking.visibility === 'BUSY' ? COPY.bookings.privateBadge : booking.title,
  ].join(' · ');

const RoomForm = ({ room, justCreated = false }: { room: Room | null; justCreated?: boolean }) => {
  const { data: catalogue } = useSuspenseQuery(featuresQuery);
  const navigate = useNavigate();

  const [name, setName] = useState(room?.name ?? '');
  const [code, setCode] = useState(room?.code ?? '');
  const [description, setDescription] = useState(room?.description ?? '');
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 8));
  const [floor, setFloor] = useState(room?.floor ?? '');
  const [location, setLocation] = useState(room?.location ?? '');
  const [active, setActive] = useState(room?.active ?? true);
  const [featureKeys, setFeatureKeys] = useState<string[]>(
    () => room?.features.map((feature) => feature.key) ?? [],
  );
  // A create redirects here, so the success line has to survive the navigation.
  const [saved, setSaved] = useState<string | null>(
    justCreated && room !== null
      ? `${COPY.roomForm.createdPrefix} ${room.name} ${COPY.roomForm.savedSuffix}`
      : null,
  );

  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const replaceFeatures = useReplaceRoomFeatures();
  const uploadPhoto = useUploadRoomPhoto();
  const deletePhoto = useDeleteRoomPhoto();
  const closeDialogRef = useRef<HTMLDialogElement>(null);

  // Non-suspense: the impact preview is advisory — a failure must not block editing.
  const future = useQuery({ ...roomFutureBookingsQuery(room?.id ?? ''), enabled: room !== null });
  const futureTotal = future.data?.page.total ?? 0;

  const nameId = useId();
  const codeId = useId();
  const codeHelperId = useId();
  const descriptionId = useId();
  const capacityId = useId();
  const floorId = useId();
  const locationId = useId();
  const photoId = useId();
  const activeHelperId = useId();

  const saveError = createRoom.error ?? updateRoom.error ?? null;
  const badFields = invalidFields(saveError);
  const pending = createRoom.isPending || updateRoom.isPending || replaceFeatures.isPending;

  const featuresChanged = room === null || featureListChanged(featureKeys, room.features);

  // Chips carry presence only; the API's per-feature quantity (1..99) has no control in
  // the blueprint, so every selected feature is quantity 1.
  const featurePayload = featureKeys.map((key) => ({ key, quantity: 1 }));

  const body = (): CreateRoomBody => ({
    code: code.trim(),
    name: name.trim(),
    capacity: Number(capacity),
    floor: floor.trim() === '' ? null : floor.trim(),
    location: location.trim() === '' ? null : location.trim(),
    description: description.trim() === '' ? null : description.trim(),
    active,
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(null);
    createRoom.reset();
    updateRoom.reset();
    replaceFeatures.reset();

    if (room === null) {
      // Create takes features inline — one call, nothing to half-commit.
      createRoom.mutate(
        { ...body(), features: featurePayload },
        {
          onSuccess: (created) =>
            void navigate({
              to: '/rooms/$roomId',
              params: { roomId: created.id },
              search: { created: true },
            }),
        },
      );
      return;
    }

    const { code: _immutableCode, ...patch } = body();
    updateRoom.mutate(
      { roomId: room.id, body: patch },
      {
        onSuccess: (updated) => {
          if (!featuresChanged) {
            setSaved(`${COPY.roomForm.savedPrefix} ${updated.name} ${COPY.roomForm.savedSuffix}`);
            return;
          }
          // PATCH and PUT /features are two calls and not atomic — report which half
          // landed rather than a blanket success line.
          replaceFeatures.mutate(
            { roomId: room.id, features: featurePayload },
            {
              onSuccess: () =>
                setSaved(
                  `${COPY.roomForm.savedPrefix} ${updated.name} ${COPY.roomForm.savedSuffix}`,
                ),
            },
          );
        },
      },
    );
  };

  const onToggleActive = () => {
    if (!active) {
      setActive(true);
      return;
    }
    // §4.4: confirm only when closing would strand existing bookings. A brand-new room
    // and a room with an empty future both flip straight away.
    if (room === null || (future.isSuccess && futureTotal === 0)) {
      setActive(false);
      return;
    }
    closeDialogRef.current?.showModal();
  };

  const futureRows = future.data?.data ?? [];

  return (
    <div className="p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-bold text-2xl text-ink">
          {room === null
            ? COPY.roomForm.titleNew
            : `${COPY.roomForm.titleEditPrefix} · ${room.name}`}
        </h1>
      </header>

      <div aria-live="polite" className="mt-4 grid gap-3">
        {saveError !== null ? <InlineAlert message={saveErrorMessage(saveError)} /> : null}
        {replaceFeatures.isError ? <InlineAlert message={COPY.roomForm.featuresFailed} /> : null}
        {uploadPhoto.isError ? (
          <InlineAlert message={photoErrorMessage(uploadPhoto.error)} />
        ) : null}
        {deletePhoto.isError ? <InlineAlert message={errorMessage(deletePhoto.error)} /> : null}
        {saved !== null ? (
          <p
            role="status"
            className="rounded-xl border border-g2 bg-g0 px-3.5 py-3 font-bold text-g7 text-sm"
          >
            {saved}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[20rem_1fr]">
        <aside
          aria-label={COPY.roomForm.summary}
          className="grid content-start gap-3 rounded-2xl border border-line bg-white p-4"
        >
          {room?.photo_url != null ? (
            // A replacement photo keeps the same URL, so the already-mounted <img> would
            // never re-request it. `submittedAt` changes on every upload and forces it.
            <img
              src={
                uploadPhoto.isSuccess
                  ? `${room.photo_url}?v=${uploadPhoto.submittedAt}`
                  : room.photo_url
              }
              alt=""
              className="h-40 w-full rounded-xl object-cover"
            />
          ) : (
            <div
              role="img"
              aria-label={`${COPY.rooms.photoAltPrefix} ${name}`}
              className="h-40 w-full rounded-xl bg-linear-145 from-g1 via-g0 to-y1"
            />
          )}

          <label htmlFor={photoId} className={fieldLabelClass}>
            {COPY.roomForm.changePhoto}
          </label>
          <input
            id={photoId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            // A photo needs a room id, so it lands after the first save.
            disabled={room === null || uploadPhoto.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined && room !== null) {
                uploadPhoto.mutate({ roomId: room.id, file });
              }
              event.target.value = '';
            }}
            className="text-ink2 text-sm file:mr-2 file:min-h-9 file:rounded-[11px] file:border file:border-line file:bg-white file:px-3 file:font-semibold file:text-ink2 file:text-sm"
          />
          {room === null ? (
            <p className="text-muted text-xs">{COPY.roomForm.photoAfterSave}</p>
          ) : null}
          {uploadPhoto.isPending ? (
            <p className="text-muted text-xs">{COPY.roomForm.uploadingPhoto}</p>
          ) : null}
          {room?.photo_url != null ? (
            <button
              type="button"
              disabled={deletePhoto.isPending}
              onClick={() => deletePhoto.mutate({ roomId: room.id })}
              className="justify-self-start rounded-[11px] border border-r2 bg-white px-3 py-1.5 font-semibold text-r7 text-sm hover:bg-r0 disabled:opacity-60"
            >
              {COPY.roomForm.removePhoto}
            </button>
          ) : null}

          <dl className="mt-1 grid gap-2 border-line border-t pt-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{COPY.roomForm.factCapacity}</dt>
              <dd className="font-semibold text-ink tabular-nums">
                {capacity} {COPY.rooms.people}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{COPY.roomForm.factFloor}</dt>
              <dd className="font-semibold text-ink">{floor === '' ? '—' : floor}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{COPY.roomForm.factFeatures}</dt>
              <dd className="font-semibold text-ink tabular-nums">{featureKeys.length}</dd>
            </div>
            {room !== null ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{COPY.roomForm.factFutureBookings}</dt>
                <dd className="font-semibold text-ink tabular-nums">
                  {future.isPending ? '…' : futureTotal}
                </dd>
              </div>
            ) : null}
          </dl>

          {/* D-26, verbatim. Closing or editing a room never cancels anyone's booking. */}
          {room !== null ? (
            <p className="rounded-xl border border-y2 bg-y0 px-3 py-2.5 text-ink2 text-xs">
              <b>{COPY.roomForm.noteLabel}</b> {COPY.roomForm.noteBody}{' '}
              <span className="tabular-nums">{futureTotal}</span> {COPY.roomForm.noteBodyTail}
            </p>
          ) : null}
        </aside>

        <form
          onSubmit={onSubmit}
          className="grid gap-4 rounded-2xl border border-line bg-white p-5"
        >
          <div className="grid gap-1.5">
            <label htmlFor={nameId} className={fieldLabelClass}>
              {COPY.roomForm.nameLabel}
            </label>
            <input
              id={nameId}
              required
              maxLength={80}
              value={name}
              aria-invalid={badFields.has('name') || undefined}
              onChange={(event) => setName(event.target.value)}
              className={controlClass}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={codeId} className={fieldLabelClass}>
              {COPY.roomForm.codeLabel}
            </label>
            <input
              id={codeId}
              required
              // CB-02: `code` is not patchable — it is what the door QR encodes.
              disabled={room !== null}
              pattern={ROOM_CODE.source}
              maxLength={32}
              value={code}
              aria-describedby={codeHelperId}
              aria-invalid={badFields.has('code') || undefined}
              onChange={(event) => setCode(event.target.value.toLowerCase())}
              className={`${controlClass} disabled:bg-n0 disabled:text-muted`}
            />
            <p id={codeHelperId} className="text-muted text-xs">
              {room === null ? COPY.roomForm.codeHelperNew : COPY.roomForm.codeHelperEdit}
            </p>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={descriptionId} className={fieldLabelClass}>
              {COPY.roomForm.descriptionLabel}
            </label>
            <input
              id={descriptionId}
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={controlClass}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label htmlFor={capacityId} className={fieldLabelClass}>
                {COPY.roomForm.capacityLabel}
              </label>
              <input
                id={capacityId}
                type="number"
                required
                min={1}
                max={500}
                value={capacity}
                aria-invalid={badFields.has('capacity') || undefined}
                onChange={(event) => setCapacity(event.target.value)}
                className={`${controlClass} tabular-nums`}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={floorId} className={fieldLabelClass}>
                {COPY.roomForm.floorLabel}
              </label>
              <input
                id={floorId}
                maxLength={40}
                value={floor}
                onChange={(event) => setFloor(event.target.value)}
                className={controlClass}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={locationId} className={fieldLabelClass}>
                {COPY.roomForm.locationLabel}
              </label>
              <input
                id={locationId}
                maxLength={200}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                className={controlClass}
              />
            </div>
          </div>

          <fieldset className="m-0 grid gap-1.5 border-0 p-0">
            <legend className={fieldLabelClass}>{COPY.roomForm.featuresLabel}</legend>
            <p className="text-muted text-xs">{COPY.roomForm.featuresHelper}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {catalogue.map((feature) => {
                const on = featureKeys.includes(feature.key);
                return (
                  <button
                    key={feature.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setFeatureKeys((keys) =>
                        on ? keys.filter((key) => key !== feature.key) : [...keys, feature.key],
                      )
                    }
                    className={`inline-flex min-h-9 items-center rounded-full border px-3 font-semibold text-sm ${
                      on ? 'border-g7 bg-g1 text-g7' : 'border-line bg-white text-ink2 hover:bg-g0'
                    }`}
                  >
                    {feature.name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2.5">
            <span>
              <b className="block text-ink text-sm">{COPY.roomForm.activeLabel}</b>
              <small id={activeHelperId} className="block text-muted text-xs">
                {COPY.roomForm.activeHelper}
              </small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              aria-label={COPY.roomForm.activeLabel}
              aria-describedby={activeHelperId}
              onClick={onToggleActive}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                active ? 'bg-g7' : 'bg-n1'
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
                  active ? 'left-5.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {/* There is no room delete in the API — closing a room IS the destructive
              action, and it lives on the switch above rather than in a duplicate footer
              button that would do exactly the same thing. */}
          <div className="flex flex-wrap justify-end gap-2 border-line border-t pt-4">
            <Link
              to="/rooms"
              className="inline-flex min-h-10 items-center rounded-[11px] border border-line bg-white px-4 font-semibold text-ink2 text-sm hover:bg-g0"
            >
              {COPY.roomForm.cancel}
            </Link>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-10 items-center rounded-[13px] bg-g7 px-4 font-bold text-sm text-white disabled:opacity-60"
            >
              {pending ? COPY.roomForm.saving : COPY.roomForm.save}
            </button>
          </div>
        </form>
      </div>

      {room !== null ? (
        <ConfirmDialog
          ref={closeDialogRef}
          title={`${COPY.closeRoomDialog.titlePrefix} ${room.name}?`}
          consequences={COPY.closeRoomDialog.consequences}
          confirmLabel={COPY.closeRoomDialog.confirm}
          pendingLabel={COPY.closeRoomDialog.pending}
          confirmDisabled={future.isPending}
          onConfirm={() => {
            setActive(false);
            closeDialogRef.current?.close();
          }}
        >
          {future.isPending ? (
            <p className="text-muted text-sm">{COPY.roomForm.checkingImpact}</p>
          ) : futureTotal === 0 ? (
            <p className="text-ink2 text-sm">{COPY.closeRoomDialog.noneAffected}</p>
          ) : (
            <>
              <p className="font-semibold text-r7 text-sm">
                {COPY.closeRoomDialog.keptPrefix}{' '}
                <span className="tabular-nums">{futureTotal}</span>{' '}
                {COPY.closeRoomDialog.keptSuffix}
              </p>
              {/* D-26: the system must never cancel these for the admin — each row links
                  to its detail so they can be cancelled one at a time, deliberately. */}
              <details className="mt-2" open={futureRows.length <= COLLAPSE_LIST_ABOVE}>
                <summary className="cursor-pointer font-semibold text-ink2 text-sm">
                  {COPY.closeRoomDialog.listLabel} ({futureRows.length})
                </summary>
                <ul className="mt-2 grid max-h-48 gap-1 overflow-y-auto text-sm">
                  {futureRows.map((booking) => (
                    <li key={booking.id}>
                      <Link
                        to="/bookings/$bookingId"
                        params={{ bookingId: booking.id }}
                        className="text-ink2 underline hover:text-g7"
                      >
                        {bookingLine(booking, room.name)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </ConfirmDialog>
      ) : null}
    </div>
  );
};

const NewRoomPage = () => <RoomForm room={null} />;

const EditRoomPage = () => {
  const { roomId } = roomEditRoute.useParams();
  const search = roomEditRoute.useSearch();
  const { data: room } = useSuspenseQuery(roomQuery(roomId));
  return <RoomForm key={room.id} room={room} justCreated={search.created === true} />;
};

export const roomNewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/rooms/new',
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(featuresQuery);
  },
  component: NewRoomPage,
});

export interface RoomEditSearch {
  created?: boolean;
}

export const roomEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/rooms/$roomId',
  validateSearch: (search: Record<string, unknown>): RoomEditSearch => ({
    ...(search.created === true ? { created: true } : {}),
  }),
  loader: async ({ context, params }) => {
    await Promise.all([
      notFoundOn404(context.queryClient.ensureQueryData(roomQuery(params.roomId))),
      context.queryClient.ensureQueryData(featuresQuery),
    ]);
  },
  component: EditRoomPage,
});
