# ReserveFlow — Production Tech Stack Decision (Stack A)

Staff-engineer pick, one stack, no menus. Versions checked live against the npm registry / Docker Hub / nodejs.org on **2026-08-23**. Sizing assumptions: ~80 users, 3 rooms, 1 timezone (Asia/Bangkok, **no DST, fixed UTC+7**), 1–3 devs, 6–8 weeks, internal tool behind login.

The single sentence that drives every choice: **this is a 30-bookings-per-day CRUD app whose only genuinely hard requirement is a correctness guarantee that Postgres already implements.** Everything else should be boring, few-moving-parts, and cheap to operate by a team that will not have an on-call rotation.

---

## 0. The stack at a glance

| Layer | Decision |
|---|---|
| Repo | pnpm workspaces + Turborepo, **5 workspace entries** (not 8) |
| Frontends | **2 separate Vite + React SPAs**, served from **one origin** (`/` and `/admin`) |
| Routing | TanStack Router (typed, Zod-validated search params) |
| UI | Tailwind CSS v4 + shadcn/ui (Radix primitives) in `packages/ui` |
| Forms | React Hook Form + Zod resolver, schemas shared with the API |
| Server state | TanStack Query; URL is the state store for calendar filters. No Redux/Zustand |
| Calendar | **Hand-rolled CSS-grid day board** (3 rooms × 08:30–17:30) + `@dnd-kit` for admin drag&drop. No calendar library |
| Date/time | date-fns v4 + `@date-fns/tz`; `timestamptz` in DB; one `APP_TZ` constant |
| API | **Hono** on Node (`@hono/node-server`) |
| API style | **REST**, OpenAPI 3.1 generated from the same Zod schemas (`@hono/zod-openapi`) |
| Typed client | `hono/client` (`hc`) type-only import — zero codegen; `openapi.json` committed as the contract artifact |
| DB | **PostgreSQL 18** + `btree_gist` EXCLUDE constraint |
| ORM | Drizzle ORM + drizzle-kit migrations (hand-written SQL for the constraints) |
| Auth | **better-auth** (email/employee-code + password, DB sessions, httpOnly cookie, admin plugin) |
| Authz | One `can()` module + one `toViewerBooking()` masking serializer. No CASL, no RLS |
| Jobs | **pg-boss** in the same Postgres, worker in the same Node process |
| Email | **Nodemailer over SMTP** + `email_outbox` table; react-email for templates; `ical-generator` for .ics |
| QR | `qrcode`, 3 static printable room signs — generated once, not per booking |
| Files | Local volume + `sharp` resize. S3/R2 only if the host has an ephemeral FS |
| Charts | HTML `<table>` + CSS/SVG bars. No chart library for MVP |
| Testing | Vitest, Playwright + axe, Postgres service container, `autocannon` for the p95 gate |
| Lint/format | **Biome** (one binary, replaces ESLint + Prettier + 6 plugins) |
| CI/CD | GitHub Actions → GHCR → `docker compose pull && up -d` over SSH |
| Deploy | **1 VM, 3 containers** (Caddy / api / postgres), ~$5–15/mo. Managed option: Fly.io (SIN) |
| Observability | pino JSON logs + Sentry (browser + node) + uptime ping on `/healthz` |
| Backups | nightly `pg_dump -Fc` → R2, 30d + 6 monthly, weekly automated restore check |

---

## 1. Monorepo tooling

**Pick: pnpm 11 workspaces + Turborepo 2.10.**
pnpm's strict node_modules stops `apps/web` from accidentally importing a server-only dep, which is the one real hazard of a TS monorepo. Turbo is one devDep + a 20-line `turbo.json` and pays for itself the first week via `--filter` and CI task caching (lint/typecheck/build skip unchanged packages).
*Runner-up: plain pnpm workspaces with root npm scripts* — completely viable at this size; lost only because CI minutes and `--filter` ergonomics are worth one dependency. *Also considered and rejected:* Nx (machinery for 20-dev orgs), Bun workspaces (native-module risk with `pg`/`sharp` for zero benefit here).

### Challenge to the orchestrator's layout: collapse 8 packages to 5

The proposed `packages/db` and `packages/email` each have exactly one consumer (`apps/api`). A package with one consumer is an abstraction with one implementation — the thing we said we wouldn't build.

```
reserve-flow/
├─ apps/
│  ├─ web/            # employee SPA   (Vite + React)
│  ├─ admin/          # admin SPA      (Vite + React)
│  └─ api/            # Hono API + pg-boss worker (same process)
│     ├─ drizzle/     # SQL migrations (incl. hand-written constraint DDL)
│     └─ src/{routes,services,db,jobs,email,auth}/
├─ packages/
│  ├─ shared/         # zod schemas, DTO types, constants, can(), tz helpers  (deps: zod, date-fns only)
│  └─ ui/             # design tokens + shared React components (calendar grid, buttons, forms)
└─ infra/             # docker-compose.yml, Caddyfile, backup.sh, .env.example
```

`packages/shared` is the contract seam that matters: the *same* Zod object validates the form in the browser, the request body in Hono, and generates the OpenAPI schema. Keep it dependency-light so both SPAs and the API can import it without dragging in server code. Split `db`/`email` out later *if* a second service ever needs them — that's a 20-minute refactor, not an upfront tax.

---

## 2. Two web apps or one app with role-based areas?

**Pick: two separate Vite builds, deployed behind one origin** (`https://booking.company.co.th/` = employee, `/admin/` = admin), sharing `packages/ui` and `packages/shared`.

Arguments for the split, strongest first:

1. **The admin bundle never reaches an employee's browser.** The server is still the authz boundary — but shipping user-management, approval, report and settings code to 80 employees' laptops is free attack surface and free reconnaissance ("view source, find `/api/admin/users`"). Two builds delete the entire class of "hidden route in the JS bundle" finding at zero ongoing cost.
2. **The two surfaces genuinely differ.** Employee = mobile-first, 5 screens, thumb-reachable booking flow, QR check-in. Admin = desktop-dense tables, drag&drop calendar, report charts, bulk actions. Different nav, different information density, different libraries (`@dnd-kit` and the report code exist *only* in admin — the employee bundle stays small, which is what actually protects the p95 ≤ 2s target on office wifi).
3. **The deliverable list names two web apps.** The RTM, the demo script and the marking scheme map 1:1 to two apps. Free clarity.
4. **Independent deploy and blast radius.** Breaking the admin calendar at 16:00 doesn't stop anyone from booking a room.

