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

## Inputs (read what you need — absolute paths)
- `inputs/spec.html`  — v1 spec (107 KB, Thai). Plain-text dump: `inputs/spec.txt` (27 KB). Sections split: `work/v1-sections/{overview,plan,spec,flow,tech,data,mockups,qa,questions}.html`. v1 CSS: `work/v1.css`, JS: `work/v1.js`, class list: `work/v1-classes.txt`.
- `inputs/requirements.txt` — official requirement PDF (FR-001..FR-012 w/ MoSCoW, 6 NFR, US-001..US-008, sample RTM).
- `inputs/company.txt` — company presentation (8 teams × 10 people = ~80 users, 3 rooms; employee/admin scope; booking workflow; conflict check example; check-in & auto-release; dashboard/report).
All under: `/private/tmp/claude-501/-Users-peach-Documents-popo-reserve-flow/81c96fd6-5640-4a8a-8307-511a52ef8926/scratchpad/`

## Facts from the slides/images (not in the text files)
- Business requirement slide: 8 teams; 3 rooms; users must **Login** before booking; website bookable **24h**; rooms open **08:30–17:30**; min booking **1 hour**; max **1 month** ahead; no overlapping bookings (system checks & prevents); **if simultaneous bookings → Admin decides which meeting agenda is more important**; edit/cancel returns slot immediately; **no check-in within 15 min → auto-release**.
- Functional requirement slide shows FR-001..FR-012 but **skips FR-009** (email notifications) — the PDF has it as Must.
- Company PDF says check-in is "ผ่านแอดมินหน้าห้อง" (via admin at the room) while FR-010 says "e.g. via QR" → both modes should exist (admin/kiosk check-in + QR self check-in).
- Company PDF lists Admin "ดู Webboard" (a web board / announcements) — unclear; treat as optional/clarify.
- Stitch UI reference photos (product named VenueFlow / ReserveFlow, pastel green): Login page with **Employee ID + Mobile number + Password**, "Remember me", "ยังไม่มีบัญชี? ลงทะเบียน"; "Available Rooms" page with 3 cards (Horizon Room – Executive Boardroom 4th floor, Summit Room – Creative Space 5th floor, Grove Room – Garden Wing 2nd floor; capacity 20, projector 1; "Select Room"); Room detail page (Horizon Room: photo, capacity 20, 1 projector + A/V, month calendar date picker, time-slot list with occupied slots in red e.g. "13:00–14:00", start/end dropdown 08:30 / 17:30, "min 1 hour", CTA). Left nav: Dashboard, Room Search, My Bookings, Schedule, Settings; "Quick Book" button.

## Scale & constraints (use these to size decisions)
- ~80 employees, 3 rooms, 1 company, 1 timezone (Asia/Bangkok). Internal tool. Tiny load.
- Hard requirements: **no double booking** (DB-level guarantee), private meetings masked, email (+.ics), approval modes per room, auto-release job, utilization report, calendar p95 ≤ 2s, WCAG-ish accessibility, drag&drop reschedule for admin (Should).
- Small team (1–3 devs), ~6–8 week MVP. TypeScript end-to-end is the expected language.
- Tech lead's taste: lazy-but-correct ("ponytail"): fewest moving parts, native/DB features before app code, no speculative abstractions, but never skimp on trust boundaries (validation, authz, idempotency, audit).

## Orchestrator's current leanings (challenge them if you have a better argument — give reasons)
- Monorepo (pnpm workspaces + Turborepo): `apps/web` (employee), `apps/admin`, `apps/api`, `packages/db` (Drizzle schema + migrations), `packages/shared` (zod schemas/types/constants), `packages/ui` (shared components), `packages/email` (templates), `infra/` (docker-compose, CI).
- PostgreSQL 16 + `btree_gist` EXCLUDE constraint on (room_id, tstzrange) for status IN (CONFIRMED, CHECKED_IN). Pending requests in manual rooms may overlap each other; approve = transaction that flips status and lets the constraint reject losers.
- Jobs via **pg-boss** (Postgres-backed queue) instead of Redis/BullMQ at this scale.
- Auth: admin-provisioned accounts (no self-registration in prod), employee code + password only, httpOnly session cookie; email is internal account/notification data and mobile is optional contact/recovery data. SSO later.
- Still open for the stack agents: Next.js vs Vite SPA for the two front-ends; NestJS vs Hono vs Fastify for the API; better-auth vs hand-rolled sessions; UI kit; calendar component; email provider; deploy target.

## Output discipline
- Return concise, decision-ready conclusions. No padding. Cite the input file/line when you flag a gap.
- Write any long artifacts to files under `work/research/` (you'll be told the filename) and return a short summary + the path.
