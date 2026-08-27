<!-- id: folders -->
## 07 · โครงสร้างโค้ด (Code Structure)

**3 apps + 3 packages** เท่านั้น เพราะหลักคิดข้อเดียว: *package ที่มีผู้ใช้คนเดียวไม่ต้องเป็น package* ทุกอย่างที่ API ใช้คนเดียว (db, email, jobs) อยู่ใน `apps/api`; `packages/shared` มี constants/enums/error types ที่ข้าม app และ `packages/ui` มี UI primitives ที่ web/admin ใช้ร่วมกัน

### 7.1 โครงสร้าง monorepo

```text
reserve-flow/
├─ apps/
│  ├─ api/            Hono REST API + in-process jobs scheduler (Node process เดียว)
│  ├─ web/            Employee SPA — Vite + React 19 + TanStack Router, base '/'
│  └─ admin/          Admin SPA — stack เดียวกัน, base '/admin/' (reports, audit และ failed-email queue)
├─ packages/
│  ├─ shared/         constants, enums และ ErrorEnvelope/ErrorCode ที่ทุก app ใช้ร่วมกัน
│  ├─ ui/             shared UI, AppModeSwitch, StatusBadge, SlotGrid primitives, tokens.css
│  └─ config/         tsconfig bases, biome.json, vite.shared.ts
├─ infra/             compose.yml (local only) · supabase/bootstrap.sql
├─ apps/api/Dockerfile · fly.toml · fly.staging.toml · vercel.json
├─ docs/              spec (HTML + Markdown) และเอกสารสนับสนุนที่มีจริง
└─ .github/workflows/ ci.yml, deploy.yml, backup.yml
```

