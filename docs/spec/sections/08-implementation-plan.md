<!-- id: plan -->
## 08 · แผนการพัฒนา (Implementation Plan)

หัวข้อนี้แบ่งเป็นสองชั้น: **สถานะ as-built ด้านล่างคือความจริงของผลิตภัณฑ์ปัจจุบัน** ส่วน phase/ticket/estimate ถัดไปเป็น ledger แผนเดิมที่เก็บไว้เพื่อ traceability ของ `T-xxx`, `FR-xxx` และ `TC-xxx` เท่านั้น ไม่ใช่ backlog ที่รับรองแล้ว ไม่ใช่บันทึกเวลาที่ใช้จริง และไม่ใช้อนุมานว่ามี dependency, route, pipeline, staging หรือ automated E2E ตามข้อความเก่า

### สถานะ as-built ของเวอร์ชันสุดท้าย

| พื้นที่ | สถานะที่ส่งมอบ |
|---|---|
| Employee app | Login ด้วย Employee ID + password; ค้นหา 3 ห้อง; ปฏิทินวัน/สัปดาห์; จอง/ดู/แก้รายละเอียด/เลื่อนเวลา/ยกเลิก; QR และ self check-in; demo check-in เฉพาะ local guard; โปรไฟล์และขนาดตัวอักษร |
| Admin app | Dashboard, ปฏิทิน, การจอง, ห้อง/รูป/QR, ผู้ใช้/CSV, settings/วันหยุด, reports, email queue และ audit; ADMIN สลับ employee/admin mode ได้จาก sidebar |
| Account provisioning | guarded initializer เป็นเส้นทางพร้อมใช้สำหรับบัญชี canonical; admin/backend invite/reset token และ outbox มีอยู่ แต่ final employee web ซ่อน `/set-password` และ `/forgot` จึงยังไม่เป็น flow end-to-end |
| Data | PostgreSQL migrations `0000`–`0009`; EXCLUDE constraint กันจองซ้อน; initializer แบบ guarded สร้าง 3 ห้อง + 8 แผนก + พนักงาน 80 + admin 1 โดยไม่สร้าง booking/session/notification demo |
| Delivery | repository มี Docker/Fly config สำหรับ app `reserveflow-api` ที่เสิร์ฟ employee `/`, admin `/admin/`, API `/api/` และ jobs จาก image เดียว พร้อม Supabase PostgreSQL และ workflow migrate → Fly → full-stack smoke; การเชื่อม project/secrets จริงเป็นขั้น deploy นอก repository |
| Verification | CI ปัจจุบันมี lint, typecheck, Vitest บน PostgreSQL และ build; browser journeys/E2E เป็น manual checklist และ **ยังไม่** เป็น Playwright job ใน CI |

> :icon[warn] การเรียกเวอร์ชันนี้ว่า final หมายถึง **functional baseline ใน repository** ไม่ใช่การรับรอง production readiness: secrets, SMTP จริง, backup restore drill, deployment health และ browser UAT ต้องตรวจใน environment ปลายทางก่อนเปิดใช้จริง

รายละเอียด W0–W8 ด้านล่างคือประวัติแผนที่นำมาสู่ baseline นี้; ค่าที่ขัดกับตาราง as-built, source code หรือหัวข้อ 09 ให้ยึดสามแหล่งหลังตามลำดับ และข้อความว่า "ผ่าน", "required", "demo" หรือ "DoD" ใน ledger หมายถึง **เป้าหมายเดิม** ไม่ใช่หลักฐานว่ารันแล้ว

### 8.1 ตาราง Phase (Phase table)

ตารางนี้เก็บ baseline การวางแผนเดิมและ exit criteria สำหรับ audit ย้อนหลัง ไม่ใช่สถานะ workflow ปัจจุบัน

| Phase | ช่วง | เป้าหมาย | Exit criteria |
|---|---|---|---|
| **MVP** · W0 | 4 วัน | ปิดคำถามค้างกับธุรกิจ, repo + compose + CI เขียวบน app เปล่า, design tokens, schema ร่างแรก, **2 spike ที่เป็น gate**: better-auth vertical (T-008) และ SMTP relay จริง (T-009) | `pnpm dev` ขึ้นครบ 3 apps, CI ผ่านทุก job บน main, หัวข้อ 02 §2.4 ได้คำตอบ Q-09/Q-11 + seed facts; T-008 ตัดสินแล้วว่าใช้ better-auth หรือ hand-rolled **ก่อน** schema freeze (T-007); T-009 ส่งอีเมลจริงออกจากบัญชี `noreply@` ของบริษัทได้ 1 ฉบับ (หรือเปิด RK-03 fallback ทันที) |
| MVP · W1 | Foundation | DB + constraints + seed, better-auth, set-password flow, **admin user management + CSV import**, settings, audit | เป้าหมายเดิมคือ admin สร้าง user → user รับ email → ตั้งรหัส → login; เวอร์ชัน final มี backend invite/reset + outbox แต่ไม่มี employee `/set-password`/`/forgot` landing จึงยังไม่ใช่ flow end-to-end |
| MVP · W2 | Rooms & availability | rooms CRUD, holidays, `/availability` + `/calendar` พร้อม masking, หน้าค้นหา/ห้อง/เลือกเวลา, calendar board | **Demo 1**: ค้นหาห้อง → เห็น slot ว่าง/ไม่ว่าง → calendar day/week แสดงผล (ข้อมูล seed) |
| MVP · W3 | Booking core | `POST /bookings` (idempotency, advisory lock, constraint→409 — ผลลัพธ์มีสองทางเท่านั้น: `201 CONFIRMED` หรือ `409 SLOT_UNAVAILABLE`), list/detail/cancel/reschedule API, booking form, My bookings | เป้าหมายเดิมมี `race` job แยก; เวอร์ชัน final อาศัย PostgreSQL integration tests + EXCLUDE constraint และไม่มี `race` job แยกใน CI |
| MVP · W4 | Notifications | outbox + in-process scheduler + SMTP + templates + .ics, reminder, dashboard | final ส่งมอบ outbox/templates/.ics/queue; SMTP จริงและ delivery client verification ยังต้องทำใน environment ปลายทาง |
| MVP · W5 | Check-in & lifecycle | QR check-in หน้าห้อง (เข้า MVP — CB-02), self/admin check-in, `booking.sweep` (auto-release/complete), admin calendar, reports, settings page | เวอร์ชัน final: สแกน QR → เปิดหน้าห้อง → ผู้ใช้กดเช็กอินอย่างชัดเจน → แสดง result panel ในหน้าเดิม; ไม่ mutate ตอน mount และไม่มี modal/door unlock claim |
| MVP · W6 | Hardening | a11y, security checklist, k6 p95, deploy pipeline + backups + restore drill, runbooks, Thai copy | **Release candidate** `vX.Y.Z-rc.1` บน staging; ด่านปล่อยรุ่น 1–3, 5, 7, 9 (หัวข้อ 09) ผ่าน |
| MVP · W7 | UAT | UAT กับ 8 ทีมบน staging (Mailpit), fix rounds, seed prod data, SMTP relay ตรวจจริง | ด่าน 4, 6, 8 ผ่าน; bug P1 = 0, P2 ≤ 5 และมี owner |
| MVP · W8 | Go-live / hypercare | deploy `vX.Y.Z`, hypercare, retro | ระบบใช้งานจริง ≥ 3 วันทำการไม่มี P1; backup heartbeat เขียว |
| **Phase 1.1** | ~3 สัปดาห์หลัง go-live | admin D&D, facility run-sheet, in-app bell, CSV export, filter polish | backlog เดิม; automated E2E เป็น acceptance target เท่านั้นและยังไม่มีใน repository |
| **Phase 2** | backlog | heatmap polish, Webboard banner, SSO, recurring/waitlist, kiosk | เปิดเมื่อธุรกิจขอและมี metric รองรับ (§8.7) |

:::chart
{"type":"bar","title":"ประมาณการเดิมต่อสัปดาห์ (W0–W7)","unit":"h","max":100,
 "series":[{"label":"W0","value":64},{"label":"W1","value":92},{"label":"W2","value":88},{"label":"W3","value":84},{"label":"W4","value":52},{"label":"W5","value":88},{"label":"W6","value":76},{"label":"W7","value":60}]}
:::

กราฟนี้เป็น estimate ตอนวางแผน ไม่ใช่ time tracking ของการพัฒนาจริง: ตามสมมติฐานเดิม W1–W6 ส่วนใหญ่อยู่เหนือ capacity สุทธิของทีม 2 คน (≈ 64 h/สัปดาห์ ที่ focus 80 %) และต่ำกว่าทีม 3 คน (≈ 96 h)

### 8.2 Ticket รายสัปดาห์ (Week-by-week tickets)

ขนาดเดิม: **S ≈ 4 h · M ≈ 8 h · L ≈ 16 h · XL ≈ 24 h** (รวม test, review, แก้ comment) — เป็น estimate ไม่ใช่ actual effort; ledger มี **66 ticket ของ MVP** (W0–W8) + 6 traceability ticket `T-102`…`T-108` ที่ reconcile สถานะ final ใน §8.7 (T-101 QR check-in ย้ายเข้า W5 ตามมติ CB-02)

