# DECISIONS.md — single source of truth for ReserveFlow v2 (orchestrator synthesis)

These are DECIDED. Writers must use exactly these names/choices. Where a research file disagrees with this document, THIS document wins. "Confirm" = we build to this default and list it as a one-line confirmation for the business; it is not an open question.

## A. Product scope & roles
- Working name: **ReserveFlow** (Q-05 confirm; name is one config constant + logo asset).
- Deliverables: `apps/web` (พนักงาน), `apps/admin` (ผู้ดูแล), `apps/api` (REST API + pg-boss worker in-process), PostgreSQL.
- Roles: `EMPLOYEE`, `ADMIN` (MVP). `FACILITY` reserved in the enum, UI in Phase 1.1 (read-only "Today" run-sheet + check-in assist). No kiosk in MVP.
- Scope: rooms only (no generic resources, no abstraction for later). 3 rooms, ~80 users, 8 departments, Asia/Bangkok.
- Phases: **MVP (W1–W6 code-complete, W7 UAT/hardening, W8 buffer → go-live)**, **Phase 1.1** (QR deep-link check-in, admin drag&drop reschedule, facility run-sheet, in-app notification bell, capacity/feature filters polish, CSV export), **Phase 2** (utilization heatmap polish, announcements "Webboard" banner if wanted, SSO, recurring/waitlist — backlog only).
- MoSCoW stays exactly as the PDF: FR-001..006, 008, 009 Must; 007, 011 Should; 010, 012 Could. v2 MVP still ships FR-007, FR-010 (self + admin check-in + auto-release; QR deep link in 1.1), FR-011 (capacity + feature filter), and a basic FR-012 report because the company deck calls them out and they are cheap on this stack.

## B. Business rules (policy defaults; all admin-editable in Settings unless marked fixed)
- Site reachable 24/7; selectable times only inside business hours (default Mon–Fri 08:30–17:30) + admin-managed holidays (seed Thai public holidays). **No out-of-hours admin override in MVP.**
- Slot grid: 30-min increments; min duration 60 min; max duration = none beyond business hours (setting exists, default null); buffer 0; advance window 30 rolling days; min lead time 0 (can book a room that is free right now, start rounds up to next 30-min mark).
- Half-open intervals `[start,end)` so 13:00–14:00 and 14:00–15:00 never collide.
- Approval: per-room `approval_mode` ∈ {AUTO, MANUAL}. AUTO = first commit wins (DB constraint). MANUAL = overlapping PENDING requests are allowed; admin approves exactly one; losers auto-rejected in the same transaction with reason_code `CONFLICT_LOST`. (Q-01 confirm with business — zero build cost either way.)
- Pending never holds a slot, BUT a pending can never be placed on a slot that is already CONFIRMED/CHECKED_IN (DB constraint B below). In availability UI a manual-room slot with pendings shows "มีคำขอรออนุมัติ" and remains selectable.
- Reschedule (time/room change): re-runs policy — AUTO room: atomic update under constraint; MANUAL room: owner's change drops back to PENDING and releases the old slot (user is warned first); admin reschedule stays CONFIRMED and auto-rejects overlapping PENDING. Detail-only edits (title, attendees, special request, privacy) never re-approve.
- Cancel: owner may cancel while status ∈ {PENDING_APPROVAL, CONFIRMED} and now < end_at; admin may cancel any booking before end_at with a required reason. Cancel/reject/auto-release free the slot immediately (status change, never delete).
- Check-in: window = start−15 min → start+15 min. Entry points (MVP): (1) self check-in button in My Bookings + link in reminder email, (2) admin check-in from admin calendar/approvals. (1.1): static printed room QR → deep link `/check-in/:roomCode` (login required; owner or attendee only; inside window). Auto-release at start+15 min if not checked in (setting `checkin_grace_minutes`=15, `auto_release_enabled`=true). No rotating tokens (threat already neutralised by login + window for an 80-person office).
- Private meeting: owner, attendees (email matches a user), and ADMIN see full details; everyone else sees "ไม่ว่าง" + room/time only. Masking happens in the API serializer (4 visibility levels FULL / PUBLIC / BUSY / FACILITY), never in CSS.
- Login: `employee_code` + password only. Email remains the internal Better Auth/account-notification address; mobile remains optional profile/contact/recovery data. Neither email nor mobile is accepted as a sign-in identity. No self-registration (Register screen removed). Admin creates users (single, or CSV import with dry-run) → one **set-password token flow** covers invite, admin reset, and forgot-password. Password ≥ 10 chars, argon2id; lockout 5 failures / 15 min; session 7 days sliding, "remember me" 30 days; deactivate = revoke all sessions + cancel that user's future bookings (with notifications).
- Admin master-data changes (room hours, capacity, approval_mode, holidays) never auto-cancel existing bookings; they apply to new requests only; the admin screen shows a warning listing affected future bookings.
- Display: Thai-first copy (no ค่ะ/ครับ system voice), statuses in Thai with English code in parentheses where useful, 24h zero-padded times, Buddhist year (พ.ศ.) via one `formatDate()` helper (Intl th-TH); API is ISO-8601 with +07:00 offset; DB is timestamptz.
- Email events (FR-009): REQUESTED (manual → owner "รออนุมัติ", admins "มีคำขอใหม่"), CONFIRMED (owner + attendees, .ics METHOD:REQUEST), REJECTED (owner, reason), CANCELLED (owner→attendees; admin cancel → owner + attendees; .ics METHOD:CANCEL), RESCHEDULED (owner + attendees, .ics REQUEST SEQUENCE+1), REMINDER (owner, T−15 with check-in link; setting), AUTO_RELEASED (owner + admins), ACCOUNT (set-password link). .ics uses UTC "Z" timestamps, stable UID = booking id @ domain, SEQUENCE = bookings.version. Email failure never rolls back a booking (transactional outbox + retry).
- Utilization: used_hours (CHECKED_IN/COMPLETED minutes clipped to business windows, holidays excluded, current month capped at now) ÷ available_hours (business hours × open days); cancelled/rejected/expired excluded; AUTO_RELEASED reported as no-show rate, not utilization. Shown per room, per month, + weekday×hour heatmap (table-based).
- Truly open for the business (v2 lists them in a short "ต้องยืนยันกับบริษัท" box): product name/logo; "Webboard" meaning; hosting location + company email domain/SMTP relay; seed facts (which rooms are MANUAL, who are admins, 8 department names); confirmations Q-01, Q-08 (SSO later?), Q-09, Q-11 max duration.

