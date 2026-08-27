import { X } from 'lucide-react';
import { type ReactNode, type RefObject, useId } from 'react';

/**
 * The A9 drawer. A native <dialog> pinned to the right edge — showModal() gives the focus
 * trap, Esc, and focus-return-to-the-triggering-row-action for free, which is the entire
 * reason a dialog library is not installed here.
 *
 * ponytail: no slide transition. Animating a <dialog> out of display:none needs
 * @starting-style or a keyframe pair, and the payoff is decoration that prefers-reduced-
 * motion would have to switch back off anyway. Add one if the sheet ever feels abrupt.
 */
export interface SheetProps {
  ref: RefObject<HTMLDialogElement | null>;
  title: string;
  closeLabel: string;
  /** Esc and the ✕ both land here — navigate the `edit` param away from this. */
  onClose: () => void;
  children: ReactNode;
}

export const Sheet = ({ ref, title, closeLabel, onClose, children }: SheetProps) => {
  const labelId = useId();

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      onClose={onClose}
      // m-0 ml-auto beats the UA's `margin:auto`, which would centre it.
      className="m-0 ml-auto h-full max-h-full w-[min(100vw,30rem)] border-line border-l bg-white backdrop:bg-black/40"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-line border-b px-5 py-4">
          <h2 id={labelId} className="font-bold text-ink text-lg">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label={closeLabel}
            className="grid size-9 shrink-0 place-items-center rounded-[11px] text-ink2 hover:bg-g0"
          >
            <X className="size-4.5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </dialog>
  );
};