:::details กติกาการอ่านตาราง และ DoD ที่ใช้กับทุก ticket (4 ข้อ)
- **ขนาดกับปฏิทิน**: ตัวเลข h ต่อสัปดาห์คือภาระที่ต้องจัดสรร ส่วนจะจบเมื่อไรขึ้นกับจำนวน dev ตาม §8.8 (focus จริง ≈ 80 % → dev หนึ่งคน ≈ 32 h สุทธิ/สัปดาห์ ⇒ 3 คน ≈ 96 h, 2 คน ≈ 64 h, 1 คน ≈ 32 h; **baseline ของแผน 8 สัปดาห์คือ 3 คน** — C1-06) W0 เป็น 4 วัน ≈ 64 h และ **อยู่นอกกรอบ 8 สัปดาห์**: 8 สัปดาห์นับ W1→W8 ส่วน W0 คือสัปดาห์ตั้งต้นที่ต้องได้คำตอบธุรกิจ + 2 spike ก่อนเริ่มนับ (ถ้าธุรกิจนับ W0 รวมด้วย ให้เลื่อน go-live ไป 1 สัปดาห์ — ต้องตกลงเป็นลายลักษณ์อักษรใน W0)
- **พื้นที่**: `api` (Hono + domain), `db` (Drizzle schema/migrations/seed), `web` (`apps/web` + `packages/ui`), `admin` (`apps/admin`), `infra`, `qa`, `shared` (`packages/shared`)
- **DoD เดิมของ ticket ที่มี endpoint** ตั้งเป้า zod schema, OpenAPI, error envelope, audit mutation และ integration test ต่อ PostgreSQL; endpoint จริงให้ยึดหัวข้อ 06 และ source code เพราะบาง route ใน ledger ไม่ได้ส่งมอบ
- **DoD เดิมของ ticket ที่มีหน้าจอ** ตั้งเป้า states ว่าง/กำลังโหลด/ผิดพลาด, keyboard/focus/responsive/Thai copy และ axe ตาม WCAG; repository final ไม่มี Playwright/axe job หรือ `tests/e2e/axe-allowlist.json` จึงต้องถือ accessibility browser pass เป็น manual validation จนกว่าจะเพิ่ม automation

FR/TC อ้างจาก RTM หัวข้อ 02 และ test matrix หัวข้อ 09 (`TC-CON-001` … `TC-ROOM-028`); R-xx/V-xx = review findings ใน **ภาคผนวก ง (ผลการรีวิว)**; RK-xx = ความเสี่ยง §8.5
:::

:::details W0 · Bootstrap — 4 วัน, 64 h · รวม 2 spike ที่เป็น gate (9 ticket)
ตัดสินใจ auth/email ก่อน schema freeze

| ID | งาน | พื้นที่ | ขึ้นกับ | ขนาด | Definition of Done | FR/TC |
|---|---|---|---|---|---|---|
| T-001 | Repo bootstrap: pnpm workspaces + Turborepo + Biome + `packages/config` (tsconfig bases, Vite config), โครง folder ตามหัวข้อ 07 | infra | – | S | `pnpm -r build` ผ่านบน apps เปล่า 3 ตัว; `turbo run lint typecheck` เขียว; README บอก 3 คำสั่งแรก | – |
| T-002 | `infra/compose.yml` (postgres 18 + btree_gist, Mailpit), `.env.example`, zod-validated env loader ใน `apps/api` | infra | T-001 | S | `docker compose up` → psql ต่อได้, Mailpit UI :8025; API ไม่ start ถ้า env ขาด พร้อมบอกชื่อตัวแปร | TC-OPS-026 |
| T-003 | CI final ใน `.github/workflows/ci.yml`: `lint`, `typecheck`, `test` (Vitest + PostgreSQL service) และ `build` | infra | T-001, T-002 | M | มี 4 jobs ตาม source; ไม่มี `migrations-check`, `race`, E2E หรือ a11y job แยก | TC-MIG-025 |
| T-004 | Design tokens + `packages/ui` bootstrap: Tailwind v4, custom React components, Noto Sans Thai/Inter สำหรับ login, semantic tokens ใน `tokens.css`, `StatusBadge`, `formatDate()` ใน shared; **ไม่มี shadcn/ui หรือ Storybook ใน final dependency graph** | web | T-001 | M | final ใช้ token/component source จริงเป็น reference; contrast และ accessibility browser pass ยังเป็น manual validation ไม่ใช่ axe job | NFR-6 (Accessibility) |
| T-005 | ยืนยันกับธุรกิจ: Q-09 (login 2 ช่อง), Q-11 (max duration), รายชื่อ admin, ชื่อ 8 แผนก, ระบบ email บริษัท (Workspace/M365), hosting/domain | qa | – | S | บันทึกคำตอบลง `docs/decisions/W0-confirmations.md`; ข้อที่ไม่ได้คำตอบใช้ default ของ หัวข้อ 02 §2.4 และระบุว่าเป็น default | – |
| T-006 | `apps/api` skeleton: Hono, pino + request-id, error envelope, `GET /api/healthz` `/readyz`, hand-authored OpenAPI 3.1 ที่ `/api/openapi.json` และ Swagger UI ที่ `/api/docs`; **ไม่มี `@hono/zod-openapi`/Scalar** | api | T-002 | M | `/api/readyz` → 503 เมื่อ DB/sweep ไม่พร้อม และ 200 เมื่อพร้อม; error มี `request_id`; contract ปัจจุบันยึด `apps/api/src/docs.ts` | TC-OPS-026 |
| T-007 | Drizzle schema ครบทุกตาราง (users, sessions, accounts, verifications (better-auth), **`password_setup_tokens`** (ของเรา — D-29/C2-06: id, user_id, token_hash UNIQUE, purpose CHECK INVITE/RESET/FORGOT, expires_at, used_at, created_by), departments, rooms, features, room_features, business_hours, holidays, settings, bookings, booking_attendees, notifications, audit_logs — ตามหัวข้อ 05) + `drizzle-kit generate` → SQL committed | db | T-002, **T-008** | L | migrate บน DB เปล่าผ่าน; ชื่อ column = snake_case ตรงหัวข้อ 05; `status/role/checkin_method` เป็น `text + CHECK` ไม่ใช่ PG enum; review โดย lead | หัวข้อ 05 |
| T-008 | Auth spike เดิมใช้ตัดสิน better-auth; final ใช้ better-auth สำหรับ session/sign-in/change-password แต่ account provisioning และ token claim เป็น custom transaction/SQL บน `users`, `accounts`, `password_setup_tokens` และ outbox — **ไม่พึ่ง `auth.api.createUser`/`setUserPassword` เป็น contract ของระบบ** | api | T-002 | M | final behavior ยึด `apps/api/src/auth` และ `modules/users`; `BETTER_AUTH_SECRET` บังคับใน production | RK-02, TC-AUTH-009 |
| T-009 | **Spike SMTP relay จริง (gate)**: IT ระบุ Workspace หรือ M365 → ส่ง 1 ฉบับจาก CI ด้วย Nodemailer ผ่านเส้นทางที่ IT อนุญาต (Workspace SMTP relay / M365 SMTP AUTH + app password — **connector ตาม IP ใช้กับ prod ตรง ๆ ไม่ได้: egress IP ของ Fly เป็นแบบแชร์/หมุนได้ ต้องเป็น SMTP AUTH หรือซื้อ dedicated IPv4 ~$2/เดือน — ต้องได้คำตอบใน W0 ไม่ใช่ W6 (หัวข้อ 09 §9.1)**) เข้ากล่องบริษัท + Gmail + Outlook; ยืนยัน SPF/DKIM/DMARC ของ `noreply@`; เก็บค่า env ที่ใช้ | infra | T-005 | S | อีเมลถึง 3 กล่องไม่ตก Junk **หรือ** เปิด fallback Postmark/SES + ขอ DNS จาก IT ทันที (RK-03); ผลใน `docs/ops/email-verification.md` (T-073 ทำซ้ำแบบเต็มใน W7) (C1-18) | RK-03, NFR-5, ด่าน 6 |
:::

