import type { SlotUnavailableDetails } from '../api/types';
import { COPY, slotUnavailableMessage } from '../lib/i18n';

interface ConflictAlertProps {
  roomName: string;
  /** Display range, e.g. "14:00–15:00". */
  range: string;
  details: SlotUnavailableDetails;
  onPickAnotherTime: () => void;
  onPickAlternative: (roomId: string) => void;
  /** E7 adds "การจองยังอยู่ที่เวลาเดิม" here (CB-03). */
  extraLine?: string;
}

/** UX-09: a 409 SLOT_UNAVAILABLE is an inline alert above the CTA — never a toast. */
export const ConflictAlert = ({
  roomName,
  range,
  details,
  onPickAnotherTime,
  onPickAlternative,
  extraLine,
}: ConflictAlertProps) => (
  <div role="alert" className="rounded-xl border border-r2 bg-r0 p-4">
    <p className="text-sm font-bold text-r7">{slotUnavailableMessage(roomName, range)}</p>
    {extraLine ? <p className="mt-1 text-sm text-r7">{extraLine}</p> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onPickAnotherTime}
        className="min-h-9 rounded-[11px] border border-r2 bg-white px-3 text-sm font-bold text-r7 hover:bg-r1"
      >
        {COPY.bookingForm.pickAnotherTime}
      </button>
      {details.alternatives.length > 0 ? (
        <>
          <span className="text-sm font-semibold text-r7">
            {COPY.bookingForm.alternativesTitle}:
          </span>
          {details.alternatives.map((alternative) => (
            <button
              key={alternative.room_id}
              type="button"
              onClick={() => onPickAlternative(alternative.room_id)}
              className="min-h-9 rounded-full bg-g1 px-3 text-sm font-bold text-g7 hover:bg-g2"
            >
              {alternative.name}
            </button>
          ))}
        </>
      ) : null}
    </div>
  </div>
);
