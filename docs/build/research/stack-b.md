**Stack ที่เลือก**

| Area | Decision | Runner-up ที่แพ้ |
|---|---|---|
| Deliverables | 4 deliverables แยกชัด: `apps/web`, `apps/admin`, `apps/api`, PostgreSQL. Employee/Admin เป็นคนละ Next.js app แต่ reverse proxy ให้อยู่ same-origin เช่น `/`, `/admin`, `/api` เพื่อลด cookie/CORS bugs. | One app with role areas แพ้ เพราะ admin workflows, navigation, permissions, release risk ต่างจาก employee ชัดเจนเกินไป |
| Monorepo | `pnpm workspaces + Turborepo`. พอดีกับ TypeScript monorepo เล็ก, cache build/test ได้, ไม่หนักเกินทีม 1-3 devs. | Nx แพ้ เพราะ feature เยอะเกิน; npm workspaces แพ้ เพราะ task graph/cache อ่อนกว่า |
| Frontend | Next.js App Router + React สำหรับทั้ง employee/admin. ใช้ file routing, SSR/streaming ได้เมื่อจำเป็น, deploy เป็น Node container ได้ตรงๆ. | Vite SPA แพ้ เพราะต้องประกอบ routing/auth/layout/data conventions เองมากกว่า |
| UI/styling | shadcn/ui + Radix primitives + Tailwind CSS v4 + Lucide. เหมาะกับ internal tool: accessible primitives, copy-in components, ไม่ผูก theme หนัก. | MUI แพ้ เพราะเร็วแต่ visual/system หนักและ customize ให้เข้าบริษัทใช้แรงกว่า |
| Forms/validation | React Hook Form + Zod + shared schemas. Client UX ดี, server validation ใช้ schema ชุดเดียวกัน. | Formik/Yup แพ้ เพราะ heavier และ type inference แย่กว่า |
| Data fetching | TanStack Query + generated REST client. รองรับ cache, invalidation หลัง book/cancel/check-in, optimistic UI แบบควบคุมได้. | SWR แพ้ เพราะ mutation/invalidation workflows ซับซ้อนกว่า |
| Calendar/DnD | FullCalendar React v7 + React Scheduler commercial license + resource time grid. Admin drag/drop/reschedule และ room resource columns เป็น core workflow ซื้อ license คุ้มกว่า build เอง. | react-big-calendar แพ้ เพราะ resource+DND polish/test burden สูงกว่า; FullCalendar standard แพ้ เพราะ resource views เป็น Premium |
| Date/time | PostgreSQL `timestamptz`, canonical timezone `Asia/Bangkok`, Temporal via `temporal-polyfill` in app/API, display with Intl. Store instants, validate room hours in Bangkok time. | Luxon-only แพ้ เพราะ FullCalendar v7 เดินไปทาง Temporal และ native Temporal กำลังมา |
| API framework | Hono on Node.js 24 LTS via `@hono/node-server`. Small, typed, Web API based, enough middleware without Nest ceremony. | Fastify แพ้แบบเฉียดๆ; NestJS แพ้เพราะ boilerplate/DI มากเกิน scale |
| API style | REST + OpenAPI 3.1. CRUD/workflow actions ชัด, easy audit, easy testing, future mobile/integration friendly. | tRPC แพ้ เพราะผูก frontend มากไป; GraphQL แพ้ เพราะไม่มี query-shape problem |
| Typed client/OpenAPI | `@hono/zod-openapi` generates docs; `openapi-typescript` + `openapi-fetch` for web/admin clients. CI checks generated types are current. | Hand-written client แพ้ เพราะ drift; heavy codegen แพ้ เพราะ churn |
| ORM/migrations | Drizzle ORM + drizzle-kit + custom SQL migrations. Use PostgreSQL 16.15, `btree_gist`, partial `EXCLUDE` constraint on confirmed/checked-in bookings; approve runs in transaction and lets DB reject losers. | Prisma แพ้ เพราะ exclusion constraints/custom SQL still leak through; TypeORM แพ้ because migration discipline weaker |
| Auth | Better Auth with Postgres sessions, admin-provisioned users only, httpOnly Secure SameSite=Lax cookie, Argon2id override via `@node-rs/argon2`. Login accepts email/employee code + password; mobile is recovery/contact only. | Hand-rolled sessions แพ้ security maintenance; stateless JWT แพ้ revocation/audit needs |
| Authz | Central RBAC/policy functions in API plus DB-scoped queries. Admin/user roles enforced server-side; private meeting fields are projected/masked unless owner/admin/allowed role. | UI-only guards แพ้ immediately; middleware-only authz แพ้ row-level edge cases |
| Background jobs | pg-boss in same PostgreSQL. Handles auto-release, email retries, cleanup, reminder jobs without Redis. Jobs are idempotent and reconciled by periodic SQL sweeps. | BullMQ/Redis แพ้ extra infra; cron-only แพ้ retry/visibility/concurrency |
| Email + ICS | Amazon SES ap-southeast-1, React Email templates, Nodemailer for MIME/attachments, `ics` for calendar invites. Low volume, reliable, cheap. | Resend/SendGrid แพ้ vendor cost/control; raw company SMTP แพ้ throttling/OAuth fragility |
| QR | `qr` package for server-rendered SVG/PNG QR check-in links. QR payload is short signed token/nonce, not booking PII. | `qrcode` แพ้ because older and needs separate typings |
| Image storage | S3-compatible object storage via `@aws-sdk/client-s3`: Cloudflare R2 for cheap path, S3 for AWS path. Store room photos/announcements as objects, metadata in DB, signed URLs only. | DB `bytea` แพ้ backup bloat; local disk แพ้ portability/backups |
| Testing | Vitest unit tests, real Postgres integration tests, Playwright E2E, axe checks, k6/concurrency scripts for booking races and calendar p95. Mocks never replace DB constraint tests. | Unit-only แพ้ because double-booking is a data race |
| Lint/format | TypeScript strict, ESLint flat config, Prettier, React Query ESLint plugin, CI typecheck. | Biome แพ้ because ESLint ecosystem still better for Next/React Query/a11y |
| CI/CD | GitHub Actions: install, lint, typecheck, unit, integration Postgres, build, Playwright, Docker image, migration dry-run, deploy. | Manual deploy แพ้ auditability |
| Containers/deploy | Docker Compose with separate `web`, `admin`, `api`, `worker`, `postgres`, `caddy`. Cheapest sane: one VPS + Caddy + Cloudflare Access/Tailscale + encrypted backups to R2/B2. Managed option: AWS ECS/Fargate or App Runner + RDS PostgreSQL + S3 + SES + CloudWatch. | Vercel/serverless-only แพ้ because worker/jobs/DB pooling become more complex |
| Observability | Pino JSON logs + OpenTelemetry SDK + Sentry exceptions + uptime check. Track booking conflicts, job failures, email failures, calendar p95. | Console logs only แพ้ incident/debug needs |
| Backups | pgBackRest or managed PITR, daily encrypted full backup, WAL archiving, 30-day retention, monthly restore drill. Room images use object versioning/lifecycle. | VM snapshot only แพ้ because restore confidence is poor |