:::details W1 · Foundation — 92 h · สัปดาห์ร้อน, T-015 คือตัวเลื่อนได้ (9 ticket)
| ID | งาน | พื้นที่ | ขึ้นกับ | ขนาด | Definition of Done | FR/TC |
|---|---|---|---|---|---|---|
| T-010 | Custom migration: `CREATE EXTENSION btree_gist`, EXCLUDE A (CONFIRMED/CHECKED_IN ไม่ทับกันต่อห้อง — constraint เดียวของระบบตาม CB-01), CHECK `end_at > start_at`, กริด 15 นาที, hard max 12 ชม., `audit_logs` BEFORE UPDATE/DELETE trigger raise, roles `rf_owner`/`rf_app` + grants | db | T-007 | M | integration test: insert ทับ → `23P01`; adjacent `[13:00,14:00)`+`[14:00,15:00)` ผ่าน; `UPDATE audit_logs` ด้วย `rf_app` ถูก raise | FR-003, TC-CON-001, TC-AUD-016 |
| T-011 | Canonical initializer: Horizon/Summit/Grove ห้องละ 20 คน + microphone/projector, 8 แผนก, settings, AU-001 admin และ AU-002..AU-081 employees; password รับจาก protected environment | db | T-010 | S | `pnpm db:initialize --apply` ผ่าน guard บน DB ที่ migrate แล้วและยังว่าง/เป็น canonical partial; ตรวจ invariant 3 ห้อง + 81 users และ operational tables ว่าง | – |
| T-012 | better-auth: login ด้วย `employee_code` + password (argon2id) เท่านั้น; wrapper resolve ไปยัง internal email credential โดยไม่เปิด email เป็น public identifier, session ใน Postgres, cookie `__Host-sid` httpOnly/Secure/Lax, sliding 7 วัน, **`remember_me` = คุกกี้ค้างเครื่อง (ไม่ติ๊ก = คุกกี้อายุเซสชันเบราว์เซอร์ — ปิดเบราว์เซอร์แล้วหลุด)**, lockout 5/15 นาที, rate limit; `POST /auth/sign-in` (wrapper), better-auth `sign-out` `change-password`, `GET /me`; implement ตามผล spike T-008 (ตัดสินไปแล้วใน W0 — ไม่มี timebox กลาง W1; C1-17) | api | T-007, T-008 | L | TC-AUTH-009: login ผิด 5 ครั้ง → 423 ข้อความกลาง ๆ, login ถูก → cookie flags ครบ, **ติ๊ก `remember_me` → คุกกี้มี `Max-Age`; ไม่ติ๊ก → ไม่มี `Max-Age`/`Expires`**, `/me` 200, logout ลบ session row; change-password revoke session อื่น; บัญชี DISABLED → 403 | TC-AUTH-009, TC-RATE-024 |
| T-013 | Token infrastructure บน `password_setup_tokens` รองรับ INVITE/RESET/FORGOT ใน schema; final API ส่งมอบ `POST /api/v1/auth/set-password` และ admin invite/reset + outbox/`notify.send` แต่ **ไม่มี `POST /auth/forgot` และไม่มี employee `/set-password`/`/forgot` route** | api | T-012 | M | backend ทดสอบ single-use/expiry/revoke session; account email อาจมีลิงก์ `/set-password?token=` แต่ employee landing ถูกซ่อน จึงต้องทำ UI/route ให้ครบก่อนเรียก flow นี้ว่า end-to-end | TC-AUTH-009, TC-USR-017 |
| T-014 | Admin users API: list/create/update/deactivate/reactivate/delete/import, resend-invite/reset-password, last-admin/self guards, session revocation และ directory | api | T-012, T-013 | L | integration tests ครอบคลุม create/invite/resend/reset, deactivate/reactivate, booking effects, domain validation และ last-admin races; **ไม่มี forgot endpoint** และ account-link journey ยังไม่ end-to-end เพราะ employee landing ถูกซ่อน | R-01, TC-USR-017, TC-RBAC-010 |
| T-015 | CSV import: `POST /admin/users/import?dry_run=` (UTF-8 BOM, upsert by `employee_code`, รายงาน duplicate/invalid/unknown dept) + modal ใน admin (อัปโหลด → ตาราง dry-run → ยืนยัน → ผล) | api/admin | T-014, T-018 | M | ไฟล์ 80 แถวมี 3 แถวผิด → dry-run ชี้บรรทัด, ยืนยัน → 77 invite ใน Mailpit, รันซ้ำ → 0 สร้างใหม่; modal ใช้คีย์บอร์ดครบ, ตารางผลมี `<caption>` | TC-USR-017 |
| T-016 | Departments API (`GET /departments`, `POST/PATCH /admin/departments`), settings `GET /settings` (public in-company, cache 5 นาที) `PUT /admin/settings` (zod whole-doc + **`If-Match` จาก `ETag` ของ `GET /settings` ใต้ advisory lock `settings` → ไม่ตรง = 409 VERSION_CONFLICT, C2-08**) `PUT /admin/business-hours` (7 แถว ชุดเดียวทุกห้อง), audit helper และ RBAC guards | api | T-012 | M | as-built ใช้ `createRequireAuth()`/`createRequireAdmin()` + ownership/status checks ใน route/service; ไม่มี `can()` module กลาง. TC-RBAC-010 ครอบ route × actor ตาม test ที่มี; settings ผิด schema → validation error; **admin A เปิดฟอร์มค้าง → B แก้ grace → A save ด้วย `If-Match` เก่า → 409 ไม่ใช่การย้อนค่าเงียบ ๆ (C2-08)**; audit มี before/after และ redact mobile | TC-RBAC-010, TC-AUD-016 |
| T-017 | Web shell: TanStack Router + auth guard + layout/nav final = ค้นหาห้อง, การจองของฉัน, ตารางเวลาห้องทั้งหมด, โปรไฟล์; Login ใช้ Employee ID + password และไม่มี Register/Dashboard/forgot/set-password landing | web | T-004, T-012, T-013 | M | final ตรวจ login/reload/logout ด้วย unit/integration + manual browser; ยังไม่มี automated E2E/axe job; sign-in ไม่มีช่อง email/mobile | TC-AUTH-009, TC-A11Y-008 |
| T-018 | Admin shell + Users (A8/A9): ตาราง/filter, sheet สร้าง/แก้ไข, invite/reset actions, ปิด/เปิดใช้งาน และ CSV import | admin | T-004, T-014 | L | component/unit + manual browser validation; invite/reset button ถึง backend/outbox แต่ลิงก์ยังไม่มี employee landing จึงไม่อ้าง journey ตั้งรหัส/login end-to-end | TC-USR-017, TC-A11Y-008 |
:::

:::details W2 · Rooms & availability — 88 h (7 ticket)
| ID | งาน | พื้นที่ | ขึ้นกับ | ขนาด | Definition of Done | FR/TC |
|---|---|---|---|---|---|---|
| T-020 | Rooms API: `GET /rooms`, `GET /rooms/:id`, `GET /rooms/:id/photo`, `GET /features`, `POST/PATCH /admin/rooms`, `PUT /:id/features`, `POST/DELETE /:id/photo` และ holidays; room writer serialize กับ booking ผ่าน advisory/row locks; final เก็บรูปเป็น PostgreSQL `bytea` และส่งผ่าน photo endpoint — **ไม่มี sharp, filesystem volume, `/uploads` หรือ image-resize dependency** | api | T-016 | L | integration ครอบคลุม active/capacity/features/photo validation และ create-vs-room-update; booking ที่มีอยู่ไม่ถูก auto-cancel เมื่อปิดห้อง | FR-011, US-001, TC-ROOM-028 |
| T-021 | Slot/time math as-built: server ใช้ `apps/api/src/lib/{time,window}.ts`; employee web ใช้ `apps/web/src/lib/slots.ts` mirror contract สำหรับ grid 30 นาที, วันหยุด และ half-open ranges; `APP_TZ='Asia/Bangkok'`; ไม่มี date-fns dependency | api/web | T-016 | M | unit/API tests ครอบขอบเวลาสำคัญ; contract ต้องแก้ server validator และ slot mirror พร้อมกันเพราะไม่ได้แชร์ implementation เดียว | TC-VAL-012 |
| T-022 | `GET /availability` (**ทุกห้อง active** + reasons/busy_until จาก SQL หัวข้อ 05 §5.8 — ไม่กรองห้องออก C1-24), `GET /calendar?from&to&room_id` (≤ 31 วัน) ผ่าน `toViewerBooking()` 3 ระดับ FULL/PUBLIC/BUSY แล้วเติม `owner_display_name` ยกเว้น private BUSY ของ FACILITY; index `(room_id, start_at)`; `GET /bookings?scope=mine` โครง | api | T-020, T-021 | M | TC-PRV-004 ระดับ API: PRIVATE ของคนอื่น → `visibility:"BUSY"`; calendar ทั่วไปเติม `owner_display_name` แต่ JSON **ไม่มี key** title/owner/description; detail/list BUSY และ private BUSY ของ FACILITY ไม่มี `owner_display_name`; contract test ครบทุก reason; เดือนที่มีวันหยุดคืน `holidays[]` | FR-001, FR-002, US-007, TC-PERF-007 |
| T-023 | Web: route ค้นหาห้องเป็น entry หลัก (ไม่มีหน้า Home) พร้อม compact filter, URL search params, การ์ด 3 ห้อง, availability/reason states และ feature pills | web | T-017, T-022 | M | unit + manual browser ตรวจ filter/refresh/empty states; nearest-slot suggestion ยังอยู่ T-107 และไม่มี E2E/axe job | FR-002, FR-011, US-001 |
| T-024 | Web: Room detail + เลือกวัน/เวลา (E3): ปฏิทินเดือน (ปิดอดีต/>30 วัน/วันปิด/วันหยุด), timeline slot 30 นาที (แดง = ไม่ว่าง), select เริ่ม/สิ้นสุดผูกกัน, ขั้นต่ำ 1 ชม., ปุ่ม "จองห้องนี้" → ส่งต่อ T-035 | web | T-023 | L | จอง 13:00–15:00 และ 16:30–17:30 ได้ (แก้ R-26); slot ไม่ว่างไม่ใช่สีอย่างเดียว (ไอคอน+ข้อความ); refetch เมื่อกลับมาโฟกัสแท็บ; คีย์บอร์ดเลือก slot ได้; 375 px ไม่มี scroll แนวนอน | FR-001, FR-002, TC-A11Y-008 |
| T-025 | Custom `SlotGrid`/calendar: day = 3 ห้อง × 18 แถว, week = ห้องที่เลือก × 7 วัน, legend, elapsed-slot shading, booked owner display และ URL state | web | T-022 | XL | final ใช้ custom React/CSS grid; day/week/keyboard/responsive ตรวจ manual และไม่มี automated E2E performance/a11y gate | FR-001, US-007, TC-PERF-007, TC-A11Y-008 |
| T-026 | Admin: Rooms list/form สำหรับชื่อ ชั้น ความจุ features รูป และ active; admin สร้าง QR ด้วย `uqr` | admin | T-018, T-020 | M | API integration + manual browser ตรวจ CRUD/photo/QR และผลต่อ employee search; ไม่มี automated E2E | FR-011 |
:::

