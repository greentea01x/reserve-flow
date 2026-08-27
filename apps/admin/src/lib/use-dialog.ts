import { type RefObject, useEffect } from 'react';

/**
 * Drives a native <dialog> from React state or a URL search param.
 *
 * showModal() only — never the `open` attribute, which gives a NON-modal dialog with no
 * focus trap. Calling it from an effect rather than from the click handler matters: the
 * handler runs before the re-render, so a dialog opened there would paint one frame of the
 * previous (or empty) content.
 *
 * Closing is driven from here too, so the browser back button can dismiss the A9 sheet.
 */
export const useDialogOpen = (ref: RefObject<HTMLDialogElement | null>, open: boolean): void => {
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, ref]);
};