**Version pins to verify ณ install time**

`Node 24.19.0 LTS`, `PostgreSQL 16.15`, `pnpm 11.22.0`, `turbo 2.10.10`, `typescript 7.0.2`, `next 16.3.2`, `react 19.2.8`, `tailwindcss 4.3.3`, `shadcn 4.19.0`, `hono 4.13.3`, `@hono/node-server 2.1.1`, `@hono/zod-openapi 1.6.1`, `zod 4.4.3`, `react-hook-form 7.85.0`, `@tanstack/react-query 5.101.4`, `@fullcalendar/react 7.0.2`, `@fullcalendar/react-scheduler 7.0.2`, `temporal-polyfill 1.0.4`, `drizzle-orm 0.45.2`, `drizzle-kit 0.31.10`, `pg 8.23.0`, `pg-boss 12.26.3`, `better-auth 1.6.26`, `@node-rs/argon2 2.1.0`, `react-email 6.9.2`, `nodemailer 9.0.5`, `ics 3.12.0`, `@aws-sdk/client-sesv2 3.1115.0`, `@aws-sdk/client-s3 3.1115.0`, `qr 0.6.0`, `vitest 4.1.10`, `@playwright/test 1.62.1`, `eslint 10.8.1`, `pino 10.3.1`, `@opentelemetry/sdk-node 0.221.0` — all marked **verify**.

**Monorepo tree**

```txt
apps/web/          Employee app: search rooms, book, my bookings, QR/self check-in.
apps/admin/        Admin app: approvals, schedule DnD, rooms, users, reports, settings.
apps/api/          Hono REST API plus worker entrypoints for pg-boss jobs.
packages/db/       Drizzle schema, migrations, seeds, DB constraints, repositories.
packages/shared/   Zod schemas, domain constants, status enums, timezone helpers.
packages/api-client/ Generated OpenAPI types and typed fetch client.
packages/ui/       Shared shadcn/Radix components and design tokens.
packages/email/    React Email templates, ICS generation, SES/Nodemailer sending.
packages/auth/     Better Auth config, password policy, session/role helpers.
packages/config/   Shared tsconfig, eslint config, env validation.
tests/e2e/         Playwright scenarios for employee/admin critical paths.
tests/load/        k6/concurrency scripts for booking races and p95 checks.
infra/             Docker Compose, Caddy, deployment docs, backup scripts.
docs/              v2 spec HTML and architecture notes.
```

**3 biggest risks**

1. Double-booking race: mitigate with PostgreSQL exclusion constraint, approve-in-transaction, idempotency keys, and concurrency tests that intentionally hammer the same slot.
2. Auth/cookie deployment bugs: mitigate by same-origin reverse proxy paths (`/`, `/admin`, `/api`) and production cookie tests before launch.
3. Calendar premium/license/UX fit: buy the FullCalendar Scheduler license in week 1 and spike admin DnD against real room data before building reports/settings.

Sources used: Node release status, PostgreSQL release notes/security guidance, npm package pages, Hono Zod OpenAPI docs, Drizzle migration docs, Better Auth security/cookie docs, and FullCalendar v7/license docs. Key links: [Node releases](https://nodejs.org/en/about/previous-releases), [PostgreSQL release notes](https://www.postgresql.org/docs/release/), [Hono Zod OpenAPI](https://hono.dev/examples/zod-openapi), [Drizzle custom migrations](https://orm.drizzle.team/), [Better Auth security](https://better-auth.com/docs/reference/security), [FullCalendar license](https://fullcalendar.io/license), [FullCalendar React Scheduler docs](https://fullcalendar.io/docs/react).