Cost of the split, and how it's paid: one extra `vite.config.ts` and one extra router tree. **Not** an extra auth flow, **not** CORS, **not** cookie problems — because both builds sit behind the same Caddy on the same origin, so one `Secure; HttpOnly; SameSite=Lax` session cookie covers both, and `/api/*` is same-origin for both. That single deployment decision removes ~90% of the usual "two SPAs" pain.

*Runner-up: one app with role-gated routes* — fewer files, one build. It lost because the only thing it saves is a config file, while it permanently couples two products with different release rhythms and leaks the admin surface into every employee's browser. *Also rejected:* one app with lazy-loaded admin chunk — the chunk is still enumerable and you still get one deploy unit; all of the downside, half of the upside.

---

## 3. Frontend framework

**Pick: Vite 8 + React 19, two static SPAs.**
The API must exist as a standalone long-running service anyway (pg-boss worker, cron sweeps, SMTP) — so Next.js would be a *second* runtime to build, containerize, monitor and keep alive for zero benefit: there is no SEO (login-gated internal tool), no public first-paint pressure, and no data-fetch pattern that RSC makes meaningfully simpler once the data lives behind an external API. A Vite SPA compiles to hashed static files that Caddy serves with brotli; the deploy artifact is a folder.
*Runner-up: Next.js 16 App Router* — better if the API lived inside Next as route handlers. But then background jobs need a separate worker process anyway, and you've split the backend across two codebases. It also loses on cookie/auth forwarding gymnastics (RSC fetch → external API → cookie propagation) that buy nothing here. *Rejected:* Remix/React Router framework mode (same SSR tax), Astro (content-site tool).

**Routing: TanStack Router 1.x.**
The whole app's state is `?date=2026-09-14&room=grove&view=day`. TanStack Router validates search params with a Zod schema and gives you `useSearch()` fully typed — meaning shareable/bookmarkable calendar URLs, working back button, and no `useState` mirror of URL state that drifts. It also has first-class TanStack Query integration and typed `Link` (a typo in a route path is a compile error).
*Runner-up: React Router 8* — more devs know it, and it is a perfectly fine choice. It lost on search-param typing, which is the exact thing this app needs most. **Decision rule:** if nobody on the team has touched TanStack Router and week-1 velocity is the binding constraint, swap to React Router 8 and hand-roll a `useCalendarSearch()` Zod wrapper — the rest of the stack is unaffected.

---

## 4. UI kit + styling

**Pick: Tailwind CSS v4 + shadcn/ui (Radix primitives), both consumed from `packages/ui`.**
Tailwind v4 config lives in CSS (`@theme`), so the pastel-green Stitch palette becomes ~15 CSS custom properties shared by both apps with no JS config file. shadcn/ui isn't a dependency — it's copy-in components over Radix, so you own the markup, which is what lets you actually hit the a11y requirements (real `<label>`s, focus management, `aria-*` on the dialogs) instead of fighting a vendor's DOM.
*Runner-up: Mantine 9* — batteries included (DatePicker, Table, Notifications) and would save maybe 3 days. Lost because the mockups are a custom pastel design system and Mantine's opinionated theme fights that, and because owning the markup matters for WCAG here. *Rejected:* MUI (weight + visual mismatch), Chakra (same trade as Mantine, smaller ecosystem).

**Thai typography — do not skip this, it is a real defect source:**
- Ship a Thai-capable variable font (Noto Sans Thai / IBM Plex Sans Thai / LINE Seed Sans TH), subset and self-hosted (`font-display: swap`, preloaded). No Google Fonts CDN call on an internal network.
- **`line-height: 1.6` minimum** on all body text. Thai stacks vowels above and tone marks above those; the default 1.2–1.4 clips them. This is the #1 visual bug in Thai web apps.
- Thai has no inter-word spaces: set `overflow-wrap: break-word` + `line-break: loose` on meeting-title cells, and never rely on word-boundary truncation.
- Test at 200% browser zoom (WCAG 1.4.4) — the calendar grid must reflow, not scroll horizontally.

---

## 5. Forms / validation

**Pick: React Hook Form 7 + `@hookform/resolvers` + Zod 4, schemas imported from `packages/shared`.**
One schema object per operation (`createBookingSchema`) drives: client-side field errors, the Hono request validator, and the generated OpenAPI body schema. Uncontrolled inputs mean the booking form doesn't re-render on every keystroke — irrelevant for perf here, relevant for how little code you write.
*Runner-up: TanStack Form* — nicer inference, but younger, fewer answers when a junior dev gets stuck at 22:00 in week 5. *Rejected:* Formik (unmaintained-ish), raw `<form>` + FormData (fine for the login form, not for the booking form with conditional attendee/private/recurrence fields).

---

## 6. Data fetching / state

