## 1. Remaining BLOCKING / HIGH

- Codex C2-01 — BLOCKING — The mutation lock contract still conflicts across §§6/8 and cannot derive deactivation room locks safely after locking the user.
  Fix: support pre-user global locks and a post-user-lock room resolver; lock actor+owner everywhere; align T1/T4/T-030 and remove the contradictory request-hash branch.
- Codex C2-03 — HIGH — `LEAST(end_at, start_at+grace)` exists only in prose; T6, sweep, API, and tests still use raw `start_at+grace`.
  Fix: use one effective deadline everywhere and add the historical short-booking regression test.
- Codex C2-04 — HIGH — Create can commit using stale `rooms.active` or `approval_mode`.
  Fix: reread the room under lock inside create/reschedule; make room PATCH take the same lock and add barrier tests.
- Codex C2-05 — HIGH — Approval accepts only `{note?}`, so an admin can approve a booking version they never reviewed.
  Fix: require `version`/`If-Match`, update with that version, and return `409 VERSION_CONFLICT`.
- Codex C2-07 — HIGH — Production-data controls remain contradictory: the release gate names a production dump in staging, retention has an incomplete predicate, and drill scrubbing retains attendee emails/reasons.
  Fix: use isolated `rf-drill`, scrub on any remaining free text, remove/pseudonymize attendees and reasons, and assert known identities are absent.

## 2. Accepted trade-offs

- No request-hash table is reasonable for this first-party client; mismatched-key replay may remain, but contradictory helper text must be removed.
- Two SPAs shipped atomically in one image are defensible.
- The in-process scheduler and at-least-once PostgreSQL outbox need no queue product or lease state at this volume.
- JSONB settings, masked pending rows, client-side impact preview, and current-policy historical reporting are proportionate.
- Better Auth and SMTP uncertainty is acceptable because the W0 spikes are binding gates before schema freeze.
- Seed-only staging on the production VM is acceptable once every production-dump reference points exclusively to isolated `rf-drill`.

## 3. Final stack verdict

Yes. React/Vite, Hono, Drizzle/PostgreSQL, a transactional outbox, and Docker/Caddy on one VM fit this project and scale well. The remaining risks are contract consistency and data handling, not the stack.

## 4. Monday readiness

I would let two developers start W0 bootstrap and the auth/SMTP spikes on Monday, but not treat the spec as ready for booking-core implementation until the issues above are closed. The honest two-developer target remains roughly W10–W11, not eight weeks.

VERDICT: REVISE — BLOCKING: 1 HIGH: 4