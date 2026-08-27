import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { ApiClientError } from '../api/client';
import { type SaveSettingsOutcome, useSaveSettings } from '../api/mutations';
import { futureBookingsQuery, settingsQuery } from '../api/queries';
import type { BusinessHour, Holiday, Settings, SettingsDocument } from '../api/types';
import { controlClass, fieldLabelClass } from '../components/filters';
import { InlineAlert } from '../components/table';
import { addDays, bkkDate, bkkTime, formatThaiDate, formatTimeRange } from '../lib/datetime';
import { COPY, errorMessage, WEEKDAY_NAMES } from '../lib/i18n';
import { bookingsOutsideHours } from '../lib/settings-impact';
import { authedRoute } from './authed';

/**
 * A10 — one page, three sections, ONE save button. The three writes behind it are ordered
 * and non-atomic (see useSaveSettings): PUT /admin/settings must go first because it is the
 * only If-Match-guarded write and the ETag covers all three documents together.
 *
 * Concurrency (C2-08) is the one rule not to soften: on 409 VERSION_CONFLICT the save is
 * NOT retried and the form is NOT silently overwritten. Two admins with this page open
 * would otherwise revert each other's operational keys, and the Group B keys take effect on
 * meetings happening right now.
 */

/** The DB column is `time`; <input type="time"> wants HH:MM. */
const hhmm = (value: string | null): string => value?.slice(0, 5) ?? '';

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const normalizeHours = (hours: BusinessHour[]): BusinessHour[] =>
  hours.map((hour) => ({
    weekday: hour.weekday,
    is_open: hour.is_open,
    open_time: hour.is_open ? hhmm(hour.open_time) : null,
    close_time: hour.is_open ? hhmm(hour.close_time) : null,
  }));

/** 400 VALIDATION_FAILED from the cross-key zod rules → the field that failed. */
const zodFieldErrors = (error: unknown): Record<string, true> => {
  if (!(error instanceof ApiClientError) || !Array.isArray(error.envelope.details)) {
    return {};
  }
  const fields: Record<string, true> = {};
  for (const issue of error.envelope.details as { path?: unknown[] }[]) {
    const field = issue.path?.[0];
    if (typeof field === 'string') {
      fields[field] = true;
    }
  }
  return fields;
};

const sectionClass = 'rounded-2xl border border-line bg-white p-4 md:p-5';
const badgeClass = 'inline-flex min-h-6 items-center rounded-full px-2.5 font-semibold text-xs';

const NumberField = ({
  label,
  helper,
  value,
  min,
  max,
  invalid,
  onChange,
}: {
  label: string;
  helper?: string | undefined;
  value: number | null;
  min: number;
  max: number;
  invalid: boolean;
  onChange: (value: number | null) => void;
}) => {
  const id = useId();
  const helperId = useId();

  return (
    <div className="grid gap-1">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value ?? ''}
        aria-invalid={invalid || undefined}
        aria-describedby={helper === undefined ? undefined : helperId}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
        className={`${controlClass} tabular-nums aria-[invalid]:border-r7`}
      />
      {helper === undefined ? null : (
        <small id={helperId} className="text-muted text-xs">
          {helper}
        </small>
      )}
    </div>
  );
};