:::details W3 · Booking core — 84 h · gate ต้องเขียวก่อนปิดสัปดาห์ (7 ticket)
| ID | งาน | พื้นที่ | ขึ้นกับ | ขนาด | Definition of Done | FR/TC |
|---|---|---|---|---|---|---|
| T-030 | `POST /bookings`: route-local zod validation → replay pre-read → `createBooking()` ใช้ `withTx()` โดย advisory lock `(actor,idempotency_key)` → replay query → lock ACTIVE actor/owner `FOR SHARE` เรียง id → `lockRooms()` → binding room `FOR SHARE` → decision time → validate policy/buffer → INSERT CONFIRMED ใต้ EXCLUDE A → outbox + audit. ไม่มี generic `mutate()` abstraction, `request_hash` หรือ attendee `user_id`; attendee เก็บ email/name เท่านั้น. ชน slot ถูก map หลัง rollback เป็น 409 พร้อม alternatives | api | T-010, T-021, T-022 | L | integration: จองสำเร็จ → 201 CONFIRMED, ทับ → 409; key ซ้ำ payloadเดิมหรือต่าง → 200 booking เดิม + `Idempotent-Replayed`; duration ผิด policy → 422; concurrency กับ room/deactivate ไม่สร้าง booking ขัด invariant | FR-003, FR-004, US-002, TC-CON-001, TC-IDEM-011, TC-VAL-012, TC-ROOM-028 |
| T-031 | `GET /bookings` (scope mine/attending/all, status, room, from/to, page; admin เพิ่ม owner/department/q), `GET /bookings/:id` (masked + `can{edit,reschedule,cancel,check_in}` + history) | api | T-030 | M | TC-PRV-004 ครบทุก scope; คนอื่นเปิด id ของ PRIVATE → BUSY view (ไม่ใช่ 403); `can` ตรงกับ permission matrix หัวข้อ 02 ทุก cell | FR-008, US-007, TC-PRV-004 |
| T-032 | `PATCH /bookings/:id` (version บังคับ): update ภายใต้ constraint A ใน tx เดียว — สำเร็จ หรือ 409 SLOT_UNAVAILABLE โดยแถวเดิม **ไม่เปลี่ยนและไม่เสีย slot เดิม** (CB-03: ไม่มีจังหวะใดที่การจองไม่ถือ slot เลย); แก้ title/attendees/special_request/privacy ไม่กระทบ slot; `PUT …/attendees` ต้องส่ง `version` เช่นกัน; predicate เดียว (CONFIRMED; owner ก่อน start, admin ก่อน end; CHECKED_IN แก้ไม่ได้) ใช้ใน PATCH/attendees/`can` (C1-13, C1-28); `version+1`, outbox RESCHEDULED | api | T-030 | L | TC-EDIT-013: version เก่า → 409 (ทั้ง PATCH และ attendees); แก้ใบ CHECKED_IN → 409; ย้ายเข้าช่วงอดีต → 422; ย้ายไปทับใบอื่น → 409 แล้วอ่านซ้ำยังเห็นเวลาเดิม + `version` เดิม (CB-03); reschedule แข่งกับ create บน slot เป้าหมาย → หนึ่งเดียวสำเร็จ | FR-008, Q-13, TC-EDIT-013 |
| T-033 | `POST /bookings/:id/cancel` (owner: CONFIRMED และ now < end_at; admin: CONFIRMED/CHECKED_IN ก่อน end_at + reason บังคับ ≥ 3 ตัวอักษร), outbox CANCELLED; deactivate-user ยกเลิก booking อนาคตใน users service | api | T-030 | S | TC-CAN-005: cancel → `/availability` ว่างทันที; cancel ซ้ำ → 200 (idempotent-by-state, หัวข้อ 06 C-11); admin ไม่ใส่ reason → 422; deactivate user ยกเลิกใบอนาคตและแจ้งผู้เกี่ยวข้อง | FR-008, US-005, TC-CAN-005 |
| T-034 | Concurrency test plan เดิม: parallel create/idempotency/cancel/reschedule/adjacent slots | qa/api | T-030, T-032, T-033 | M | final มี PostgreSQL integration tests + EXCLUDE/advisory-lock enforcement แต่ **ไม่มี `apps/api/test/race/` หรือ CI `race` job แยก**; dedicated stress loop ยังเป็น hardening backlog | FR-003, NFR-1 (Concurrency), TC-CON-001, TC-IDEM-011 |
| T-035 | Web: booking form + confirmation/error states; final employee UI ใช้ React state/custom fields และไม่แสดง attendee/email controls หรือข้อความรับรองการส่งอีเมล; **ไม่มี React Hook Form dependency** | web | T-024, T-030 | L | ปุ่มส่ง disabled ระหว่างรอ, Idempotency-Key คงเดิมเมื่อ retry และ 409 แสดง inline; browser flow ตรวจแบบ manual เพราะไม่มี automated E2E | FR-003, FR-004, US-002, TC-IDEM-011 |
| T-036 | Web: การจองของฉันพร้อม status filters, booking detail/actions และ cancel dialog; final employee UI ซ่อน attendee/email surface | web | T-031, T-033 | L | API integration + manual browser ตรวจ cancel/visibility/focus/status; ไม่มี automated E2E | FR-008, US-005, US-007, TC-CAN-005, TC-PRV-004 |

Reschedule **UI** (E7) ไปอยู่ T-046 ใน W4 — API อยู่ W3 ครบ (gate ครอบคลุมแล้ว); ย้ายเพื่อให้ W3 ไม่เกิน 84 h และ W4 ฝั่ง web มีงาน
:::

:::details W4 · Notifications — 52 h (6 ticket)
| ID | งาน | พื้นที่ | ขึ้นกับ | ขนาด | Definition of Done | FR/TC |
|---|---|---|---|---|---|---|
| T-040 | Outbox + in-process scheduler ใน `apps/api/src/jobs/index.ts`: `booking.sweep` ทุก 60 s, `notify.send` ทุก 10 s + post-commit kick และ `maintenance.daily` เวลา 03:15 Asia/Bangkok; advisory locks, stop บน SIGTERM, Nodemailer/Mailpit และ `WORKER_ENABLED`; **ไม่มี Sentry dependency** | api | T-013 | M | drain ใน `jobs/drain.ts` ใช้ `FOR UPDATE SKIP LOCKED`, retry/FAILED, deterministic Message-ID; `/readyz` ตรวจ sweep staleness เฉพาะ instance ที่เปิด worker | FR-009, NFR-5 (Reliability), TC-EMAIL-014 |
| T-041 | Templates react-email ภาษาไทยครบ 7 template keys ตาม matrix หัวข้อ 02 §2.7 (CONFIRMED, CANCELLED, RESCHEDULED, REMINDER, AUTO_RELEASED **owner+attendees**, AUTO_RELEASED_ADMIN, ACCOUNT) + .ics ด้วย ical-generator (UID = booking id@domain, SEQUENCE = version, METHOD REQUEST/CANCEL, UTC "Z") + `GET /bookings/:id/ics`; PRIVATE ไม่มีชื่อเรื่องใน subject | api | T-040 | L | TC-EMAIL-014 ผ่าน Mailpit: ผู้รับถูกคนทุก event ตาม matrix หัวข้อ 02, .ics แนบและ parse ได้ (byte-identical หลัง MIME round trip), UID คงที่ข้าม RESCHEDULED และ SEQUENCE +1, CANCEL มี METHOD:CANCEL + STATUS:CANCELLED; **auto-release: owner ได้ .ics CANCEL (ไม่ใช่แค่ attendees) และ admin ที่เป็น owner ได้ทั้งสองฉบับ (C2-02)**; snapshot test ทุก template | FR-007, FR-009, US-003, TC-EMAIL-014 |
| T-043 | Integration coverage สำหรับ cancel-vs-rebook, reschedule-vs-create, clock boundaries และ outbox-in-transaction | qa/api | T-032, T-034 | M | final ใช้ PostgreSQL integration/table-driven tests; dedicated 20-round `race` job ไม่มีใน CI | TC-CON-001, TC-EDIT-013, TC-EMAIL-014 |
| T-045 | Admin: Dashboard (A1): KPI วันนี้ (จำนวน booking วันนี้, no-show เดือนนี้), tiles สถานะห้องตอนนี้ (ว่าง/จองแล้ว/กำลังใช้) — KPI utilization ต่อใน T-056 | admin | T-031 | M | ตัวเลขตรงกับ SQL oracle บน seed; tile ห้องอัปเดตเมื่อ refetch 60 s; ไม่มีปุ่ม Export (ย้ายไป reports) | FR-012, V-09 |
| T-046 | Web final ทำ reschedule **inline ใน booking detail** โดยคงห้องเดิมและโหลด time picker ของห้องนั้น; 409/version conflict ไม่ทำให้ slot เดิมหาย; attendee endpoint ยังอยู่ backend แต่ employee UI ซ่อน attendee editing | web/api | T-032, T-036, T-041 | M | API integration + manual browser ตรวจ conflict/slot preservation/return-to-detail; ไม่มี automated E2E | FR-008, Q-13, TC-EDIT-013 |
| T-047 | `booking.sweep` ทุก 60 s ทำ reminder T−15 ผ่าน outbox/dedupe ตามเวลาเริ่มล่าสุด | api | T-040 | S | integration test ยืนยัน reminder idempotent และ reschedule สร้าง dedupe รอบใหม่; health ใช้ state ใน process + `/readyz`/structured logs ไม่ใช่ Sentry cron monitor | FR-009, V-05, TC-JOB-020 |
:::

