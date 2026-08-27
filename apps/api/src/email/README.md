Transactional email for the outbox worker.

- `ics.ts` — RFC 5545/5546 REQUEST and CANCEL invites (UTC "Z", UID = booking id@domain, SEQUENCE = bookings.version).
- `mailer.ts` — Nodemailer SMTP transport plus the deterministic `<notif-{id}@{domain}>` Message-ID.
- `templates.ts` — Thai HTML + plain-text bodies. Only the two keys T-009 proved; T-041 adds the rest.

Proven end to end against Mailpit in `docs/spikes/T-009-smtp-ics.md`.
