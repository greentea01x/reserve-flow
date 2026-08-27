## Verification

| ID | Status | Evidence |
|---|---|---|
| C2-01 | CORRECTLY FIXED | `mutate()` now enforces idempotency → global → sorted actor/owner users → sorted rooms; deactivation resolves rooms only after its user lock. [08:149](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/08-folder-structure.md:149) |
| C2-02 | CORRECTLY FIXED | Owner and all attendees who received REQUEST get CANCEL; admins receive a separate non-ICS template. [03:137](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/03-requirements.md:137) |
| C2-03 | CORRECTLY FIXED | `LEAST(end_at, start_at + grace)` is authoritative for T6, sweep, and `can.check_in`; the historical 30/60/45 case is explicitly covered. [06:413](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/06-data-model.md:413) |
| C2-04 | CORRECTLY FIXED | Creation rereads policy under the room lock; room PATCH takes the same advisory lock and row lock. [06:470](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/06-data-model.md:470), [07:111](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/07-api.md:111) |
| C2-05 | CORRECTLY FIXED | Approve requires the observed version, updates with `version=$expected`, and returns `VERSION_CONFLICT` with current data. [07:188](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/07-api.md:188) |
| C2-06 | CORRECTLY FIXED | App-owned hashed setup tokens provide purpose-specific TTLs and transactional outbox binding; the Better Auth spike is binding before schema merge. [06:146](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/06-data-model.md:146), [09:42](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/09-implementation-plan.md:42) |
| C2-07 | CORRECTLY FIXED | Production dumps are confined to `rf-drill`; staging is seed-only; retention covers every free-text field; drill scrub removes attendees/reason and asserts known identities are absent. [09:183](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/09-implementation-plan.md:183), [06:860](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/06-data-model.md:860), [10:297](/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/work/build/md/10-devops-security-qa.md:297) |

## Remaining blockers

None.

## Final stack verdict

| Major choice | Verdict | Closing position |
|---|---|---|
| Two Vite SPAs, one origin | AGREE | Distinct shells, shared packages, atomic release |
| Hono | AGREE | Appropriate typed REST/OpenAPI surface |
| Drizzle + two EXCLUDE constraints + room lock | AGREE | Correct source of truth for concurrency |
| Better Auth | ACCEPT-AS-TRADE-OFF | Keep only if the binding W0 spike passes |
| In-process one-minute sweep | AGREE | Current spec correctly removes pg-boss |
| SMTP outbox | AGREE | Correct reliability boundary; verify the real relay |
| Custom CSS-grid calendar | ACCEPT-AS-TRADE-OFF | Reasonable for three fixed room columns; guard accessibility |
| One VM + Docker Compose | ACCEPT-AS-TRADE-OFF | Scale-appropriate with the specified backup/drill discipline |
| Biome | AGREE | Low-ceremony fit for this team |

## First five moves

1. Close the named business, operations, and PDPA confirmations; record owners and defaults.
2. Run T-008 against real PostgreSQL and decide Better Auth versus the fallback before schema merge.
3. Run T-009 through the real corporate relay and validate REQUEST/CANCEL in all three target clients.
4. Land Compose, CI, custom migrations, both EXCLUDE constraints, and required migration/race checks.
5. Build one Thai-first, axe-clean AUTO-booking walking slice through `mutate()`, outbox/.ics, masking, and calendar before widening the UI.

VERDICT: APPROVE — BLOCKING: 0 HIGH: 0