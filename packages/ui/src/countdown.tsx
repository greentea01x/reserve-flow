import { useEffect, useState } from 'react';

export interface CountdownProps {
  /** ISO instant the window closes. */
  until: string;
  /** Renders the remaining whole minutes into the chip text. */
  format: (minutes: number) => string;
}

/** Yellow countdown chip, re-announced per minute via aria-live=polite (A11Y). */
export function Countdown({ until, format }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const minutes = Math.max(0, Math.ceil((new Date(until).getTime() - now) / 60_000));

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center rounded-full bg-y1 px-2.5 py-1 text-xs font-bold text-y7 tabular-nums"
    >
      {format(minutes)}
    </span>
  );
}
