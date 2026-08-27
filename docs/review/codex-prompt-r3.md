You are the same staff/principal engineer who reviewed this spec in rounds 1 and 2. This is the FINAL closing round. Be decisive: the team ships from this document.

PROJECT: internal meeting-room booking system for a Thai company (~80 employees, 8 teams, 3 rooms). Employee web app + admin web app + one backend service + PostgreSQL. Hard requirements: DB-level no-double-booking, per-room auto/manual approval, private meetings masked, email + .ics, check-in + 15-minute auto-release, utilization report, Thai-first UI, accessibility. Team 1-3 devs. Tech lead's taste: lazy-but-correct.

READING RULES (round 2 died from context exhaustion — respect these):
- NEVER read/grep/list `*.log`, `work/research/`, `codexlogs/`, or `SPEC-v2.md` (the 600 KB assembled file). Read the per-section files instead.
- Read in targeted chunks with `sed -n 'A,Bp'` / `grep -n`. Emit your answer BEFORE you run low on context — a short, decisive review beats a truncated exhaustive one.

FILES:
- Your round-2 review: `work/review/codex-r2.md` (12 findings C2-01..C2-12 + a verification table).
- The team's response and what they applied: `work/review/response-r2.md`.
- The spec, by section: `work/build/md/00-overview.md` … `12-appendix.md`. The ones that changed most: `06-data-model.md` (transactions/jobs), `07-api.md` (contract), `09-implementation-plan.md` (plan/staffing), `10-devops-security-qa.md` (deploy/security/QA), `03-requirements.md`.

YOUR JOB (in this order, budget your reading accordingly):
1. Verify the fixes for your round-2 BLOCKING and HIGH items only: C2-01 (lock order in the mutate() funnel), C2-02 (AUTO_RELEASED owner .ics CANCEL), C2-03 (retroactive settings / effective deadline), C2-04 (room policy read under lock), C2-05 (approve version), C2-06 (better-auth token flow), C2-07 (release gates / PDPA / production data in staging). For each: CORRECTLY FIXED / INCOMPLETE / WRONG + the evidence line.
2. State any remaining defect you would still block a build start on. Only genuine blockers.
3. Give your final stack verdict in one short table (agree / accept-as-trade-off / still-disagree per major choice: two Vite SPAs on one origin, Hono, Drizzle + two EXCLUDE constraints + per-room advisory lock, better-auth, pg-boss in-process 1-minute sweep, SMTP outbox, custom CSS-grid calendar, one VM + Docker Compose, Biome).
4. Give the team the 5 things you would do FIRST in week 1 if you were the tech lead on this spec.

OUTPUT (markdown, English, at most ~60 lines total):
`## Verification` table · `## Remaining blockers` (or "none") · `## Final stack verdict` table · `## First five moves` · then the final line EXACTLY:
`VERDICT: APPROVE | REVISE — BLOCKING: <n> HIGH: <n>`