:::details W5 · Check-in & lifecycle — 88 h (11 ticket) · QR check-in ย้ายเข้า MVP (CB-02)
| ID | งาน | พื้นที่ | ขึ้นกับ | ขนาด | Definition of Done | FR/TC |
|---|---|---|---|---|---|---|
| T-050 | `POST /bookings/:id/check-in` endpoint เดียว (owner / attendee-by-email → SELF หน้าต่าง `start−15 → LEAST(end_at, start+15)`; admin **ที่ไม่ใช่ owner/attendee** → ADMIN ถึง end_at; `checked_in_at/by`), `can.check_in` ใช้เส้นตายเดียวกับ server | api | T-031 | M | TC-CHK-019: ก่อนหน้าต่าง → 422, หลัง → 422, ซ้ำ → 200 `already_checked_in`, คนนอก → 403; audit มี method; CHECKED_IN ไม่ถูก auto-release; **ADMIN ที่เป็น owner ของใบนั้น → `checkin_method='SELF'` และใช้หน้าต่าง self ไม่ใช่ถึง `end_at` (C2-12 ข้อ check-in precedence)**; **ใบยาว 30 นาทีขณะ grace=45 → เช็กอินได้ถึง `end_at` เท่านั้น และถูก AUTO_RELEASED ที่ `end_at` ไม่ใช่ COMPLETED (TC-GRC-027, CF-02)**; ต้องมี test ที่ยืนยันว่า server, `can.check_in` และ sweep อ่านนิพจน์ `LEAST(end_at, start_at + checkin_grace_minutes)` จาก helper ตัวเดียวใน `packages/shared` | FR-010, US-006, TC-CHK-019, TC-GRC-027 |
| T-101 | **QR check-in (ย้ายจาก Phase 1.1 เข้า MVP — CB-02)**: admin สร้าง QR static ต่อห้องด้วย `uqr`; สแกนเปิด `/check-in/:roomCode`, auth guard กลับ URL เดิม แล้วหน้าแสดงรายละเอียดก่อน ผู้ใช้ต้องกดปุ่มเช็กอินจึง `POST /check-in/rooms/:room_code`; server เลือก booking CONFIRMED ที่เข้าเงื่อนไขและเรียง `start_at` ก่อน; ผลสำเร็จ/เร็วไป/ไม่มีใบ/ซ้ำแสดงเป็น result panel ในหน้าเดิม — **ไม่ auto-submit ตอน mount, ไม่มี modal และไม่กล่าวอ้างว่าปลดล็อกประตู** | web/api | T-050 | M | integration + manual browser ตรวจ explicit press, redirect, success/error/idempotent states; repository ไม่มี `qrcode`/Playwright dependency | FR-010, US-006, TC-QR-006, TC-CHK-019 |
| T-051 | `booking.sweep` lifecycle: idempotent AUTO_RELEASED ก่อน COMPLETED, ใช้ `LEAST(end_at, start_at + checkin_grace_minutes)` เดียวกับ permission/check-in; auto-release เขียน audit + owner/attendee cancel .ics + admin notice ผ่าน outbox ส่วน complete เขียน audit | api | T-047, T-050 | M | PostgreSQL integration tests เรียก job functions โดยตรงเพื่อยืนยัน boundary/idempotency/rollback; **ไม่มี `/api/test/run-job` endpoint ใน final API** | FR-010, TC-QR-006, TC-JOB-020, TC-GRC-027 |
| T-052 | Check-in UI: web มีปุ่ม "เช็กอิน" ใน My bookings/detail, same-page result states และ demo control เฉพาะ DEV + capability; admin มี check-in actions | web/admin | T-050 | M | integration + manual browser ครอบคลุม self/demo/auto-release; ไม่มี Playwright run-job journey ใน CI | FR-010, US-006, TC-CHK-019 |
| T-053 | Admin calendar (A3 แบบอ่านอย่างเดียว: reuse `SlotGrid`, ทุกห้อง day/week, คลิกบล็อก → detail + actions ยกเลิก/เช็กอิน); D&D ไป 1.1 | admin | T-025, T-050 | M | axe ผ่าน; บล็อก PRIVATE เห็นชื่อเรื่องเต็ม (admin = FULL); action จาก calendar ใช้ endpoint เดิมทั้งหมด | FR-001, FR-010 |
| T-054 | Admin: All bookings (A4: กรองห้อง/ผู้ใช้/สถานะ/วันที่, ยกเลิกพร้อมเหตุผล, เช็กอิน) + Booking detail admin (A5: component เดียวกับ E5 + audit trail + actions) | admin | T-031, T-033 | L | ยกเลิกโดย admin → email owner + attendees พร้อมเหตุผล; ตารางแบ่งหน้า + sort อ่านด้วย screen reader; detail แสดง history ครบจาก API | FR-008, FR-006 (deviation CB-01: แทนด้วย admin cancel + เหตุผล) |
| T-055 | Reports API: `/admin/reports/utilization` (per room/month: used_hours clipped to business window ÷ available_hours, วันหยุดออก, เดือนปัจจุบันตัดที่ now), `/outcomes` (no-show rate), `/heatmap` (weekday×hour) | api | T-051 | M | TC-RPT-018: ผลตรงกับ SQL oracle บน dataset seed 1 เดือน; AUTO_RELEASED ไม่นับใน utilization แต่นับใน no-show; เดือนที่มีวันหยุด 1 วันตัวหารลด 27 h (3 ห้อง × 9 h); **ห้องที่ `created_at` อยู่กลางเดือน (และกลางวันทำการ) ได้ตัวหารเฉพาะตั้งแต่วินาทีที่สร้าง ไม่ใช่ทั้งเดือน (C2-09)** | FR-012, US-008, TC-RPT-018 |
| T-056 | Admin Reports page: date/room filters, utilization/outcomes/heatmap และ KPI dashboard | admin | T-055 | M | API/unit + manual browser ตรวจข้อมูลและ non-color labels; ไม่มี automated E2E/performance gate | FR-012, US-008, TC-RPT-018, TC-A11Y-008 |
| T-057 | Admin Settings page (A10): นโยบายการจอง (ขั้นต่ำ/ช่วง/ล่วงหน้า/max duration), เวลาทำการ + วันทำงาน, check-in (เปิด, หน้าต่าง, grace), reminder; **Holidays** CRUD; คำเตือน booking ที่กระทบเมื่อหดเวลาทำการ/เพิ่มวันหยุด (วนดึงทุกหน้า); ป้าย "มีผลกับการจองใหม่" vs "มีผลทันทีกับใบ live" ต่อกลุ่ม (05 §5.10); validation ข้ามคีย์จาก zod แสดงที่ฟิลด์ | admin | T-016, T-020 | M | แก้ค่าแล้ว `/settings` ใหม่ภายใน 5 นาที (cache) และ slot picker เปลี่ยนตาม; เพิ่มวันหยุดที่มี booking → รายการ + ลิงก์ไปยกเลิก (ไม่ auto-cancel); audit before/after | V-10, TC-VAL-012 |
| T-058 | `GET /admin/audit-logs` + หน้า Audit log (A12) ตารางอ่านอย่างเดียว กรองวันที่/ผู้กระทำ/entity | api/admin | T-016 | S | แถว before/after ไม่มี password_hash/mobile; employee เรียก → 404 | TC-AUD-016, TC-RBAC-010 |
| T-059 | Web: โปรไฟล์ final แสดงชื่อ/รหัส/แผนก, เปลี่ยนรหัสผ่าน, ตั้งค่าขนาดตัวอักษรและ sign out; employee UI ซ่อน email/mobile และไม่มี profile edit endpoint | web | T-017 | S | change-password revoke session อื่นผ่าน backend; responsive/focus ตรวจ manual และไม่มี axe job | TC-AUTH-009 |
:::