## C. Tech stack (decided)
| Layer | Decision | Runner-up & why it lost |
|---|---|---|
| Repo | pnpm workspaces + Turborepo; Node 24 LTS; TypeScript strict; **Biome** for lint+format | Nx (too much), ESLint+Prettier (6 plugins vs one binary) |
| Front-ends | **Two Vite + React 19 SPAs** (`apps/web`, `apps/admin`), **TanStack Router** (typed routes, zod search params), served as static files by Caddy from ONE origin at `/` and `/admin/` | Next.js (runner-up; picked against because there is a separate API, no SEO/SSR need, and static files mean 2 fewer Node processes — choose Next.js only if the team standardises on it). One role-gated app lost: admin code/dnd-kit/report bundles stay out of 80 employee browsers |
| UI | Tailwind CSS v4 + shadcn/ui (Radix primitives) in `packages/ui`; Noto Sans Thai; pastel semantic tokens from v1 with darkened text tokens for AA contrast | MUI (heavy, hard to match pastel brand) |
| Forms | React Hook Form + Zod resolver; the same Zod schemas are the API request schemas (`packages/shared`) | Formik/Yup |
| Server state | TanStack Query; URL holds calendar filters; no Redux/Zustand | SWR |
| Calendar / D&D | **Hand-rolled CSS-grid board** (3 room columns × 18 half-hour rows 08:30–17:30; day + week views) + `@dnd-kit` for admin drag&drop (1.1) with a keyboard "เลื่อนเวลา…" dialog alternative | FullCalendar / Schedule-X (resource views are paid; drag is pointer-only → fails WCAG 2.2 SC 2.5.7) |
| Date/time | date-fns v4 + `@date-fns/tz`; `APP_TZ = 'Asia/Bangkok'` constant; DB timestamptz | Temporal polyfill (fine; revisit when native Temporal ships everywhere) |
| API | **Hono 4** on Node (`@hono/node-server`) + `@hono/zod-openapi` → OpenAPI 3.1 at `/api/docs`; `openapi.json` committed as contract artifact | Fastify (close), NestJS (DI ceremony for a 3-room app) |
| API style | REST, JSON snake_case, `/api/v1`, error envelope `{code,message,details,request_id}`, Idempotency-Key on POST /bookings | tRPC (couples FE), GraphQL (no query-shape problem) |
| Typed client | `hono/client` (`hc`) type-only import from `apps/api` route types — zero codegen; shared ErrorCode enum | openapi-typescript + openapi-fetch (pre-decided fallback if hc types get slow) |
| DB | **PostgreSQL 18** (≥16 acceptable) + `btree_gist`; TWO exclusion constraints on `bookings` (see datamodel.md): (A) CONFIRMED/CHECKED_IN never overlap per room; (B) PENDING never overlaps CONFIRMED/CHECKED_IN per room (`((status='PENDING_APPROVAL')::int) WITH <>`); `pg_advisory_xact_lock(hashtext(room_id))` at the start of every booking-mutating transaction (one writer per room — fine for 3 rooms, documented ceiling) | App-level locking only (leaks through code paths) |
| ORM | Drizzle ORM + drizzle-kit `generate` → committed SQL; EXCLUDE + extension + audit trigger in hand-written custom migrations; **never `drizzle-kit push` outside local** | Prisma (exclusion constraints leak through), Kysely (no migrations story) |
| Auth | **better-auth** (employee-code login resolved internally to its email credential, Postgres sessions, `__Host-sid` httpOnly Secure SameSite=Lax cookie, admin plugin for user management & instant revocation, argon2id via `@node-rs/argon2`), login rate-limit + lockout | Hand-rolled sessions (fallback if better-auth blocks on employee_code login — ~150 lines), JWT (no revocation) |
| CSRF / CORS | Single origin → no CORS; SameSite=Lax + Origin header check on mutations; no CSRF tokens | Token-based CSRF |
| Authz | One `can(actor, action, resource)` module + one `toViewerBooking()` masking serializer; RBAC in route guards; private masking at query/serializer level; no CASL, no RLS | CASL / RLS (overkill) |
| Jobs | **pg-boss** (same Postgres, runs inside the API process behind `WORKER_ENABLED=true`; can split to a second container later with zero code change). One cron `booking.sweep` every minute doing 4 idempotent statements (expire pendings past start, auto-release no-shows, complete past end, enqueue reminders with dedupe), plus `notify.send` outbox drain (`FOR UPDATE SKIP LOCKED`, retry/backoff, dead-letter) | BullMQ/Redis (extra infra), per-booking startAfter jobs (reconciliation on reschedule/cancel) |
| Email | **Nodemailer over SMTP** to the company's Google Workspace / M365 relay (SPF/DKIM already theirs) via a `notifications` outbox table written in the booking transaction; react-email templates (Thai); `ical-generator` for .ics (UID/SEQUENCE/METHOD/UTC). Provider swap (Postmark/SES) = one transport config. Local/staging: Mailpit | SES/Resend first (needs new domain auth; company relay is guaranteed internal delivery) |
| QR | `qrcode` → 3 static printable room signs (1.1) | Per-booking rotating tokens |
| Files | Room photos on a Docker volume + `sharp` resize; included in backups; R2/S3 only if host FS is ephemeral | S3 from day 1 |
| Charts | `<table>` + CSS/SVG bars for utilization & heatmap | Recharts/Chart.js |
| Testing | Vitest (unit + API integration against a real Postgres service container via `app.request`/inject), Playwright + axe for e2e journeys, **concurrency gate**: 100 parallel POST /bookings same slot → exactly one 201 + DB has 1 row; approve-race; cancel-vs-rebook; idempotent double-click; k6 for calendar p95 | Mocks instead of DB constraint tests |
| CI/CD | GitHub Actions: lint → typecheck → unit → integration (PG service) → e2e smoke → migrations-check → build images → GHCR; `main` → staging auto; tag + environment approval → prod; migrate as explicit pre-deploy step | Manual deploy |
| Deploy | **One VM (Singapore/Bangkok, 2 vCPU/4 GB)** + docker compose: `caddy` (serves both SPAs + reverse-proxies `/api`), `api` (+worker), `postgres`; staging = second compose project on the same box under a subdomain; ~$12–25/mo. Managed alternative: Fly.io (SIN) or Render + managed Postgres. Vercel/Supabase rejected (long-lived worker) | ECS/RDS (cost & ceremony) |
| Observability | pino JSON + request ids, Sentry (browser + node, cron monitors on sweep + backup), `/api/healthz` + `/api/readyz`, external uptime ping; OTel/Grafana only if needed | OTel from day 1 |
| Backups | 6-hourly `pg_dump -Fc | age` → R2/B2 (30d + monthly), pre-deploy dump, quarterly restore drill into staging with PII scrub; PITR deferred | VM snapshots only |
| Security baseline | HTTPS (Caddy auto-TLS), `__Host-` cookie, argon2id, rate limits, RBAC returning 404 for hidden resources, DB roles `rf_owner` (DDL) / `rf_app` (DML; audit_logs INSERT/SELECT only + BEFORE UPDATE/DELETE trigger raises), zod-validated env, log redaction (mobile/emails), PDPA retention (attendee emails + notification payloads 12 months, audit 24 months) | — |

