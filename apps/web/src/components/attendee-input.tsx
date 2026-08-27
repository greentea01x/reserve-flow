import { type KeyboardEvent, useState } from 'react';
import { COPY } from '../lib/i18n';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_ATTENDEES = 50;

interface AttendeeInputProps {
  id: string;
  emails: string[];
  onChange: (emails: string[]) => void;
}

/** Email tag input: Enter/comma adds a chip, Backspace on empty removes the last. */
export const AttendeeInput = ({ id, emails, onChange }: AttendeeInputProps) => {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  const add = () => {
    const email = draft.trim().toLowerCase();
    if (email === '') {
      return;
    }
    if (!EMAIL_PATTERN.test(email) || emails.length >= MAX_ATTENDEES) {
      setInvalid(true);
      return;
    }
    if (!emails.includes(email)) {
      onChange([...emails, email]);
    }
    setDraft('');
    setInvalid(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && draft === '' && emails.length > 0) {
      onChange(emails.slice(0, -1));
    }
  };

  return (
    <div>
      <input
        id={id}
        type="text"
        inputMode="email"
        className="w-full rounded-[11px] border border-border-input bg-white px-3 py-2.5 text-base text-ink"
        placeholder={COPY.bookingForm.attendeesPlaceholder}
        value={draft}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
      {invalid ? (
        <p className="mt-1 text-xs font-semibold text-r7" role="alert">
          {COPY.bookingForm.attendeeInvalid}
        </p>
      ) : null}
      {emails.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {emails.map((email) => (
            <li key={email}>
              <button
                type="button"
                onClick={() => onChange(emails.filter((entry) => entry !== email))}
                aria-label={`${COPY.bookingForm.attendeeRemove} ${email}`}
                className="inline-flex min-h-8 items-center gap-1 rounded-full bg-g1 px-3 text-sm font-semibold text-g7 hover:bg-g2"
              >
                {email}
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