:::details W6 · Hardening → release candidate — 76 h (8 ticket)
| ID | งาน | พื้นที่ | ขึ้นกับ | ขนาด | Definition of Done | FR/TC |
|---|---|---|---|---|---|---|
| T-060 | Accessibility target เดิม: keyboard, visible focus, zoom/responsive, ไม่ใช้สีอย่างเดียว, reduced motion และฟอนต์ไทย | web/admin/qa | W2–W5 | L | final มี semantic/focus styles และ manual checklist แต่ **ไม่มี axe/Playwright required check**; ต้องรัน browser accessibility pass ก่อน production sign-off | NFR-6 (Accessibility), TC-A11Y-008 |
| T-061 | Security target: headers, cookie flags, CSRF/origin checks, resource-hiding 404, rate limits สำหรับ route ที่มีจริง (login/booking/check-in/account actions), dependency scan และ log redaction | api/infra | W5 | M | final CI ไม่ได้มี Trivy/security job แยกและไม่มี forgot route; ใช้ unit/integration tests + production checklist ในหัวข้อ 09 | NFR-3 (Security), TC-SEC-021, TC-RATE-024 |
| T-062 | Performance target เดิม: dataset 3 ปี, API p95 และ navigation budget | api/qa | T-025, T-063 | M | final ไม่มี k6/Playwright nightly หรือ performance report ที่ใช้เป็น release evidence; ต้องวัดใน isolated dataset ไม่ใช่ canonical demo DB ก่อน production sign-off | NFR-2 (Performance), TC-PERF-007 |
| T-063 | Delivery configuration final: Docker/Fly image เดียวสำหรับ employee/admin/API/jobs, Supabase bootstrap/migrations และ deploy workflow migrate → Fly → ตรวจ `/api/readyz`, `/`, `/admin/`; backup/restore assets ตามหัวข้อ 09 | infra | T-003 | L | repository มี config แต่ **ไม่ใช่หลักฐานว่า Fly/Supabase secrets, staging, backup upload หรือ restore drill ทำสำเร็จแล้ว**; ต้องตรวจ external environment ก่อน go-live | TC-BK-022, TC-MIG-025, TC-OPS-026 |
| T-064 | Observability final: structured pino logs, `/api/healthz`, `/api/readyz`, Fly health check, scheduler health และหน้า admin email queue/retry; **ไม่มี Sentry SDK, sourcemaps หรือ cron monitors** | api/infra/admin | T-040, T-063 | M | integration tests ครอบคลุม readiness/queue; external uptime/alert routing ยังต้องตั้งและทดสอบใน deployment | NFR-5 (Reliability), TC-OPS-026 |
| T-065 | Thai copy review: error catalogue (ข้อความ 409 จาก deck ตรงตัว), subject email, ข้อความว่าง/ผิดพลาด, glossary ในภาคผนวก จ ให้ตรงกับ UI; ไม่มีคำลงท้ายสุภาพใน system voice | web/admin | W5 | S | ไม่พบ hard-coded date format นอก `formatDate()` (ตรวจด้วย script); reviewer ธุรกิจ 1 คนอ่านผ่าน | V-09 |
| T-066 | เอกสาร: runbooks (deploy, rollback, restore, rotate secrets, incidents), คู่มือ admin + quick guide พนักงาน (ไทย, 1 หน้า), กรอก RTM Status + test report จาก CI artifacts | qa | W5 | M | ไฟล์ใน `docs/` ตามหัวข้อ 07; RTM ทุกแถว Must = Done พร้อมลิงก์ TC | R-02, V-08 |
| T-067 | Browser journeys 1–11 เป็น UAT checklist เดิม | qa | T-063 | M | final repository **ไม่มี Playwright dependency, test suite หรือ E2E CI job**; journeys ที่เกี่ยวกับ final scope ต้องรัน manual บน isolated test data | TC-A11Y-008, smoke |
:::

:::details W7 · UAT (≈ 60 h dev + เวลาธุรกิจ) และ W8 · Go-live / hypercare (9 ticket)
W8 ไม่ใช่ buffer งานพัฒนา (C1-06)

| ID | งาน | พื้นที่ | ขึ้นกับ | ขนาด | Definition of Done | FR/TC |
|---|---|---|---|---|---|---|
| T-070 | UAT 2 รอบกับตัวแทน 8 ทีม + admin บน staging **ด้วยข้อมูล seed/บัญชีทดสอบเท่านั้น (ไม่มี dump prod บน staging — C1-21)** (อ่าน email ผ่าน Mailpit หลัง basic-auth; ทุกคนเห็นกล่องร่วมกัน จึงห้ามมีข้อมูลจริง); script ตาม journeys; เก็บ feedback เป็น issue พร้อม severity | qa | T-067 | M | sign-off Must FR-001..004, 008, 009 + FR-007/010/011/012 ที่อยู่ใน MVP โดย admin + ≥ 2 พนักงาน; **FR-005/FR-006/US-004 รับทราบเป็น deviation "เปลี่ยนตามมติลูกค้า (CB-01)" ตาม RTM**; Should/Could ระบุ in/out ชัด; **รับทราบเป็นลายลักษณ์อักษร**: Admin D&D (NFR Usability) อยู่ใน 1.1 และนิยาม delivery rate = relay accepted (C1-22, C1-18) | ด่าน 4 |
| T-071 | Fix rounds จาก UAT (P1 ก่อน, P2 ตาม; ของที่ไม่ใช่ Must และใหญ่กว่า S → backlog 1.1 พร้อมบันทึกเหตุผล) | all | T-070 | L | P1 = 0; P2 ≤ 5 ทุกตัวมี owner + ticket 1.1 | – |
| T-072 | Seed prod: users CSV จริง (dry-run → import) **บน prod เท่านั้น**, ห้อง 3 ห้อง, admin จริง, วันหยุดปี 2569, settings; สร้าง ADMIN คนแรกผ่าน CLI ซ้อม dry-run/import/rollback ก่อนด้วย **CSV สังเคราะห์ที่มีรูปร่าง/ขนาดเดียวกัน** บน staging — staging เป็น seed-only ตลอดโครงการ ห้ามมีรายชื่อ HR จริง (C1-21/CF-05) | qa/admin | T-015, T-063 | S | dry-run ด้วย CSV สังเคราะห์บน staging ผ่านก่อน → import จริงบน prod; **admin จริง login ได้บน prod** (ไม่ใช่ staging); รายชื่อตรวจกับ HR ที่ต้นทาง ไม่คัดลอกไฟล์ออกจาก prod | ด่าน 8 |
| T-073 | Email จริง: SMTP relay บริษัท (หรือ transport สำรอง), ส่งทดสอบเข้า Gmail/Outlook/กล่องบริษัท, .ics เปิดได้ใน Google/Outlook/Apple, mail-tester ≥ 9 หรือ IT ยืนยัน SPF/DKIM | infra | T-041 | S | บันทึกผล 3 client ใน `docs/ops/email-verification.md` | ด่าน 6 |
| T-074 | **Pending:** สร้าง isolated restore drill จาก backup จริง พร้อม scrub/assert scripts, cleanup และผลลัพธ์ RTO; ห้ามโหลด dump prod เข้า staging/UAT. Repo ปัจจุบันยังไม่มี `infra/scrub-drill.sql`, `infra/drill-assert.sql` หรือ `docs/ops/drills.md` | infra | T-063 | S | restore schema/data/constraints ผ่านใน isolated DB, identity assertion เป็นศูนย์, บันทึกเวลาและผู้อนุมัติ | ด่าน 5, TC-BK-022 |
| T-075 | Go/No-go review: ไล่ด่านปล่อยรุ่นทั้ง 9 (หัวข้อ 09) ทีละข้อกับ lead + ตัวแทนธุรกิจ | qa | T-070–T-074 | S | checklist ติ๊กครบมีลิงก์หลักฐาน; วันเวลา go-live ตกลง (นอก 08:30–17:30) | ด่าน 1–9 |
| T-080 | Go-live: tag `vX.Y.Z` → approval → deploy (pre-dump, migrate, up) → smoke `@prod-safe` → ประกาศ + quick guide | infra | T-075 | S | `/readyz` 200, login page 200, `/api/v1/rooms` คืน 3 (C2-12); ประกาศส่งแล้ว | – |
| T-081 | Hypercare target 5 วันทำการ: ดู structured logs, readiness/sweep health, failed email queue, pending age และ backup heartbeat; ตอบคำถามผู้ใช้และ hotfix ผ่าน pipeline | all | T-080 | M | ไม่มี Sentry integration ใน final; external alert channel/uptime monitor ต้องกำหนดก่อน go-live | – |
| T-082 | Retro + จัดลำดับ Phase 1.1 (§8.7) ตาม feedback จริง | qa | T-081 | S | backlog 1.1 เรียงลำดับพร้อม estimate; ADR สำหรับสิ่งที่เปลี่ยนจากสเปก | – |
:::

### 8.3 ทีม ความเป็นเจ้าของ และพิธีกรรม (Team & rituals)

ส่วนนี้เป็น staffing/ownership model ของแผนเดิม ไม่ใช่รายชื่อทีมปัจจุบันหรือหลักฐานว่าพิธีกรรมเกิดขึ้นจริง

| บทบาท | เป็นเจ้าของ | Tickets หลัก |
|---|---|---|
| **Lead** (full-stack) | booking core + constraints + jobs: `apps/api/src/modules/bookings`, `apps/api/src/jobs`, `apps/api/src/db`, web slot helpers และ CI — ความถูกต้องเรื่อง concurrency ต้องอยู่กับคนที่เห็นทั้ง schema, tx และ test | T-007, T-010, T-021, T-030–T-034, T-043, T-047, T-050–T-051, T-063 |
| **Dev B** (web) | `apps/web` + `packages/ui` (SlotGrid, tokens), a11y ทั้งสองแอป — หน้าพนักงานคือสิ่งที่ 80 คนเห็นทุกวัน | T-004, T-017, T-023–T-025, T-035–T-036, T-046, T-052 (web), T-059, T-060 |
| **Dev C** (admin — ถ้ามี) | `apps/admin` ทั้งหมด + admin-facing API ที่แยกได้ชัด (users CRUD, rooms CRUD, reports) — CRUD + ตารางเป็นหลัก แยกออกจาก core ได้สะอาด | T-014–T-016, T-018, T-020, T-026, T-045, T-053–T-058 |