## D. Monorepo folder structure (decided)
```
reserve-flow/
├─ apps/
│  ├─ web/        Employee SPA (Vite + React + TanStack Router)
│  ├─ admin/      Admin SPA (same stack; dnd-kit + reports only here)
│  └─ api/        Hono REST API + pg-boss worker; contains db/ (Drizzle schema, migrations, seed), email/ (react-email templates, ics), modules by domain
├─ packages/
│  ├─ shared/     Zod schemas (request/response), enums (BookingStatus, Role, ErrorCode), settings type, slot/time math (computeSlots, validateBooking), formatDate
│  ├─ ui/         shadcn/ui components, Tailwind preset + tokens, StatusBadge, SlotGrid primitives
│  └─ config/     tsconfig bases, Biome config, shared Vite config
├─ tests/
│  ├─ e2e/        Playwright journeys (employee + admin) + axe
│  └─ load/       k6 scripts (booking race, calendar p95)
├─ infra/
│  ├─ compose.yml, compose.staging.yml, Caddyfile, Dockerfile.api, Dockerfile.static, backup.sh, .env.example
│  └─ github/ (copied to .github/workflows): ci.yml, deploy.yml
├─ docs/          this spec (HTML + md), ADRs, runbooks
├─ package.json, pnpm-workspace.yaml, turbo.json, biome.json
```
(`packages/db` and `packages/email` are deliberately folded into `apps/api` — each has exactly one consumer.)

