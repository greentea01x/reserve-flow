# Response to Codex review round 2 (C2-01 … C2-12 + round-1 verification)

Source: `work/review/codex-r2.md` — 16 verification rows (9 CORRECTLY FIXED · 6 INCOMPLETE · 1 WRONG),
findings C2-01 … C2-12 (1 BLOCKING · 6 HIGH · 5 MEDIUM · VERDICT: REVISE), and answers to our 5 questions.
Round-1 verdicts are in `work/review/response-r1.md` and are not re-argued here.

Tally: **ACCEPT 10 · PARTIAL 2 · REJECT 0** (12 findings). The BLOCKING and all 6 HIGH are ACCEPT.
The 1 WRONG row and 5 of the 6 INCOMPLETE rows from the verification table are closed; **C1-08 is closed
only in its lock-ordering half** — the `request_hash` half is a deliberate decline, argued in
"Remaining known trade-offs".

> **Note on ids.** `codex-r2.md` is a genuine, complete Codex round-2 review (verification table →
> C2-01…C2-12 → answers → `VERDICT: REVISE`); the truncated artefact archived at
> `_codex-r2-failed.md` is an earlier aborted run and is not the source of anything here. Every
> `C2-xx` id below is Codex's. One wrinkle: an in-house consistency pass that ran in parallel
> originally reused the ids
> `C2-01…C2-09` for its *own* findings, which collided with Codex's numbering. Those have been
> re-keyed in the section files and in `DECISIONS.md`: three that have no Codex counterpart are now
> **IR-01 / IR-03 / IR-02** (listed at the end of this file, and *not* findings of Codex's), and the
> rest were folded into the Codex or round-1 id they actually belonged to. Every `C2-xx` tag now in
> `work/build/md/*.md` means the Codex round-2 id of the same number.

## Findings

| ID | Severity | Decision | Rationale | Where applied |
|---|---|---|---|---|
| C2-01 | BLOCKING | **ACCEPT** | Real deadlock, not theory: `mutate()` locked rooms before `fn()` took the user lock, while create/reschedule and deactivate both document user-before-room — so create could hold room R waiting for user U while deactivate held U waiting for R. It also locked only the owner, so an admin booking on behalf could commit after their own account was disabled. | `08` §8.2 `mutate({idem,userIds,userLock,roomIds},actor,fn)` + "6 slot-mutating ops"; `06` §6.6 principle (1)(a)(b)(c); T1/T4/T5 lock lines; `07` §7.3.7 deactivate, §7.7 U-04; `05` §5.2 step 5; `09` T-030/T-043 barrier tests; `10` TC-CON-001 |
| C2-02 | HIGH | **ACCEPT** | The owner is the `.ics` ORGANIZER and received the original REQUEST, so sending CANCEL only to attendees leaves the owner's calendar holding a room the system already released. Also needed a second `template_key`, because `notifications_dedupe` is `(booking_id, template_key, recipient_email, dedupe_key)` — one key with two payloads gives an admin-who-is-owner an arbitrary variant. | `02` D-30(b); `03` §3.7 matrix + L13; `06` §6.5 auto-release row, §6.7 sweep step 2; `04` FL-05 4B; `08` template list (11 keys); `09` T-051; `10` job-idempotency block |
| C2-03 | HIGH | **ACCEPT** | Confirmed by construction: grace is retroactive to live bookings, `min_duration_minutes` is not, so the round-1 cross-field guard protected nothing that already existed. 30-min booking under min=30, then min=60 + grace=45 ⇒ sweep step 3 completes at `end_at` before the auto-release deadline and the row can never become AUTO_RELEASED. | `06` §6.5 effective-deadline paragraph + auto-release/complete rows, T6, §6.7 sweep step 2, §6.10 grace rule; `07` §7.3.5 + check-in rows; `03` BR-08/FR-016/L12/L13; `04` FL-05; `02` D-16; `11` E6/A10; `12` glossary; `09` T-050; `10` TC-CHK-019 |
| C2-04 | HIGH | **ACCEPT** | Validation reads `rooms` outside the transaction and T1 never re-read it, so an admin committing AUTO→MANUAL or active→false between step 4 and the INSERT yields a CONFIRMED booking in a room that no longer allows one. Fix is one `SELECT` under the lock we already hold plus the same lock on room PATCH. | `06` §6.6 principle (1)(e), T1 step (e), T2, T4; `07` §7.3.2 `PATCH /admin/rooms/:id`, `POST /bookings` validate order; `05` §5.2 steps 4–5; `09` T-030; `10` TC-CON-001, TC-SET-015 |
| C2-05 | HIGH | **ACCEPT** | The server-side re-read closes a millisecond race; it does not close the two minutes an admin spends reading an agenda. Approving a request whose title, attendees or privacy changed under them is a decision made on stale evidence. `{version}` costs one field. | `07` §7.3.6 approve row + side-effects prose, C-08 catalogue row; `06` T3 `AND version=$expected`; `09` T-042, T-043; `10` TC-APR-003 |
| C2-06 | HIGH | **ACCEPT** (app-owned table) | Codex is right that the documented Better Auth surface does not give us two TTLs, and — more important — does not guarantee the token row's id is available to write `notifications.dedupe_key` in the *same* transaction, which is what C1-05's exactly-once mail rests on. ~15 lines of DDL removes a library-behaviour dependency; storing only `sha256(token)` is a bonus. Chose the table over collapsing to one TTL because a 24-hour invite for an 80-person CSV import is a support burden. | `06` §6.1 table list, §6.2 `password_setup_tokens` DDL + grants + daily purge + migration list; `07` §7.3.1 forgot/set-password, §7.3.7 create/resend-invite/reset-password, §7.7 U-06; `02` D-29; `03` §3.7 ACCOUNT row + RTM; `04` FL-01; `08` schema list; `09` T-007/T-008/T-013/T-014; `10` S-03, job tests; `12` glossary |
| C2-07 | HIGH | **ACCEPT** | Three separate holes, all real: release gate 3 contradicted seed-only staging (and staging's Mailpit is a shared inbox every UAT tester can read); the 24-month scrub keyed on `description` alone so title/special-request/reason could survive forever; the drill scrub left attendee emails and `reason` intact. | `09` §9.6 gate (3) → `rf-drill`; `06` §6.10 retention `UPDATE … WHERE` predicate; `10` §10.9 restore-drill runbook (+`booking_attendees`, `password_setup_tokens`, `reason=NULL`, in-tx canary assertion against `infra/drill-canaries.txt`) |
| C2-08 | MEDIUM | **ACCEPT** — reverses our C1-33 position | We argued "two admins editing simultaneously is not a real risk". Codex's counter-example needs no simultaneity: A leaves the form open, B changes grace, A saves reminder and silently restores the old grace — and operational keys hit meetings that are about to start. An ETag over the canonical document is cheaper than the argument. | `07` §7.3.8 `GET /settings` (ETag) + `PUT /admin/settings` (`If-Match`, advisory lock, 409), §7.3.2 impact preview to `max_advance_days`; `11` A10; `09` T-016; `10` TC-SET-015 |
| C2-09 | MEDIUM | **ACCEPT** | We promised the `rooms.created_at` mitigation in the C1-30 answer and then did not implement it — the SQL cross-joined every room with every report day, so a room created on the 16th got a 1–31 denominator. | `06` §6.9 `room_hours` carries `created_at`, `windows` uses `GREATEST(...)`, new `windows_nonempty` feeds `avail`/`used`, prose updated; `09` T-055; `10` TC-RPT-018 |
| C2-10 | MEDIUM | **ACCEPT** | `now()` is transaction-start stable. A tx that begins at 12:59:59 and wins the advisory lock at 13:00:10 still passes `start_at > now()`, and every check-in / auto-release guard shifts by the lock wait. One `clock_timestamp()` after the locks fixes all of them. | `08` §8.2 `mutate()` step (d); `06` §6.6 canonical lock order step (4), T1/T3/T4/T5/T6, **H1 losers CTE** and the §6.5 effect cells for `confirmed_at`; `04` FL-05 note; `07` §7.3.5; `09` T-043; `10` TC-CON-001. Sweep deliberately keeps one `now()` per run (no advisory lock; its 4 statements must agree on one instant) — stated in §6.6/§6.7 |
| C2-11 | MEDIUM | **ACCEPT** | D-27 says "future bookings are cancelled" and the implementation selected two of the three live statuses. Self-check-in at T−10 followed by deactivation at T−5 left a CHECKED_IN future booking holding the room. Correct boundary is `start_at > $decision_time`, not the status list. | `02` D-27; `06` §6.5 deactivate row; `07` §7.3.7 deactivate, §7.7 U-04; `09` T-014; `10` TC-USR-017 |
| C2-12 | MEDIUM | **PARTIAL** | Accepted and applied in full for every contradiction Codex named. Recorded as PARTIAL only because "one authority pass" is a standing discipline, not a closed item — this round fixed the eight known clashes and named an owner section for each rule, but nothing mechanically prevents the next one. | FACILITY denied general history in `07` §7.5 (matched to §7.3.4); pg-boss only ever as a rejected option (`05`, `12` ADR-004/versions/glossary); one PG pin `postgres:18.1-alpine@sha256:<digest>` in `10` local/CI/compose and `12` §12.3; ticket a11y DoD = the §10.7 rule (`09` §9.2); W8 = go-live/hypercare in the phase table **and** the §9.2 sub-heading; `/api/rooms` → `/api/v1/rooms` (`09` T-080); `reserve@` → `noreply@` (`10` env + S-14); `min_duration` → `min_duration_minutes` (`06` §6.8 prose, `07` §7.3.8) |

## Round-1 verification follow-ups

| Row | Codex status | What was missing | Now |
|---|---|---|---|
| C1-03 | INCOMPLETE | compose pinned 18.1, env rows said 18.x, appendix said 18.6 | One string everywhere: `postgres:18.1-alpine@sha256:<digest>` in local / CI / compose / staging / prod / `12` §12.3, plus a CI step that string-compares the CI service image against `infra/compose.yml` |
| C1-06 | INCOMPLETE | plan still framed weekly capacity as two developers; W8 still labelled "Buffer"; W0 vs the 8-week target unstated | §9.2 reading rules now express weekly numbers as **workload**, with per-head net capacity (≈32 h) and 3 devs as the 8-week baseline; W8 is "Go-live / hypercare" in the phase table *and* the §9.2 sub-heading (`grep Buffer` is empty); W0 explicitly **outside** the 8 weeks, with the instruction to move go-live a week if the business counts it |
| C1-08 | INCOMPLETE | ordering fixed, but same key + different payload still replayed the old booking | **Half closed, half deliberately declined.** The ordering half is closed (idempotency claim + replay run before any user or room lock — see C2-01). The `request_hash` half was implemented and then **reverted**: the spec now states in one voice that the same key returns the original booking whatever the payload, and that there is no `request_hash` column and no `IDEMPOTENCY_KEY_REUSED` code (§6.2 DDL, §6.6 T1 + error map, C-10, T-030, TC-IDEM-011). Rationale below |
| C1-10 | **WRONG** | mandatory `mutate()` reversed the documented user→room order and locked only the owner | Fixed by C2-01: one lock plan `idempotency → sorted users → sorted rooms`, `userIds = {actor, owner}`, deactivate uses the same helper with `userLock:'UPDATE'`, with create-vs-deactivate barrier tests both directions |
| C1-11 | INCOMPLETE | only the two-concurrent-role-reductions test existed | TC-USR-017 and T-014 now require the full barrier matrix: every pair of {PATCH role, deactivate, DELETE, CSV import that changes role} run against each other ⇒ ≥1 active admin survives and the loser gets `409 LAST_ADMIN` |
| C1-14 | INCOMPLETE | AUTO_RELEASED attached CANCEL for attendees only | Fixed by C2-02: owner + every attendee who received REQUEST get the `.ics` CANCEL under `booking.auto_released`; active ADMINs get `booking.auto_released_admin` (explanation, no `.ics`) |
| C1-15 | INCOMPLETE | retroactivity documented but grace validated only against the *current* minimum duration | Fixed by C2-03: effective deadline `LEAST(end_at, start_at + grace)` in T6, sweep step 2 and `can.check_in`; the `grace < min_duration_minutes` cross-field rule is retired in favour of `1–120` |

## Answers to Codex's answers (the 5 questions)

1. **Every CONFIRMED path runs H1** — accepted; the table-driven enumeration test (T1 AUTO, T1 admin-in-MANUAL, T3 approve, T4 reschedule→CONFIRMED) is added to T-043's race gate.
2. **Check-in is not airtight** — accepted. §7.3.5 is now the single owner of the rule and states it as an ordered precedence: owner/attendee ⇒ `SELF` **even when the actor is ADMIN**, otherwise ADMIN ⇒ `ADMIN`, QR ⇒ `QR`, else 403. §03 FR-016/L12, §04 FL-05 2b and §06 §6.5/T6 now reference it instead of restating it; §04 FL-05 2b was the one that said the admin path is always `ADMIN`. Test note added to TC-CHK-019/T-050: an ADMIN who owns the booking records `SELF` **and** is bound by the self deadline, not `end_at`.
3. **Settings names** — `min_duration` → `min_duration_minutes` at §6.8 and in the §7.3.8 cross-field rule; grepped clean across all 13 files. The other numbers Codex checked are unchanged.
4. **Better Auth token flow** — accepted; app-owned `password_setup_tokens` (see C2-06). T-007 now depends on T-008 deciding this before schema freeze, and T-008's DoD asserts the two TTLs and the token+outbox single transaction.
5. **Phase labels / D&D** — accepted. W8 renamed everywhere, W0 stated as outside the eight weeks. The D&D waiver requirement (written waiver from the requirement owner in W0, otherwise T-102 moves into W6 and a third developer is required) was already recorded under C1-22 and is unchanged.

## Amendments to DECISIONS

Appended to `work/DECISIONS.md` under `## Amendments (Codex round 2)`, which now has two lists —
**A** (the in-house pass, re-keyed) and **B** (this review, items 9–20). The provenance note at the
top of that section previously claimed the round-2 Codex run never emitted a review; that was wrong
(it confused `codex-r2.md` with the salvaged `_codex-r2-failed.md`) and has been corrected.

Decisions materially changed by this round:

- **D-27** — deactivation cancels every booking with `start_at > $decision_time` including `CHECKED_IN`; meetings already in progress are never auto-cancelled.
- **D-29** — set-password tokens move from Better Auth `verifications` to our `password_setup_tokens` (`purpose` INVITE/RESET/FORGOT, `token_hash`, `expires_at`, `used_at`, `created_by`).
- **D-30(b)** — the AUTO_RELEASED recipient split (owner + attendees get `.ics` CANCEL; admins get a separate explanatory template).
- **D-16 / BR-08** — check-in and auto-release deadline becomes `LEAST(end_at, start_at + grace)`.
- **C1-33's settings position is reversed** — `PUT /admin/settings` now requires `If-Match`.

## Carried-over in-house findings (IR-xx — not Codex findings)

| ID | What | Where |
|---|---|---|
| IR-01 | §12.2 gains items 10–12: written waiver for deferring admin drag & drop, written acceptance of the NFR-5 delivery definition, HR/DPO sign-off on the PII inventory — all three were already cited as prerequisites by §03/§06/§09 | `12` §12.2; `03` NFR-5; `06` §6.10 |
| IR-03 | Outbox drain checks staleness for **every** template, not only reminders: a booking in a terminal state suppresses non-terminal mail (`SKIPPED`). `payload.version` is deliberately **not** compared — version also moves on detail edits and would swallow valid invitations | `06` §6.7 drain; `10` job-idempotency block |
| IR-02 | Sweep step 3 (COMPLETED) writes an audit row (actor NULL, `booking.complete`) like steps 1–2, and emits no email — §6.5 already promised this | `06` §6.7; `09` T-051 |

## Remaining known trade-offs

- **No per-booking policy snapshot.** `LEAST(end_at, start_at + grace)` removes the failure Codex found, but operational settings remain retroactive by design. A grace change still moves the deadline of meetings that are already confirmed; that is intended (§6.10 "มีผลกับ") and the Settings screen says so. Snapshotting policy per booking stays out of scope for 3 rooms.
- **Utilization is still computed with *current* business hours and holidays.** C2-09 fixes only the room dimension. Editing business hours retroactively still changes last month's numbers; the report page prints that caveat and monthly CSV export is the snapshot escape hatch (C1-30, unchanged).
- **Half of C1-08 is declined: no `request_hash`.** Codex asked for a canonical request hash on the booking row and a `409 IDEMPOTENCY_KEY_REUSED` on mismatch. We took the lock-ordering half and declined the hash. The hash's real cost is not the column, it is a canonical-JSON contract that has to serialise byte-for-byte identically in the browser and on the server *forever*: any drift in key order, timestamp normalisation or attendee sorting turns an ordinary network retry into a hard 409 that blocks a booking the user is entitled to make. Against a single first-party client that mints a fresh UUID per submit press, that is a worse failure than the one it prevents — the mismatch case it catches is a client bug that cannot currently occur. Recorded as a knowing deviation; if a second client (mobile, integration) ever appears, or if round 3 insists, the column is ~5 lines plus the serialiser contract. **Codex's final pass (`codex-final.md` §2) accepted this as a reasonable trade-off for a first-party client**, subject to the contradictory helper text being removed — which it has been (CF-01), so this is an accepted deviation, not one shipped over a reviewer's objection. Also unchanged: 4xx results are not stored, and a replay after the original was cancelled still returns the cancelled booking (C-10).
- **One `now()` per sweep run.** The sweep does not use `clock_timestamp()`; its four statements must agree on one instant and it holds no advisory lock, so there is no lock wait to distort. Accepted deviation from C2-10, stated in §6.6 and §6.7.
- **Staging still shares the production VM** (C1-21, unchanged). C2-07 only guarantees that production *data* never lands there.
- **The authority pass is manual.** C2-12 is closed for the eight clashes named, and each rule now has one owner section, but nothing in CI detects the next cross-section contradiction. If round 3 finds more, the answer is a link-checking script over section cross-references, not another manual sweep.
- **Better Auth is still the auth library.** C2-06 removes the dependency on its *token* semantics, not on the library; T-008 remains a W0 gate that can still send us to the ~150-line hand-rolled fallback (RK-02).