**Pick: TanStack Query 5 + URL search params. No global state library.**
Everything on screen is server state (rooms, availability, my bookings, pending approvals). Query gives caching, `staleTime`, background refetch on window focus (important: an admin approving from a stale list), and `invalidateQueries` after a mutation. The only client state is "is this dialog open", which is `useState`.
Set `refetchOnWindowFocus: true` and a 30s `staleTime` on the availability query so a user who tabs back doesn't book a slot that vanished 10 minutes ago.
*Runner-up: Zustand* — would be added for zero reasons; there is no cross-tree client state here. *Rejected:* Redux Toolkit / RTK Query (ceremony), SWR (fine, but Query's mutation + invalidation ergonomics are better and it pairs with TanStack Router).

---

## 7. Calendar + drag & drop

**Pick: hand-rolled CSS-grid day board + `@dnd-kit/core` (admin only). No calendar library.**

The "calendar" in this product is a fixed grid: **3 columns (rooms) × 08:30–17:30 in 15-minute rows = 36 rows**. That is `grid-template-rows: repeat(36, 1fr)` and absolutely-positioned booking blocks computed from `(start - 08:30)/15min`. ~250 lines, total control over Thai labels, contrast, focus order, and the `role="grid"` semantics the a11y NFR needs. Every calendar library on the market is a bigger fight to bend than to write, and the two features libraries genuinely give you (recurring events, timezone-shifting resources) are not in scope.

Concretely, the libraries lose on specifics:
- **FullCalendar 7** — the view you actually want (rooms as columns = *resource* views) is **Premium/paid**, and its drag is pointer-only, failing WCAG 2.2 SC 2.5.7. Lost on license + a11y.
- **Schedule-X 4** — resource scheduler is also a paid tier. Lost the same way.
- **react-big-calendar** — free, has a `resources` prop and a DnD addon. Lost on dated styling you'd override anyway, weak keyboard support, and a moment/date-fns localizer layer you'd be debugging in week 3.

**`@dnd-kit` for the admin reschedule** because it ships a `KeyboardSensor` and live-region screen-reader announcements out of the box — that's the WCAG 2.2 **SC 2.5.7 (Dragging Movements, AA)** obligation half-solved. The other half is mandatory regardless of library: **every drag&drop reschedule must also be doable from a plain "แก้ไขเวลา" dialog with start/end selects.** Build the dialog first, wire drag&drop to call the same mutation.

**Month picker:** native `<input type="date">` on mobile (free OS picker, free a11y, free Thai locale), `react-day-picker` v10 on desktop if a month-occupancy heatmap is wanted. Do not build a month grid by hand.

---

## 8. Date/time library + timezone strategy

**Pick: date-fns 4 + `@date-fns/tz`, with a single `APP_TZ = 'Asia/Bangkok'` constant in `packages/shared`.**
Tree-shakeable, no global mutation, and v4's `TZDate` handles the few genuine zone conversions (rendering a UTC instant as Bangkok wall-clock). date-fns also gives you Thai locale for month/day names.
*Runner-up: Luxon* — best zone API in JS, but 70 kB for a problem that is one fixed offset. *Rejected:* Temporal via `temporal-polyfill` (correct future, but a polyfill for a stage-3 API in a 6-week MVP is gratuitous risk); Day.js (plugin soup); moment (dead).

**Strategy — the important part, not the library:**
1. Postgres columns are `timestamptz`. Store instants. Never store naive local time.
2. The wire format is ISO-8601 with offset (`2026-09-14T13:00:00+07:00`). Both SPAs render in `APP_TZ`, not in the browser's zone — an employee on a laptop still set to UTC must see 13:00, not 06:00.
3. **Thailand has had no DST since 1955 and is a fixed UTC+7.** Exploit it: `(start_at + interval '7 hours')::time` is an IMMUTABLE expression, so business hours are enforceable as a real CHECK constraint (see §12). Add a comment in the migration stating the assumption, so whoever adds a second country drops it deliberately.
4. All range math is half-open `[start, end)` — 13:00–14:00 and 14:00–15:00 do not overlap. This must be identical in the DB (`tstzrange(start_at, end_at, '[)')`), the app validators, and the UI grid, or you get a bug class nobody can reproduce.
5. **The .ics must carry `TZID=Asia/Bangkok` with an embedded VTIMEZONE**, not floating time — Outlook in another region will otherwise place the meeting wrong. `ical-generator` does this if you set the timezone and supply the VTIMEZONE generator.

---

## 9. API framework

**Pick: Hono 4.13 on Node 24 LTS via `@hono/node-server`.**
Web-standard `Request`/`Response`, ~14 kB, and the best TypeScript inference of the three. The decisive feature is `@hono/zod-openapi`: one `createRoute()` declaration gives you request validation, response typing, and the OpenAPI 3.1 document from the *same* Zod schema you already wrote for the form. No schema written twice, no drift.
*Runner-up: Fastify 5* — more mature, better plugin ecosystem (multipart, rate-limit, graceful shutdown are all first-party), and I'd pick it for a 5-service backend. It lost because its OpenAPI story needs JSON Schema (so Zod → JSON Schema conversion, or schemas written twice) and its type inference across routes is weaker; here the typed contract *is* the productivity story.
*Rejected: NestJS* — decorators, modules, DI containers and ~1500 lines of scaffolding for 30 endpoints and 2 devs. The v1 spec proposed it for the "scale-ready" column; there is no scale to be ready for at 80 users, and it would eat a week of the 6–8.

Verified compatibility: `@hono/zod-openapi@1.6.1` peers are `zod ^4.0.0` and `hono >=4.10.0` — matches `hono@4.13.3` + `zod@4.4.3`.

---

## 10. API style: REST vs tRPC vs GraphQL

**Pick: REST, resource-shaped, OpenAPI 3.1 generated from Zod.**

- **vs tRPC:** tRPC's win is end-to-end types with no codegen — but `hono/client` already gives that in a monorepo, *and* leaves an inspectable HTTP contract. This project has non-browser consumers: the QR check-in kiosk page, the CSV export, a future Entra SSO integration, and — practically — the graders/reviewers who want to see an API contract. tRPC gives you an RPC blob over POST that you can't `curl`, can't document with Scalar, and can't hand to anyone outside the repo.
- **vs GraphQL:** there is no over-fetching problem (3 rooms), no client-shape diversity (2 first-party apps), and it would import an authorization surface (field-level authz for private-meeting masking) and an N+1 problem you'd then need DataLoader to solve. Strictly negative.
- **REST specifics:** `GET /api/availability?from&to&roomId`, `POST /api/bookings` (with `Idempotency-Key`), `PATCH /api/bookings/:id`, `POST /api/bookings/:id/cancel`, `POST /api/bookings/:id/check-in`, `POST /api/admin/bookings/:id/approve|reject`, `GET /api/admin/reports/utilization?from&to&format=json|csv`. Conflicts return **409** with a machine-readable body `{ code: 'SLOT_TAKEN', conflictingRange }` so the UI can highlight the offending block.

**Typed client:** `hc<AppType>` from `hono/client`, with `AppType` imported **type-only** so no server code enters the browser bundle. Additionally, CI regenerates `openapi.json` and fails if it differs from the committed copy — that file *is* the API deliverable.
*Contingency (and the mitigation for risk #2):* if editor/tsc performance degrades from RPC inference, swap the client to `openapi-typescript` + `openapi-fetch` against the same committed `openapi.json`. Same DX, codegen step, no server-type import. It's a half-day swap, and the OpenAPI doc that makes it possible already exists.

---

## 11. ORM + migrations

**Pick: Drizzle ORM 0.45 + drizzle-kit 0.31, with hand-written SQL for the constraint DDL.**
Drizzle is a typed SQL builder, not an abstraction over SQL — which matters because the two most important pieces of this system (the EXCLUDE constraint and the utilization report's `generate_series` + `tstzrange` intersection query) are pure SQL that Drizzle lets you write with `sql\`\`` and still type. No query engine binary, no generate step in Docker, ~7 MB.
*Runner-up: Prisma* — nicer CRUD DX and better docs, but you'd be running `migrate --create-only` and hand-editing the SQL for the exclusion constraint anyway, its client is heavier in the image, and its raw-query escape hatch is less typed. Lost on the exact thing this project needs. *Runner-up 2: Kysely* — arguably the best SQL types in TS, but you hand-write every migration and lose schema-derived model types; Drizzle gives you both.
*Verified:* `better-auth@1.7.1` declares peer `drizzle-orm ^0.45.2` — exactly our version. **Pin `0.45.2` exactly**; Drizzle has a `1.0.0-rc.4` in flight, so plan the major upgrade as post-MVP work, not mid-sprint.

**Migrations:** `apps/api/drizzle/*.sql`, applied as an explicit CI/deploy step (`drizzle-kit migrate`) *before* `docker compose up -d` — never on app boot, which races if you ever run two replicas. Custom SQL migrations carry `CREATE EXTENSION btree_gist`, the generated `slot` column, the EXCLUDE constraint, and the CHECK constraints. `drizzle-zod` derives base Zod schemas from the table definitions where useful, but the request schemas in `packages/shared` are hand-written (request shape ≠ table shape).

---

## 12. The no-double-booking guarantee (the one thing that must be right)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD COLUMN slot tstzrange
  GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED;

-- The guarantee. Not app code. Not SELECT-then-INSERT. Not an advisory lock.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (room_id WITH =, slot WITH &&)
  WHERE (status IN ('CONFIRMED','CHECKED_IN'));

-- Business rules the DB can hold, because Asia/Bangkok is a fixed UTC+7 with no DST.
-- If this system ever serves a second country, DROP these and move them to app code.
ALTER TABLE bookings ADD CONSTRAINT bookings_business_hours CHECK (
      (start_at + interval '7 hours')::time >= '08:30'
  AND (end_at   + interval '7 hours')::time <= '17:30'
  AND (start_at + interval '7 hours')::date = (end_at + interval '7 hours')::date
  AND end_at > start_at
  AND end_at - start_at >= interval '1 hour'   -- FR: minimum 1 hour
);
```

Non-negotiable application rules that ride on top:

1. **One funnel.** Exactly one function — `applySlotChange(tx, bookingId|new, room, range, actor)` — performs every write that touches `(room_id, slot, status)`. Create, employee edit, cancel-and-rebook, admin approve, and admin drag&drop reschedule all call it. Anything that bypasses it can bypass the guarantee's error handling. Grep for direct `update(bookings).set({startAt` in code review.
2. **Catch SQLSTATE `23P01`** (`exclusion_violation`) and map it to `409 SLOT_TAKEN`. Never pre-check with a `SELECT` and then insert — that's the race the whole design exists to eliminate. A pre-check `SELECT` is allowed *only* to render a friendlier form; the INSERT is still the arbiter.
3. **Approval flow:** overlapping `PENDING_APPROVAL` rows are legal (that's the whole point — the slides say the admin picks which agenda matters more). `approve` is a transaction that flips status to `CONFIRMED`; if the constraint rejects it, the loser gets a 409 and the UI says "another request for this slot was already approved" and offers to reject it. This is *exactly* the behaviour the business requirement asks for, and it costs zero extra code.
4. **`Idempotency-Key` header on `POST /bookings`**, stored in a `request_idempotency(key, user_id, response_json, created_at)` table with a unique index. Double-click, flaky office wifi retry, and the browser's auto-retry all become one booking.
5. **Audit table** append-only: `(id, actor_id, action, booking_id, before_json, after_json, at)`, written inside the same transaction. Required for the "admin decided" workflow to be defensible.

---

## 13. Auth

**Pick: better-auth 1.7 (pinned exactly), Drizzle adapter, DB sessions in an httpOnly cookie.**
Reasons in order of weight: (a) its **admin plugin** delivers a whole FR area for free — create/list users, set role, ban/deactivate (which revokes sessions), impersonate for support; (b) DB-backed sessions mean deactivating an employee kills their access *immediately*, which is the actual requirement, not "within 15 minutes when the JWT expires"; (c) built-in rate limiting and origin/CSRF checks on auth endpoints; (d) an OIDC path already exists for the future Microsoft Entra SSO, so the migration is config, not a rewrite.
*Runner-up: hand-rolled sessions* (~200 lines: `argon2`/`scrypt` hash, `sessions` table, cookie, CSRF). Genuinely tempting and I'd accept it — it lost because the 200 lines becomes ~800 once you add password reset, lockout after N failures, session listing/revocation, and then SSO, and each of those is a place to get security subtly wrong. *Rejected: Lucia* (the library was discontinued in favour of a learning resource), *NextAuth/Auth.js* (Next-shaped, awkward outside it), *Keycloak* (an entire extra service for 80 users).

Concrete configuration:
- `emailAndPassword: { enabled: true }`, **`disableSignUp: true`** — accounts are admin-provisioned. (The Stitch mockup shows "ยังไม่มีบัญชี? ลงทะเบียน"; that link should be removed or point to "contact your admin". Flag to the spec owner.)
- Login identifier: **employee code** (via the username plugin) or corporate email — pick one. The mockup's three-field login (Employee ID + Mobile + Password) is unusual; mobile belongs on the profile for contact/recovery, not as a login factor. Flag it.
- **Cookie, not JWT.** `HttpOnly; Secure; SameSite=Lax; Path=/`, 8-hour rolling expiry, same-origin so both SPAs share it and there is no CORS or third-party-cookie exposure. JWT loses on the one requirement that matters: instant revocation.
- **Password hashing: better-auth's default scrypt** (Node `crypto`, no native module in the image). OWASP-acceptable. Swap to argon2id via `@node-rs/argon2` only if a security review demands it — that's a config change, not a redesign. Enforce a minimum length of 12 and check against a small common-password list; do not impose rotating complexity rules (NIST 800-63B).

---

## 14. Authorization pattern

**Pick: a single `can(actor, action, resource)` function in `packages/shared`, enforced in the API service layer, plus one masking serializer.**

Three roles only: `EMPLOYEE`, `ADMIN`, and optionally `FACILITY` (read-only day sheet for the cleaning/break staff named in the stakeholder table). At that size a policy DSL is pure overhead.

The part that must be structural, not conventional:

```ts
// ONE function. Every read path that returns a booking goes through it.
export function toViewerBooking(b: Booking, viewer: Actor): ViewerBooking {
  const visible = !b.isPrivate || b.ownerId === viewer.id
                  || b.attendeeIds.includes(viewer.id) || viewer.role === 'ADMIN';
  return visible ? full(b) : { id: b.id, roomId: b.roomId, startAt: b.startAt,
                               endAt: b.endAt, status: b.status, title: 'ไม่ว่าง (Busy)' };
}
```

**Private-meeting masking happens in the API response, never in CSS or client code.** If the title reaches the browser, it is disclosed — DevTools is one keypress away. Add an integration test that fetches another user's private booking as an employee and asserts the response body does not contain the title string.

*Runner-up: CASL* — an abilities DSL for 3 roles and ~8 actions; lost on ceremony. *Rejected: Postgres RLS* — genuinely elegant for multi-tenant SaaS, but here it requires `SET LOCAL app.user_id` on every pooled checkout, complicates the background jobs (which run as no user), and doubles the surface you debug when a query mysteriously returns zero rows. The masking rule is one function; RLS is a subsystem.

---

## 15. Background jobs

**Pick: pg-boss 12, running in the same Node process as the API.**
The queue lives in the same Postgres: same connection pool, same backup, same transaction boundary, no Redis to run/monitor/restore. `boss.schedule()` gives cron without a cron container *and* guarantees a single fire even if you later run two API replicas. Retry with exponential backoff + dead-letter is exactly what the ">99% email delivery" NFR needs and exactly what a hand-rolled loop gets subtly wrong.
*Runner-up: BullMQ + Redis* — the standard answer, and wrong here: a second datastore to run, secure, back up and monitor for ~40 jobs/day, plus non-transactional enqueue (booking commits, Redis is down, email never sent, no trace). *Runner-up 2: bare `setInterval` + `pg_advisory_xact_lock`* — ~80 lines, zero deps, and honestly defensible; lost because backoff, dead-lettering and single-fire semantics are precisely the fiddly parts, and pg-boss is one dependency (deps: `pg`, `cron-parser`, `serialize-error`; requires Node ≥ 22.12).

Three jobs, and one design decision that matters more than the library:

| Job | Schedule | Note |
|---|---|---|
| `auto-release` | every 60 s | **Periodic sweep, not per-booking scheduled jobs.** |
| `reminders` | every 60 s (same tick) | bookings starting in 30±1 min with `reminder_sent_at IS NULL` |
| `drain-outbox` | every 15 s | sends queued email, backoff on failure, dead-letter after 5 attempts |

**Why a sweep beats per-booking timers:** if you schedule a "release booking X at 09:45" job at creation time, you must cancel and reschedule it on every edit, cancel, approve and drag&drop — five places to forget. A sweep recomputes truth from the table:

```sql
UPDATE bookings SET status = 'AUTO_RELEASED', released_at = now()
WHERE status = 'CONFIRMED'
  AND checked_in_at IS NULL
  AND start_at < now() - interval '15 minutes'
  AND start_at > now() - interval '4 hours'      -- don't resurrect ancient rows on restart
RETURNING id, owner_id;
```
Idempotent, stateless, survives a 3-hour outage gracefully, and the released slot immediately becomes bookable because the EXCLUDE constraint's `WHERE` clause no longer matches. Keep pg-boss's own `pgboss` schema out of drizzle-kit's migration diffing (`schemaFilter: ['public']`).

---

## 16. Email + .ics

**Pick: Nodemailer 9 over SMTP + an `email_outbox` table + react-email templates + `ical-generator` 11.**

- **Transport: Nodemailer/SMTP, not a provider SDK.** Nodemailer *is* the abstraction, and it's one dependency — the same code sends via Resend SMTP, Postmark SMTP, Amazon SES SMTP, or **the company's own Microsoft 365 / Exchange relay**. For a Thai corporate, "mail must originate from our domain via our relay" is a common non-negotiable you find out about in week 5; config-only switching is worth more than any SDK's ergonomics. Default to **Resend** for the MVP/demo (5-minute setup, generous free tier); switch by changing three env vars.
  *Runner-up: Postmark SDK* — best transactional deliverability and webhook analytics; lost because the outbox table already gives us delivery state, and SDK lock-in blocks the corporate-relay path.
- **`email_outbox` table** (`id, to, subject, html, text, ics, attempts, next_attempt_at, sent_at, last_error`) written **inside the booking transaction**. This is the transactional-outbox pattern and it's why the NFR is achievable: a booking can never commit without its notification being queued, failures are visible in the admin UI ("3 emails failed — resend"), and the retry job is 15 lines. Also sidesteps pg-boss's custom-db-executor gymnastics for transactional enqueue.
- **Templates: react-email + `@react-email/components`.** 5 bilingual templates (created / approved / rejected / cancelled / reminder). Worth the two deps for one reason: the recipients are on Outlook, and hand-written email HTML that survives Outlook's Word rendering engine is a genuinely miserable thing to debug. `email dev` gives a live preview loop for Thai copy review. *Runner-up: template literals returning HTML* — zero deps, and I'd choose it for plain-text-ish mail; lost on Outlook table quirks and the preview loop.
- **.ics: `ical-generator` 11.** Handles the parts that determine whether an update actually updates the meeting in Outlook/Google rather than creating a duplicate: stable `UID` (= booking id), incrementing `SEQUENCE` on every edit, `METHOD:REQUEST` for create/update and `METHOD:CANCEL` for cancellation, `ORGANIZER`/`ATTENDEE` with `RSVP`, and `TZID=Asia/Bangkok` + VTIMEZONE. Attach as `text/calendar; method=REQUEST` **and** include a plain "add to calendar" fallback link.
  *Runner-up: the `ics` package* — simpler API, but weaker on METHOD/SEQUENCE semantics, which is the whole game for edits and cancels.
- **Deliverability is a DNS task, not a code task:** SPF + DKIM + DMARC on the sending domain before the demo, or corporate Exchange will junk everything and the ">99%" NFR fails for reasons no amount of retry logic fixes.

---

## 17. QR codes

**Pick: `qrcode` 1.5, generating three static printable room signs. Not one QR per booking.**
The sign encodes `https://booking.company.co.th/checkin/grove`. Scanning opens the SPA; the user is already (or gets) logged in; the server finds *their* booking in *that* room within `[start-15min, start+15min]` and checks it in. No per-booking QR to generate, email, expire, or invalidate — the booking table already knows who may check in.
Admin route `GET /api/admin/rooms/:id/qr.png` renders the sign on demand for reprinting; `<10` lines.
Security note to state explicitly in the spec: a static QR can be photographed and used remotely, but check-in still requires an authenticated user who owns a booking in that room inside a 30-minute window — the blast radius is "someone checks in for their own meeting from their desk". Preventing that needs geofencing or NFC, which is not worth it. The admin-at-the-door check-in mode (from the company slides) exists in parallel as `POST /api/admin/bookings/:id/check-in`.
*Runner-up: signed rotating tokens per room* — solves a threat nobody has; adds key rotation and clock skew. *Rejected: per-booking QR in email* — more moving parts, and it fails for the walk-up user who left their phone at their desk.

---

## 18. File / image storage (room photos)

**Pick: local volume + `sharp` resize on upload.** Three rooms, three photos, changed roughly never. Write to `/data/uploads/<sha256>.webp`, serve via Caddy with a long cache header, back it up in the same nightly tarball as the DB. `sharp` resizes the admin's 6 MB phone photo to a 1600px and a 400px webp — 8 lines, protects the p95.
Validate at the boundary: max 8 MB, sniff the actual magic bytes (don't trust `Content-Type`), re-encode through sharp (which strips EXIF and neutralizes polyglot files), and serve from a path that never echoes the uploaded filename.
*Runner-up: S3 / Cloudflare R2 + presigned uploads* — the right answer the moment the host has an ephemeral filesystem or you run two API instances. **Decision rule: if you deploy to Fly.io/Render/Cloud Run, use R2; if you deploy to a VM with a volume (the recommendation), use the volume.** *Rejected: bytea in Postgres* (bloats every backup and dump for no benefit), *MinIO* (running an object store for 3 JPEGs).

---

## 19. Utilization report + charts

**Pick: no chart library. An HTML `<table>` plus CSS/SVG bars.**
US-008's acceptance criterion is "see a bar chart comparing % utilization per room". Three rooms and a 30-day trend rendered as `<div style="inline-size: 72%">` inside table cells satisfies it, is *more* accessible than a canvas chart (screen readers read the table; a `<canvas>` is a black box), prints correctly, and adds zero kB.
*Runner-up: Recharts 3* — add it the day the dashboard needs a stacked series or a real time-series with tooltips; it's a drop-in and the report page is isolated. Not before.
The heavy lifting is SQL anyway:
```sql
SELECT r.id, r.name,
       SUM(EXTRACT(epoch FROM (upper(b.slot * $window) - lower(b.slot * $window)))) 
         / EXTRACT(epoch FROM $window) AS utilization
FROM rooms r LEFT JOIN bookings b ON b.room_id = r.id AND b.slot && $window
             AND b.status IN ('CONFIRMED','CHECKED_IN')
GROUP BY r.id, r.name;
```
Note `b.slot * $window` (range intersection) — it correctly counts only the in-window part of a booking that straddles the boundary. Add `GET /api/admin/reports/utilization?format=csv` returning `text/csv` — five lines, no library, and it's what the admin will actually forward to management.

---

## 20. Testing

| Level | Tool | What it must cover |
|---|---|---|
| Unit | **Vitest 4** | `can()`, `toViewerBooking()` masking, slot math, .ics content, business-hours validators |
| Integration | **Vitest + real Postgres** (Docker Compose locally, GH Actions `services:` in CI) | every route through the real DB and the real constraints |
| **Concurrency** | Vitest + `Promise.all` | **the single most important test in the repo** |
| E2E | **Playwright 1.62**, two projects (employee / admin) | book → approve → check-in → cancel; drag&drop reschedule; auto-release with a clock-shifted fixture |
| a11y | **`@axe-core/playwright`** | zero critical violations on login, room list, booking form, calendar, admin approvals |
| Load | **`autocannon` 8** | `GET /api/availability` at 80 concurrent for 60 s, **assert p95 < 2000 ms**, fail CI if not |

The concurrency test, written explicitly:

```ts
it('exactly one of 50 simultaneous bookings for the same slot wins', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, () => api.post('/api/bookings', SAME_SLOT, { headers: freshIdempotencyKey() }))
  );
  expect(results.filter(ok(201))).toHaveLength(1);
  expect(results.filter(ok(409))).toHaveLength(49);
  expect(await countRows('bookings', { status: 'CONFIRMED' })).toBe(1);
});
```
Run the same shape against `approve` (two overlapping pendings, approved simultaneously) and against drag&drop reschedule. This test is the proof for US-002 and the Concurrency NFR — put it in the RTM and demo it live.

*Rejected: Testcontainers* — nice isolation, but a GH Actions `services: postgres:18-alpine` block plus `docker compose up db` locally costs zero dependencies and one YAML block. *Rejected: k6* — a separate binary and language for one p95 assertion that `autocannon` makes in npm.

---

## 21. Lint / format

**Pick: Biome 2.5.** One Rust binary replaces ESLint + Prettier + `typescript-eslint` + `eslint-plugin-react` + `-react-hooks` + `-import` + `eslint-config-prettier`: ~8 devDeps and 150 lines of config become one `biome.json`. Formats and lints in well under a second on this repo, so it runs in a pre-commit hook without anyone disabling it.
*Runner-up: ESLint 10 + Prettier 3* — the only real argument for it is full type-aware rules (`no-floating-promises` matters in a codebase with background jobs). Biome 2 covers the important ones (`useExhaustiveDependencies`, `noFloatingPromises` — **verify the latter's stability tier before relying on it**), and `tsc --noEmit` in CI catches the rest. If a type-aware rule turns out to be load-bearing, adding ESLint alongside Biome for that one rule is a 30-minute change.

---

## 22. CI/CD

**GitHub Actions**, one workflow, five jobs, ~6 minutes:

1. `setup` — pnpm 11 + Node 24 LTS, cached store.
2. `verify` — `turbo run lint typecheck test` with a `postgres:18-alpine` service; uploads coverage; **fails if `openapi.json` drifts from the committed copy**.
3. `e2e` — `turbo run build` then Playwright (chromium + one mobile viewport) + axe.
4. `image` — `docker buildx build --push` to **GHCR**, tagged with the commit SHA (never `latest` in prod).
5. `deploy` (on `main`, environment-gated) — SSH to the VM: `docker compose pull && drizzle-kit migrate && docker compose up -d --remove-orphans`, then curl `/healthz`. **Migrations run as an explicit step before the new container starts**, not on app boot.

Branch protection: PRs only, `verify` + `e2e` required. Renovate weekly, grouped, auto-merge patch-only — this is the maintenance path for the pinned young dependencies.

---

## 23. Containerization & deploy

**Cheapest sane option (recommended): one VM, three containers, ~$5–15/month.**

```
Caddy  ─ auto-TLS (Let's Encrypt), brotli
       ├─ /        → static files: apps/web/dist
       ├─ /admin/  → static files: apps/admin/dist
       └─ /api/*   → reverse_proxy api:3000
api    ─ node:24-alpine, Hono + pg-boss worker in one process
postgres ─ postgres:18-alpine, named volume, btree_gist
(+ a backup sidecar: nightly pg_dump → R2)
```

Hetzner CX22 (€3.79/mo) or an AWS Lightsail / local Thai VPS in Singapore/Bangkok for latency — 2 vCPU / 4 GB is 20× more than 80 users need. **Everything on one origin** is what makes the two-SPA split painless: one cookie, no CORS, no preflight. And because it is plain `docker compose`, the identical artifact runs on a company on-prem VM if IT requires the data to stay inside — a realistic constraint for a Thai corporate that you should ask about in week 1.

**Managed option: Fly.io**, `fly deploy` from CI, one machine in `sin`, Fly Managed Postgres with automated snapshots, a Fly volume (or R2) for uploads. ~$15–25/mo, no OS patching, no TLS management. *Runner-up managed: Render* (similar, simpler UI, pricier Postgres). *Rejected for the "proper cloud" slot: AWS ECS Fargate + RDS + ALB* — correct at 100× this scale, ~$120/mo and several days of Terraform for 80 users. **Explicitly rejected: the v1 spec's Vercel + Supabase** — Vercel cannot host the long-lived pg-boss worker, so you'd add Supabase cron + edge functions and end up with *more* moving parts and a split backend, which is the opposite of the goal.

Image hygiene: multi-stage build, `pnpm deploy --filter api --prod` into a clean stage, non-root user, `NODE_ENV=production`, `HEALTHCHECK` on `/healthz`, `restart: unless-stopped`, and log rotation configured in the compose file (`max-size: 10m`).

---

## 24. Observability

Deliberately small, because the failure modes here are "an email didn't send" and "the VM is down", not distributed tracing.

- **Logs:** `pino` 10 → JSON on stdout → `docker compose logs` / journald. One `request_id` per request, propagated into job logs and Sentry. Log every booking mutation with actor, room, range, and outcome — that's your incident timeline.
- **Errors:** **Sentry** free tier for `@sentry/node` (API) and `@sentry/react` (both SPAs), with source maps uploaded in CI. Enable performance tracing at 10% sampling and put an alert on **p95 of `GET /api/availability` > 2 s** — that turns the NFR into a monitored SLO instead of a claim in a document.
- **Uptime:** `/healthz` (checks DB round-trip + pg-boss connectivity) pinged by a free external monitor; alert to email/LINE.
- **Business visibility (cheap, high value):** an admin page showing failed outbox rows, auto-released bookings in the last 7 days, and pending approvals older than 24 h. Three SQL queries; catches the failures users actually notice.
- *Rejected for MVP:* OpenTelemetry + Prometheus + Grafana + Loki — four services to operate so that three people can look at a dashboard nobody opens. Add OTel the day there is a second service to trace across.

---

## 25. Backups

- **Nightly `pg_dump -Fc`** in a sidecar container → gzip + age/gpg encrypt → `rclone` to **Cloudflare R2** (pennies at this size). Retention: 30 daily + 6 monthly. The `/data/uploads` volume goes in the same tarball.
- **State the targets in the spec: RPO ≤ 24 h, RTO ≤ 1 h.** For a meeting-room tool that is the honest, correct answer. If someone insists on RPO ≈ 0, that's a deliberate upgrade to managed Postgres with PITR (Fly/Neon/RDS), not a tweak.
- **A backup you have not restored is not a backup.** Weekly scheduled CI job: pull the latest dump, restore into a throwaway container, assert `SELECT count(*) FROM bookings > 0` and that the EXCLUDE constraint exists. It's 15 lines of YAML and it is the difference between having backups and believing you do.
- Keep `docker-compose.yml`, `Caddyfile` and `.env.example` in `infra/` under version control; the real `.env` lives only on the host and in the password manager. Document the "rebuild the box from scratch" runbook in `infra/README.md` — target: 30 minutes.

---

## 26. Concrete versions (fetched 2026-08-23; **verify** = churn risk, pin exactly)

**Runtime / platform**
| Package | Version | Note |
|---|---|---|
| Node.js | **24.19.x LTS** ("Krypton") | 26.7.0 is current but not LTS until Oct 2026 — stay on 24 |
| PostgreSQL | **18.6-alpine** | `uuidv7()` is built in (PG18) — use it for booking ids, no `uuid` dep |
| pnpm | 11.23.0 | |
| TypeScript | **7.0.2** (native compiler) | **verify** — fallback `6.0.3` or `5.9.3` if any dep's build chokes |
| turbo | 2.10.11 | |
| @biomejs/biome | 2.5.10 | **verify** `noFloatingPromises` stability tier |

**API**
| Package | Version |
|---|---|
| hono | 4.13.3 |
| @hono/node-server | 2.1.1 |
| @hono/zod-openapi | 1.6.1 (peers verified: `zod ^4`, `hono >=4.10`) |
| @scalar/hono-api-reference | 0.11.16 (docs UI, non-prod) |
| zod | 4.4.3 |
| drizzle-orm | **0.45.2 exact** — 1.0.0-rc.4 in flight, upgrade post-MVP |
| drizzle-kit | 0.31.10 |
| drizzle-zod | 0.8.3 |
| pg | 8.23.0 |
| pg-boss | 12.27.0 (requires Node ≥ 22.12) |
| better-auth | **1.7.1 exact** — **verify**; peers `drizzle-orm ^0.45.2`, `drizzle-kit >=0.31.4` ✓ |
| nodemailer | 9.0.5 |
| ical-generator | 11.1.0 |
| qrcode | 1.5.4 (+ `@types/qrcode` 1.5.6) |
| sharp | 0.35.3 |
| pino | 10.3.1 |
| @sentry/node | 10.70.0 |

**Web (both apps)**
| Package | Version |
|---|---|
| react / react-dom | 19.2.8 |
| vite | 8.2.2 |
| @tanstack/react-router | 1.170.32 (**verify** — fast-moving minor line) |
| @tanstack/react-query | 5.102.1 |
| react-hook-form | 7.86.0 · @hookform/resolvers 5.9.1 |
| tailwindcss | 4.3.3 |
| @radix-ui/react-* | dialog 1.1.23 (shadcn baseline) |
| lucide-react | 1.33.0 |
| @dnd-kit/core | 6.3.1 (admin only) |
| date-fns | 4.4.0 · @date-fns/tz 1.5.0 |
| react-day-picker | 10.0.1 (optional, desktop month picker) |
| @sentry/react | 10.70.0 |

**Email templates / tooling**
| Package | Version |
|---|---|
| @react-email/components | 1.0.12 · react-email 6.9.2 (dev preview) |

**Testing**
| Package | Version |
|---|---|
| vitest | 4.1.11 |
| @playwright/test | 1.62.1 |
| @axe-core/playwright | 4.13.0 |
| autocannon | 8.0.0 |

*Deliberately absent and worth noticing:* no Redis, no Nginx config, no S3 SDK, no chart library, no calendar library, no state-management library, no ESLint/Prettier, no NestJS, no Next.js, no Terraform. Every one of those is a thing nobody has to learn, patch, or restore.

---

## 27. The three biggest risks

### Risk 1 — The correctness guarantee leaks through a code path that skips the funnel
The EXCLUDE constraint is airtight, but it only protects rows whose `status` is in the constraint's `WHERE` clause, and only if every writer handles `23P01`. There are **five** paths that mutate `(room_id, slot, status)`: create, employee edit, admin approve, admin drag&drop reschedule, and auto-release. Drag&drop is the likeliest to be written late, by whoever is doing the UI, with its own `UPDATE`. A path that writes directly and swallows the constraint error surfaces as a 500 and a user who thinks the room is theirs.
**Mitigation:** (a) exactly one `applySlotChange()` function; make direct `update(bookings).set({ startAt | endAt | roomId | status })` outside `services/booking.ts` a code-review blocker and add a lint/grep check in CI; (b) run the 50-way concurrency test against **all five** paths, not just create; (c) map `23P01` centrally in the Hono error middleware so no route can forget; (d) an `Idempotency-Key` on `POST /bookings` so a retry never creates a second row; (e) keep the audit table write inside the same transaction so any anomaly is reconstructable.

### Risk 2 — Four young / fast-moving dependencies on the critical path
`better-auth@1.x` (auth — total-loss failure mode), Hono RPC type inference (can degrade tsc/editor performance as the route surface grows), `@tanstack/react-router` (fast minor cadence), and **TypeScript 7's native compiler**, which is new enough that some tool in the chain may not have validated its `.d.ts` emit or compiler-API surface. Any one of these can eat three days in week 4.
**Mitigation:** (a) **week-1, day-1 spike:** wire login → one `@hono/zod-openapi` endpoint → `hc` typed call → one Drizzle query → one Playwright test, on TS 7, *before* any feature work. If it isn't smooth in a day, fall back immediately — the fallbacks are pre-decided and cheap: hand-rolled sessions (~200 lines), `openapi-typescript` + `openapi-fetch` from the already-generated `openapi.json`, React Router 8, TypeScript 6.0.3. (b) **Pin every version exactly** — no `^` anywhere, `pnpm-lock.yaml` committed, Renovate weekly with CI as the gate. (c) Export `AppType` as per-module route unions rather than one giant app type, which is the documented way to keep Hono RPC inference cheap.

### Risk 3 — One host, one Postgres, one mail path: the whole system is a single point of failure
The stack deliberately concentrates everything into one VM: the queue is in Postgres, uploads are on a local volume, TLS is one Caddy. Correct for the budget and the load — but the failure modes are real. A disk-full or a bad `docker compose up` takes the product down; a corrupted volume takes the data with it; and separately, mail from a fresh domain into a corporate Microsoft 365 tenant will land in Junk, silently failing the ">99% .ics delivery" NFR for reasons no retry logic can fix.
**Mitigation:** (a) nightly encrypted off-host dumps **plus the weekly automated restore drill** — the drill is the mitigation, the backup is just a file; (b) disk-usage and `/healthz` alerting, log rotation capped in compose, `restart: unless-stopped`, and a 30-minute documented rebuild runbook in `infra/README.md` (the whole box is 3 containers + one env file + one dump); (c) SPF/DKIM/DMARC configured on the sending domain **before** the demo, sender-domain warm-up, an `email_outbox` admin view with a manual "resend" button, and a decision in week 1 about whether IT wants mail routed through the corporate relay; (d) if the business later declares this business-critical, the pre-planned upgrade is exactly two steps — managed Postgres with PITR, and a second API machine (pg-boss and cookie sessions already tolerate two instances; only local uploads need to move to R2 first).

**Watch list (not top-3, but track):** WCAG 2.2 SC 2.5.7 requires a non-drag alternative for the reschedule — build the dialog first, or the a11y requirement fails at the finish line. Thai `line-height` clipping is a guaranteed visual bug if nobody sets it explicitly. And the scope is the real schedule risk: drag&drop, QR check-in and the report are all `Should`/`Could` — cut them in that order if week 5 is behind, and land the concurrency guarantee, email/.ics and approvals first.