## E. Implementation plan skeleton (writers flesh out to ticket level with DoD)
- W0 (2–3 days): confirm open items with business; repo bootstrap; compose; CI green on empty apps; design tokens.
- W1 Foundation: DB schema + migrations + constraints + seed; better-auth + login/logout/me + set-password flow; admin Users CRUD + CSV import; Departments; settings table; audit log.
- W2 Rooms & availability: rooms CRUD (+features, photo, approval_mode, hours), holidays; GET /availability, /calendar with masking; employee Search + Available rooms + Room & time pages; calendar board (day/week).
- W3 Booking core: POST /bookings (auto + manual paths, idempotency, advisory lock, constraint mapping), booking form, My bookings, detail, cancel, reschedule; **concurrency test suite green (release gate)**.
- W4 Approvals + notifications: approval center with conflict groups, approve/reject (+loser sweep), outbox + pg-boss + SMTP + templates + .ics; reminder; admin dashboard.
- W5 Check-in & lifecycle: self/admin check-in, sweep job (expire/auto-release/complete), admin calendar (read-only + check-in), reports v1 (utilization per room/month, outcomes, heatmap table), settings page.
- W6 Hardening: a11y pass (axe, zoom 200%, keyboard), security checklist, k6 p95, backups + restore drill, runbooks, Thai copy review, RTM & test report.
- W7 UAT with 8 teams + fixes; W8 buffer / go-live; Phase 1.1 items start after.
- Team: 1 full-stack lead + 1–2 devs; split by area (api+db / web / admin) with the lead owning booking core + constraints.

## F. Document structure for the v2 HTML (section ids fixed)
00 hero/overview · 01 review-of-v1 (what we kept / changed / added, verified findings) · 02 decisions (closed questions + truly-open box) · 03 requirements (FR/NFR table, business rules, status lifecycle, permission matrix, notification matrix, RTM) · 04 user-flows (employee, admin approval, admin user mgmt, check-in/auto-release, concurrency sequence) · 05 architecture (diagram, stack table with rationale, request path, same-origin topology) · 06 data-model (ERD summary, full DDL, constraints, indexes, state machine, transactions SQL, jobs) · 07 api (conventions, error catalogue, endpoint tables, 6 worked examples) · 08 folder-structure (tree + per-folder purpose + conventions) · 09 implementation-plan (phases, week-by-week tickets with DoD, team, risks, release gates) · 10 devops-security-qa (environments, CI/CD, deploy, security checklist, test matrix, observability, backups, runbooks) · 11 ui-mockups (v1 panels kept + new Admin Users / Admin Rooms panels; UX fixes list; design tokens) · 12 appendix (glossary TH/EN, open confirmations, references/versions verified).

## Amendments (Codex round 1) — summary by decision area

Round-1 peer review (`work/review/codex-r1.md`, 43 findings) → response and per-finding verdicts in `work/review/response-r1.md`. These amendments **override** the corresponding lines above; the section files in `work/build/md/` already reflect them. (The per-finding list of the same round follows below; round 2 is at the end of the file and overrides both.)