const SwitchRow = ({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) => (
  <div className="flex items-center justify-between gap-3">
    <span className="font-semibold text-ink2 text-sm">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-g7' : 'bg-n1'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
          checked ? 'left-5.5' : 'left-0.5'
        }`}
      />
    </button>
  </div>
);

const SettingsForm = ({ doc, onReload }: { doc: SettingsDocument; onReload: () => void }) => {
  const [settings, setSettings] = useState<Settings>(doc.settings);
  const [hours, setHours] = useState<BusinessHour[]>(doc.business_hours);
  const thisYear = Number(bkkDate(doc.server_time).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [holidays, setHolidays] = useState<Holiday[]>(doc.holidays);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [holidayError, setHolidayError] = useState<string | null>(null);
  const save = useSaveSettings();
  const [outcome, setOutcome] = useState<SaveSettingsOutcome | null>(null);
  const yearId = useId();
  const newDateId = useId();
  const newNameId = useId();

  // The draft holds every year the document returned, but the <select> shows one at a time.
  // Dirtiness and the payload are therefore computed over ALL years — keying them off the
  // visible year would silently drop the other year's unsaved edits on a year switch.
  const inYear = (list: Holiday[], value: number): Holiday[] =>
    list.filter((holiday) => holiday.date.startsWith(`${value}-`));
  const holidayYears = [
    ...new Set([...holidays, ...doc.holidays].map((holiday) => Number(holiday.date.slice(0, 4)))),
  ];
  const changedYears = holidayYears.filter(
    (value) => !sameJson(inYear(holidays, value), inYear(doc.holidays, value)),
  );

  const yearHolidays = inYear(holidays, year);
  const hoursDirty = !sameJson(normalizeHours(hours), normalizeHours(doc.business_hours));
  const holidaysDirty = changedYears.length > 0;
  const settingsDirty = !sameJson(settings, doc.settings);
  const dirty = settingsDirty || hoursDirty || holidaysDirty;

  // D-26 impact preview. The horizon is the CURRENT max_advance_days, never a hard 30.
  const impact = useQuery({
    ...futureBookingsQuery(addDays(bkkDate(doc.server_time), doc.settings.max_advance_days)),
    enabled: hoursDirty || holidaysDirty,
  });
  const stranded =
    impact.data === undefined
      ? []
      : bookingsOutsideHours(impact.data.data, normalizeHours(hours), holidays);

  const failedError = outcome?.failed?.error;
  const isConflict =
    failedError instanceof ApiClientError && failedError.envelope.code === 'VERSION_CONFLICT';
  const invalidFields = zodFieldErrors(failedError);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setOutcome(null);
    setSettings((prev) => ({ ...prev, [key]: value }));
  };
  const setHour = (weekday: number, patch: Partial<BusinessHour>) => {
    setOutcome(null);
    setHours((prev) =>
      prev.map((hour) => (hour.weekday === weekday ? { ...hour, ...patch } : hour)),
    );
  };

  const addHoliday = () => {
    if (newDate === '' || newName.trim() === '') {
      return;
    }
    if (!newDate.startsWith(`${year}-`)) {
      setHolidayError(COPY.settings.holidaysOutOfYear);
      return;
    }
    if (holidays.some((holiday) => holiday.date === newDate)) {
      setHolidayError(COPY.settings.holidaysDuplicate);
      return;
    }
    setHolidayError(null);
    setOutcome(null);
    setHolidays((prev) =>
      [...prev, { date: newDate, name: newName.trim() }].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
    setNewDate('');
    setNewName('');
  };

  const onSave = () => {
    save.mutate(
      {
        etag: doc.etag ?? '',
        settings,
        ...(hoursDirty ? { businessHours: normalizeHours(hours) } : {}),
        ...(holidaysDirty
          ? {
              holidays: changedYears.map((value) => ({
                year: value,
                items: inYear(holidays, value),
              })),
            }
          : {}),
      },
      { onSuccess: setOutcome },
    );
  };

  const numeric = (
    label: string,
    key: keyof Settings,
    min: number,
    max: number,
    helper?: string,
  ): ReactNode => (
    <NumberField
      key={key}
      label={label}
      helper={helper}
      min={min}
      max={max}
      invalid={invalidFields[key] === true}
      value={settings[key] as number | null}
      onChange={(value) =>
        // max_duration_minutes is the only nullable key: empty means ไม่จำกัด.
        set(key, (key === 'max_duration_minutes' ? value : (value ?? min)) as never)
      }
    />
  );

  return (
    <div className="grid gap-4">
      <section className={sectionClass}>
        <h2 className="font-bold text-ink text-lg">{COPY.settings.policyTitle}</h2>

        <p className={`${badgeClass} mt-3 bg-n1 text-ink2`}>{COPY.settings.groupNewBadge}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="grid gap-1">
            <label htmlFor="slot-increment" className={fieldLabelClass}>
              {COPY.settings.slotIncrement}
            </label>
            <select
              id="slot-increment"
              value={settings.slot_increment_minutes}
              aria-invalid={invalidFields.slot_increment_minutes === true || undefined}
              onChange={(event) => set('slot_increment_minutes', Number(event.target.value))}
              className={`${controlClass} tabular-nums`}
            >
              {[15, 30, 60].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          {numeric(COPY.settings.minDuration, 'min_duration_minutes', 1, 720)}
          {numeric(
            COPY.settings.maxDuration,
            'max_duration_minutes',
            1,
            720,
            COPY.settings.maxDurationUnlimited,
          )}
          {numeric(COPY.settings.buffer, 'buffer_minutes', 0, 720)}
          {numeric(COPY.settings.maxAdvance, 'max_advance_days', 1, 365)}
          {numeric(COPY.settings.minLead, 'min_lead_minutes', 0, 1440)}
        </div>

        <p className={`${badgeClass} mt-5 bg-y1 text-y7`}>{COPY.settings.groupLiveBadge}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {numeric(COPY.settings.checkinOpenBefore, 'checkin_open_before_minutes', 0, 120)}
          {numeric(COPY.settings.checkinGrace, 'checkin_grace_minutes', 1, 120)}
          {numeric(COPY.settings.reminder, 'reminder_minutes_before', 0, 1440)}
          <div className="self-end rounded-xl border border-line p-3">
            <SwitchRow
              label={COPY.settings.autoRelease}
              checked={settings.auto_release_enabled}
              onToggle={() => set('auto_release_enabled', !settings.auto_release_enabled)}
            />
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="font-bold text-ink text-lg">{COPY.settings.hoursTitle}</h2>
        <p className="mt-1 text-muted text-sm">{COPY.settings.hoursHelper}</p>
        <div className="mt-3 grid gap-2">
          {hours.map((hour) => (
            <div
              key={hour.weekday}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2"
            >
              <b className="w-20 text-ink text-sm">{WEEKDAY_NAMES[hour.weekday - 1]}</b>
              <button
                type="button"
                role="switch"
                aria-checked={hour.is_open}
                aria-label={`${COPY.settings.hoursOpenSwitch} ${WEEKDAY_NAMES[hour.weekday - 1]}`}
                onClick={() =>
                  setHour(hour.weekday, {
                    is_open: !hour.is_open,
                    // A day being opened needs both times or the server rejects all 7 rows.
                    ...(hour.is_open
                      ? {}
                      : {
                          open_time: hour.open_time ?? '08:30:00',
                          close_time: hour.close_time ?? '17:30:00',
                        }),
                  })
                }
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  hour.is_open ? 'bg-g7' : 'bg-n1'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
                    hour.is_open ? 'left-5.5' : 'left-0.5'
                  }`}
                />
              </button>
              <label className="flex items-center gap-1.5 text-muted text-xs">
                {COPY.settings.hoursOpenTime}
                <input
                  type="time"
                  disabled={!hour.is_open}
                  value={hhmm(hour.open_time)}
                  onChange={(event) => setHour(hour.weekday, { open_time: event.target.value })}
                  className={`${controlClass} tabular-nums disabled:bg-n0 disabled:text-muted`}
                />
              </label>
              <label className="flex items-center gap-1.5 text-muted text-xs">
                {COPY.settings.hoursCloseTime}
                <input
                  type="time"
                  disabled={!hour.is_open}
                  value={hhmm(hour.close_time)}
                  onChange={(event) => setHour(hour.weekday, { close_time: event.target.value })}
                  className={`${controlClass} tabular-nums disabled:bg-n0 disabled:text-muted`}
                />
              </label>
              {hour.is_open && hhmm(hour.open_time) >= hhmm(hour.close_time) ? (
                <span role="alert" className="font-semibold text-r7 text-xs">
                  {COPY.settings.hoursOrderError}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-bold text-ink text-lg">{COPY.settings.holidaysTitle}</h2>
          <div className="grid gap-1">
            <label htmlFor={yearId} className={fieldLabelClass}>
              {COPY.settings.holidaysYearLabel}
            </label>
            <select
              id={yearId}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className={`${controlClass} tabular-nums`}
            >
              {[thisYear, thisYear + 1].map((value) => (
                // Buddhist era on screen, Gregorian on the wire (C1-34).
                <option key={value} value={value}>
                  {value + 543}
                </option>
              ))}
            </select>
          </div>
        </div>

        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">{COPY.settings.holidaysTableLabel}</caption>
          <thead>
            <tr className="border-line border-b text-left text-muted text-xs">
              <th scope="col" className="px-2 py-2 font-semibold">
                {COPY.settings.holidaysColDate}
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                {COPY.settings.holidaysColName}
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                {COPY.settings.holidaysColActions}
              </th>
            </tr>
          </thead>
          <tbody>
            {yearHolidays.map((holiday) => (
              <tr key={holiday.date} className="border-line border-b last:border-b-0">
                <td className="px-2 py-2 text-ink2 tabular-nums">{formatThaiDate(holiday.date)}</td>
                <td className="px-2 py-2 text-ink2">{holiday.name}</td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOutcome(null);
                      setHolidays((prev) => prev.filter((item) => item.date !== holiday.date));
                    }}
                    className="min-h-8 rounded-[9px] border border-line bg-white px-2.5 font-semibold text-r7 text-xs hover:bg-r0"
                  >
                    {COPY.settings.holidaysRemove}
                  </button>
                </td>
              </tr>
            ))}
            {yearHolidays.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2 py-3 text-muted text-sm">
                  {COPY.settings.holidaysEmpty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor={newDateId} className={fieldLabelClass}>
              {COPY.settings.holidaysColDate}
            </label>
            <input
              id={newDateId}
              type="date"
              value={newDate}
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              onChange={(event) => setNewDate(event.target.value)}
              className={controlClass}
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor={newNameId} className={fieldLabelClass}>
              {COPY.settings.holidaysColName}
            </label>
            <input
              id={newNameId}
              value={newName}
              maxLength={120}
              onChange={(event) => setNewName(event.target.value)}
              className={`${controlClass} w-56 max-w-full`}
            />
          </div>
          <button
            type="button"
            onClick={addHoliday}
            className="min-h-10 rounded-[11px] border border-line bg-white px-3 font-semibold text-ink2 text-sm hover:bg-g0"
          >
            {COPY.settings.holidaysAdd}
          </button>
        </div>
        <div aria-live="polite">
          {holidayError !== null ? (
            <p role="alert" className="mt-2 font-semibold text-r7 text-xs">
              {holidayError}
            </p>
          ) : null}
        </div>
        <p className="mt-2 text-muted text-xs">{COPY.settings.holidaysReplaceNote}</p>
      </section>

      {/* D-26: shrinking hours or adding a holiday never cancels a committed booking, but it
          can strand one. Say so with real rows before the save, not after. */}
      {hoursDirty || holidaysDirty ? (
        <div aria-live="polite">
          {impact.isPending ? (
            <p className="text-muted text-sm">{COPY.settings.impactChecking}</p>
          ) : stranded.length > 0 ? (
            <div className="rounded-xl border border-y1 bg-y0 px-3.5 py-3 text-sm text-y7">
              <b className="tabular-nums">
                {COPY.settings.impactPrefix} {stranded.length} {COPY.settings.impactSuffix}
              </b>
              <p className="mt-0.5">{COPY.settings.impactTail}</p>
              <details className="mt-1">
                <summary className="cursor-pointer font-semibold">
                  {COPY.settings.impactListLabel}
                </summary>
                <ul className="mt-1 grid gap-0.5">
                  {stranded.map((booking) => (
                    <li key={booking.id}>
                      <Link
                        to="/bookings/$bookingId"
                        params={{ bookingId: booking.id }}
                        className="underline"
                      >
                        <span className="tabular-nums">
                          {formatThaiDate(bkkDate(booking.start_at), { omitCurrentYear: true })}{' '}
                          {formatTimeRange(bkkTime(booking.start_at), bkkTime(booking.end_at))}
                        </span>
                        {booking.visibility === 'BUSY' ? null : ` · ${booking.title}`}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : null}
        </div>
      ) : null}

      <div aria-live="polite" className="grid gap-2">
        {isConflict ? (
          <div className="rounded-xl border border-r2 bg-r0 px-3.5 py-3">
            <p role="alert" className="font-bold text-r7 text-sm">
              {COPY.settings.conflict}
            </p>
            {/* No auto-retry and no "save anyway": the form is never silently overwritten. */}
            <button
              type="button"
              onClick={() => {
                setOutcome(null);
                onReload();
              }}
              className="mt-2 min-h-9 rounded-[11px] border border-r2 bg-white px-3 font-bold text-r7 text-sm"
            >
              {COPY.settings.reload}
            </button>
          </div>
        ) : outcome?.failed != null ? (
          <InlineAlert
            message={
              outcome.failed.section === 'business_hours'
                ? COPY.settings.partialHours
                : outcome.failed.section === 'holidays'
                  ? COPY.settings.partialHolidays
                  : errorMessage(outcome.failed.error)
            }
          />
        ) : null}
        {outcome?.failed === null ? (
          <p role="status" className="font-bold text-g7 text-sm">
            {COPY.settings.saved}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty ? null : <span className="text-muted text-sm">{COPY.settings.noChanges}</span>}
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={onSave}
          className="inline-flex min-h-10 items-center rounded-[13px] bg-g7 px-4 font-bold text-sm text-white disabled:opacity-60"
        >
          {save.isPending ? COPY.settings.saving : COPY.settings.save}
        </button>
      </div>
    </div>
  );
};

const SettingsPage = () => {
  const { data: doc, refetch } = useSuspenseQuery(settingsQuery);
  // Remounting is how "โหลดค่าล่าสุด" discards the stale draft — after the refetch, so the
  // form initialises from the values that actually won.
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="p-4 md:p-6">
      <header>
        <h1 className="font-bold text-2xl text-ink">{COPY.settings.title}</h1>
        <p className="text-muted text-sm">{COPY.settings.sub}</p>
      </header>
      <div className="mt-4">
        <SettingsForm
          key={reloadKey}
          doc={doc}
          onReload={() => {
            void refetch().then(() => setReloadKey((value) => value + 1));
          }}
        />
      </div>
    </div>
  );
};

export const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: SettingsPage,
});