:::details โครงสร้างฉบับเต็มถึงระดับไฟล์ (3 apps + 3 packages)
```text
reserve-flow/
├─ apps/
│  ├─ api/                          Hono REST API + in-process jobs scheduler (Node process เดียว)
│  │  ├─ src/
│  │  │  ├─ app.ts                  สร้าง Hono app: middleware (request-id, pino, session, CSRF) → mount routers; /api/healthz, /api/readyz, /api/docs และ Swagger UI อยู่ที่นี่
│  │  │  ├─ server.ts               @hono/node-server listen :3000; startJobs() เมื่อ WORKER_ENABLED=true; SIGTERM → ปิด HTTP → jobs.stop() (รอรอบค้าง ≤ 30 s) → pool.end
│  │  │  ├─ env.ts                  zod-parse process.env ตอน boot; fail fast, log เฉพาะ "ชื่อ" key ที่หาย; ไฟล์เดียวที่แตะ process.env
│  │  │  ├─ docs.ts                 OpenAPI 3.1 document ประกอบมือ; sign-in body reuse zod ผ่าน z.toJSONSchema; path inventory ที่มี test ยังครอบเพียง public/auth/read routes ไม่ใช่ API ทั้งหมด
│  │  │  ├─ auth/                   better-auth instance (+admin plugin), employee_code-only public login, lockout, set-password token flow, session middleware → c.var.actor
│  │  │  ├─ modules/                1 โฟลเดอร์ต่อ domain โดยมี `routes.ts` เป็นแกน; domain ที่ซับซ้อนจึงแยก `service.ts`, `serialize.ts`, `admin.ts` หรือ `import.ts` เพิ่มตามไฟล์จริง
│  │  │  │  ├─ bookings/            routes.ts + serialize.ts (FULL/PUBLIC/BUSY) + service.ts สำหรับ create/update/cancel/check-in และ lock ตามลำดับกลาง
│  │  │  │  ├─ rooms/               CRUD, features, photo upload (validate bytes → `rooms.photo bytea`) — เวลาทำการเป็นชุดเดียวทุกห้อง อยู่ใน settings/
│  │  │  │  ├─ availability/        GET /availability, /calendar — read-only; server คืน facts/masked booking ส่วน web คำนวณ slot ด้วย lib/slots.ts
│  │  │  │  ├─ checkin/             POST /check-in/rooms/:roomCode — ปลายทาง QR หน้าห้อง; POST /bookings/:id/check-in อยู่ใน bookings/routes.ts; rate limit 10/นาที/ผู้ใช้
│  │  │  │  ├─ users/               admin CRUD, CSV import (dry-run), deactivate = FOR UPDATE user → delete sessions (tx เดียวกัน) + cancel future bookings; lastAdminGuard() (advisory lock 'users:last-admin') ใช้ร่วมทุก op ที่ถอดสิทธิ์ admin; GET /directory/users — รายชื่อพนักงาน ACTIVE (id, ชื่อ, อีเมล, แผนก) สำหรับเลือกผู้เข้าร่วม
│  │  │  │  ├─ departments/         CRUD 8 แผนก
│  │  │  │  ├─ settings/            settings key/value (defaults จาก shared/settings.ts), business_hours (7 แถว), holidays
│  │  │  │  ├─ reports/             utilization, outcomes/no-show และ heatmap; เวอร์ชันปัจจุบันยังไม่มี CSV export route
│  │  │  │  ├─ notifications/       admin อ่าน outbox/filter `FAILED` และ retry dead-letter; enqueue อยู่ใน service ที่สร้าง event
│  │  │  │  └─ audit/               audit insert (tx เดียวกับ mutation), GET /admin/audit-logs
│  │  │  ├─ db/
│  │  │  │  ├─ schema/              Drizzle tables 4 กลุ่ม + index.ts: auth.ts (departments, users รวม `job_title`, sessions, accounts, verifications — better-auth; `password_setup_tokens` — ของเรา D-29) · master.ts (rooms `photo bytea`, features, room_features, business_hours, holidays, settings) · bookings.ts · ops.ts · columns.ts
│  │  │  │  ├─ demo-seed.ts         canonical manifest: 3 ห้อง, 8 แผนก, 80 EMPLOYEE + 1 ADMIN, job titles/equipment/settings; demo-only guards
│  │  │  │  ├─ seed.ts              preflight, advisory lock, create missing credentials, normalize/upsert/verify canonical data
│  │  │  │  ├─ initialize.ts        production-capable one-shot CLI: dedicated URL + confirmation + `--apply` + production opt-in
│  │  │  │  └─ index.ts             createDb(): pg Pool + drizzle({ schema, casing: 'snake_case' }) — runtime ใช้ role app; migrations/initializer ใช้ URL แยก
│  │  │  ├─ jobs/
│  │  │  │  ├─ index.ts             scheduler loops (sweep 60 s, notify 10 s, maintenance 03:15), advisory lock, pino error log, health state สำหรับ `/readyz`, kick/stop
│  │  │  │  ├─ sweep.ts             auto-release / complete / enqueue reminders แบบ idempotent
│  │  │  │  ├─ drain.ts             outbox lease + SMTP send + retry/backoff; 8 attempts → `FAILED`
│  │  │  │  └─ maintenance.ts       purge/scrub ตาม retention ทุกวัน
│  │  │  ├─ email/
│  │  │  │  ├─ templates.ts         อีเมลภาษาไทย 7 template keys (หัวข้อ 02 §2.6): booking.confirmed, booking.cancelled, booking.rescheduled, booking.reminder, booking.auto_released (owner+attendees, .ics CANCEL), booking.auto_released_admin (ไม่มี .ics — C2-02), account.set_password
│  │  │  │  ├─ ics.ts               ical-generator: UID = <booking_id>@<domain>, SEQUENCE = bookings.version, METHOD REQUEST/CANCEL, UTC
│  │  │  │  └─ mailer.ts            Nodemailer SMTP (company relay / Mailpit) — เปลี่ยน provider = แก้ไฟล์นี้ไฟล์เดียว
│  │  │  └─ lib/
│  │  │     ├─ errors.ts            AppError(code, message) → envelope {code,message,details,request_id}; mapPostgresError(): 23P01 → SLOT_UNAVAILABLE, unique constraint ที่เปิดเผยได้ → 409 VALIDATION_FAILED; alternatives คำนวณใน bookings route/service หลัง rollback
│  │  │     ├─ http.ts              clientIp() — advisory สำหรับ audit/log เท่านั้น ไม่ใช่ auth factor; อ่าน X-Forwarded-For เมื่อ TRUST_PROXY เปิด
│  │  │     ├─ rate-limit.ts        sliding-window in-process ต่อ instance (C-13: single instance = design ไม่ใช่ shortcut) → 429 RATE_LIMITED + retry_after_seconds
│  │  │     ├─ settings.ts          loadSettings() — policy keys ตามหัวข้อ 05 §5.10 จากตาราง settings (defaults จาก shared)
│  │  │     ├─ time.ts              toBangkokIso() — render ที่ +07:00 เท่านั้น; เก็บ/ตัดสินใจเป็น timestamptz UTC
│  │  │     ├─ window.ts            business hours + หน้าต่าง check-in: verdict เปิด/ปิดจอง, earliestSlotStart() — guard เวลาที่ทุก service ใช้ร่วม
│  │  │     └─ logger.ts            pino JSON + redact paths (mobile, email, password)
│  │  ├─ drizzle/                   migration SQL เรียงเลข 0000–0009 (เพิ่ม 0008 audit filter indexes และ 0009 users.job_title) — SQL คือ artifact ที่ review ใน PR; apply: `pnpm db:migrate`
│  │  ├─ test/                      Vitest integration ผ่าน app.request() กับ Postgres จริง; concurrency gate (TC-xxx ในหัวข้อ 09) อยู่ที่นี่
│  │  ├─ drizzle.config.ts          schema ./src/db/schema/index.ts, out ./drizzle, casing snake_case
│  │  └─ package.json               scripts สำหรับ dev/build/migrate/initialize/test และ dependency pins ของ Hono, better-auth, Drizzle, Swagger UI, SMTP/.ics
│  ├─ web/                          Employee SPA (Vite + React 19 + TanStack Router), base '/'
│  │  ├─ src/
│  │  │  ├─ routes/                 root, login, authed, home redirect, rooms, room-detail, booking-new, booking-detail, bookings, calendar, check-in และ profile; **ไม่มี** forgot/set-password route ใน final employee build
│  │  │  ├─ components/             shell, room/booking/edit/reschedule widgets และ `date-picker-field.tsx` ที่ใช้ `@daypicker/react` + `@daypicker/buddhist`
│  │  │  ├─ lib/                    datetime/slots/i18n/font-scale/demo-check-in และ pure helpers พร้อม unit tests
│  │  │  ├─ api/                    same-origin fetch client, typed payloads, queries/mutations และ QueryClient
│  │  │  ├─ router.tsx              ประกอบ route tree แบบ code-based ด้วย TanStack Router (ไม่มี generated route tree)
│  │  │  └─ main.tsx                QueryClientProvider + RouterProvider + tokens.css
│  │  ├─ index.html · vite.config.ts · tsconfig.json
│  └─ admin/                        Admin SPA — stack เดียวกัน; reports/audit/email-queue อยู่ที่นี่; base '/admin/'
│     ├─ src/
│     │  ├─ routes/                 root/authed, dashboard, calendar, bookings/detail, rooms/form/QR, users, settings, reports, audit และ emails (ค่าเริ่มต้น filter `FAILED`)
│     │  ├─ components/             forms/tables/dialogs เขียนด้วย React + Tailwind; `qr-code.tsx` ใช้ `uqr`
│     │  ├─ api/                    fetch client, payload types, queries/mutations และ QueryClient
│     │  ├─ lib/                    datetime/slots/i18n และ pure helpers พร้อม unit tests
│     │  └─ router.tsx · main.tsx   route tree แบบ code-based + app bootstrap
│     └─ index.html · vite.config.ts (base: '/admin/') · tsconfig.json
├─ packages/
│  ├─ shared/                       @reserveflow/shared — constants/enums/error contracts; ไม่มี server code (manifest pin `zod` ไว้ แต่ยังไม่มี shared schema module)
│  │  └─ src/
│  │     ├─ constants.ts            status/role/check-in arrays และค่าคงที่ที่ใช้ร่วมกัน
│  │     ├─ enums.ts                TypeScript unions ที่ derive จาก constants
│  │     └─ errors.ts               ErrorEnvelope และ shared error types
│  ├─ ui/                           @reserveflow/ui — shared UI primitives + navigation ข้ามสอง bundle, Noto Sans Thai
│  │  └─ src/{app-mode-switch.tsx, status-badge.tsx, slot-grid.tsx, countdown.tsx, font-scale.ts, tokens.css, index.ts}
│  └─ config/                       tsconfig.base.json, tsconfig.react.json, biome.json, vite.shared.ts
├─ infra/
│  ├─ compose.yml                   Postgres + Mailpit สำหรับ local dev เท่านั้น
│  └─ supabase/bootstrap.sql        เปิด extension, สร้าง `rf_app`, grants/default privileges และปิด PostgREST roles
├─ apps/api/Dockerfile              build API + web/admin dists; Fly รัน API และมี static fallback/staging ใน image เดียว
├─ fly.toml · fly.staging.toml      Fly production/staging config; API production always-on
├─ vercel.json                      production origin เดียว: web `/`, admin `/admin/*`, rewrite `/api/*` ไป Fly
├─ docs/                            spec (HTML + Markdown), deploy/init/UI handoff
├─ .github/workflows/               ci.yml, deploy.yml, backup.yml (ดูหัวข้อ 09)
└─ package.json · pnpm-workspace.yaml · turbo.json · biome.json · tsconfig.json · .env (gitignored)
```
:::

### 7.2 ข้อตกลงในการเขียนโค้ด (Conventions)

โมดูลแยกตาม domain และมีไฟล์เท่าที่จำเป็น; implementation ปัจจุบันใช้ Hono + local zod schemas + shared transaction helpers:

- **`routes.ts`/`admin.ts`** mount Hono routers, parse body/query ด้วย zod schema ที่ประกาศข้าง route และ serialize response; OpenAPI document ประกอบมือใน `docs.ts`
- **`service.ts`** รวม business transaction ของ domain; helper กลาง `lib/tx.ts` ให้ `withTx`, ordered room locks, decision time, audit และ outbox. ไม่มีข้อบังคับ `repo.ts` layer ในโค้ดปัจจุบัน
- booking writers อยู่ใน `modules/bookings/service.ts`; user deactivation อยู่ใน `modules/users/service.ts`; ทั้งสองเดิน lock order เดียวกันด้วย helper กลาง ส่วน `jobs/sweep.ts` เป็น SQL idempotent

:::details lock-plan reference (conceptual pseudocode; ไม่ใช่ exported `mutate()` ในโค้ดปัจจุบัน)
ลำดับ **idempotency → global → users → rooms → `$decision_time`** เป็นสัญญาร่วมของ writer (นิยามฉบับเต็มอยู่ที่หัวข้อ 05 §5.6 — CF-01): operation ที่เริ่มจาก booking id ล็อก actor + owner; QR check-in ล็อก actor แล้ว room ก่อนค้นหา booking; deactivate ล็อก target user แล้ว resolve ห้องของใบอนาคต

```ts
// conceptual contract; implementation จริง split อยู่ใน bookings/service.ts, users/service.ts และ lib/tx.ts
// ลำดับตายตัว: (0) idempotency → (1) global → (2) users → (3) rooms → (4) $decision_time  (หัวข้อ 05 §5.6)
type LockPlan = {
  idem?: { key: string; replay: (tx: Tx) => Promise<T | null> };  // create เท่านั้น; ไม่มี request_hash — key เดิมคืนใบเดิม
  globalLocks?: readonly string[];      // (1) invariant ระดับระบบ ก่อนแตะ user เช่น 'users:last-admin'
  userIds: readonly string[];           // (2) actor + owner สำหรับ booking-id operation; QR = actor; deactivate = target user
  userLock?: 'SHARE' | 'UPDATE';        // default SHARE; deactivate/last-admin ใช้ UPDATE
  roomIds?: readonly string[];          // (3) รู้ล่วงหน้า (create/cancel/check-in/reschedule)
  resolveRoomIds?: (tx: Tx) => Promise<readonly string[]>;  // (3) รู้หลังล็อก user เท่านั้น (deactivate: อ่านใบอนาคตของ user ใต้ FOR UPDATE)
};
export async function mutate<T>(plan: LockPlan, actor: Actor, fn: (tx: Tx, at: Date, rooms: readonly string[]) => Promise<MutationResult<T>>) {
  let out: { value: T; enqueued: number };
  try {
    out = await withTx(async (tx) => {
      // (0) idempotency ก่อนเสมอ — ยังไม่แตะ global/user/room ใด (C1-08)
      if (plan.idem) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${hashKey(actor.id + ':' + plan.idem.key)})`);
        const prior = await plan.idem.replay(tx);            // ใบเดิม → 200 replay (payload ต่างก็คืนใบเดิม — ไม่มี hash, CF-01)
        if (prior) return { value: prior, enqueued: 0 };
      }
      // (1) global ก่อน user เสมอ — ไม่งั้น writer สองคนถือคนละครึ่งของ invariant (U-01 LAST_ADMIN, หัวข้อ 06 §6.7)
      for (const g of [...new Set(plan.globalLocks ?? [])].sort())
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${hashKey(g)})`);
      // (2) แถว users เรียงตาม id — ทุก writer ล็อกคนก่อนห้องเสมอ จึงไม่มีวงจร deadlock กับ deactivate (C1-10, CF-01)
      for (const u of [...new Set(plan.userIds)].sort()) {
        const rows = await tx.execute(plan.userLock === 'UPDATE'
          ? sql`SELECT 1 FROM users WHERE id=${u} AND status='ACTIVE' FOR UPDATE`
          : sql`SELECT 1 FROM users WHERE id=${u} AND status='ACTIVE' FOR SHARE`);
        if (rows.length === 0) throw new ApiError(403, 'ACCOUNT_DISABLED');   // รวมกรณี admin ที่จองแทนแล้วถูกปิดบัญชีระหว่างทาง
      }
      // (3) ชุดห้อง: คงที่ หรือ resolver ที่รันหลัง user lock แล้วจึงนิ่ง (deactivate) — เรียงตาม hashtext เสมอ
      const rooms = plan.roomIds ?? await plan.resolveRoomIds!(tx);
      for (const k of [...new Set(rooms)].map(hashKey).sort())
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${k})`);            // ponytail: one writer per room; ceiling = 3 rooms
      // (4) เวลาตัดสินใจ = อ่านหลังได้ lock ครบ (now() ค้างที่เวลาเริ่ม tx — รอ lock 10 วินาทีแล้ว guard จะเพี้ยน; C2-10)
      const [{ at }] = await tx.execute(sql`SELECT clock_timestamp() AS at`);
      const r = await fn(tx, at, rooms);                                      // fn ทำ re-read FOR UPDATE / อ่าน rooms FOR SHARE ใต้ lock เอง
      await auditRepo.insert(tx, actor, r.audit);
      const enqueued = await notificationsRepo.enqueue(tx, r.notifications);  // outbox, ส่งจริงโดย drain loop ใน jobs/index.ts + jobs/drain.ts
      return { value: r.value, enqueued };
    });
  } catch (e) {
    throw await mapPgErrorAfterRollback(e);   // 23P01 → SLOT_UNAVAILABLE (+ query alternatives ที่นี่ — tx ที่ abort แล้ว query ไม่ได้: 25P02, C1-07)
  }
  if (out.enqueued > 0) setImmediate(() => jobs.kick('notify.send'));          // หลัง commit เท่านั้น; พลาดได้ — loop 10 s ตามเก็บ
  return out.value;
}
```

`POST /admin/users/:id/deactivate` ทำ contract นี้ตรง ๆ ใน `modules/users/service.ts`: global `users:last-admin` lock → target user `FOR UPDATE` → resolve future room ids → ordered room locks → decision time → cancel/audit/outbox ใน transaction เดียว. Booking create/reschedule ทำลำดับ users → rooms ใน `modules/bookings/service.ts`

การทดสอบใน race gate: create-vs-deactivate ทั้งสองทิศ (barrier, ต้องไม่ `40P01`), จองแทนโดย admin ที่ถูก disable ระหว่างทาง → 403, deactivate-vs-`PATCH role`-vs-CSV import (mixed `LAST_ADMIN`), create-vs-`PATCH /admin/rooms/:id` (TC-ROOM-028), `23P01 → 409` ไม่ใช่ `500/25P02` (TC-CON-001)
:::

:::details กติกาอีก 6 ข้อ: naming, schemas, env, hc client, migrations, สอง SPA → image เดียว (6 ข้อ)
**Naming.** ไฟล์ kebab-case; ตาราง/คอลัมน์/JSON snake_case (Drizzle `casing: 'snake_case'` แปลงให้); TS camelCase; enum values และ ErrorCode UPPER_SNAKE; route tree ประกอบแบบ code-based ใน `router.tsx`; package scope `@reserveflow/*`; job names `booking.sweep`, `notify.send`

**Validation ปัจจุบัน.** API ประกาศ zod schemas ใกล้ route และใช้ `readJson`/`parseBody`; `docs.ts` แปลง validator ที่ reuse ได้ด้วย `z.toJSONSchema` และมี inventory test กัน route หลุดจาก OpenAPI. SPA ใช้ controlled React forms/HTML validation และแสดง server error envelope; ไม่มี react-hook-form/resolvers หรือ shared schema directory ใน build ปัจจุบัน

**Env.** `apps/api/src/env.ts` parse runtime env ตอน boot; frontend ใช้ same-origin paths และไม่มี Sentry/VITE secret. `.env` ที่ root ถูก gitignore และ template อยู่ที่ `.env.example`

**API client.** SPA ทั้งสองใช้ thin same-origin `fetch` wrapper ใน `src/api/client.ts`, parse shared `ErrorEnvelope` เป็น `ApiClientError` และไม่มี dependency จาก frontend ไป `apps/api`; จึงไม่มี server code ใน Vite bundleและไม่ต้องตั้ง CORS/credentials ข้าม origin

**Migrations.** `pnpm --filter api db:generate` → `drizzle-kit generate` เขียน `drizzle/NNNN_<name>.sql`; ของที่ Drizzle เขียนไม่ได้ (EXCLUDE, trigger, grants, audit index migration) ใช้ custom migration แล้วเขียน SQL มือในโฟลเดอร์เดียวกัน ทุกไฟล์ขึ้นต้น `SET lock_timeout='5s'` apply local ด้วย `pnpm db:migrate`; production `deploy.yml` รันคำสั่งเดียวกันผ่าน `DATABASE_URL_MIGRATE` ก่อน `flyctl deploy` — ไม่ migrate ตอน API boot และไม่ `drizzle-kit push` นอก local. ชุดปัจจุบันมี `0000`–`0009`

**สอง SPA → Vercel project เดียว.** root script `build:vercel` build ทั้ง `apps/web` และ `apps/admin` แล้วคัดลอก admin dist ไป `apps/web/dist/admin`; `vercel.json` เสิร์ฟ employee SPA ที่ `/`, admin SPA ที่ `/admin/*` และ rewrite `/api/*` ไป Fly จึงยังใช้ cookie origin เดียวโดยไม่มี CORS. `apps/api/Dockerfile` build/copy dist ทั้งสองชุดไว้ด้วยเพื่อให้ Fly เป็น static fallback และเป็น origin ของ staging. สอง SPA เป็น router bundle แยกกัน ดังนั้น `AppModeSwitch` ใช้ plain anchor `/rooms` ↔ `/admin/`; render เฉพาะ role `ADMIN`, mark current mode ด้วย `aria-current` และรองรับ sidebar admin แบบ collapsed. โค้ด FE ที่ใช้ร่วมอยู่ใน `packages/ui` / `packages/shared` ไม่ก็อปสองที่
:::

:::details ทำไมไม่แยก `packages/db` และ `packages/email`
ทั้งสองมีผู้ใช้คนเดียวคือ `apps/api` — package ที่มี consumer เดียวคือ abstraction ที่มี implementation เดียว ซึ่งเป็นสิ่งที่เราตกลงว่าจะไม่สร้าง การแยกออกไปได้มาแค่ `package.json` เพิ่ม 2 ไฟล์, build order ใน turbo, และ type boundary ที่ต้อง export/re-export ทุกครั้งที่เพิ่มตาราง แต่ไม่ได้ความปลอดภัยหรือ reuse ใด ๆ (SPA ไม่ควรแตะ Drizzle schema อยู่แล้ว — pnpm strict node_modules กันไว้ให้) สิ่งที่ใช้ร่วมกันจริงในปัจจุบันคือ constants, enums และ error contracts ใน `packages/shared`; runtime zod schemas ยังอยู่ใกล้ API routes. ถ้าวันหนึ่งมี service ที่สองต้องอ่าน DB หรือส่งอีเมลจึงค่อยย้าย module ที่มีผู้ใช้มากกว่าหนึ่งตัว
:::

### 7.3 การแบ่ง ownership สำหรับ 1–3 devs

แบ่งตาม **area ไม่ใช่ layer**: 3 คนไม่พอจะมี "คน FE / คน BE" แล้วรอกันข้าม sprint คนที่ทำ Admin Users ควรแก้ทั้ง route, service และหน้า UI ของตัวเองใน PR เดียว โดยมี `packages/shared` เป็นจุดที่ต้องคุยกัน และ booking core อยู่กับ Lead เสมอ

:::details ข้อเสนอ ownership 6 area (repository ยังไม่มี `.github/CODEOWNERS`)
| Area | Paths | Owner | หมายเหตุ |
|---|---|---|---|
| Booking core + DB | `apps/api/src/{modules/bookings,modules/availability,db,jobs}`, `packages/shared/src/{constants,enums}.ts` | Lead | constraint, transaction helpers และ sweep — ที่ที่ผิดแล้วเกิด double booking; แนะนำ review 2 คนถ้าทีมมี 3 |
| API อื่น ๆ | `apps/api/src/{auth,modules/*,email,lib}` | Dev A (หรือ Lead ถ้าทีม 2) | users/CSV, rooms, settings, reports, templates |
| Employee SPA | `apps/web` | Dev B | booking form, my bookings, check-in |
| Admin SPA | `apps/admin` | Dev A/B สลับตาม sprint | calendar board, users |
| Shared contract + UI | `packages/shared/src`, `packages/ui` | ทุกคนแก้ได้, Lead review | เปลี่ยน enum/error/token UI = เปลี่ยน contract หลายแอป |
| Infra/CI | `infra/`, `.github/` | Lead | |

```text
# ตัวอย่าง CODEOWNERS หากทีมเลือกเพิ่มในอนาคต (ไฟล์นี้ยังไม่มีใน repository)
/apps/api/src/modules/bookings/   @lead
/apps/api/src/db/                 @lead
/apps/api/src/jobs/               @lead
/packages/shared/                 @lead
/apps/web/                        @dev-b
/apps/admin/                      @dev-a
/infra/ /.github/                 @lead
```
:::