- **C. Jobs** — pg-boss is **out**. Jobs run in an in-process `apps/api/src/jobs/scheduler.ts` (~40 lines: `setInterval` loops for `booking.sweep` 60 s, `notify.send` 10 s + post-commit kick, `maintenance.daily` 03:15 Asia/Bangkok; `pg_try_advisory_xact_lock('job:'||name)` as the singleton guard; first run at boot; `stop()` on SIGTERM; `/readyz` 503 when `last_sweep_at` older than 3 min). The outbox table already is the queue and the sweep recomputes current truth, so a queue library added a schema, migrations and a second retry model for three loops. `WORKER_ENABLED` unchanged. (ADR-004; C1-37)
- **C. Auth / secrets** — `BETTER_AUTH_SECRET` (≥ 32 random bytes, different per environment, zod-validated at boot, **never** generated at container start; rotation = everyone re-logs in) is the app's one secret and is now in the env table, compose, CI and the rotation/recovery runbooks. better-auth refuses to start in production without it. (C1-02)
- **C. Deploy** — PG18 mounts `pgdata:/var/lib/postgresql` (not `/var/lib/postgresql/data`; the image's `PGDATA` is `/var/lib/postgresql/18/docker`). Caddy uses `handle /api/*` (prefix preserved for Hono) and `handle_path /admin/*` with `root * /srv/admin`, plus `redir /admin /admin/ 308`. Every image is pinned tag + `@sha256:` identically across local/CI/staging/prod (postgres, caddy, mailpit, node build base, k6) and GitHub Actions are pinned by commit SHA. A smoke test against the built image is a release gate. (C1-01, C1-03, C1-39)
- **B. Email events** — `AUTO_RELEASED` now also sends **attendees** `.ics METHOD:CANCEL` (stable UID, `SEQUENCE = bookings.version`) alongside the explanatory mail to owner + admins; otherwise attendee calendars keep an event for a room that has been released and possibly rebooked. D-30(b) reversed. The notification matrix in §3.7 is the single authority. (C1-14)
- **B. Login / identity** — employee accounts (single create and CSV import) must use an address inside `ACCOUNT_EMAIL_DOMAINS` (env; empty = unenforced locally, company domain in prod) → 422 otherwise. `email_verified` becomes true only when the invite link is redeemed, never when an admin creates the row. `users.banned` mirrors `status='DISABLED'` by CHECK constraint so access state has one value. External attendee emails stay free-text contacts, never directory identities. (C1-17, C1-20)
- **A / C. New surfaces** — `GET /directory/users` (any logged-in user; `{id, full_name, email, department}`, ACTIVE only) for the attendee picker. FACILITY (1.1) gets `GET /facility/run-sheet?date=` bounded to today/tomorrow and is denied `GET /bookings?scope=all`. (C1-23, C1-32)
- **C. Environments** — staging runs on **seed/test data only**; a production dump is never restored there (its Mailpit inbox is shared with 8 UAT teams). Restore drills, load tests and anything touching a prod dump run in a throwaway `rf-drill` compose project with no Caddy route and no published port, scrubbed by `infra/scrub-drill.sql` in one transaction **before** any service starts, then `down -v`. (C1-21)
- **E. Staffing → calendar (decide in W0, record in `docs/decisions/W0-confirmations.md`)** — MVP code-complete is ≈ 568 h against ≈ 435 h net capacity for two people, so: **3 devs = the baseline for the 8-week date**; 2 devs ≈ 9 weeks to code-complete → go-live W10–W11, or 8 weeks **only** with the §9.8 cut list approved in advance and no buffer; 1 dev = 16–18 weeks. W8 is go-live/hypercare, not development capacity. W0 spikes T-008 (better-auth vertical) and T-009 (real SMTP relay) are gates that decide before schema freeze. (C1-06, C1-17, C1-18)
- **A. Scope governance** — utilization per room/month **stays in MVP** and is explicitly not the first thing cut (only the heatmap/outcomes polish moves to 1.1). Admin drag & drop stays in Phase 1.1 **only against a written waiver** from the requirement owner in W0, since the PDF NFR names it; without the waiver T-102 moves into W6 and a third dev is required. UAT sign-off must capture that waiver and the "delivery = relay accepted" SLO definition in writing. (C1-22, C1-18)
- **Documented limitations** (accepted deliberately, each cited in-spec so nobody rediscovers them by surprise): utilization denominator uses *current* business hours/holidays/rooms with no effective-date history (C1-30); master-data impact is a client-side preview and settings have no ETag/`If-Match` (C1-33); the two SPAs ship as one atomic release, not independently (C1-38); the outbox has no lease/`SENDING` state (C1-31); booking policy is not snapshotted per booking, operational keys are declared retroactive (C1-15); no separate idempotency table — advisory lock per `(actor, key)` plus `UNIQUE (created_by, idempotency_key)` (C1-08).

## Amendments (Codex round 1) — per-finding list

Applied from `work/review/codex-r1.md`; full per-finding log in `work/review/response-r1.md`. Same round as the summary block above (which groups the same changes by decision area); where either disagrees with sections A–F, **these win**.

1. **Jobs — pg-boss dropped** (C1-37). §C "Jobs" is now: in-process `jobs/scheduler.ts` (~40 lines), `setInterval` + `pg_try_advisory_xact_lock` per job + `stop()` on SIGTERM; `booking.sweep` 60 s, `notify.send` 10 s + post-commit kick, `maintenance.daily` 03:15; `/readyz` exposes `last_sweep_at` (503 if older than 3 min). No `pgboss.*` schema, no second retry model.
2. **PostgreSQL 18 kept, pinned and mounted correctly** (C1-03, C1-39). Volume is `pgdata:/var/lib/postgresql` (PG18 moved `PGDATA` to `/var/lib/postgresql/18/docker`); image `postgres:18.1-alpine@sha256:<digest>` with the identical pin in compose, CI service, staging and prod (same for `caddy` and `axllent/mailpit`). Downgrading to 17 is not adopted — the fix removes the reason.
3. **CSRF is our own middleware, not Hono `csrf()`** (C1-12). Every unsafe method, any content type or none, needs `Origin ∈ [PUBLIC_BASE_URL] ∪ CSRF_EXTRA_ORIGINS` or `Sec-Fetch-Site: same-origin`, else `403 CSRF_REJECTED`. New env `CSRF_EXTRA_ORIGINS` (empty in prod; `http://localhost:5174` locally for the admin dev server).
4. **`BETTER_AUTH_SECRET` is a required managed secret** (C1-02) — ≥32 random bytes, zod-validated at boot, distinct per environment, never generated at container start, covered by the rotation runbook.
5. **Canonical account state = `users.status`; `banned` is a DB-enforced mirror** (C1-17). `CHECK (banned = (status='DISABLED'))`; session revocation is a direct `DELETE FROM sessions` on the same tx client. better-auth is confirmed only after the **W0 T-008 vertical spike gate**, which blocks schema freeze; the ~150-line hand-rolled fallback becomes a W0 decision, not a mid-W1 escape.
6. **Employee identity boundary** (C1-20). `email_verified` becomes true only on invite redemption, never at admin creation. New env `ACCOUNT_EMAIL_DOMAINS` restricts account creation **and CSV import** to the company domain (422 otherwise). External attendee addresses stay contacts without `user_id`.
7. **AUTO_RELEASED cancels attendee calendars** (C1-14). §B email events: `AUTO_RELEASED` = owner + admins (explanatory mail) **plus every original calendar recipient with `.ics METHOD:CANCEL`, same UID, `SEQUENCE=version`**. Previously owner + admins only, no attendee `.ics`.
8. **Check-in / operational policy is retroactive by design** (C1-15). §B's "master-data changes apply to new requests only" holds for booking-window rules **only**. `checkin_open_before_minutes`, `checkin_grace_minutes`, `auto_release_enabled`, `reminder_minutes_before` are read fresh each sweep and therefore apply immediately to all live bookings; the Settings screen must say so. New cross-field rule `1 ≤ checkin_grace_minutes < min_duration_minutes`. Settings storage stays key/value JSONB validated as a whole document by zod — no typed `booking_policy` table, no per-booking policy snapshot.
9. **Idempotency stays on the `bookings` row — with a fixed claim order** (C1-08). No separate idempotency table. T1 order: `pg_advisory_xact_lock(hashtext(actor‖':'‖key))` → replay `SELECT` → return the existing booking **before** any room lock or H1 sweep → only then room lock/insert. `UNIQUE (created_by, idempotency_key)` is the second net. Same key + different payload deliberately returns the original booking.
10. **Approval order is canonical and lock-revalidated** (C1-04, C1-09). Everywhere: read target → advisory lock room → re-read `FOR UPDATE` comparing room/range/status/version (difference ⇒ rollback + one retry from the new room) → reject directly-overlapping pendings → confirm winner → audit/outbox. A failed winner update rolls back the loser rejections.
11. **Conflict group ≠ rejection set** (C1-25). A connected component is a display container only; approving rejects only the pendings that overlap **directly** (`conflicts_with[]`).
12. **Attendee edits are optimistically locked** (C1-13, C1-28). `PUT /bookings/:id/attendees` requires `version` and obeys the same predicate as PATCH; bookings become uneditable at `CHECKED_IN` (admin cancel only).
13. **Staffing baselines replace "1 lead + 1–2 devs / W8 buffer"** (C1-06). Net capacity ≈32 h/dev/week (80 % focus); MVP W0–W6 ≈568 h. **3 devs ⇒ W8 go-live (baseline for the 8-week date)**; 2 devs ⇒ W10–W11, or W8 only with the pre-approved cut list; 1 dev ⇒ W18–W20. W8 is go-live/hypercare, **not** development buffer.
14. **Scope gates** (C1-22). Utilization per room/month is not a cut candidate before heatmap/outcomes. Admin drag-and-drop stays in 1.1 **only with a written waiver** from the requirement owner in W0; otherwise T-102 enters W6 and needs the third dev.
15. **Retention adds booking free-text scrubbing** (C1-19). Booking `title`/`description`/`special_request`/`reason` scrubbed at 24 months (statistical facts retained); retained-identifier cases are **pseudonymisation**, not anonymisation; a field-level PII inventory + DSAR + breach runbook, owned by company HR/DPO, confirmed in W0.
16. **Staging and restore drills separated from production data** (C1-21). Replaces "quarterly restore drill into staging with PII scrub": staging carries seed/test data only and never a production dump; restores run in an isolated `rf-drill` compose project (no Caddy route, no published ports) with `scrub-drill.sql` in one transaction **before any service starts**, then `down -v`; annual bare-VM restore as DR proof. Staging still shares the production VM.
17. **Email SLO restated** (C1-18). NFR-5 "delivery > 99 %" means **relay accepted ÷ attempted**, invalid addresses excluded, with bounce monitoring on `MAIL_FROM` — explicitly not inbox delivery — and requires written business acceptance. The real relay path is proven in W0 (T-009), not W7.
18. **Week view semantics frozen** (C1-36). Day = 3 rooms × 18 half-hour rows; **week = one selected room × 7 days**; mobile <640 px = list view. A throwaway prototype in W1 is the acceptance reference; T-025 is XL (24 h).
19. **Availability contract** (C1-24). `GET /availability` returns **every active room** with per-reason facts (`BUSY`/`PENDING`/`CLOSED`/`HOLIDAY`/`CAPACITY`/`MISSING_FEATURE`), `pending_overlaps` and `busy_until`; rooms are never filtered out of the response.
20. **New endpoint `GET /directory/users`** (C1-32) for any logged-in user — active users only, `{id, full_name, email, department}`, no mobile/role/status/login metadata. The admin user list is no longer the colleague picker.
21. **Two SPAs kept, release coupling documented** (C1-38). The "independent release rhythm" claim is withdrawn: `apps/web` and `apps/admin` ship in one Caddy image tag, so releases are atomic; shared frontend infrastructure lives once in `packages/ui` / `packages/shared`. One app with lazy `/admin/*` chunks remains a documented, low-cost W1 switch.
22. **Accessibility gate hardened** (C1-35). CI fails on **any** `wcag2a`/`wcag2aa`/`wcag22aa` rule violation regardless of axe impact, waivable only via a dated, reasoned allowlist entry; no page-level horizontal scroll at 320 px / 200 % (labelled scroll containers with a list alternative are fine).

## Amendments (Codex round 2)

> Provenance — read this before matching ids. Two things happened in round 2 and they must not be
> confused:
> - **Codex did emit a round-2 review.** `work/review/codex-r2.md` holds it: a 16-row verification of
>   the round-1 fixes (9 CORRECTLY FIXED · 6 INCOMPLETE · 1 WRONG), findings **C2-01 … C2-12**
>   (1 BLOCKING · 6 HIGH · 5 MEDIUM), answers to our 5 questions, and `VERDICT: REVISE`. The
>   truncated transcript that an earlier pass mistook for the review is `_codex-r2-failed.md`.
> - **We also ran our own in-house consistency pass.** Its findings originally reused the ids
>   `C2-01…C2-09`, which collided with Codex's. They have been renumbered **IR-01 … IR-02** where
>   they are genuinely ours, and folded into the matching `C1-xx`/`C2-xx` id where they were really
>   the same defect. Section files now carry only the corrected tags.
>
> List **A** below is the in-house pass (as re-keyed); list **B** is the Codex round-2 review. Both
> override everything above; where they disagree with each other, **B wins**. Per-finding verdicts:
> `work/review/response-r2.md`.

### A. In-house consistency pass (re-keyed)

1. **AUTO_RELEASED recipient split** (= Codex **C2-02**; closes C1-14) — **supersedes round-1 item 7 / bullet "B. Email
   events"**. `booking.auto_released` → **owner + every attendee who received REQUEST**, payload
   `.ics METHOD:CANCEL`, UID unchanged, `SEQUENCE = bookings.version`; a separate
   `booking.auto_released_admin` → active ADMINs, explanatory, no `.ics`. Round 1 put the owner on
   the explanatory branch, but the owner is the `.ics` **ORGANIZER** — their calendar kept the
   released room. Two payloads under one `template_key` were also unsafe: `notifications_dedupe` is
   `(booking_id, template_key, recipient_email, dedupe_key)`, so an ADMIN who is also owner/attendee
   received one arbitrary variant. Template keys: 10 → 11.
2. **ADR-004 is "in-process scheduler", everywhere** (part of Codex **C2-12**). The appendix (ADR index, glossary,
   versions table, changelog) now matches §05/§06; pg-boss is recorded as a **rejected** option.
   Round-1 item 1 was applied to the body of the spec but not to the ADR index, which is what an
   implementer reads first.
3. **§12.2 gains items 10–12** (**IR-01**): written waiver for deferring Admin drag & drop; written
   acceptance that NFR-5 "delivery > 99 %" means relay accepted ÷ attempted; HR/DPO confirmation of
   the PII inventory and retention table. All three were already cited as prerequisites by §03, §06
   and §09 (two of them citing the same non-existent "item 10"). Owners and W0 deadlines set;
   answers recorded in `docs/decisions/W0-confirmations.md`.
4. **One image-pin string, enforced by CI** (closes **C1-03**; part of Codex **C2-12**). `postgres:18.1-alpine@sha256:<digest>` in
   compose, CI service, local, staging, prod **and** the §12.3 versions table (which said `18.6`),
   plus a CI step that string-compares the CI service image against `infra/compose.yml`. Caddy's pin
   lives in `infra/Dockerfile.static` (`caddy:2.<x>-alpine@sha256:<digest>`), not in compose.
5. **Per-ticket a11y DoD = the §10.7 rule** (closes **C1-35**; part of Codex **C2-12**). §9.2 no longer says "axe ไม่มี serious/critical";
   any `wcag2a`/`wcag2aa`/`wcag22aa` violation fails regardless of impact, waivable only through the
   dated, reasoned `tests/e2e/axe-allowlist.json`.
6. **Outbox suppresses on terminal state, never on version** (**IR-03**). Every queued mail is checked
   before rendering, not just reminders: if the booking is `CANCELLED`/`REJECTED`/`EXPIRED`/
   `AUTO_RELEASED` and the row is not one of the terminal-state templates → `SKIPPED`. This closes
   round 1's open item (a stale "confirmed" arriving after a "cancelled" when the relay was down).
   **`payload.version` is deliberately not compared** — `version` also moves on detail edits, so a
   version check would swallow a still-valid invitation. No lease / `SENDING` state (unchanged).
7. **FK indexes closed as partial indexes** (closes **C1-40**). `bookings_decided_by_idx`,
   `bookings_checked_in_by_idx`, `bookings_cancelled_by_idx`, `users_created_by_idx`, all
   `WHERE … IS NOT NULL` — they exist for the FK check on `DELETE FROM users`, not for any query,
   and partial keeps them nearly free on the insert path. Closes the last open half of C1-40.
8. **Sweep step 3 writes audit** (**IR-02**). CONFIRMED/CHECKED_IN → COMPLETED now returns rows and
   writes `audit_logs` (actor NULL, `booking.complete`) like the EXPIRED and AUTO_RELEASED steps —
   §6.5 already promised "audit เท่านั้น" for that transition.

### B. Codex round-2 review (`work/review/codex-r2.md`, C2-01 … C2-12)

9. **One lock plan for every writer: idempotency → users → rooms** (C2-01, BLOCKING). `mutate()`
   becomes `mutate({ idem?, userIds, userLock?, roomIds }, actor, fn)` and is the **only** door for
   all six slot-mutating operations — create, approve/reject, reschedule, cancel, check-in **and
   user deactivation**. It claims the idempotency key and replays *before* touching any user or
   room, then locks every involved `users` row sorted by id (`FOR SHARE`; deactivate `FOR UPDATE`),
   then every room sorted by `hashtext`. Round 1 left the helper locking rooms *before* `fn()` took
   the user lock, so create could hold room R while waiting for user U exactly as deactivate held U
   and waited for R. It also locked only the owner, so an ADMIN booking on behalf of someone could
   commit after their own account was disabled — `userIds` is now `{actor, owner}`.
10. **`$decision_time = clock_timestamp()` after the locks** (C2-10). `now()` is transaction-start
    stable, so a transaction that begins at 12:59:59 and wins the advisory lock at 13:00:10 would
    still approve a meeting that had already started, and would push check-in / auto-release
    deadlines out by however long it waited. T3–T6 and the deactivation scan take one
    `clock_timestamp()` after all locks and use it for every guard and every timestamp written.
    `booking.sweep` deliberately keeps a single `now()` per run (it takes no advisory lock, and its
    four statements must agree on one instant).
11. **Effective check-in deadline = `LEAST(end_at, start_at + checkin_grace_minutes)`** (C2-03).
    Operational settings are retroactive while `min_duration_minutes` is not, so the round-1 guard
    `grace < min_duration_minutes` did not protect bookings that already existed: a 30-minute
    booking created under min=30, followed by min=60 + grace=45, was COMPLETED by sweep step 3
    before the auto-release deadline arrived and could never become AUTO_RELEASED. The `LEAST()`
    form is now used identically in T6, sweep step 2, `can.check_in` and every prose statement of
    the window; the cross-field settings rule is relaxed to `checkin_grace_minutes` 1–120.
12. **Room policy is read under the room lock** (C2-04). `rooms.active` and `rooms.approval_mode`
    are re-read after the advisory lock and only that value binds; `PATCH /admin/rooms/:id` takes
    the same advisory lock before writing. Validation outside the transaction stays, but only as a
    fast 422 for the user.
13. **Approval carries the client-observed `version`** (C2-05). `POST /admin/bookings/:id/approve`
    takes `{version, note?}` and confirms under `WHERE … AND version=$expected` → `409
    VERSION_CONFLICT`. The server-side re-read catches millisecond races, not the two minutes an
    admin spends reading an agenda while the owner edits the title, attendees or privacy.
14. **Set-password tokens live in our own table** (C2-06) — **supersedes D-29's storage choice**.
    New `password_setup_tokens (id, user_id, token_hash UNIQUE, purpose INVITE|RESET|FORGOT,
    expires_at, used_at, created_by)`. Better Auth's documented surface has one global reset expiry
    and hands the callback a token/URL, so it cannot express our 7-day invite vs 24-hour reset TTLs
    and cannot guarantee that the token's row id is available to write `notifications.dedupe_key` in
    the same transaction as the token. ~15 lines of DDL removes a library-behaviour dependency and
    makes the outbox atomicity explicit; only `sha256(token)` is stored. `verifications` stays as a
    Better Auth-owned table we do not use for this flow.
15. **Deactivation cancels every not-yet-started booking** (C2-11) — **amends D-27**. The scan now
    covers `PENDING_APPROVAL`, `CONFIRMED` **and `CHECKED_IN`** where `start_at > $decision_time`
    (someone can self-check-in at T−10 and be disabled at T−5, and that booking was holding the
    room). Meetings already in progress are never cancelled automatically.
16. **Settings are replaced under `If-Match`** (C2-08) — **amends the round-1 C1-33 position**.
    `GET /settings` returns an `ETag` over canonical settings JSON; `PUT /admin/settings` requires
    `If-Match`, holds `pg_advisory_xact_lock(hashtext('settings'))`, and 409s on mismatch. The
    failure needs no simultaneous saves: A leaves the form open, B changes grace, A saves reminder
    and silently restores the old grace — on live meetings. The room-policy impact preview also
    pages to the current `max_advance_days`, not a hard-coded 30 days.
17. **Utilization denominator starts at `rooms.created_at`** (C2-09). The prose promised it; the SQL
    cross-joined every room with every report day. `room_hours` now carries `created_at`, each
    window is built with `GREATEST(open_timestamp, room.created_at)`, and empty windows are dropped.
18. **Production data never reaches UAT staging; the scrub is complete** (C2-07). Release gate 3
    migrates the latest production dump inside the isolated `rf-drill` project, not staging. The
    24-month free-text scrub fires when **any** retained free-text column is still populated (round
    1 keyed it on `description` alone, so title / special-request / reason could survive forever).
    `infra/scrub-drill.sql` additionally deletes `booking_attendees` and `password_setup_tokens`,
    clears `bookings.reason`, and ends with an in-transaction canary assertion — known production
    emails/names must return zero rows or the whole transaction rolls back.
19. **`Idempotency-Key` binds to a submit press, not to a payload** (C1-08, half declined). The
    lock-ordering half is closed under item 9. The `request_hash` half is **not** adopted: no
    `request_hash` column, no `IDEMPOTENCY_KEY_REUSED`, and the same key returns the original
    booking whatever the payload. A canonical-JSON hash has to serialise byte-for-byte identically
    in browser and server forever; drift in key order, timestamp normalisation or attendee sorting
    converts an ordinary network retry into a hard 409 that blocks a legitimate booking, which is
    worse than the client bug it detects for a single first-party client that mints a fresh UUID per
    submit. Revisit if a second client appears.
20. **Authority pass** (C2-12). One statement per rule, everything else cross-references it:
    FACILITY is denied general booking search/history in the §7.5 matrix as well as §7.3.4; check-in
    role precedence (membership beats role — an ADMIN who owns or attends records `SELF`) is owned
    by §7.3.5 and referenced from §03, §04 and §06; `min_duration` → `min_duration_minutes`
    everywhere; `/api/rooms` → `/api/v1/rooms`; `reserve@` → `noreply@`; W8 is go-live/hypercare in
    every heading; weekly capacity is expressed as workload with W0 stated as outside the eight-week
    target.