ทุกโหมด lead เป็นเจ้าของ booking core; ถ้ามี **2 คน** dev B ถือทั้ง web และ admin ส่วน lead รับ admin-facing API (T-014/T-016/T-020/T-055) — ผลต่อปฏิทินอยู่ที่ §8.8

:::details พิธีกรรมและกติกา branch (rituals & branching)
- **Rituals**: daily 15 นาที (เขียนในแชทแทนประชุมได้ถ้าไม่มี blocker); **demo ธุรกิจทุกศุกร์ 30 นาทีบน staging** ตาม milestone §8.4 (คนดู: admin ตัวจริง + ตัวแทน 1–2 ทีม); วางแผนจันทร์ 30 นาที (ย้าย ticket, เช็ค hot week); review PR ภายใน 4 ชั่วโมงทำการ
- **Branching / CI ปัจจุบัน**: trunk-based บน `main`; GitHub Actions รัน `lint`, `typecheck`, `test` (PostgreSQL service) และ `build`; ยังไม่มี `e2e-smoke`, `migrations-check`, `race` หรือ `a11y` เป็น job แยก จึงห้ามอ้างว่า automated gates เหล่านั้นผ่าน — ใช้ manual browser checklist เพิ่มจนกว่าจะทำ automation; migration เป็น forward-only ตามหัวข้อ 09
:::

### 8.4 Milestones และ demo (Milestones & demos)

ตารางนี้เป็น demo sequence ที่วางไว้เดิม ไม่ใช่บันทึกว่า staging/demo เกิดขึ้นแล้ว; หลักฐาน final ต้องมาจาก CI 4 jobs, deployment checks และ manual UAT ปัจจุบัน

:::details ตาราง demo รายสัปดาห์ (7 รอบ)
| เมื่อ | Demo | สิ่งที่ต้องเห็น | สิ่งที่ยังไม่ต้องเห็น |
|---|---|---|---|
| ปลาย W1 | (ภายใน) | admin สร้าง user → email → ตั้งรหัส → login | หน้าค้นหา |
| **ปลาย W2** | Search + calendar | ค้นหา 13:00–14:00 10 คน projector → ห้องที่ตรง → slot timeline (แดง/ว่าง) → calendar day/week 3 ห้อง; admin เพิ่ม/แก้ห้อง | การจองจริง (ใช้ seed) |
| **ปลาย W3** | Race test (แผนเดิม) | เป้าหมายคือ 100 คนกดพร้อมกัน → 1 สำเร็จ, 99 ได้ 409; final ไม่มี CI `race` job แยก แต่มี constraint + PostgreSQL integration coverage | email |
| **ปลาย W4** | Email + .ics | จองแล้วได้ email ยืนยัน + .ics เปิดใน Google/Outlook; ยกเลิก/เลื่อนเวลา → email แจ้งพร้อม .ics อัปเดต; reminder T−15 | check-in |
| **ปลาย W5** | Check-in / auto-release | สแกน QR → เปิดหน้า → กดเช็กอิน → result panel ในหน้าเดิม; self/admin check-in; booking ไม่ check-in → AUTO_RELEASED + slot ว่าง; reports/settings/holidays | polish |
| **ปลาย W6** | Release candidate | `vX.Y.Z-rc.1` บน staging ผ่าน pipeline จริง, axe/k6/security report, restore drill log, runbooks | — |
| ปลาย W7 | UAT sign-off | ผล UAT + รายการ 1.1 | — |
:::

### 8.5 ทะเบียนความเสี่ยง (Risk register)

สามข้อที่ต้องเฝ้าจริง: **RK-08** ทีม 2 คนไม่พอกับปฏิทิน 8 สัปดาห์ (โอกาสสูงถ้า staffing ไม่ตัดสินใน W0) · **RK-03** relay อีเมลของบริษัทใช้ไม่ได้ → FR-009 ตก UAT · **RK-01** บัญชี Fly/Supabase หรือโดเมนบริษัทไม่พร้อมจนไม่มี staging/โดเมนจริงให้ UAT — ทั้งสามมี owner และเส้นตายอยู่ใน W0

:::details ทะเบียนความเสี่ยงฉบับเต็ม RK-01…RK-10 (10 ข้อ)
| ID | ความเสี่ยง | ผลกระทบ | โอกาส | การรับมือ | เจ้าของ |
|---|---|---|---|---|---|
| RK-01 | บัญชี managed ทั้งสอง (Fly/Supabase) หรือโดเมน/DNS บริษัทไม่พร้อม → staging (`reserveflow-staging.fly.dev`) ไม่เกิดใน W1 / prod ไม่มี canonical origin ให้ UAT + go-live | สูง | ต่ำ | เปิดบัญชี + สร้าง staging ตั้งแต่ W0–W1; staging และ prod ใช้ `*.fly.dev` ได้จึงไม่รอโดเมนบริษัท; ถ้าจะใช้ custom domain ให้ขอ DNS จาก IT ใน W0 (T-005); ทางถอย: runtime = 1 Dockerfile + 1 Postgres URL → กลับแผน VM (ADR-008) ได้ในครึ่งวัน | ธุรกิจ / lead |
| RK-02 | better-auth ไม่รองรับ login ด้วย `employee_code` หรือ admin plugin ไม่ตรงที่ต้องการ | กลาง | กลาง | spike แนวดิ่ง T-008 ใน W0 (gate ก่อน schema freeze); ถ้าไม่ผ่าน → ตัดสินใช้ hand-rolled sessions (~150 บรรทัด, schema `sessions` เดิม) **ตั้งแต่ W0** ไม่ใช่ fallback กลาง W1 | lead |
| RK-03 | SMTP relay บริษัทไม่ได้ (M365 ปิด SMTP AUTH / ต้อง connector), ส่งช้า, ตกสแปม → FR-009 (Must) ไม่ผ่าน UAT | สูง | กลาง | **T-009 ใน W0 ส่งจริง 1 ฉบับจากเส้นทางที่ IT อนุญาต** (gate); ไม่ผ่าน → เปิด transport สำรอง Postmark/SES + ขอ DNS ทันที (เปลี่ยน config 1 ที่ T-040); T-073 ตรวจเต็ม 3 client ใน W7; นิยาม SLO = relay accepted + ดู bounce ที่กล่อง `MAIL_FROM` ต้องได้การยอมรับเป็นลายลักษณ์อักษร (ภาคผนวก ซ) | lead |
| RK-04 | ธุรกิจยืนยัน login 3 ช่อง / self-registration (Q-09) หลัง W1 | ต่ำ | ต่ำ | ปิดใน T-005; mobile = equality check เพิ่ม 1 ชม.; self-registration ปฏิเสธ (ขัด R-20) | lead |
| RK-05 | ช่องโหว่ concurrency ที่ไม่อยู่ใน EXCLUDE (เช่น path ใหม่ลืม advisory lock) | สูง | ต่ำ | constraint เป็นด่านสุดท้ายเสมอ; final ใช้ PostgreSQL integration tests และ code review ของ mutation paths; dedicated `race` CI job ยังเป็น backlog ไม่ใช่ required check ปัจจุบัน | lead |
| RK-06 | Calendar board hand-rolled ช้า/ใช้ยากบนมือถือ หรือ p95 > 2 s บนข้อมูล 3 ปี | กลาง | กลาง | k6 + EXPLAIN ตั้งแต่ W2 (T-022), วัดจริง W6 (T-062); fallback = day view อย่างเดียวบน < 640 px, virtualize สัปดาห์เฉพาะที่เปิด | dev B |
| RK-07 | Scope creep จาก demo/UAT (เช่น Webboard, recurring, kiosk) | กลาง | สูง | ทุกคำขอใหม่ลง backlog 1.1/2 พร้อม ADR 3 บรรทัด; demo ทุกศุกร์ทำให้ surprise เล็ก; เกณฑ์ W7: non-Must และ > S → 1.1 | lead |
| RK-08 | ทีม 2 คน = capacity สุทธิต่ำกว่างาน ~25 % (C1-06); คนหนึ่งป่วย 1 สัปดาห์ | สูง | สูง (ถ้า 2 คน) | ตัดสินใจ staffing ใน W0 (§8.8): 3 คน หรือ 2 คน + ปฏิทิน ~10–11 สัปดาห์ หรือ 2 คน + cut list อนุมัติล่วงหน้า; slip list ตัดตามลำดับ; W8 = go-live/hypercare ไม่ใช่ buffer งานพัฒนา | lead |
| RK-09 | บั๊กเวลา/ภาษา: พ.ศ. vs ค.ศ., UTC vs Asia/Bangkok ข้ามวัน หรือ date field ทำงานต่างกัน | กลาง | กลาง | shared `ThaiDatePickerField` lazy-load `@daypicker/buddhist`; UI เป็น พ.ศ. แต่ URL/API เป็น Gregorian; `formatDate()` จุดเดียว + unit test ขอบเวลา; booking grid ยังคงเป็น custom component | dev B |
| RK-10 | sweep/outbox บั๊กส่ง email ซ้ำหรือถล่ม (reminder ทุกนาที) | กลาง | ต่ำ | unique `notifications_dedupe` ใน outbox + Message-ID คงที่ต่อแถว, local ใช้ Mailpit, kill switch = `WORKER_ENABLED=false`, ตรวจ failed queue/log จากหน้า admin; external alert routing เป็นงานก่อน go-live | lead |
:::

