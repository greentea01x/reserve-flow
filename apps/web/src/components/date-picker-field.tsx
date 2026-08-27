import type { Matcher } from '@daypicker/react';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { lazy, Suspense, useId, useRef, useState } from 'react';
import { APP_TIME_ZONE, bangkokDateToIso, isoDateToBangkokDate } from '../lib/date-picker';
import { formatThaiDate } from '../lib/datetime';
import { COPY } from '../lib/i18n';

const loadBuddhistDayPicker = () => import('@daypicker/buddhist');
const BuddhistDayPicker = lazy(() =>
  loadBuddhistDayPicker().then((module) => ({ default: module.DayPicker })),
);

interface ThaiDatePickerFieldProps {
  id: string;
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
  isDateDisabled?: ((value: string) => boolean) | undefined;
  name?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Shared employee date field. The calendar displays Buddhist Era dates while
 * the controlled value stays Gregorian YYYY-MM-DD for URLs and API requests.
 */
export const ThaiDatePickerField = ({
  id,
  label,
  value,
  min,
  max,
  onChange,
  isDateDisabled,
  name,
  className = '',
  disabled = false,
}: ThaiDatePickerFieldProps) => {
  const dialogId = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedDate = isoDateToBangkokDate(value);
  const minDate = isoDateToBangkokDate(min);
  const maxDate = isoDateToBangkokDate(max);
  const [month, setMonth] = useState<Date>(selectedDate);
  const [open, setOpen] = useState(false);

  const preloadCalendar = () => {
    void loadBuddhistDayPicker();
  };

  const openCalendar = () => {
    const dialog = dialogRef.current;
    if (dialog === null || dialog.open) {
      return;
    }
    setMonth(selectedDate);
    setOpen(true);
    dialog.showModal();
  };

  const closeCalendar = () => {
    dialogRef.current?.close();
  };

  const disabledMatchers: Matcher[] = [
    { before: minDate },
    { after: maxDate },
    ...(isDateDisabled === undefined
      ? []
      : [(candidate: Date) => isDateDisabled(bangkokDateToIso(candidate))]),
  ];

  return (
    <>
      {name === undefined ? null : <input type="hidden" name={name} value={value} />}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={open}
        aria-label={`${COPY.datePicker.openCalendar}: ${label} ${formatThaiDate(value)}`}
        onFocus={preloadCalendar}
        onPointerEnter={preloadCalendar}
        onClick={openCalendar}
        className={`inline-flex items-center justify-between gap-3 text-left tabular-nums ${className}`}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-g7" />
          <span className="truncate">{formatThaiDate(value)}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted" />
      </button>

      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={titleId}
        className="date-picker-dialog m-auto max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-visible rounded-[1.75rem] border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-ink/35"
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
      >
        <div className="w-[min(22rem,calc(100vw-2rem))] p-4 sm:p-5">
          <header className="mb-2 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-bold text-ink">
              {COPY.datePicker.dialogTitle}
            </h2>
            <button
              type="button"
              aria-label={COPY.datePicker.closeCalendar}
              onClick={closeCalendar}
              className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-g0 hover:text-ink"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </header>

          <Suspense
            fallback={
              <div
                aria-busy="true"
                className="grid min-h-72 place-items-center rounded-2xl bg-g0 text-sm font-semibold text-muted"
              >
                {COPY.datePicker.loading}
              </div>
            }
          >
            <BuddhistDayPicker
              mode="single"
              required
              selected={selectedDate}
              month={month}
              onMonthChange={setMonth}
              onSelect={(nextDate) => {
                const nextValue = bangkokDateToIso(nextDate);
                if (isDateDisabled?.(nextValue) === true) {
                  return;
                }
                onChange(nextValue);
                closeCalendar();
              }}
              startMonth={minDate}
              endMonth={maxDate}
              disabled={disabledMatchers}
              timeZone={APP_TIME_ZONE}
              weekStartsOn={1}
              navLayout="after"
              numerals="latn"
              autoFocus
              footer={
                <span role="status" aria-live="polite">
                  {formatThaiDate(value, { withWeekday: true })}
                </span>
              }
            />
          </Suspense>
        </div>
      </dialog>
    </>
  );
};
