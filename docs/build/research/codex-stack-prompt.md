# Context: ReserveFlow project brief

# ReserveFlow — shared brief for all agents

## What we are doing
The user (a tech lead) built a v1 product spec for a **meeting-room booking system** for
"บริษัท อุ๊ยรวยไม่จำกัด (Uiruai Mai Jamkad)". We are producing **v2**: a reviewed & improved spec
with a DECIDED tech stack, an implementation plan, and a monorepo folder structure —
delivered as ONE self-contained HTML file (Thai-first, English technical terms OK, same
bilingual tone as v1).

The system has 4 deliverables:
1. Employee web app (search rooms, book, my bookings, check-in)
2. Admin web app (approvals, manage rooms, **manage users: add / remove / deactivate / roles**, reports, settings)
3. Backend service (REST API + background jobs)
4. Database (PostgreSQL)

## Facts from the slides/images
- 8 teams; 3 rooms; users must **Login** before booking; website bookable **24h**; rooms open **08:30–17:30**; min booking **1 hour**; max **1 month** ahead; no overlapping bookings (system checks & prevents); if simultaneous bookings → Admin decides which meeting agenda is more important; edit/cancel returns slot immediately; no check-in within 15 min → auto-release.
- FR-001..FR-012 (MoSCoW), FR-009 = email notifications (Must).
- Check-in via admin at the room AND via QR self check-in (both modes).
- Admin has "Webboard" (announcements) — optional/unclear.
- UI reference: Login page with Employee ID + Mobile number + Password, "Remember me", self-registration link; "Available Rooms" page with room cards; Room detail page with month calendar date picker, time-slot list, start/end dropdowns. Left nav: Dashboard, Room Search, My Bookings, Schedule, Settings; "Quick Book" button.

## Scale & constraints
- ~80 employees, 3 rooms, 1 company, 1 timezone (Asia/Bangkok). Internal tool. Tiny load.
- Hard requirements: no double booking (DB-level guarantee), private meetings masked, email (+.ics), approval modes per room, auto-release job, utilization report, calendar p95 ≤ 2s, WCAG-ish accessibility, drag&drop reschedule for admin (Should).
- Small team (1–3 devs), ~6–8 week MVP. TypeScript end-to-end is the expected language.
- Tech lead's taste: lazy-but-correct: fewest moving parts, native/DB features before app code, no speculative abstractions, but never skimp on trust boundaries (validation, authz, idempotency, audit).

## Orchestrator's current leanings (challenge them if you have a better argument — give reasons)
- Monorepo (pnpm workspaces + Turborepo): apps/web (employee), apps/admin, apps/api, packages/db (Drizzle schema + migrations), packages/shared (zod schemas/types/constants), packages/ui (shared components), packages/email (templates), infra/ (docker-compose, CI).
- PostgreSQL 16 + btree_gist EXCLUDE constraint on (room_id, tstzrange) for status IN (CONFIRMED, CHECKED_IN). Pending requests in manual rooms may overlap each other; approve = transaction that flips status and lets the constraint reject losers.
- Jobs via pg-boss (Postgres-backed queue) instead of Redis/BullMQ at this scale.
- Auth: admin-provisioned accounts (no self-registration in prod), email/employee-code + password, httpOnly session cookie; mobile number stored for contact/recovery only. SSO later.
- Still open for the stack agents: Next.js vs Vite SPA for the two front-ends; NestJS vs Hono vs Fastify for the API; better-auth vs hand-rolled sessions; UI kit; calendar component; email provider; deploy target.

## Requirements doc summary
Official requirement PDF (from company slides): defines FR-001..FR-012 with MoSCoW priorities, 6 non-functional requirements (NFRs), user stories US-001..US-008, and a sample requirements traceability matrix (RTM). Covers: room search/booking, conflict/double-booking prevention, approval workflow (auto vs manual per room), check-in (admin-assisted and QR self check-in) with 15-min auto-release, email notifications (FR-009, Must-have, includes .ics calendar attachments), admin room/user management, utilization reporting, and accessibility/performance NFRs (calendar load p95 ≤ 2s, WCAG-ish).

---

# Task

You are a staff engineer. Decide ONE production tech stack (no hedging) for the 4 deliverables, justify each pick in 2–4 lines with runner-up and why it lost. Cover: monorepo tooling; frontend framework/routing for the two web apps (separate apps vs one app with role areas — argue it); UI kit/styling; forms/validation; data fetching; calendar + drag&drop component; date/time + timezone; API framework; API style (REST/tRPC/GraphQL); typed client/OpenAPI; ORM+migrations; auth (library vs hand-rolled, cookie vs JWT, hashing); authz pattern; background jobs (pg-boss vs BullMQ/Redis vs cron); email provider+templating+.ics lib; QR lib; image storage; testing (unit/integration/e2e/concurrency load); lint/format; CI/CD; containerization + cheapest sane deploy for an internal tool + one managed-cloud option; observability; backups. List concrete package versions you believe current (mark 'verify'). State 3 biggest risks + mitigations. Also give a recommended monorepo folder tree (apps/*, packages/*) with one-line purpose per folder. Output markdown.