### 8.6 เกณฑ์ปล่อยรุ่น, go-live และ rollback

ด่านปล่อยรุ่นที่อ้างใน ledger เดิมเป็นเป้าหมาย; สำหรับ repository ปัจจุบันให้ใช้ checklist as-built ในหัวข้อ 09: CI 4 jobs ผ่าน, migration สำเร็จ, Fly `/api/readyz` ตอบ 200, employee/admin SPA เปิดหน้าแรกและ deep link ได้บน Fly origin เดียว, backup/restore และ browser UAT มีหลักฐาน

**กติกาเมื่อ prod มีปัญหา**: :icon[warn] fix-forward สำหรับ migration แบบ backward-compatible; rollback employee/admin/API/jobs พร้อมกันด้วย Fly image/commit ที่ทราบว่าดี; rollback schema ทำเฉพาะตาม runbook หลังมี backup ที่ทดสอบ restore แล้ว ทุกเหตุการณ์ต้องมี incident note

:::details Checklist วัน go-live (วัน D)
```
[ ] D-1  CI 4 jobs เขียวบน sha ที่จะปล่อย; ตรวจ migration แบบ backward-compatible และประกาศหน้าต่าง deploy
[ ] D-1  รัน backup workflow และพิสูจน์ว่า artifact เข้ารหัสถูกอัปโหลด; restore drill ล่าสุดยังอยู่ใน SLA
[ ] D    deploy workflow: migrate ผ่าน session pooler → flyctl deploy → /api/readyz 200
[ ] D    ตรวจ Fly origin เดียว: /, /admin/, deep links และ /api/readyz; ไม่มี cache บน API
[ ] D    admin ตรวจ 3 ห้อง/81 users/settings โดยไม่ใช้ E2E ที่สร้าง booking/user ทิ้งใน canonical DB
[ ] D    ทดสอบ browser flow บนข้อมูลทดสอบที่แยกออก: login → จอง → conflict/reschedule → QR check-in → cancel
[ ] D+1..5 ดู structured logs, failed email queue, pending age, failed logins และ backup heartbeat
```
:::

### 8.7 งานค้าง Phase 1.1 และ Phase 2 (Backlog)

รายการนี้คือ backlog snapshot ที่ reconcile กับ final source แล้ว: T-102–T-105 ยังไม่ส่งมอบ, T-107 ส่งมอบบางส่วน และ T-108 ส่งมอบแล้ว จึงไม่ควรรวมตัวเลข estimate เดิมเป็น commitment ใหม่โดยไม่ re-estimate

:::details Phase 1.1 — ledger 6 ticket พร้อมสถานะ final และ Phase 2 backlog
| ID | งาน | พื้นที่ | ขนาดเดิม | สถานะ final / DoD ที่เหลือ | อ้างอิง |
|---|---|---|---|---|---|
| T-102 | Admin D&D reschedule บน calendar ด้วย keyboard alternative | admin | L | **ยังไม่ส่งมอบ**; ไม่มี `@dnd-kit`; ต้องเพิ่ม interaction + accessibility + conflict rollback | NFR-4 (Usability), TC-DND-023 |
| T-103 | Facility run-sheet และ FACILITY-only surface | admin/api | M | **ยังไม่ส่งมอบ**; route `/facility/run-sheet` ไม่มีใน final API | R-18, TC-RBAC-010 |
| T-104 | In-app bell + read state | web/api | M | **ยังไม่ส่งมอบ**; `GET /notifications` และ `POST /notifications/read` ไม่มีใน final API | FR-009 (C) |
| T-105 | CSV export จาก reports | api/admin | S | **ยังไม่ส่งมอบ**; `/admin/reports/export` ไม่มีใน final API | FR-012 |
| T-107 | Search/filter polish | web | S | **ส่งมอบบางส่วน**: URL filters + feature pills + เหตุผลห้องไม่ตรง filter มีแล้ว; nearest-slot suggestion/local persistence/capacity range ยังต้องยืนยันหรือพัฒนา | FR-011 |
| T-108 | Utilization/outcomes/heatmap report + reminder | api/admin | M | **ส่งมอบแล้ว** ผ่าน T-047/T-055/T-056; ไม่ใช่ backlog final | FR-012 |

**Phase 2 backlog** (ยังไม่ประเมิน): analytics polish · Webboard/announcement banner · SSO Google/M365 · recurring bookings + waitlist · kiosk door display · per-room hours · delivery webhook · PDF export · Teams/Google calendar sync · metrics/Grafana ถ้า structured logs/readiness ไม่พอ
:::

### 8.8 ประมาณการและ staffing (Estimate & staffing)

ตัวเลขด้านล่างคือ **estimate ก่อนพัฒนา** ไม่ใช่ actual effort, current staffing หรือ forecast ของงานที่เหลือ และต้องไม่ใช้วางแผน release ใหม่โดยไม่ re-estimate จาก backlog final ใน §8.7

| ทีม (สมมติฐานเดิม) | capacity สุทธิ (80 % focus) | estimate เดิม 544 h | go-live ตามแผนเดิม | เงื่อนไขเดิม |
|---|---|---|---|---|
| **3 คน** (lead + dev B + dev C) | ≈ 96 h/สัปดาห์ | ≈ 6 สัปดาห์ → จบใน W6 | **W8** :icon[check] | baseline ของวันที่ 8 สัปดาห์; W1/W3/W4 ไม่ร้อน; slack ≈ 15 % รับ UAT fixes |
| **2 คน** (lead + dev B) | ≈ 64 h/สัปดาห์ | ≈ 8.5 สัปดาห์ (≈ 7.9 ถ้าตัด cut list ข้อ 1–4 ≈ 40 h) | **W10–W11** | หรือ W8 เฉพาะเมื่อธุรกิจอนุมัติ cut list ทั้งหมดล่วงหน้า + ยอมรับว่าไม่มี buffer (ไม่แนะนำ) |
| **1 คน** (lead) | ≈ 32 h/สัปดาห์ | ≈ 16–18 สัปดาห์ | **W18–W20** | ไม่มีทางเป็น 8 สัปดาห์; ลำดับงานเดิม, demo ทุก 2 สัปดาห์ |

บรรทัด W0/W7/W8 และ Phase 1.1 ≈ 50–60 h เป็น planning assumptions ในอดีตเท่านั้น; final spec ไม่ยืนยันจำนวนคน ชั่วโมงจริง หรือวันที่ go-live

:::details ถ้าช้า ตัดตามลำดับนี้ — และสิ่งที่ห้ามตัด (5 ขั้น)
ตัดแล้ว **ย้ายไป 1.1 ไม่ใช่ทิ้ง**

1. รูปห้อง (แผนเดิม; final ส่งมอบ DB `bytea` + photo endpoint โดยไม่มี sharp) — 5 h เดิม · หน้า Audit log — 3 h เดิม · week view — 8 h เดิม
2. **Heatmap + outcomes report** (ส่วนของ T-055/T-056) → T-108; **คง utilization ต่อห้อง/เดือน** (ตารางเดียว, SQL มีแล้ว — เป็นสิ่งที่ deck ของบริษัทยกมา จึงไม่ใช่ตัวแรกที่ตัด C1-22) — ประหยัด 10 h
3. **Reminder T−15** (T-047) → T-108; sweep ยังต้องมีสำหรับ auto-release (T-051) — ประหยัด 4 h
4. **Feature filter polish** (ทางเลือก slot ใกล้สุด, pills) ใน T-023/T-024 → T-107 — ประหยัด ~6 h; ตัว filter ความจุ + อุปกรณ์เองห้ามตัด (US-001 Must)
5. CSV import UI 2-step modal (คง API + dry-run ผ่าน curl/Postman สำหรับ seed) — 4 h — ตัดท้ายสุดเพราะ seed 80 คนต้องใช้

Admin drag&drop ไม่ได้อยู่ใน cut list เพราะอยู่ใน Phase 1.1 ตั้งแต่ต้น — แต่ **NFR Usability ของ PDF ระบุ D&D** จึงต้องมี written waiver จากเจ้าของ requirement ใน W0 (ภาคผนวก ซ ข้อ 10); ถ้าไม่ได้ waiver → T-102 เข้า W6 และต้องมี dev C

**Must-have ตามแผนเดิม**: EXCLUDE constraints + advisory lock, masking, outbox, admin user management, account provisioning, a11y พื้นฐาน และ backup/restore ก่อน go-live; final มี PostgreSQL integration coverage แต่ไม่มี dedicated `race` gate และ account invite/reset ยังขาด employee landing จึงต้องไม่อ้างว่าสอง flow นี้ผ่าน end-to-end
:::

**ก่อน go-live จริงยังต้องยืนยัน**: owner ของ deployment/rollback, ช่วง deploy นอกเวลาทำการ, ผู้อนุมัติ production, ตัวแทน UAT, SMTP/backup/restore และผล manual browser journeys บนข้อมูลทดสอบที่แยกจาก canonical demo DB
