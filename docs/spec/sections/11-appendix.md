<!-- id: appendix -->
## 11 · ภาคผนวก (Appendix)

ที่มาของเอกสารทั้งหมดอยู่ที่นี่: ต้นทางที่ใช้เขียน, สิ่งที่ตัดสินไปแล้วและคำถามที่ปิดแล้ว, ผลรีวิวจากภายนอกกับผลพิสูจน์ของ spike, ศัพท์ เวอร์ชัน และ ADR — ปิดท้ายด้วยรายการเดียวที่ยังต้องให้บริษัทยืนยัน

**เนื้อหาหลักอ่านจบได้โดยไม่ต้องเปิดภาคผนวก** ที่นี่ตอบคำถามว่า "รู้ได้อย่างไร" และ "ทำไมถึงไม่ทำอีกแบบ" ไม่ใช่ "ระบบทำอะไร"

### 11.A :icon[doc] ที่มาของเอกสาร (Sources)

เขียนจากต้นทาง 6 ฉบับ: เอกสารความต้องการ (PDF), เอกสารนำเสนอของบริษัท, สไลด์ business requirement, ภาพอ้างอิง UI จาก Stitch, ร่างสเปกฉบับก่อนหน้า และบันทึกวิจัยภายใน

**กติกาเมื่อต้นทางขัดกัน** — ความต้องการ: PDF (S-01) > สไลด์ (S-03) > deck (S-02) > ภาพ Stitch (S-04); การออกแบบ: การตัดสินใจใน 11.B ชนะทุกฉบับ ตัวอย่างจริงสองเคส: FR-009 (สไลด์ข้าม แต่ PDF บอก Must → อยู่ใน MVP) และ check-in (deck บอก admin กดให้, PDF US-006 บอกพนักงานกดเอง → ทำทั้งสองทางบน endpoint เดียว)

:::details ตารางต้นทาง (6 ฉบับ)

| ID | เอกสาร | ไฟล์ / ที่มา | สิ่งที่ให้ | ใช้ที่ไหน |
|---|---|---|---|---|
| S-01 | เอกสารความต้องการอย่างเป็นทางการ (PDF) | `inputs/requirements.pdf` | FR-001..012 + MoSCoW, NFR 1–6, US-001..008, ตัวอย่าง RTM (ซึ่ง map ผิด เช่น FR-001→Login) | หัวข้อ 02 ใช้ ID เดิมทุกตัว และแก้ตัวอย่าง RTM ให้ถูก; TC-xxx หัวข้อ 09 |
| S-02 | เอกสารนำเสนอของบริษัท (deck) | `inputs/company.pdf` | 8 ทีม × 10 คน, 3 ห้อง, ขอบเขต employee/admin, workflow จอง, ตัวอย่าง conflict, check-in "ผ่านแอดมินหน้าห้อง", auto-release, dashboard/report, "ดู Webboard" | ตัวเลขภาพรวมหัวข้อ 00; กฎธุรกิจหัวข้อ 02; flow หัวข้อ 03; D-21, D-22; glossary 11.E (Reserved / Check-in / Auto Cancle) |
| S-03 | สไลด์ Business requirement (ภาพ) | อยู่ใน deck S-02 (ข้อความไม่อยู่ในไฟล์ .txt) | Login ก่อนจอง, เว็บ 24 ชม., ห้อง 08:30–17:30, ขั้นต่ำ 1 ชม., ล่วงหน้า 1 เดือน, ห้ามทับซ้อน, admin ตัดสินวาระเมื่อชน, คืน slot ทันที, 15 นาทีไม่เช็กอิน = auto-release; สไลด์ FR ข้าม FR-009 | D-01, D-02, D-11, D-12, D-16; business rules หัวข้อ 02 |
| S-04 | ภาพอ้างอิง UI จาก Stitch (พาสเทลเขียว) | ภาพ Login, Available Rooms, Room detail, left nav | Login Employee ID + Mobile + Password + ลิงก์ลงทะเบียน; 3 ห้อง Horizon/Summit/Grove; ปฏิทินเดือน + รายการ slot + dropdown 08:30/17:30 | หัวข้อ 10 (แผงต้นแบบ + design tokens); D-05, D-09 (ถอด mobile ออกจาก login), ถอดหน้าสมัครเอง; slot 30 นาทีแทนบล็อก 1 ชม. |
| S-05 | ร่างสเปกฉบับก่อนหน้า | `inputs/spec.html` (9 ส่วน: overview, plan, spec, flow, tech, data, mockups, qa, questions) | โครงเอกสาร, FR/NFR table, SQL EXCLUDE, concurrency sequence, mockups, Q-01..Q-20 | เก็บเกือบคำต่อคำ: ตาราง FR 5 คอลัมน์ (แถว FR-003/005/007/008/009), business rules 1–8, ตาราง NFR + คอลัมน์ Verification, GiST EXCLUDE + `slot` generated column + half-open, lifecycle, flow employee/admin + sequence A/B, security baseline, entity core + REST draft, ระบบสีพาสเทล + กฎ "ทุกสถานะมี text label", ชุด mockups, TC-xxx + release gates, ฟอร์แมตตาราง open question, "system at a glance" |
| S-06 | บันทึกวิจัยภายใน (ไม่ส่งมอบ) | `docs/build/research/{review,stack-a,stack-b,datamodel,api,ops,uiux,context7-notes}.md` | ทางเลือกและเหตุผลต่อชั้น, DDL ร่าง, API catalogue, ops/QA, ข้อเท็จจริงจากเอกสารไลบรารี | สังเคราะห์เป็น 11.B (ตัดสินใจ) และหัวข้อ 04 (stack); เมื่อขัดกันให้ 11.B ชนะ |
:::

:::details การอ่านร่างก่อนหน้าอย่างละเอียด (52 ข้อค้นพบ)

ร่าง S-05 เป็นเอกสาร *problem-framing* ที่ดี: อ่าน FR-001..012 จาก PDF ได้ถูกต้อง (โดยเฉพาะ FR-003 "DB คือด่านสุดท้าย", FR-005 `approval_mode` ต่อห้อง, FR-009 "email ล้มเหลวไม่ rollback การจอง"), วางแนวทาง concurrency ถูกตั้งแต่ต้น (`btree_gist` EXCLUDE + half-open `[start,end)` + Idempotency-Key), flow ให้ Admin เลือกผู้ชนะตรงกับสไลด์ และตั้ง open question 20 ข้ออย่างซื่อสัตย์ สิ่งที่ยังไม่มีคือของที่ทีม *สร้าง* ต้องใช้: RTM, admin user/room/settings management, mockup ของปฏิทิน (FR-001 Must), permission/notification matrix, การเลือก tech stack และคำตอบของคำถามที่ทีมตัดสินเองได้

การอ่านรอบนั้นได้ 43 ข้อ (`R-xx`) แล้วตรวจซ้ำโดย verifier: **CONFIRMED 32 · ADJUSTED 11 · REFUTED 0** (ที่ปรับส่วนใหญ่เพราะร่างเดิมระบุหลักการไว้แล้ว ช่องว่างจึงแคบกว่าที่เขียน หรือ severity สูงเกิน) verifier เพิ่มอีก 10 ข้อ (`V-xx`; High 1 · Medium 4 · Low 5) รวมเป็น **52 แถว** (R-32 ซ้ำกับ R-21 จึงรวมแถว) severity: Critical = ขวาง build หรือละเมิด Must · High = Must/US ตามรอยไม่ได้ · Medium = ระบุไม่พอ/ขัดกันเอง · Low = ขัดเกลา

**หมายเหตุ (2026-08-24):** ตารางนี้บันทึกตามสถานะ ณ เวลารีวิว — แถวที่คอลัมน์ "ผลในเอกสารนี้" อ้างกลไกอนุมัติ (`approval_mode`, `PENDING_APPROVAL`, constraint B, Approval Center, `CONFLICT_LOST`) หรือ QR ใน Phase 1.1 ถูกแทนที่ภายหลังโดยมติลูกค้า `CB-01`…`CB-04` (ดู 11.B กลุ่ม 5); พฤติกรรมปัจจุบันดูหัวข้อ 02–06

| ID | Sev | ประเด็นในร่างก่อนหน้า | ผลในเอกสารนี้ |
|---|---|---|---|
| R-01 | Critical | Admin user management ไม่มีทั้งหน้าและ API; nav "ตั้งค่าระบบ" และ "ลืมรหัสผ่าน" ไม่มีปลายทาง; ไม่มี audit การจัดการผู้ใช้ ทั้งที่ห้าม self-registration | Admin Users: list/search, create, CSV import (dry-run), edit, deactivate/reactivate, role, set-password token; ≥1 active admin, ห้าม deactivate ตัวเอง; audit ทุก action → 03, 06, 10; ticket W1 ใน 08 |
| R-02 | High (ปรับจาก Critical) | ไม่มี RTM แม้ PDF แสดงเป็น deliverable และตัวอย่างใน PDF ผิด | RTM เต็มตามคอลัมน์ PDF + Module path + Status → 02 |
| R-03 | High | Check-in มีแค่ QR (Phase 2, `checkins.token_hash`, `POST /check-in/:token`); deck บอก "ผ่านแอดมินหน้าห้อง", US-006 บอกพนักงานกดในระบบ | endpoint เดียว self + admin ใน MVP, QR deep link 1.1, auto-release ใน sweep → 02, 03, 05 |
| R-04 | High (ปรับ: มีหลักการ day/week แล้ว) | FR-001 ปฏิทินไม่มี layout 3 ห้อง, mockup, click/drag, admin variant, API shape; nav ปฏิทินไม่มีหน้า | CSS-grid board spec + mockup, `GET /calendar` → 04, 06, 10 |
| R-05 | High (หนักกว่าที่เขียน) | Rooms / settings / holidays ไม่มี CRUD ไม่มีหน้า; FR-005 (Must) ไม่มีที่ตั้ง `approval_mode`; ไม่มีตาราง holidays ทั้งที่ FR-012 อ้างถึง | Admin Rooms + settings/business_hours + holidays CRUD; กฎ master-data ไม่ auto-cancel → 02, 05, 06, 10 |
| R-06 | High (ปรับ: events มีแต่กระจาย) | FR-009 ไม่มี notification matrix — ผู้รับต่อ event, เวลา reminder, `.ics` METHOD/SEQUENCE ไม่ระบุ | Notification matrix 9 events + กฎ `.ics` → 02; outbox + `notify.send` → 05 |
| R-08 | High | Login 3 ช่อง (Stitch) ขัดกับคำถามที่ตั้งไว้เอง; ไม่มี password policy, ตัวเลข lockout, อายุ session, ความหมาย "Remember me"; มีลิงก์ลงทะเบียน | ตัดสินใน 11.B + หัวข้อ 02 (`employee_code` + password เท่านั้น; email คงอยู่สำหรับบัญชีและการแจ้งเตือน; ≥10 ตัวอักษร argon2id; lockout 5/15 นาที; session 7 วัน); better-auth → 04; checklist → 09 |
| R-09 | High | แผน 6 สัปดาห์บรรทัดเดียวต่อสัปดาห์; W5 "ตามเวลาที่เหลือ"; ไม่มี ticket/DoD/ลำดับพึ่งพา/user mgmt/seed | แผน W0–W8 ระดับ ticket + DoD + release gates, W1 = foundation → 08 |
| R-10 | High | Tech stack สองชุดเคียงกัน + สถาปัตยกรรม scale-ready เชิงสมมติ (Redis, Object storage, OTel, Storybook, webhooks, Supabase Cron) | ชุดเดียวพร้อมเหตุผล + runner-up → 04; รายการที่ตัดอยู่ในบล็อกถัดไป |
| V-01 | High | ข้อเสนอ admin-only check-in ทำให้ auto-release 15 นาทีขึ้นกับ admin คนเดียววิ่ง 3 ชั้น | `POST /bookings/:id/check-in` ร่วมกัน (owner / attendee / admin ในหน้าต่างเวลา) ทางเข้า self + admin; `checkin_method` SELF/ADMIN/QR → 02, 03, 06 |
| R-07 | Medium (ปรับจาก High: ผิดแค่ป้ายแผน) | FR-002 มี filter ความจุ/อุปกรณ์ใน Must แล้ว แต่แผนเขียนไว้ที่ Phase 1.1 → ขัดกันเอง | FR-011 ส่งใน MVP (W2) โดยยังติดป้าย Should ใน RTM → 02, 08 |
| R-11 | Medium (ปรับจาก High) | Deck ระบุ Admin "ดู Webboard" แต่ร่างไม่กล่าวถึง; ความหมายยังไม่แน่ | เข้ารายการยืนยันกับบริษัท 11.H; default ไม่สร้าง; ถ้าเป็นกระดานประกาศ = banner Phase 1.1/2 |
| R-12 | Medium (ปรับ: มีบางส่วนแล้ว) | Pending policy ไม่ครบ: ไม่ระบุว่า pending ทับ CONFIRMED ถูกปฏิเสธตอน submit, loser-rejection ไม่อยู่ใน SQL, EXPIRED ไม่มีผู้ผลิต, การแสดง slot ที่มี pending ไม่ชัด | กฎ B ใน 02; constraint B + approve txn + sweep `expire pendings` → 05; badge "มีคำขอรออนุมัติ" → 10 |
| R-13 | Medium (ปรับ: มีหลักการแล้ว) | Reschedule: ชะตา slot เดิมในห้อง MANUAL, deadline แก้ไข, สถานะเมื่อ admin reschedule ไม่ระบุ | กฎ reschedule/cancel ครบ → 02; flow → 03; `PATCH /bookings/:id` → 06 |
| R-14 | Medium | Drag & Drop มีแค่ bullet: ไม่มี view, สิ่งที่ลากได้, feedback 409, keyboard alt, licence FullCalendar (resource view = Premium) | **Future 1.1:** grid เขียนเอง + dialog "เลื่อนเวลา…" สำหรับคีย์บอร์ด; ยังไม่ได้ติดตั้ง drag-and-drop dependency → 04, 10; TC-DND-023 → 09 |
| R-15 | Medium | Auto-release job ไม่ระบุ schedule/SQL/idempotency/ผู้รับ; เวลา reminder ไม่ระบุ | `booking.sweep` ทุกนาที 4 statements idempotent; reminder T−15 → 05; matrix → 02 |
| R-16 | Medium | FR-012 ไม่มีสูตร; ตัวเลขตัวอย่าง "244/360 ชม." ขัดกับ 3 ห้อง × 9 ชม. × ~20 วัน; no-show 4.2% vs 4.0% ขัดกันระหว่างหน้า | สูตร utilization / no-show ใน 02; `GET /reports/utilization` → 06; แก้ตัวเลขตัวอย่าง → 10 |
| R-17 | Medium | ไม่มี permission matrix ทั้งที่ private masking, owner-vs-admin, facility ต้องอ้าง; ไม่ระบุว่า public booking เปิดเผยอะไรให้เพื่อนร่วมงาน | matrix role × action + 3 ระดับมองเห็น + แถว anonymous → 02; route/service guards + `toViewerBooking()` → 04/06 |
| R-21 / R-32 | Medium | `users.email` ดูเป็น optional แต่ FR-009 (Must) ต้องมีอีเมลทุกคน; หน้า login/register ของ Stitch ไม่มีช่อง email | `email NOT NULL UNIQUE`, `employee_code UNIQUE`, mobile optional → 05; ฟอร์ม admin บังคับ → 10 |
| R-22 | Medium | `business_hours(weekday, open, close, timezone)` ต่อห้อง + "timezone" ใน API สำหรับบริษัทเดียว TZ เดียว | `business_hours` ชุดเดียวทุกห้อง (7 แถว) + `settings` + `holidays`; `APP_TZ` constant; ไม่มี override รายห้องใน MVP → 02, 05 |
| R-23 | Medium | NFR-5 ต้องการ webhooks + bounce + delivery dashboard สำหรับ ~30 อีเมล/วัน | outbox + retry/backoff + dead-letter + ปุ่ม Resend; วัดที่ provider → 11.B D-19, 05 |
| R-24 | Medium | สถาปัตยกรรมมี Redis/Queue, Object storage, Worker แยก, cache master data, ABAC | ตัดทั้งหมด (บล็อกถัดไป); สถาปัตยกรรม 3 containers → 04 |
| R-26 | Medium | Room & time ใช้บล็อก 1 ชม. คงที่ มีช่องว่าง 12:30–13:00 และจบ 17:00 | select เริ่ม/สิ้นสุดขั้น 30 นาที, ขั้นต่ำ 60, ไม่มีพักเที่ยงจนกว่าบริษัทขอ → 02, 10 |
| R-41 | Medium | ท้าทาย brief: สอง front-end apps สำหรับบริษัทเดียว = build/deploy/routing ซ้ำ | คง 2 SPA เป็น bundle แยก แต่ build เข้า Docker/Fly image เดียว: employee `/`, admin `/admin/`, API `/api/` — admin bundle ไม่ไปอยู่ในเบราว์เซอร์พนักงานและทั้งระบบยังเป็น origin เดียว → 04, 07 |
| V-02 | Medium | ข้อเสนอ temp password "แสดงครั้งเดียว" ใช้ไม่ได้กับ CSV import 80 คน; "ลืมรหัสผ่าน → ติดต่อ admin" ทิ้งลิงก์ตาย | ข้อเสนอเดิมเลือก set-password token สำหรับ invite/admin reset/forgot; as-built ส่ง API token สำหรับ invite/reset แต่ไม่มี employee landing และไม่มี forgot endpoint จึงบันทึกข้อจำกัดไว้ใน 01/02/03/06/10 |
| V-03 | Medium | สไลด์ธุรกิจ "จองพร้อมกัน → Admin ตัดสินว่าวาระไหนสำคัญกว่า" ไม่จำกัดเฉพาะห้อง MANUAL; ร่างตีความเป็น AUTO = first commit wins | คงดีไซน์ แต่ให้เป็นข้อยืนยันกับบริษัท (การตีความ) 11.H ข้อ 5; ถ้าต้องการให้ admin ตัดสินทุกห้อง → ตั้งทั้ง 3 ห้องเป็น MANUAL ไม่มีต้นทุน build |
| V-04 | Medium | loser-rejection อยู่แค่ใน approve; admin reschedule / admin create / เปลี่ยน AUTO→MANUAL วาง CONFIRMED ทับ pending ได้ → pending อนุมัติไม่ได้ตลอดกาล | **ทุก** transition → CONFIRMED รัน statement ปฏิเสธ pending ที่ทับ (`CONFLICT_LOST`) ในธุรกรรมเดียว → 05; TC-APR-003 → 09 |
| V-07 | Medium | ใช้คำศัพท์ phase สองชุด (MVP/1.1/2 vs W1–W8), W4 แน่นเกิน, TC list แตก (9 bullets 8 IDs, อ้าง TC ที่ไม่นิยาม) | คำศัพท์เดียว: MVP (W1–W6 code-complete, W7 UAT, W8 buffer) / Phase 1.1 / Phase 2 ใช้ทั้ง RTM, plan, TC → 02, 08; TC list เดียว TC-CON-001 … TC-OPS-026 → 09 |
| R-18 | Low (ปรับจาก Medium) | เสนอ Facility read-only + kiosk "optional" + กล่อง "Facility staff" client ในสถาปัตยกรรม | `FACILITY` รองรับใน schema/auth แต่ไม่มี canonical account, run-sheet, staff override หรือ client เฉพาะใน final build; kiosk/client และ run-sheet เป็น backlog → D-18, 02 |
| R-19 | Low | Lifecycle มี DRAFT (ไม่มี UI), COMPLETED (ไม่มี job), EXPIRED (ไม่มีผู้ผลิต); ชื่อ PENDING vs PENDING_APPROVAL ใช้ปนกัน | ตัด DRAFT; ใช้ `PENDING_APPROVAL` ชื่อเดียว; COMPLETED / EXPIRED / AUTO_RELEASED ผลิตโดย sweep; transition table → 02, 05 |
| R-20 | Low (ปรับจาก Medium) | หน้าสมัครเอง "prototype only" + ลิงก์ลงทะเบียนบนหน้า Login; ไม่มีช่อง email | ถอดหน้าสมัครและลิงก์ออกจาก build; บัญชีมาจาก admin เท่านั้น → 02, 10 |
| R-25 | Low (ปิดแล้ว) | seed เดิมมี approval mode/ความจุไม่ตรง final demo | CB-01 ตัด approval mode; canonical initializer ใช้ Horizon/Summit/Grove capacity 20 เท่ากันและอุปกรณ์ชุดเดียว → 05, 11.H ข้อ 4 |
| R-27 | Low | ตาราง `approval_actions` ซ้ำกับ `audit_logs` | `decided_by/at`, `decision_reason`, `cancelled_by`, `cancel_reason` บน bookings; ตัดตาราง → 05 |
| R-28 | Low | ตาราง `checkins(token_hash)` + `POST /check-in/:token` ต้องการเฉพาะ rotating QR | คอลัมน์ `checked_in_at/by/method` บน bookings; QR คงที่ → 05, 06 |
| R-29 | Low | `booking_attendees.response_status` ต้อง parse iMIP reply — นอกขอบเขต | ตัด; attendees = อีเมล (+ชื่อ); เพิ่ม `headcount` บน bookings เป็นข้อมูลประกอบ (UI เตือนเมื่อเกินความจุ ไม่บล็อก) → 05 |
| R-30 | Low | ตาราง `features` + `room_features(quantity)` สำหรับ 3 ห้อง ~6 อุปกรณ์ | คงตาราง `features` + `room_features` (seed 6 รายการคงที่; admin แก้ต่อห้องได้ในหน้า Room edit) — ไม่มี UI จัดการ features แยกใน MVP → 05, 06 |
| R-31 | Low | `bookings.version` ไม่มีผู้ใช้; Idempotency key ไม่มีที่เก็บ | `Idempotency-Key` บน `POST /bookings` (กันดับเบิลคลิกสร้าง 2 PENDING ที่ constraint จับไม่ได้) → 06; `version` **เก็บไว้** เพราะใช้เป็น `.ics` SEQUENCE → 05 |
| R-33 | Low | Mockups มี แชร์ / ♡ / 🔔 / TH toggle / Export / Export PDF ที่แต่ละอันนัยถึงฟีเจอร์ที่ไม่ได้ขอ | ตัด แชร์ ♡ TH Export PDF; bell + CSV export → Phase 1.1; รายการแก้ → 10 UX-33/UX-19 |
| R-34 | Low | Approval Center แสดง badge "High / Medium" โดยไม่มี field `priority`; สไลด์บอก admin ตัดสินจากวาระ | ถอด badge; แสดงหัวข้อ/วัตถุประสงค์/แผนก/จำนวนคน/เวลาส่ง → 10 UX-14 |
| R-35 | Low (ปรับ: เป็น convention ไม่ใช่ error) | วันที่ผสม "26 ส.ค. 2026"; ไม่ระบุ พ.ศ./ค.ศ.; ข้อเสนอเดิมให้ `.ics` ใช้ +07:00 (ผิด RFC 5545) | กล่อง Date/time conventions: UI พ.ศ. ผ่าน `Intl`/`formatDate()` และ date picker ใช้ `@daypicker/buddhist`; API ISO +07:00, `.ics` UTC "Z" → 02, 04 |
| R-36 | Low | Employee nav "⚙ ตั้งค่า" ไม่มีหน้า | หน้าโปรไฟล์ (แก้เบอร์), เปลี่ยนรหัสผ่าน, สวิตช์ขนาดตัวอักษร → 10 E11 |
| R-37 | Low | FR-007 "`.ics` UID reuse" ไม่พอ — Outlook/Google ต้องการ SEQUENCE + METHOD | UID = booking id @ domain, SEQUENCE = `bookings.version`, METHOD:REQUEST / CANCEL, `ical-generator` → 02, 04 |
| R-38 | Low | Security baseline ไม่มี password policy, กฎ admin lock ตัวเอง, audit ไม่ครอบคลุม user/room/settings | audit actions += USER_* / ROOM_* / SETTINGS_UPDATE / HOLIDAY_*; checklist → 09; audit_logs + trigger กันแก้ → 05 |
| R-39 | Low | กฎ validation กระจาย (อนาคต, ขั้น 30 นาที, ในเวลาทำการ, ไม่ใช่วันหยุด, ≥60 นาที, ≤30 วัน, ห้อง active, ความจุ, หัวข้อ ≤120, ≤20 อีเมล, reason บังคับ) ไม่มี error code | Validation + error catalogue → 06; as-built ใช้ route-local Zod + service policy และ web precheck แยกกัน; shared schema ยังไม่ถูกสร้าง → 07 |
| R-40 | Low | TC ขาด: re-approval on reschedule, idempotent double-submit, pending expiry, D&D 409 rollback, deactivation blocks login, room deactivation guard, holiday/hours validation, `.ics` SEQUENCE, text-size | TC-AUTH-009 … TC-OPS-026 ใน test matrix → 09; map ใน RTM → 02 |
| R-42 | Low | แผนสมมติ cloud ทั้งที่ข้อจำกัด hosting / โดเมนอีเมลของบริษัทยังไม่รู้ | default เดิม: compose บน VM เดียว (SG/BKK) + SMTP relay ของบริษัท; hosting ถูกแทนที่โดย D-33 ส่วนโดเมน/SPF/DKIM ยังยืนยันใน 11.H ข้อ 3 |
| R-43 | Low | "เตรียม interface สำหรับ projector/รถ/โต๊ะ" = abstraction เชิงสมมติ | ตาราง `rooms` อย่างเดียว ไม่มี resource polymorphism → D-07, 05 |
| V-05 | Low | reminder ใน scheduler ทุกนาทีไม่มี dedupe → ส่งซ้ำ 15 ครั้ง; การจองที่สร้างใน window ได้ reminder ค้าง | marker `reminder_sent_at` / unique outbox key `(booking_id, type)`; ตาราง jobs ระบุ idempotent-by-predicate vs by-marker → 05 |
| V-06 | Low | `.ics` DATE-TIME ไม่มีรูปแบบ offset; ตั้ง process `TZ` เป็น footgun; `<input type="date">` แสดง พ.ศ./ค.ศ. แล้วแต่ browser | `.ics` UTC "Z"; timestamptz ทุกคอลัมน์เวลา, format ที่ขอบด้วย `Asia/Bangkok`; ปฏิทิน availability ทำหน้าที่ date picker → 02, 04, 10 · **ดู 11.D**: ค่า `TZ` จริงของ container ยังต้องตัดสิน |
| V-08 | Low | RTM skeleton ไม่มีคอลัมน์ Use Case และ Code/Module ตาม PDF §6 | RTM เพิ่ม US-xx + Module path ในโมโนรีโป → 02 |
| V-09 | Low | ศัพท์ใน deck (🟡 Reserved → 🟢 Check-in → "Auto Cancle" → Available, ประโยค 409 ภาษาไทย, "ดูสถานะการใช้งาน") ไม่อยู่ใน glossary | glossary TH/EN map ศัพท์ deck ↔ status code → 11.E; ใช้ประโยค 409 ของ deck เป็นข้อความ error → 06 |
| V-10 | Low | ไม่มีกฎผลข้างเคียงเมื่อ admin เพิ่มวันหยุด / ย่อเวลาทำการ / ปิดห้อง / deactivate ผู้ใช้ → เสี่ยงมีคน implement auto-cancel เงียบ ๆ | master data (ห้อง เวลาทำการ วันหยุด) ไม่ auto-cancel — หน้าจอ admin แสดงรายการที่กระทบ; deactivate ผู้ใช้ = ยกเลิกการจองอนาคตของคนนั้นพร้อมแจ้งเตือน → D-26, D-27, 02, 03; TC-SET-015 / TC-USR-017 → 09 |
:::

:::details สิ่งที่ไม่มีในระบบโดยตั้งใจ และจุดต่อกลับ (12 รายการ)

- **Redis / queue library** — outbox บน Postgres + scheduler ในโปรเซส (`setInterval` + advisory lock) ทำ retry/sweep ได้ที่โหลด ~30 อีเมล/วัน; แม้แต่ pg-boss ก็ถูกตัด (ADR-004)
- **Object storage (S3)** — ยังไม่ต้องใช้: รูปห้อง 3 รูปเก็บใน `rooms.photo bytea` และส่งผ่าน photo API; ไม่มี `sharp` หรือ volume รูปใน runtime ปัจจุบัน
- **ABAC** — 2 role + owner/attendee check คือ `can()` ฟังก์ชันเดียว
- **Worker service แยก** — scheduler รันในโปรเซสของ API หลัง `WORKER_ENABLED`; แยก container ได้ภายหลังโดยไม่แก้โค้ด (advisory lock กันรันซ้อน)
- **Production compose/VM** — เหตุผลเดิมถูกแทนที่เมื่อ Fly.io รับหน้าที่ employee/admin/API/worker แบบ always-on: deploy ปัจจุบันคือ Supabase + Fly.io ตาม D-33; compose เหลือ local dev เท่านั้น (ดู 11.B กลุ่ม 5)
- **เมนู tech stack สองคอลัมน์** — สองคอลัมน์ = ไม่มี decision; สิ่งที่จะเปลี่ยนเมื่อโตสิบเท่าเขียนเป็นเชิงอรรถในหัวข้อ 04
- **สถานะ DRAFT** — ไม่มี "บันทึกร่าง" ใน UI
- **ตาราง `checkins` + rotating QR** — login + หน้าต่าง T−15…T+15 ปิดภัย "ถ่ายรูป QR" สำหรับออฟฟิศ 80 คนแล้ว; เก็บ `checked_in_at/by/method` บน bookings
- **`approval_actions`, `business_hours` ต่อห้อง + timezone, `response_status` (RSVP)** — audit_logs เก็บประวัติอยู่แล้ว; บริษัทเดียว TZ เดียว กฎเดียว; ไม่ parse iMIP reply
- **Provider webhooks / bounce handling / delivery dashboard** — อ่าน % จาก dashboard ของ provider; outbox + retry/backoff + ปุ่ม Resend พอ
- **FullCalendar** — resource/timeline view เป็น Premium และ drag เป็น pointer-only (ขัด WCAG 2.2 SC 2.5.7); grid 3×18 เขียนเองเล็กกว่า
- **kiosk client, หน้าสมัครเอง, ปุ่ม แชร์/♡/TH toggle/Export PDF, badge priority, resource polymorphism** — ไม่มีความต้องการรองรับ (bell + CSV export เลื่อนไป 1.1 ไม่ได้ตัด)
:::

### 11.B :icon[check] การตัดสินใจที่ปิดแล้ว (Closed decisions)

36 ข้อ: `D-01`…`D-30` จากช่วงเขียนสเปก + กลุ่ม 5 ที่บันทึกภายหลัง (**มติลูกค้า `CB-01`…`CB-04` วันที่ 2026-08-24** และ `D-31`/`D-32`) แต่ละข้อมีเหตุผลหนึ่งบรรทัดและระบุว่ากระทบตาราง/endpoint/หน้าจอไหน สถานะมีสามแบบ: **ตัดสินใจแล้ว** = ไม่ต้องถามใครอีก · **ยืนยันกับบริษัท** = สร้างตาม default นี้ไปก่อน แล้วแจ้งบริษัทหนึ่งบรรทัดให้เปลี่ยนได้ก่อน go-live (ไม่ใช่ blocker — รวมอยู่ใน 11.H) · **แทนที่/แก้ไขโดย CB-xx หรือ D-31/D-32** = แถวเดิมคงไว้เป็นประวัติ พฤติกรรมปัจจุบันอยู่หัวข้อ 02–06

กฎธุรกิจฉบับเต็มอยู่หัวข้อ 02 · schema/constraint หัวข้อ 05 · endpoint หัวข้อ 06

:::details กลุ่ม 1 — นโยบายการจองและเวลา (9 ข้อ)

| ID | เรื่อง | การตัดสินใจ (default ที่สร้าง) | เหตุผล | สถานะ | ผลต่อระบบ |
|---|---|---|---|---|---|
| D-01 | นโยบายจองชนกัน | ห้อง `AUTO` = first commit wins ด้วย DB exclusion constraint; ห้อง `MANUAL` = รับคำขอ `PENDING_APPROVAL` ซ้อนกันได้ admin อนุมัติได้หนึ่งรายการ ที่เหลือถูก reject อัตโนมัติในธุรกรรมเดียวกันด้วย `reason_code = CONFLICT_LOST`; ADMIN สร้าง booking ในห้อง MANUAL เอง → `CONFIRMED` ทันที (admin คือผู้อนุมัติ) และ reject pending ที่ทับเช่นกัน | ตรงกับสไลด์ "Admin ตัดสินว่าวาระไหนสำคัญกว่า" และยังรักษา NFR-1 (ไม่มี double booking) | แทนที่โดยมติลูกค้า CB-01 (2026-08-24) — ไม่มีขั้นอนุมัติอีกต่อไป | `bookings` (constraint A/B, `reason_code`), `POST /admin/bookings/:id/approve`, หน้า Approval center แบบ conflict group |
| D-02 | เว็บเปิด 24 ชม. vs ห้องเปิด 08:30–17:30 | เว็บใช้ได้ 24/7; เลือกเวลาได้เฉพาะในเวลาทำการจาก `settings` (default จ–ศ 08:30–17:30) + วันหยุดที่ admin จัดการ; **ไม่มี admin override นอกเวลาทำการใน MVP**; เวลาทำการเป็นชุดเดียวใช้ร่วมทุกห้อง (`business_hours` 7 แถว แก้ที่หน้า Settings) — ไม่มี override รายห้อง | Override = permission + UI เพิ่มสำหรับเคสที่ไม่มีใครขอ; admin แก้เวลาทำการใน Settings ได้อยู่แล้ว | ตัดสินใจแล้ว | `settings`, `business_hours`, `holidays`, API policy validation, `GET /availability` |
| D-06 | Pending ถือ slot หรือไม่ | Pending ไม่เคยถือ slot; ห้อง MANUAL แสดง badge "มีคำขอรออนุมัติ" และยังเลือกได้; แต่วาง pending ทับ slot ที่ `CONFIRMED`/`CHECKED_IN` แล้วไม่ได้ (constraint B) | สืบเนื่องจาก D-01; กัน pending ที่อนุมัติไม่ได้ตั้งแต่ต้น | แทนที่โดย CB-01 — ไม่มีสถานะ pending อีกต่อไป | constraint B, `GET /availability.pending_overlaps`, slot grid ในหน้า Room detail |
| D-11 | ช่วงเวลา / ขั้นต่ำ / สูงสุด / buffer | ขั้นละ 30 นาที; ขั้นต่ำ 60 นาที; **ไม่มีเพดานระยะเวลา** นอกจากขอบเวลาทำการ (`max_duration_minutes` default `null`); buffer 0; lead time 0 (จองห้องว่างตอนนี้ได้ เวลาเริ่มปัดขึ้นเป็นช่อง 30 นาทีถัดไป) | บริษัทขอแค่ขั้นต่ำ 1 ชม.; เพดานเป็นกฎที่เราแต่งเอง; admin ยกเลิกการจองที่ใช้ในทางผิดได้ | ยืนยันกับบริษัท (เฉพาะเพดาน) | `settings`, API `validateWindow`, web `slots.ts`, ERR `MIN_DURATION`/`SLOT_INCREMENT`/`MAX_DURATION` |
| D-12 | "จองล่วงหน้า 1 เดือน" | 30 วันแบบ rolling; UI แสดง "จองล่วงหน้าได้ถึง …" | คาดเดาได้ ไม่มี edge case ความยาวเดือน | ตัดสินใจแล้ว | `settings.max_advance_days=30`, ERR `MAX_ADVANCE`, date picker ปิดวันเกินช่วง |
| D-13 | เลื่อนนัดต้องอนุมัติใหม่ไหม | เปลี่ยนเวลา/ห้อง = รันนโยบายใหม่: ห้อง AUTO อัปเดตแบบ atomic ใต้ constraint; ห้อง MANUAL ที่เจ้าของแก้เองกลับเป็น `PENDING_APPROVAL` และปล่อย slot เดิม (เตือนก่อน); admin เลื่อนให้คง `CONFIRMED` และ reject pending ที่ซ้อน; แก้เฉพาะรายละเอียด (ชื่อ ผู้เข้าร่วม คำขอพิเศษ ความเป็นส่วนตัว) ไม่อนุมัติใหม่ | กันการเลี่ยงการอนุมัติ; ตรง FR-008 "slot คืนทันที" | แทนที่โดย CB-01/CB-03 — ไม่มี re-approval; เลื่อนแล้วชน = 409 และแถวเดิมไม่เปลี่ยน | `PATCH /bookings/:id` (`reapproval_required`), `bookings.version` + `.ics` `SEQUENCE`, dialog เตือนใน E7 |
| D-14 | เส้นตายยกเลิก / admin ยกเลิก | เจ้าของยกเลิกได้ขณะสถานะ ∈ {`PENDING_APPROVAL`, `CONFIRMED`} และ `now < end_at` (เลื่อนนัดได้ก่อน `start_at`); admin ยกเลิกได้ทุกรายการก่อน `end_at` โดยต้องใส่เหตุผล; ยกเลิก/ปฏิเสธ/auto-release คืน slot ทันที (เปลี่ยนสถานะ ไม่ลบแถว) | ไม่มีสถานะ "ยกเลิกบางส่วน"; no-show จัดการด้วย auto-release อยู่แล้ว | ตัดสินใจแล้ว (ส่วนที่อ้าง `PENDING_APPROVAL`/ปฏิเสธ ตกไปตาม CB-01) | `POST /bookings/:id/cancel`, `bookings.cancelled_by/at/reason`, `audit_logs`, email `CANCELLED` + `.ics` `METHOD:CANCEL` |
| D-25 | Interval แบบครึ่งเปิด | ทุกช่วงเวลาเป็น `[start,end)` ใน DB (`tstzrange`), API และ web slot grid | 13:00–14:00 กับ 14:00–15:00 ต้องไม่ชนกัน; ใช้ semantics เดียวทั้งระบบ | ตัดสินใจแล้ว | constraint A, API availability/booking services, web `slots.ts` |
| D-26 | Admin แก้ master data แล้วการจองเดิมเป็นอย่างไร | การแก้เวลาทำการ/ความจุ/`approval_mode`/วันหยุด **ไม่** auto-cancel การจองเดิม; มีผลกับคำขอใหม่เท่านั้น; หน้า admin เตือนพร้อมรายชื่อการจองในอนาคตที่ได้รับผลกระทบ | การลบงานของคนอื่นเงียบ ๆ แก้คืนไม่ได้; admin ยกเลิกเองเป็นรายกรณีได้ | ตัดสินใจแล้ว (`approval_mode` ในรายการตกไปตาม CB-01) | `PATCH /admin/rooms/:id`, `PUT /admin/settings`, `PUT /admin/holidays`, dialog เตือนใน A7/A10 |
:::

:::details กลุ่ม 2 — บัญชี สิทธิ์ และความเป็นส่วนตัว (6 ข้อ)

| ID | เรื่อง | การตัดสินใจ (default ที่สร้าง) | เหตุผล | สถานะ | ผลต่อระบบ |
|---|---|---|---|---|---|
| D-08 | ระบบบัญชีผู้ใช้ | บัญชี local ที่ admin สร้างให้ (สร้างเดี่ยว / CSV import แบบ dry-run); ไม่มี self-registration; SSO ภายหลังถ้าบริษัทมี Workspace/M365 | Admin ต้องจัดการผู้ใช้อยู่แล้ว; SSO เพิ่ม IdP dependency สำหรับคน 80 คน | ยืนยันกับบริษัท (SSO ทีหลัง?) | `users`, `password_setup_tokens`, `POST /admin/users`, `POST /admin/users/import`, หน้า A8/A9 |
| D-09 | ฟิลด์ login | `employee_code` + password เท่านั้น; email คงเป็นข้อมูลบัญชีสำหรับ invite/reset/แจ้งเตือน และเบอร์มือถือเป็น profile data — ทั้งคู่ไม่ใช่ factor ในการ login | ลด friction, ใช้รหัสพนักงานที่องค์กรควบคุมเป็น public identity เดียว และยังคง workflow ทางอีเมล | ยืนยันแล้วโดยเจ้าของ requirement (2026-08-25) | `POST /auth/sign-in { employee_code }`, หน้า E0, `users.email`, `users.mobile` |
| D-15 | ใครเห็นการประชุมส่วนตัว | เจ้าของ, ผู้เข้าร่วม (email ตรงกับ user), ADMIN เห็นครบ; คนอื่นเห็น "ไม่ว่าง" + ห้อง/เวลา. Serializer as-built มี 3 ระดับ `FULL/PUBLIC/BUSY`; calendar เติมชื่อผู้จองยกเว้น private BUSY ของ FACILITY; ไม่มี FACILITY visibility ที่เปิด headcount/special_request | Need-to-know ขั้นต่ำ และทดสอบได้ (TC-PRV-xxx) | ปรับเป็น as-built 2026-08-26 | `toViewerBooking()`, `toCalendarBooking()`, `GET /calendar`, `GET /bookings/:id` |
| D-18 | เจ้าหน้าที่อาคาร | `FACILITY` อยู่ใน schema/auth/API แต่ไม่มี canonical account หรือ UI เฉพาะ; ถ้าสร้างบัญชีจะใช้ self-service แบบ EMPLOYEE และไม่มี staff check-in override. Run-sheet/kiosk ยังเป็น backlog | ไม่อ้าง feature ที่ final build ไม่มี และไม่เพิ่มสิทธิ์ข้อมูลส่วนตัวโดยปริยาย | ปรับเป็น as-built 2026-08-26 | `Role` enum, route/service guards, serializer 3 ระดับ |
| D-27 | ปิดใช้งานผู้ใช้ | Deactivate = revoke ทุก session + ยกเลิกการจอง **ทุกใบที่ยังไม่เริ่ม** (`start_at > $decision_time`) ไม่ว่าจะเป็น PENDING_APPROVAL, CONFIRMED หรือ CHECKED_IN (`reason_code=OWNER_DISABLED`, แจ้งผู้เข้าร่วม) — ใบที่เริ่มประชุมไปแล้วไม่ถูกยกเลิกอัตโนมัติ (C2-11); ลบถาวรได้เฉพาะผู้ใช้ที่ไม่มีประวัติเลย | ห้องต้องกลับมาว่างทันทีที่คนออก; ประวัติการจองต้องตรวจสอบย้อนหลังได้ | ตัดสินใจแล้ว (สถานะ `PENDING_APPROVAL` ในรายการตกไปตาม CB-01) | `POST /admin/users/:id/deactivate`, `DELETE /admin/users/:id` (409 `USER_HAS_HISTORY`), `sessions` |
| D-29 | ลิงก์ตั้งรหัสผ่าน | token ใช้ครั้งเดียวใน **ตารางของเราเอง `password_setup_tokens`** (`purpose` INVITE/RESET/FORGOT, `token_hash`, `expires_at`, `used_at`, `created_by`); as-built ออก INVITE 7 วันและ RESET 24 ชม. ผ่าน admin routes แล้ว redeem ด้วย `POST /auth/set-password`. ค่า `FORGOT` สงวนใน schema จากแผนเดิมแต่ไม่มี endpoint ออก token; final employee web ก็ไม่มี landing redeem. ไม่มี temp password — **เปลี่ยนในรีวิวรอบ 2 (C2-06)**: better-auth ให้ reset-password ที่มีอายุเดียวต่อทั้งระบบและส่ง callback มาแค่ token/URL จึงรองรับ TTL สองค่าและการผูก `dedupe_key = token.id` เข้ากับ outbox ใน tx เดียวไม่ได้ | CSV import 80 คนต้องการอายุ invite ที่คนเปิดทัน; reset สั้นกว่าเพราะบัญชีมีอยู่แล้ว | ส่งมอบเฉพาะ API/admin; employee landing/forgot ยังไม่ส่ง | `password_setup_tokens`, `POST /auth/set-password`, `POST /admin/users/:id/{resend-invite,reset-password}` |
:::

:::details กลุ่ม 3 — Check-in และการแจ้งเตือน (7 ข้อ)

| ID | เรื่อง | การตัดสินใจ (default ที่สร้าง) | เหตุผล | สถานะ | ผลต่อระบบ |
|---|---|---|---|---|---|
| D-03 | FR-009 หายจากสไลด์ | ยึด PDF: FR-009 email notification เป็น Must อยู่ใน MVP | สไลด์ตกหล่น ไม่ใช่การตัดสินใจ | ตัดสินใจแล้ว | `notifications` outbox, job `notify.send`, SMTP relay |
| D-16 | หน้าต่าง check-in | self check-in `start−15 นาที` → `LEAST(end_at, start+15 นาที)` (ADMIN ที่ไม่ใช่ owner/attendee เช็กอินให้ได้ถึง `end_at`); ไม่ check-in ภายในเส้นตายนั้น → `AUTO_RELEASED` (ใช้ `LEAST` เพราะ grace มีผลย้อนหลังกับใบที่สั้นกว่า grace — C2-03) | รวม reminder, window และ grace ไว้ในงานเดียว | ตัดสินใจแล้ว | `settings`, job `booking.sweep`, email `REMINDER` T−15 / `AUTO_RELEASED` |
| D-17 | QR แบบ static vs rotating | QR static ต่อห้อง (พิมพ์ติดหน้าห้อง) → deep link `/check-in/:roomCode`; ต้อง login, เฉพาะเจ้าของ/ผู้เข้าร่วม, ในหน้าต่าง D-16; **ไม่มี rotating token**; ส่งใน Phase 1.1 | ภัยที่ rotating token แก้ (ถ่ายรูป QR) ถูกกันด้วย login + window แล้วสำหรับออฟฟิศ 80 คน | แก้ไขโดย CB-02 — QR static คงเดิมแต่ย้ายเข้า MVP | `rooms.code`, route `/check-in/:roomCode` (1.1), `POST /bookings/:id/check-in` (MVP) |
| D-19 | นิยาม email > 99 % | วัดที่ provider/relay ("delivered/accepted"); แอปเก็บสถานะ `SENT/FAILED` + retry ใน outbox; ไม่ทำ webhook | Dashboard ของ provider คำนวณให้แล้ว | ตัดสินใจแล้ว | `notifications.status/attempts/last_error`; admin email queue เริ่มที่ filter `FAILED` และ retry ได้ |
| D-22 | Check-in อยู่ใน MVP ไหม | อยู่ใน MVP: (1) ปุ่ม self check-in ใน E6 + ลิงก์ใน reminder email, (2) admin check-in จากปฏิทิน/หน้าอนุมัติ; auto-release ใน MVP; QR deep link (D-17) ใน 1.1 | Deck ชูเป็นตัวแก้ Ghost Booking และถูกบนสแต็กนี้ | แก้ไขโดย CB-02 — QR เป็นทางเข้าหลักและอยู่ใน MVP; "หน้าอนุมัติ" ไม่มีแล้ว (CB-01) | `POST /bookings/:id/check-in` (owner/attendee = `SELF`, ADMIN = `ADMIN` ถึง `end_at`), `bookings.checked_in_at/by/checkin_method`, สถานะ `CHECKED_IN` |
| D-28 | Email ล้มเหลวแล้วการจองเป็นอย่างไร | Email ล้มเหลวไม่ rollback การจอง; เขียน `notifications` outbox ในธุรกรรมเดียวกับ booking แล้วให้ worker ส่ง + retry/backoff | การจองคือ source of truth; SMTP ล่มชั่วคราวไม่ควรทำให้ห้องหาย | ตัดสินใจแล้ว | `notifications` outbox, job `notify.send`, `FOR UPDATE SKIP LOCKED` |
| D-30 | รายละเอียดเล็กที่ทุกหัวข้อต้องตรงกัน | (a) `EXPIRED` ส่งอีเมลแจ้ง owner (ไม่งั้นคำขอตายเงียบ); (b) `AUTO_RELEASED` → **owner และ attendees ทุกคนที่เคยได้ REQUEST ได้ `.ics` `METHOD:CANCEL`** (UID เดิม, SEQUENCE=version) เพื่อให้ปฏิทินไม่ค้าง event — owner คือ ORGANIZER จึงต้องอยู่ฝั่ง CANCEL (C1-14, C2-02); ADMIN ที่ ACTIVE ได้ `booking.auto_released_admin` (อีเมลอธิบาย ไม่มี `.ics`) เป็นคนละ `template_key` เพราะ `notifications_dedupe` มี `template_key` เป็นส่วนหนึ่งของคีย์; (c) `headcount` เป็นข้อมูลประกอบ ไม่บล็อกเมื่อเกินความจุ; (d) approve หลัง `start_at` ทำไม่ได้ → เส้นตายที่ใช้จริงคือ **`LEAST(end_at, start_at + checkin_grace_minutes)`** สูตรเดียวทั้งเล่ม (CF-02); (e) แก้รายละเอียดอย่างเดียวไม่ส่งอีเมล — attendees ที่เพิ่ม/ลบได้ `.ics` REQUEST/CANCEL | ปิดช่องที่ writer แต่ละหัวข้อตีความต่างกัน | ตัดสินใจแล้ว (ข้อ (a) และ (d) ตกไปตาม CB-01 — ไม่มี `EXPIRED`/approve แล้ว) | หัวข้อ 02, 05, 06 |
:::

:::details กลุ่ม 4 — ขอบเขต ชื่อ และข้อมูลตั้งต้น (8 ข้อ)

| ID | เรื่อง | การตัดสินใจ (default ที่สร้าง) | เหตุผล | สถานะ | ผลต่อระบบ |
|---|---|---|---|---|---|
| D-04 | RTM ตัวอย่างใน PDF ผิด | สร้าง RTM ใหม่ที่ map FR → US → TC ครบและถูกต้อง | เป็น deliverable ที่ถูกตรวจ | ตัดสินใจแล้ว | หัวข้อ 02 (RTM), หัวข้อ 09 (test matrix) |
| D-05 | ชื่อผลิตภัณฑ์ | ใช้ชื่อทำงาน **ReserveFlow**; ชื่อ = config constant เดียว + ไฟล์โลโก้ | ไม่กระทบโค้ด; branding เป็นของบริษัท | ยืนยันกับบริษัท | `APP_NAME` ใน `packages/shared`, email template header, หน้า E0 |
| D-07 | ห้องอย่างเดียว vs resource ทั่วไป | `rooms` table ตรง ๆ; ไม่มี abstraction "resource" เผื่ออนาคต | YAGNI — 3 ห้อง | ตัดสินใจแล้ว | `rooms`, `features`, `room_features`; ไม่มีตาราง `resources` |
| D-10 | วันที่จองได้ | จ–ศ + รายการวันหยุดที่ admin จัดการ (seed วันหยุดราชการไทย) | Admin แก้เองได้ → ไม่มีวันติดขัด | ตัดสินใจแล้ว | `holidays`, `PUT /admin/holidays`, หน้า A10 |
| D-20 | Recurring / waitlist / timezone อื่น / Teams | ไม่อยู่ใน MVP และ 1.1; backlog Phase 2 | คุม scope; ไม่มี use case ระบุ | ตัดสินใจแล้ว | ไม่มีตาราง/endpoint; `APP_TZ='Asia/Bangkok'` ค่าคงที่ |
| D-21 | "Webboard" ในเอกสารบริษัท | ตีความเป็น Admin Dashboard; ถ้าหมายถึงประกาศ → banner ประกาศใน Phase 1.1/2 | บริบทใน deck ชี้ไปทาง dashboard | ยืนยันกับบริษัท | หน้า A1 (MVP); `announcements` เฉพาะถ้ายืนยันว่าต้องการ |
| D-23 | Hosting / email domain | VM เดียว (Singapore/Bangkok) + docker compose (`caddy`, `api`+worker, `postgres`); ส่ง email ผ่าน SMTP relay ของบริษัท (Workspace/M365) ในชื่อ `noreply@<company domain>` | Relay ของบริษัทมี SPF/DKIM อยู่แล้ว → ส่งถึงกล่องภายในแน่นอน; VM เดียวพอสำหรับโหลดนี้ | แทนที่โดย D-31 แล้ว D-33 (2026-08-27); SMTP relay ยังต้องยืนยันกับ IT (11.H ข้อ 3) | `infra/compose.yml`, env `SMTP_*`, `MAIL_FROM` |
| D-24 | Canonical initializer dataset | Horizon/Summit/Grove auto-confirm, capacity 20 และ microphone 1 + projector 1 เท่ากัน; 8 แผนก × 10 EMPLOYEE; 8 job titles deterministic; `AU-001` ADMIN + `AU-002`–`AU-081` EMPLOYEE | ชุดเริ่มต้น final ต้องทำซ้ำได้และตรง UI/demo ทุก environment | ปิดแล้ว 2026-08-26; `FACILITY` เหลือ schema-reserved ไม่มี canonical account | `apps/api/src/db/{demo-seed.ts,seed.ts,initialize.ts}`, `users.job_title`, `room_features` |
:::

:::details กลุ่ม 5 — มติลูกค้า 2026-08-24 และการตัดสินใจหลังปิดเล่ม (7 ข้อ)

| ID | เรื่อง | การตัดสินใจ | เหตุผล | สถานะ | ผลต่อระบบ |
|---|---|---|---|---|---|
| CB-01 | ยกเลิกขั้นอนุมัติทั้งหมด | ทุกห้อง **first-come-first-served**: การจองที่ commit สำเร็จเป็น `CONFIRMED` ทันที; ตัด `approval_mode`, สถานะ `PENDING_APPROVAL`/`EXPIRED`/`REJECTED`, constraint B, Approval Center และ endpoint approve/reject ออกทั้งหมด — วงจรเหลือ 5 สถานะ (`CONFIRMED → CHECKED_IN → COMPLETED` + ทางออก `CANCELLED`/`AUTO_RELEASED`) โดย constraint A เป็นผู้ตัดสินเพียงตัวเดียว; การ “ปฏิเสธ” ถูกแทนด้วย **ยกเลิกพร้อมเหตุผลบังคับ** (audit + แจ้งเจ้าของ). As-built API ยังมีสิทธิ์ ADMIN แก้/เลื่อน/จัดการผู้เข้าร่วมและเช็กอินเชิงปฏิบัติการตาม lifecycle table | มติลูกค้า: จองแล้วต้องได้เลย ไม่รอ admin | มติลูกค้า (2026-08-24); ขอบเขต as-built ชี้แจง 2026-08-26 | แทนที่ D-01, D-06, D-13 และบางส่วนของ D-14/D-24/D-27/D-30; **FR-005/FR-006 ไม่ทำตามที่ระบุ, US-004 ไม่ใช้แล้ว** — RTM §2.7 บันทึกเป็น "เปลี่ยนตามมติลูกค้า (CB-01)" และผู้เซ็นรับดู 11.H ข้อ 5 |
| CB-02 | QR หน้าห้อง = วิธีเช็กอินหลัก และอยู่ใน MVP | ป้าย QR **static ต่อห้อง** พิมพ์ติดหน้าประตู encode `/check-in/<roomCode>`; สแกน → login → ระบบหาใบจองให้เองจากผู้สแกน + ห้อง + เวลาปัจจุบัน → modal สำเร็จ/ไม่สำเร็จ; การต่อกับตัวควบคุมประตูจริงอยู่นอกขอบเขต (ส่งมอบเฉพาะฝั่งแอป); ทางเข้า self/admin เดิมคงอยู่ (`checkin_method` `SELF`/`QR`/`ADMIN`) | ลูกค้าติดป้ายหน้าห้องจริง — คนเดินถึงห้องแล้วสแกนได้ทันที | มติลูกค้า (2026-08-24) | แก้ไข D-17/D-22: QR ย้ายจาก Phase 1.1 เข้า **MVP**; `POST /check-in/rooms/:roomCode`; S-13 กลายเป็น shipped control (หัวข้อ 09) |
| CB-03 | เลื่อนเวลาแล้วชน = ไม่เสียของเดิม | `PATCH /bookings/:id` ที่เปลี่ยนเวลา/ห้องเป็น transaction เดียวใต้ constraint A — ชนแล้วตอบ `409 SLOT_UNAVAILABLE` และแถวเดิม **ไม่ถูกแก้เลย** (`version` เดิม); ไม่มีจังหวะที่ใบจองไม่ถือ slot ใด และไม่มีการปล่อย slot เดิมล่วงหน้า | ของเดิมที่ยังใช้ได้ต้องไม่หายเพราะการแก้ที่ล้มเหลว | มติลูกค้า (2026-08-24) | ทำพฤติกรรมที่ตั้งใจอยู่แล้วให้ explicit + testable — BR-05, flow FL-02, TC-EDIT-013 (แทนกติกา re-approval ใน D-13) |
| CB-04 | วันเสาร์–อาทิตย์จองไม่ได้ | ยืนยันโครงสร้างเดิม: `business_hours` 7 แถวคีย์ ISO weekday โดยเสาร์–อาทิตย์ปิด + `holidays` ทับอีกชั้น — slot นอกวันเปิดไม่ถูกสร้างและจองไม่ได้อยู่แล้ว; ไม่เปลี่ยนโค้ด เพิ่มเพียงบรรทัดที่มองเห็นได้ในหัวข้อ 02 | คำถามลูกค้า — โครงสร้างเดิมตอบอยู่แล้ว | มติลูกค้า (2026-08-24; ไม่มีการเปลี่ยน) | หัวข้อ 02 (business rule หนึ่งบรรทัด), `business_hours`, `holidays` |
| D-31 | สถาปัตยกรรม deploy (ประวัติ) | **Supabase free (`ap-southeast-1`) + Fly.io `sin` (API + worker) + Vercel Hobby (สอง SPA + rewrite `/api` → Fly)** แทน VM เดียว + compose | ลดภาระ OS/DBA และคง worker แบบ always-on | **แทนที่โดย D-33 (2026-08-27)** | เก็บเป็นประวัติการตัดสินใจเท่านั้น; ห้ามใช้เป็น deployment/runbook ปัจจุบัน |
| D-32 | ความหมายจริงของ "จำฉันไว้" (BR-10) | กติกาเดิม "จำฉันไว้ 30 วัน" **ถูกแก้บันทึก**: better-auth ให้ session sliding 7 วันเท่านั้น (`rememberMe:true` → `Max-Age=604800`); ความหมายจริงของ checkbox คือ **ติ๊ก = คุกกี้ค้างเครื่องตลอดอายุ session 7 วัน · ไม่ติ๊ก = คุกกี้หมดเมื่อปิดเบราว์เซอร์** | 30 วันไม่เคยทำได้ผ่าน public API ของ better-auth (พิสูจน์ใน W0 gate review — 11.D); session 30 วันยังเป็นท่าที่ปลอดภัยน้อยกว่าสำหรับเครื่องใช้ร่วม; custom session extension = งานจริงแลกผลเชิงเครื่องสำอาง | ตัดสินใจแล้ว (แก้บันทึกเดิม) | 00 at-a-glance, 02 BR-10, 06 C-03, 08 T-012 DoD, 09 S-01 |
| D-33 | สถาปัตยกรรม deploy ปัจจุบัน | **Supabase PostgreSQL + Fly.io app เดียวที่ `https://reserveflow-api.fly.dev`**; Docker image เดียวเสิร์ฟ employee `/`, admin `/admin/`, API `/api/` และรัน jobs; compose ใช้ local dev เท่านั้น; backup ยังเป็น `pg_dump \| age` → R2 | ผู้ใช้ยืนยันว่า production ใช้ Fly.io เท่านั้นสำหรับทั้งสองเว็บไซต์และ API; image/runtime รองรับ topology นี้อยู่แล้ว จึงลด platform และ release boundary หนึ่งชั้น | ตัดสินใจแล้ว (2026-08-27) | แทนที่ D-31; ลบ `vercel.json`/`build:vercel`; deploy workflow ปล่อย full stack พร้อมกัน; `PUBLIC_BASE_URL` = canonical Fly origin |
:::

:::details หลักการที่ใช้ตัดสินทุกข้อข้างต้น (5 ข้อ)

- **DB เป็น source of truth ของ invariant** — กฎที่ห้ามผิด (ไม่มี double booking, audit แก้ไม่ได้) อยู่ใน PostgreSQL constraint/trigger เป็นด่านสุดท้าย; โค้ดแอปทำหน้าที่ให้ error message ที่ดี ไม่ใช่ผู้รักษากฎคนเดียว (CB-01, D-25)
- **ชิ้นส่วนให้น้อยที่สุดสำหรับ 80 คน / 3 ห้อง** — ไม่มี Redis, ไม่มี resource abstraction, ไม่มี rotating token, ไม่มี kiosk, ไม่มี recurring; ทุกอย่างที่ตัดออกมีจุดต่อกลับระบุไว้ใน Phase 1.1/2 (D-07, D-17, D-18, D-20)
- **ไม่ประหยัดที่ trust boundary** — validation ด้วย Zod ทุก endpoint, `can()` ทุก route, masking ที่ serializer, idempotency บน `POST /bookings`, audit log แบบ append-only, argon2id + lockout (D-08, D-09, D-15, D-27)
- **ให้ admin ตั้งค่าได้ แทนการ hardcode** — เวลาทำการ วันหยุด ขั้นเวลา/ขั้นต่ำ/เพดาน ช่วงจองล่วงหน้า grace ของ check-in อยู่ใน `settings` เพื่อให้คำถามธุรกิจที่ยังไม่ปิดไม่กลายเป็น release blocker (D-02, D-10, D-11, D-12, D-16, D-26)
- **Thai-first UX** — ข้อความระบบเป็นไทย (ไม่มี ค่ะ/ครับ) สถานะไทยพร้อมโค้ดอังกฤษ เวลา 24 ชม. ปี พ.ศ. ผ่าน `formatDate()` ตัวเดียว; API/DB เป็น ISO-8601/timestamptz ไม่ปนกัน (D-15, D-22, หัวข้อ 10)
:::

### 11.C :icon[info] คำถามที่ปิดแล้ว (Closed questions)

คำถามเปิด 24 ข้อ (`Q-01`…`Q-20` จากร่างก่อนหน้า + `Q-21`…`Q-24` ที่การรีวิวตั้งเพิ่ม) ปิดครบทุกข้อแบบหนึ่งต่อหนึ่งกับ `D-01`…`D-24` — ตารางนี้มีไว้ให้คนที่ถือคำถามเดิมอยู่ในมือหาปลายทางเจอ ส่วน `D-25`…`D-30` เป็นเรื่องที่ไม่มีใครถาม แต่จำเป็นต้องตัดสินเพื่อให้ทุกหัวข้อตรงกัน

:::details ตารางคำถาม → การตัดสินใจ (24 ข้อ)

| Q | คำถาม | ปิดด้วย |
|---|---|---|
| Q-01 | นโยบายเมื่อจองชนกัน — ใครได้ห้อง | D-01 |
| Q-02 | เว็บเปิด 24 ชม. แต่ห้องเปิด 08:30–17:30 จัดการอย่างไร | D-02 |
| Q-03 | FR-009 หายจากสไลด์ — อยู่ใน scope ไหม | D-03 |
| Q-04 | RTM ตัวอย่างใน PDF ผิด — ทำใหม่ไหม | D-04 |
| Q-05 | ชื่อผลิตภัณฑ์ (ReserveFlow vs VenueFlow) | D-05 |
| Q-06 | คำขอที่รออนุมัติถือ slot ไว้หรือไม่ | D-06 |
| Q-07 | ห้องอย่างเดียว หรือเผื่อ resource ทั่วไป | D-07 |
| Q-08 | ระบบบัญชีผู้ใช้ — สมัครเองได้ไหม / SSO | D-08 |
| Q-09 | ใช้อะไรเป็นฟิลด์ login | D-09 |
| Q-10 | วันไหนจองได้ / วันหยุดมาจากไหน | D-10 |
| Q-11 | ขั้นเวลา ขั้นต่ำ เพดาน buffer | D-11 |
| Q-12 | "จองล่วงหน้า 1 เดือน" นับอย่างไร | D-12 |
| Q-13 | เลื่อนนัดแล้วต้องอนุมัติใหม่ไหม | D-13 |
| Q-14 | เส้นตายการยกเลิก และ admin ยกเลิกได้แค่ไหน | D-14 |
| Q-15 | ใครเห็นรายละเอียดการประชุมส่วนตัว | D-15 |
| Q-16 | หน้าต่างเช็กอินกว้างเท่าไร | D-16 |
| Q-17 | QR แบบคงที่หรือหมุนเวียน | D-17 |
| Q-18 | เจ้าหน้าที่อาคารเป็น role หรือไม่ | D-18 |
| Q-19 | "ส่งอีเมลถึง > 99 %" วัดอย่างไร | D-19 |
| Q-20 | Recurring / waitlist / timezone อื่น / Teams อยู่ใน scope ไหม | D-20 |
| Q-21 | "Webboard" ในเอกสารบริษัทหมายถึงอะไร | D-21 |
| Q-22 | Check-in อยู่ใน MVP หรือ Phase 2 | D-22 |
| Q-23 | Hosting และโดเมนอีเมลของบริษัท | D-23 |
| Q-24 | ห้องไหนต้องอนุมัติ ใครเป็น admin ชื่อ 8 แผนก | D-24 |
:::

### 11.D :icon[shield] ผลการรีวิว (Review log)

เอกสารนี้ผ่านการรีวิวแบบ adversarial **5 รอบ** จากผู้รีวิวภายนอก (OpenAI Codex `gpt-5.6-sol`, reasoning effort `ultra`, บทบาท staff/principal engineer ที่เป็น *peer* ไม่ใช่ตรายาง) ได้ข้อค้นพบภายนอก **60 ข้อ** (`C1` 43 + `C2` 12 + `CF` 5) บวกข้อขัดแย้งข้ามหัวข้อที่ทีมจับเอง `IR` อีก 3 รวม **63 รหัส** ทุกข้อปิดในเนื้อเอกสารแล้ว รอบสุดท้าย `codex-r3.md` = **APPROVE (BLOCKING 0 · HIGH 0)** ไฟล์ทั้งหมดอยู่ `docs/review/`

W0 ยังเพิ่มการพิสูจน์ด้วยของจริงอีกชั้น: spike **T-008 (better-auth)** และ **T-009 (SMTP + `.ics`)** รันกับ PostgreSQL และ Mailpit จริง แล้วถูกตรวจซ้ำแบบ adversarial อีกครั้งใน `docs/spikes/W0-gate-review.md` (**GO WITH CAVEATS**) — เทคโนโลยีทั้งสองผ่าน แต่ยังเหลือ **7 ข้อที่ต้องปิดก่อน W1** ส่วนใหญ่เป็น DDL ของ `accounts`

**กรอบที่ซื่อสัตย์**: คำกล่าวที่ถูกต้องคือ "ทุกข้อค้นพบจากทุกรอบปิดครบในเนื้อเอกสารแล้ว และรีวิวรอบถัดไปย่อมหาเจอเพิ่มได้เสมอ" — ไม่ใช่ "ผ่านการรับรอง (certified) จากภายนอก"

:::details รอบรีวิวและจำนวนข้อค้นพบต่อรอบ (5 รอบ)

โจทย์ทุกรอบระบุให้หาสิ่งที่จะทำให้ทีมสร้างผิด ไม่ใช่ให้ชม ทุกข้อค้นพบถูกตอบกลับเป็น **ACCEPT / PARTIAL / REJECT** พร้อมเหตุผลเชิงเทคนิค และ **ข้อที่ปฏิเสธถูกบันทึกไว้พร้อมข้อโต้แย้ง** ไม่ใช่ลบทิ้ง

| รอบ | ไฟล์ผลรีวิว | ข้อค้นพบ | VERDICT | คำตอบของทีม |
|---|---|---|---|---|
| 1 | `docs/review/codex-r1.md` | 43 ข้อ → `C1-01`…`C1-43` | REVISE — BLOCKING 6 · HIGH 16 · MEDIUM 16 · LOW 4 · NIT 1 | `response-r1.md` — ACCEPT 32 · PARTIAL 10 · REJECT 1 (BLOCKING ทั้ง 6 = ACCEPT) |
| 2 | `docs/review/codex-r2.md` | ตรวจซ้ำผลรอบ 1 (16 แถว) + 12 ข้อใหม่ → `C2-01`…`C2-12` | REVISE — BLOCKING 1 · HIGH 6 · MEDIUM 5 | `response-r2.md` — ACCEPT 10 · PARTIAL 2 · REJECT 0 |
| ปิดท้าย | `docs/review/codex-final.md` | 5 ข้อที่ยังไม่ปิดจริง → `CF-01`…`CF-05`; §2 ระบุ trade-off ที่ผู้รีวิว **ยอมรับ**, §3 รับรอง stack ตรง ๆ, §4 ตั้ง readiness gate ไว้ที่ 5 ข้อนี้พอดี | REVISE — BLOCKING 1 · HIGH 4 | `response-final.md` — แก้ครบทั้ง 5 |
| ตรวจซ้ำ | `docs/review/codex-verify.md` | C2-01 + C2-07 ยังเปิด และข้อขัดแย้งใหม่อีก 3 | REVISE — BLOCKING 1 · HIGH 4 | แก้ครบทั้ง 5 ข้อ (รายการด้านล่าง) |
| ปิดท้ายสุด | `docs/review/codex-r3.md` | ตรวจ `C2-01`…`C2-07` ครบ 7 แถว = **CORRECTLY FIXED** ทุกแถว | **APPROVE — BLOCKING 0 · HIGH 0** | + stack verdict และ "ห้าก้าวแรก" ด้านล่าง |

**รหัสอ้างอิงที่โผล่ในวงเล็บทั่วเอกสาร** (เช่น "(C2-04)") สืบกลับได้ทุกตัว มี 4 ชุดเท่านั้น

| รหัส | จำนวน | ที่มา | ไฟล์ (ผลรีวิว → คำตอบ) |
|---|---|---|---|
| `C1-xx` | 43 | **ภายนอก** — รีวิวรอบ 1 | `codex-r1.md` → `response-r1.md` |
| `C2-xx` | 12 | **ภายนอก** — รีวิวรอบ 2 | `codex-r2.md` → `response-r2.md` |
| `CF-xx` | 5 | **ภายนอก** — รอบปิดท้าย; C2-01 → **CF-01**, C2-03 → **CF-02**, C2-04 → **CF-03**, C2-05 → **CF-04**, C2-07 → **CF-05** (เลขใหม่เพราะแก้คนละรอบ ไม่ใช่ข้อใหม่) | `codex-final.md` + `codex-r2.md` → `response-final.md` |
| `IR-xx` | 3 | **ภายใน** — ความขัดแย้งข้ามหัวข้อที่ทีมจับได้เอง | `response-r2.md` (ท้ายไฟล์) |

`IR-xx` เคยถูกแท็กเป็น `X2-xx` ในร่างระหว่างทาง รวมเป็นลำดับเดียวแล้ว (C2-12: หนึ่งเอกสาร = หนึ่งชุดรหัส) `CF-xx` **ไม่ถูกยุบเข้า `IR-xx`** โดยตั้งใจ — มันคือข้อค้นพบของผู้รีวิว *ภายนอก* การรวมเข้ากับชุด "รีวิวภายใน" จะทำให้ที่มาผิดและทำให้สัดส่วนงานรีวิวภายนอกดูน้อยกว่าความจริง สองรอบที่ไม่ได้สร้างชุดรหัสใหม่ (`codex-verify.md`, `codex-r3.md`) เพราะเป็นการ *ตรวจซ้ำ* ข้อเดิม จึงอ้างเป็นชื่อไฟล์ในเนื้อเอกสาร
:::

:::details สิ่งที่รอบตรวจซ้ำจับได้ (5 ข้อ)

ทั้งหมดเป็นความไม่ตรงกันของ *ข้อความ* ไม่ใช่การออกแบบใหม่ — รอบก่อนหน้าตรวจหัวข้อที่ **เป็นเจ้าของกฎ** แล้วพบว่าถูก ส่วนรอบนี้ไล่อ่าน **เสียงสะท้อนของกฎเดียวกันที่ค้างอยู่หัวข้ออื่น**

1. สรุปลำดับ lock ที่ NFR-1, flow FL-01, ADR-003 และ ticket T-042 ยังเขียนว่า "ล็อกห้องเป็นตัวแรก" ขัดกับลำดับกลาง → แก้ให้ตรงกันทุกจุด
2. T-072 เอาข้อมูล HR จริงไปไว้บน staging ทั้งที่ staging เป็น seed-only และ runbook restore สัญญา "ธุรกรรมเดียว" ที่ `psql` ทำไม่ได้ → staging ใช้ข้อมูลสังเคราะห์, restore ใช้ `pg_restore -f -` ต่อท่อเข้า `psql --single-transaction` สายเดียว
3. TC-ROOM-028 ขัดกับกฎ "ไม่ auto-cancel" → ย้ายจุดตัดสินนโยบายไปที่ linearization point ของ transaction จอง และ T-020 เลิกใช้ `UPDATE … FOR UPDATE` ที่ไม่มีจริงใน SQL
4. C-11 สัญญา 200 เมื่อ approve ซ้ำ แต่ T3 ให้ 200 เฉพาะเมื่อ version ตรง → ตรวจสถานะปลายทางก่อน version, บังคับ version เฉพาะ transition PENDING→CONFIRMED, เพิ่มเคส lost-response retry ใน TC-APR-003
5. `rf-drill` อนุญาต/ห้ามบน VM ของ prod พร้อมกัน และ restore prod ทั้งจำเป็นและต้องห้าม → drill ต้องใช้ VM ชั่วคราวแยก, ข้อห้ามจำกัดขอบเขตที่ "การเปิด dump เพื่อทดสอบ", และ rollback/DR เข้า `rf-prod` ที่หยุดแล้วอนุญาตโดยชัดเจน
:::

:::details สามเรื่องที่ตั้งใจไม่ทำตามข้อเสนอ (3 ข้อ)

| ข้อเสนอที่ไม่ได้ทำ | ข้อโต้แย้งของเรา | ท่าทีปิดท้ายของผู้รีวิว | จะกลับมาทบทวนเมื่อ |
|---|---|---|---|
| ตาราง snapshot `room_capacity_days` สำหรับ utilization ย้อนหลัง (C1-30) | เวลาทำการของบริษัทนี้เปลี่ยนปีละครั้ง; เพิ่มตาราง + backfill เพื่อกันเหตุที่ยังไม่เคยเกิด แลกกับการพิมพ์ "คำนวณด้วยเวลาทำการปัจจุบัน" บนหน้ารายงาน + CSV รายเดือนเป็น snapshot | `codex-final.md` §2 จัดว่า "current-policy historical reporting" อยู่ในเกณฑ์ **proportionate** | เวลาทำการ/วันหยุดเปลี่ยนมากกว่าปีละครั้ง หรือมีการ audit ตัวเลขย้อนหลัง |
| endpoint `POST /admin/policy/impact` (C1-33) | คำเตือน "booking ที่กระทบ" เป็น preview ฝั่ง client ที่วนดึงครบทุกหน้าของ query ที่มีขอบเขตแน่นอน (≤ 30 วัน × 3 ห้อง) — endpoint ใหม่จะทำให้ต้อง maintain `validateWindow()` สองที่ | `codex-final.md` §2 จัดว่า "client-side impact preview" **proportionate** | จำนวนห้อง/ช่วงล่วงหน้าโตจนวนทุกหน้าไม่ไหว (ทำเพิ่มได้ใน 1 ticket) |
| ผูก `Idempotency-Key` กับ hash ของ payload + `409 IDEMPOTENCY_KEY_REUSED` (ครึ่งหนึ่งของ C1-08) | key ผูกกับ **การกดปุ่ม submit หนึ่งครั้ง** ไม่ใช่กับเนื้อ payload; request hash ต้องมีสัญญา canonical-JSON ที่ serialize ตรงกันทั้งเบราว์เซอร์และเซิร์ฟเวอร์ตลอดไป — drift เล็กน้อยจะเปลี่ยน retry ธรรมดาให้กลายเป็น 409 ที่บล็อกการจองที่ผู้ใช้มีสิทธิ์ทำ (ครึ่งที่เป็นลำดับ lock รับมาแก้แล้ว) | **ผู้รีวิวยอมรับ trade-off นี้เอง** ใน `codex-final.md` §2 โดยมีเงื่อนไขว่าต้องลบข้อความ helper ที่ขัดกันออกให้หมด — ทำแล้ว (CF-01) | มี client ที่สาม (API token ให้ระบบอื่น) เข้ามาใช้ API |

รอบ 1 ยังมี `C1-38` ที่เรา REJECT เต็มใบ — ยืนยันสอง SPA แยกแอป ซึ่ง `codex-r3.md` กลับมา **AGREE** ในรอบปิดท้าย จึงไม่ใช่เรื่องค้างอีกต่อไป
:::

:::details W0 spike — สิ่งที่พิสูจน์กับ Postgres และ Mailpit จริง (17 ข้อ)

การตรวจซ้ำใน `docs/spikes/W0-gate-review.md` ไม่หยิบผลจากรายงาน spike มาใช้ต่อ: ทุกแถวถูกรันใหม่กับ PostgreSQL 18 ที่รันจาก `infra/compose.yml` และ Mailpit บน `127.0.0.1:1025` ด้วย assertion ที่เขียนแยกจากสคริปต์ของ spike และเมื่อหลักฐานเดิมมาจากเครื่องมือที่อาจผิดเอง ก็ถอดรหัสซ้ำด้วย implementation คนละตัว (`psql` แทน Drizzle, Python `email` แทน decoder ของ Mailpit, unfolder RFC 5545 ที่เขียนเอง)

**ฝั่ง auth (T-008)**

- สมัคร/ล็อกอินด้วย `employee_code` ทำงาน — แต่ **กลไกเป็นของเรา ไม่ใช่ของ better-auth**: `signInEmail({email:'zq-7781'})` ถูกปฏิเสธ 400, ทางที่ผ่านคือ resolve `employee_code → email → signInEmail` ฝั่งแอป; `citext` ทำให้ค้นแบบไม่สนตัวพิมพ์ได้จริง
- แฮชที่เก็บจริง **เป็น argon2id** อ่านตรงจาก Postgres: `$argon2id$v=19$m=65536,t=3,p=1$…` digest 32 ไบต์ ทั้งเส้นทางสร้างผู้ใช้และเส้นทาง redeem token
- คุกกี้ `__Host-sid` มาครบ (`Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`, ไม่มี `Domain`) และ session ถูกเขียนลงตาราง
- **`banned=true` เพียงอย่างเดียวไม่ revoke session ที่ยังมีชีวิต** — ต้องลบแถวใน `sessions` ด้วย; เมื่อลบแล้ว request ถัดไปทันที `getSession()` คืน `null` และการ sign-in ถูกปฏิเสธ `403 BANNED_USER` → **deactivate ต้องเป็นธุรกรรมเดียวที่ตั้ง `status`/`banned`/`disabled_at` *และ* ลบ session**
- `createUser` โดยไม่มีรหัสผ่านเขียน `accounts` **ศูนย์แถว**; sign-in ก่อน redeem = 401
- **token ตั้งรหัสผ่านใช้ซ้ำไม่ได้จริงภายใต้ concurrency** — สอง transaction แข่ง token เดียวกันโดยถือไว้ 250 ms: commit ได้ตัวเดียว, `used_at` ถูกตั้งครั้งเดียว, รหัสของผู้ชนะเท่านั้นที่ล็อกอินได้ (รายงานเดิม *อ้าง* ว่าไม่มี race แต่ไม่เคยแข่งจริง)
- token ที่หมดอายุถูกปฏิเสธ; `auth.api.*` **ไม่มี rate limit ในตัว** (limiter อยู่ที่ `auth.handler` เท่านั้น); better-auth ไม่แตะ `failed_logins`/`locked_until` เลย → lockout เป็นงานของเรา
- `CREATE EXTENSION` รันในฐานะ `rf_owner` ไม่ได้ (แก้แล้วโดยย้ายไป `infra/db/init/01-roles.sql`); default privileges แจก `DELETE` ให้ `rf_app` ทุกตารางใหม่

**ฝั่งอีเมลและ `.ics` (T-009)**

- `DTSTART` เป็น UTC `"Z"` ไม่มี `TZID` ไม่มี `+07:00` และ instant ตรงกับเวลานาฬิกากรุงเทพที่ขอ
- CANCEL ใช้ `UID` เดิมแบบไบต์ต่อไบต์ และ `SEQUENCE` เพิ่มขึ้น; REQUEST/CANCEL มี `METHOD` + `STATUS` ครบ, `ORGANIZER` เป็น owner พร้อม `SENT-BY`, `ATTENDEE` 2 บรรทัด
- การ fold ถูกต้องระดับ octet — ไม่มีบรรทัดเกิน 75 octets, ไม่มี bare LF/CR, ไม่มี U+FFFD, unfold แล้วได้ `LOCATION` ภาษาไทยกลับมาครบรวมช่องว่างที่อยู่ตรงรอยพับ; ไฟล์ปิดท้ายด้วย `\r\n`
- **ภาษาไทยรอดผ่าน MIME** ยืนยันด้วย decoder ตัวที่สอง: `text/plain`, `text/html`, `text/calendar` ไทยครบ 0 U+FFFD; subject และชื่อผู้รับถอดรหัสถูกต้อง; ไฟล์ `.ics` เหมือนเดิมทุกไบต์หลัง round trip
- `Message-ID` เป็น deterministic (replay แถวเดิมได้ header เดิม)
- คำสั่ง gate ทั้งสี่ (`lint`, `typecheck`, `test`, `build`) exit 0 แบบบังคับไม่ใช้ cache

**ข้อที่ผลตรวจแก้จากรายงานเดิม** — remember-me 30 วัน **ไม่มีจริง** (`rememberMe:true` ให้ `Max-Age=604800` = 7 วัน; สิ่งที่ better-auth ให้จริงคือ persistent vs browser-session cookie) · header `Date:` เป็น UTC จริงแต่ *เหตุผล* ที่อ้างผิด — container ตั้ง `TZ`/`PGTZ` เป็น `Asia/Bangkok` ไม่ใช่ UTC (`+0000` มาจาก Nodemailer เอง) · `notifications.provider_message_id` อธิบายผิด — relay คืน queue id จากบรรทัด `250` ไม่ใช่ `Message-ID` · คำสั่ง reproduce ที่ตีพิมพ์ในรายงานทั้งสองฉบับรันไม่ผ่าน · "13 unit assertions" จริง ๆ คือ 10 เคสในไฟล์นั้น · assertion ที่ "พิสูจน์" ว่าเก็บเฉพาะ `sha256(token)` เป็น tautology (`timingSafeEqual(a, a)`) ห้ามยกไปใส่ `TC-AUTH-009`
:::

:::details W0 spike — สิ่งที่ยังไม่ปิด (7 ข้อ)

ต้องปิดก่อน W1 เรียงตามความจำเป็น (รายละเอียดเต็มอยู่ `docs/spikes/W0-gate-review.md` §2b–§3)

1. **DDL ของ `accounts` รันไม่ได้ตามที่เขียนไว้** — ขาด `issuer` (NOT NULL) + unique index `(issuer, account_id)` และขาดอีก 6 คอลัมน์ที่สเปกทิ้งไว้ในคอมเมนต์ (`access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`) — adapter `SELECT` ทั้งเจ็ดคอลัมน์ตรง ๆ พิสูจน์ด้วย `42703` สองครั้ง (ข้อ S1/S2)
2. **freeze ที่ไฟล์ config ไม่ใช่รายการสี่บรรทัด** — ต้องมี field map ครบ (`user`, `session`, `account`, `verification`) + `schema` ของ admin plugin (`ban_reason`, `ban_expires`, `impersonated_by`) + `roles: { ADMIN, EMPLOYEE, FACILITY }` มิฉะนั้น better-auth อ้างคอลัมน์ camelCase ที่ไม่มีอยู่ หรือ admin endpoint ตอบ "not allowed" ทุกเส้น (S3–S5)
3. **ความขัดแย้งเรื่องสิทธิ์ `DELETE`** — `01-roles.sql` แจก `DELETE` ให้ `rf_app` เป็น default privilege อยู่แล้ว การ `GRANT` ที่แคบกว่าไม่หดสิทธิ์เดิม ต้อง `REVOKE DELETE` ตรง ๆ ไม่งั้นข้อ "ไม่มี DELETE โดย default" ล้ม (S8)
4. **Google Workspace หรือ Microsoft 365 (D-23)** — ยังไม่มีเจ้าของและไม่มีคำตอบ อยู่บนเส้นทางวิกฤต W4/W6 และเป็นความต่างระหว่าง "แก้ `.env`" กับ "เขียน XOAUTH2 token handling"
5. **นิยาม "delivered" ของ NFR-5 (IR-01)** — รายงาน T-009 หัวเรื่องเขียน `GO` แต่เนื้อในบอกเองว่านิยาม "ต้องได้รับการยอมรับเป็นลายลักษณ์อักษรจากเจ้าของ requirement" และ "spike นี้ไม่ปิดข้อนี้" → gate ยังไม่ปิดจนกว่าจะมีลายเซ็น (11.H ข้อ 11)
6. **timezone ของ container (S13)** — ต้องตัดสินก่อน freeze schema เพราะ `now()::date`, `date_trunc('day', …)` และ cast เป็น `timestamp` ในรายงานทั้งหมดคิดตาม session zone — **ปิดแล้วโดย D-31 (2026-08-24)**: managed Postgres เป็น UTC → server/DB = UTC ทั้งหมด + `timestamptz` แสดงผลที่ขอบด้วย `APP_TZ='Asia/Bangkok'`
7. **แก้คำสั่ง reproduce ของทั้งสอง spike** — หลักฐานที่รันซ้ำไม่ได้คือหลักฐานที่ไม่มีใครตรวจรอบสอง

**ยังไม่ได้ตรวจซ้ำ** (บันทึกไว้เพื่อไม่ให้ความเงียบถูกอ่านเป็นการยืนยัน): พฤติกรรมเมื่อถอด `roles` ออก, กิ่ง `rememberMe:false`, `session.updateAge` แบบ sliding, ตารางโหมดล้มเหลวของ T-009 (relay ล่ม, 535, `550`) และ **การเปิด `.ics` จริงใน Google Calendar / Outlook desktop+web / iOS** ซึ่งเป็นงาน UAT (T-041) — ไม่มี iCalendar parser แบบออฟไลน์บนเครื่องที่ตรวจ

**ปลอดภัยที่จะเดินหน้า**: ใช้ better-auth 1.7.1 ต่อ · deactivate = ธุรกรรมเดียวที่ลบ session ด้วย · redeem token เป็น `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING …` (พิสูจน์ race-safe แล้ว) · เก็บ `src/email/{ics,mailer,templates}.ts` เป็น seam ของ T-040/T-041 · คง `ical-generator` ที่ 11.1.0 พร้อม workaround CRLF ท้ายไฟล์ · ลบ `apps/api/spike/*` ทิ้งเมื่อจบ W1
:::

:::details ท่าทีปิดท้ายของผู้รีวิวต่อ stack และ "ห้าก้าวแรก" (9 ทางเลือก)

| ทางเลือกหลัก | Verdict | ท่าทีปิดท้าย |
|---|---|---|
| สอง Vite SPA บน origin เดียว | AGREE | คนละ shell, แชร์ packages, ปล่อยพร้อมกันเป็นก้อนเดียว |
| Hono | AGREE | ขนาดพอดีกับ REST/OpenAPI ที่ต้อง type |
| Drizzle + EXCLUDE constraint สองตัว + advisory lock ต่อห้อง | AGREE | เป็น source of truth ของ concurrency ที่ถูกต้อง |
| better-auth | ACCEPT-AS-TRADE-OFF | เก็บไว้ได้ **ก็ต่อเมื่อ** spike ผูกมัดใน W0 ผ่าน — ผ่านแล้ว (บล็อก W0 spike ด้านบน) |
| sweep ในโปรเซสทุกหนึ่งนาที | AGREE | สเปกปัจจุบัน **ถอด pg-boss ออกถูกต้องแล้ว** |
| SMTP outbox | AGREE | เส้นแบ่งความน่าเชื่อถือถูกจุด; ต้องตรวจกับ relay จริง |
| calendar CSS-grid เขียนเอง | ACCEPT-AS-TRADE-OFF | สมเหตุสมผลกับ 3 คอลัมน์ห้องที่คงที่; ต้องเฝ้า accessibility |
| VM เดียว + Docker Compose | ACCEPT-AS-TRADE-OFF | เหมาะกับสเกลนี้ ภายใต้วินัย backup/drill ที่ระบุไว้ |
| Biome | AGREE | พิธีกรรมน้อย เหมาะกับทีมขนาดนี้ |

**Historical W1 plan จาก `codex-r3.md` (ไม่ใช่รายการ automation ปัจจุบัน):** (1) ปิดรายการยืนยันฝั่งธุรกิจ/operations/PDPA (2) spike better-auth — ทำแล้ว (3) spike SMTP/`.ics` — Mailpit ผ่าน แต่ relay/client จริงยังต้อง manual verify (4) ลง Compose + CI + custom migrations + EXCLUDE constraint (5) walking slice ของการจองแบบ AUTO. Accessibility ปัจจุบันตรวจด้วย manual browser plan ในหัวข้อ 09; axe เป็น future automation

**เรื่องกำลังคน** — `codex-final.md` §4 สรุปว่า "ทีม 2 คน เป้าหมายที่ซื่อสัตย์คือราว W10–W11 ไม่ใช่แปดสัปดาห์" ตรงกับตาราง capacity ในหัวข้อ 08 ที่คำนวณมาคนละทาง (568 h เทียบ capacity สุทธิ 80 % focus): **8 สัปดาห์ = 3 คน · W10–W11 = 2 คน · W18–W20 = 1 คน** — ห้ามพูดว่า "8 สัปดาห์" โดยไม่พ่วง "ด้วยทีม 3 คน"
:::

### 11.E :icon[tag] อภิธานศัพท์ (Glossary TH/EN)

35 คำที่ใช้ทั้งเอกสาร เรียงตามลำดับที่พบ: โดเมนการจอง → สถานะ → สิทธิ์ → กลไกทางเทคนิค → คำศัพท์บริหารโครงการ คอลัมน์ "อ้างอิง" ชี้หัวข้อที่เป็นเจ้าของนิยาม (ที่อื่นอ้างได้ แต่แก้นิยามไม่ได้)

:::details ตารางศัพท์ (35 คำ)

| คำไทย | English / identifier | ความหมายใน ReserveFlow | อ้างอิง |
|---|---|---|---|
| ช่องเวลา | **Slot** | ช่วงครึ่งชั่วโมงบนตาราง 08:30–17:30 (18 ช่อง/วัน/ห้อง); การจองหนึ่งรายการครอบคลุม ≥ 2 ช่อง (60 นาที); ใน DB คือ generated column `slot tstzrange` | 02, 05 |
| ช่วงเวลาครึ่งเปิด | **Half-open interval** `[start, end)` | นับเวลาเริ่ม ไม่นับเวลาจบ → 13:00–14:00 ต่อกับ 14:00–15:00 ได้โดยไม่ถือว่าชน | 05 |
| การจองชนกัน | **Conflict / overlap** | สองรายการในห้องเดียวกันที่ `slot && slot`; API ตอบ `409 SLOT_UNAVAILABLE` พร้อมห้องทางเลือกใน `details.alternatives` | 06 |
| ใครมาก่อนได้ก่อน | **First-come-first-served (FCFS)** | กติกาเดียวทุกห้อง (มติลูกค้า CB-01): การจองที่ commit สำเร็จเป็น `CONFIRMED` ทันที ไม่มีขั้นอนุมัติ; ผู้ตัดสินคือ constraint A ไม่ใช่หน้าจอ; `POST /bookings` ตอบ `201` หรือ `409 SLOT_UNAVAILABLE` เท่านั้น | 02, 05, 11.B CB-01 |
| จองแล้ว (deck: "Reserved") | `CONFIRMED` | ยืนยันแล้ว ถือครอง slot แต่ยังไม่เช็กอิน | 02 |
| เช็กอินแล้ว (deck: "Check-in") | `CHECKED_IN` | ยืนยันการใช้ห้องจริงภายในหน้าต่างเช็กอิน; ไม่ถูก auto-release อีก | 02 |
| ปล่อยห้องอัตโนมัติ (deck: "Auto Cancle") | **Auto-release** (`AUTO_RELEASED`) | ระบบคืน slot เมื่อไม่เช็กอินภายใน `LEAST(end_at, start+15 นาที)`; นับเป็น no-show ไม่ใช่ utilization | 02, 05 |
| จองทิ้ง | **Ghost booking** | ปัญหาจาก deck บริษัท: ห้องถูกจองแต่ไม่มีคนมาใช้; แก้ด้วย check-in + auto-release | 00, 02 |
| หน้าต่างเช็กอิน | **Check-in window** | self: `start − 15 นาที` → `LEAST(end_at, start + 15 นาที)` (`checkin_open_before_minutes` / `checkin_grace_minutes`; C2-03); ADMIN ที่ไม่ใช่ owner/attendee เช็กอินให้ได้ถึง `end_at` (หัวข้อ 06 เป็นเจ้าของกฎ); นอกช่วงตอบ `422 CHECKIN_WINDOW_CLOSED` | 02, 06 |
| เสร็จสิ้น | `COMPLETED` | sweep ตั้งให้เมื่อ `end_at` ผ่านไป | 05 |
| ยกเลิก | `CANCELLED` | เปลี่ยนสถานะ ไม่ลบแถว; slot ว่างทันที; admin ยกเลิกใบของใครก็ได้แต่ต้องระบุเหตุผล (audit + แจ้งเจ้าของ) | 02 |
| ประชุมลับ / ไม่ว่าง | **Private meeting / Busy** (`is_private = true`) | คนนอกเห็นเพียง "ไม่ว่าง" + ห้อง/เวลา; ระดับการมองเห็น `FULL / PUBLIC / BUSY` จัดที่ serializer ไม่ใช่ CSS | 02, 06 |
| เจ้าของการจอง / ผู้เข้าร่วม | **Owner / Attendee** (`owner_id` / `booking_attendees`) | เจ้าของการประชุม (ผู้สร้าง หรือผู้ที่ ADMIN จองแทน) / อีเมลที่ระบุในฟอร์ม (ถ้าตรงกับ user ในระบบ → เห็นรายละเอียดเต็ม และได้รับ `.ics`) | 02 |
| พนักงาน / ผู้ดูแลระบบ / ทีมจัดห้อง | `EMPLOYEE` / `ADMIN` / `FACILITY` | canonical initializer สร้างสองค่าแรก; FACILITY รองรับใน schema/auth แต่ไม่มี canonical account หรือ UI เฉพาะ | 02 |
| เวลาทำการ / วันหยุด | **Business hours / Holiday** | จ–ศ 08:30–17:30 (ตาราง `business_hours` 7 แถว ชุดเดียวทุกห้อง แก้ที่หน้า Settings) + ตาราง `holidays`; เว็บเปิด 24 ชม. แต่เลือกเวลาได้เฉพาะในเวลาทำการ | 02 |
| ช่วงจองล่วงหน้า | **Advance window** (`max_advance_days`) | 30 วันแบบ rolling นับจากวันนี้ | 02 |
| การเลื่อนนัด | **Reschedule** | เปลี่ยนเวลา/ห้องเป็น `UPDATE` เดียวใต้ constraint A — ชนแล้วตอบ `409` และแถวเดิมไม่เปลี่ยน ใบจองไม่เคยเสีย slot เดิม (CB-03); แก้รายละเอียดอย่างเดียวไม่แตะ slot | 02, 03 |
| กุญแจกันซ้ำ | **Idempotency-Key** | header UUID บน `POST /bookings`; สำเร็จครั้งแรกตอบ 201, replay ตอบ 200 + `Idempotent-Replayed: true` และไม่สร้างแถวใหม่ | 06 |
| ข้อจำกัดกันทับซ้อน | **Exclusion constraint** (`EXCLUDE USING gist`) | กฎ DB: ไม่มีสองแถวที่ `room_id` เท่ากันและ `slot` ซ้อนกัน ในสถานะ `CONFIRMED`/`CHECKED_IN` — constraint A ตัวเดียว (CB-01 ตัด constraint B ออกพร้อมสถานะ pending); ละเมิด = SQLSTATE `23P01` → 409 | 05 |
| ล็อกต่อห้อง | **Advisory lock** (`pg_advisory_xact_lock(hashtext(room_id))`) | serialize การเขียนการจองต่อห้องภายในธุรกรรม; ปล่อยเองตอน commit/rollback | 05 |
| ลำดับล็อกกลาง | **Canonical lock order** | writer ใช้ลำดับ `idempotency → global → users → rooms → $decision_time` ตาม operation: booking-id operation ล็อก actor+owner, QR ล็อก actor แล้ว room, deactivate ล็อก target user แล้วห้องของใบอนาคต; implementation แยกอยู่ใน booking/user services และใช้ helper จาก `lib/tx.ts` (CF-01) | 05, 07 |
| กล่องขาออก | **Transactional outbox** (ตาราง `notifications`) | แถวอีเมลถูกเขียนในธุรกรรมเดียวกับ booking; worker `notify.send` ดึงไปส่งทีหลัง → email ล้มเหลวไม่ rollback การจอง | 05, 09 |
| งานกวาด | **Sweep** (`booking.sweep`) | loop ทุก 1 นาทีจาก `jobs/index.ts` เรียก `jobs/sweep.ts` (in-process + advisory lock): auto-release, complete, enqueue reminder — ทุกคำสั่ง idempotent รันซ้ำได้; health state โผล่ที่ `/api/readyz` | 05 |
| คิวงานตาย | **Dead-letter queue (DLQ)** | job ที่ retry ครบแล้วยังล้มเหลว; admin กด "ส่งซ้ำ" จากหน้า outbox ได้ | 09 |
| ไฟล์นัดหมาย | **.ics** (iCalendar: `UID` / `SEQUENCE` / `METHOD`) | แนบอีเมล; `UID` = booking id@domain คงที่, `SEQUENCE` = `bookings.version`, `METHOD:REQUEST` / `CANCEL`, เวลาเป็น UTC "Z" | 02 |
| ลิงก์ตั้งรหัสผ่าน | **Set-password token** | token ใช้ครั้งเดียวในตาราง `password_setup_tokens` ของเรา (`purpose` + `used_at`; C2-06); as-built ออกให้ invite (7 วัน) และ admin reset (24 ชม.). `FORGOT` เป็นค่า reserved ที่ยังไม่มี route และ final employee landing ถูกซ่อน | 11.B D-29, 02, 03 |
| origin เดียว | **Same-origin** | production ใช้ Fly app เดียวเสิร์ฟ employee SPA ที่ `/`, admin SPA ที่ `/admin/` และ API ที่ `/api/*`; local ใช้ Vite proxy → browser ใช้ cookie origin เดียว ไม่มี CORS | 04 |
| ปี พ.ศ. | **Buddhist year** | แสดงผลผ่าน `formatDate()` (Intl `th-TH`) เท่านั้น; API/DB/`.ics` เป็น ค.ศ. ISO-8601 | 02, 10 |
| อัตราการใช้งาน / อัตราไม่มาใช้ | **Utilization / No-show rate** | `used_hours ÷ available_hours` (เฉพาะ CHECKED_IN/COMPLETED ตัดตามเวลาทำการ) / `AUTO_RELEASED ÷ (AUTO_RELEASED + COMPLETED)` | 02 |
| ตารางตามรอยความต้องการ | **RTM** (Requirements Traceability Matrix) | FR/NFR/US → หน้าจอ → API → ตาราง DB → Test case → Phase → Status | 02 |
| ลำดับความสำคัญ | **MoSCoW** (Must / Should / Could / Won't) | ตาม PDF เป๊ะ: FR-001..006, 008, 009 Must; 007, 011 Should; 010, 012 Could | 02 |
| เปอร์เซ็นไทล์ที่ 95 | **p95** | 95 % ของ request เสร็จภายในเวลานี้; NFR calendar p95 ≤ 2 s เป็น manual performance budget ปัจจุบัน ส่วน load automation เป็น future backlog | 09 |
| เกณฑ์เสร็จ / เกณฑ์ปล่อยรุ่น | **DoD / Release gate** | เงื่อนไขปิด ticket / เงื่อนไขก่อน deploy prod (เช่น concurrency suite ผ่าน 100 %) | 08, 09 |
| ระยะ | **MVP / Phase 1.1 / Phase 2** | W1–W6 code-complete + W7 UAT + W8 buffer / ส่วนต่อขยายหลัง go-live / backlog | 08 |
| บันทึกการตัดสินใจ | **ADR** (Architecture Decision Record) | บริบท → การตัดสินใจ → ผลที่ตามมา; ดัชนีอยู่ 11.G | 11.G |
:::

### 11.F :icon[database] ตารางเวอร์ชัน (Versions)

กติกาเดียว: **pin เวอร์ชันตรงตัวทุกตัว ไม่มี `^`**, commit `pnpm-lock.yaml`, Dependabot รายสัปดาห์โดยมี CI เป็นด่าน ตัวเลขดึงจาก npm 2026-08-23 ตามที่หัวข้อ 04 ตัดสิน **Context7 ✓** = ตรวจ *พฤติกรรม* API กับเอกสารจริงแล้ว (ไม่ใช่ตรวจตัวเลขเวอร์ชัน)

:::details ตาราง dependencies หลักและ local services ที่ pin อยู่ใน workspace ปัจจุบัน

| Package | Version (pin) | ตรวจ / หมายเหตุ |
|---|---|---|
| **Runtime** | | |
| Node.js | 24.x LTS | `engines.node >=24`, Docker/CI ใช้ major 24 |
| PostgreSQL | Supabase managed Postgres ใน production; `postgres:18` ใน local compose และ CI | managed service ไม่ได้ใช้ image เดียวกับ local/CI; schema รองรับ PG ≥ 16 และใช้ `gen_random_uuid()`; ตรวจ server major ก่อน upgrade/migration สำคัญ |
| pnpm | 10.27.0 | ค่าเดียวกับ CI และ package manager ของ repo |
| TypeScript | 7.0.2 (native compiler) | **verify** — fallback 6.0.3 / 5.9.3 ถ้า dep ใด build ไม่ผ่าน |
| turbo | 2.10.11 | |
| @biomejs/biome | 2.5.10 | **verify** tier ของ rule `noFloatingPromises` |
| **API** | | |
| hono | 4.13.3 | |
| @hono/node-server | 2.1.1 | |
| @hono/swagger-ui | 0.6.1 | UI ของ `/api/docs` |
| zod | 4.4.3 | |
| drizzle-orm | 0.45.2 **exact** | **Context7 ✓**: generated column ได้ (`generatedAlwaysAs`), `tstzrange` ต้อง `customType`, EXCLUDE เขียนใน DSL ไม่ได้ → custom migration; 1.0.0-rc กำลังมา อัปหลัง MVP; better-auth ต้องการ `^0.45.2` |
| drizzle-kit | 0.31.10 | **Context7 ✓**: `generate --custom` สำหรับ extension/EXCLUDE/trigger; **ห้าม `push` นอก local** (อาจพยายาม drop constraint ที่ไม่รู้จัก) |
| pg | 8.23.0 | |
| ~~pg-boss~~ | — | **historical decision:** ไม่ติดตั้ง; jobs ปัจจุบันอยู่ใน `jobs/index.ts`, `sweep.ts`, `drain.ts`, `maintenance.ts` และไม่มี schema `pgboss.*` |
| better-auth | 1.7.1 **exact** | **spike ผ่านแล้ว** (11.D) — adopt with caveats: field map ต้องครบและ deactivate ต้องลบ session เอง; fallback hand-rolled sessions ยังออกแบบไว้ (ADR-006) |
| @node-rs/argon2 | 2.1.0 | native binary บน `node:24-slim` |
| nodemailer | 9.0.5 | |
| ical-generator | 11.1.0 | **spike ผ่านแล้ว** พร้อม workaround CRLF ท้ายไฟล์ — re-check ถ้า pin ขยับ; `ics` 3.12.0 ไม่ใช้ (ต้องการ METHOD/SEQUENCE ครบ) |
| pino | 10.3.1 | |
| **Web (ทั้งสอง SPA)** | | |
| react / react-dom | 19.2.8 | |
| vite | 8.2.2 | |
| @tanstack/react-router | 1.170.32 | **verify** — minor ออกถี่; pin exact |
| @tanstack/react-query | 5.102.2 | |
| tailwindcss | 4.3.3 | UI primitives เขียนใน workspace; ไม่มี shadcn/Radix runtime |
| lucide-react | 1.34.0 | |
| @daypicker/react / @daypicker/buddhist | 10.0.1 / 10.0.1 | employee date picker; Buddhist calendar/Thai locale |
| uqr | 0.1.3 | `apps/admin/src/components/qr-code.tsx` สร้าง QR SVG สำหรับป้ายห้อง |
| **Testing** | | |
| vitest | 4.1.11 | |
| Mailpit | `axllent/mailpit:v1.30.7` | dev/staging เท่านั้น |

**จงใจไม่มีในสแต็กปัจจุบัน** — Sentry, Playwright/axe/k6, shadcn/Radix, `qrcode`, `sharp`, react-email, react-hook-form, dnd-kit, `next`, `@fullcalendar/*`, object-storage SDK, OpenTelemetry และ Redis/BullMQ. ถ้าเพิ่มในอนาคตต้องมี package/lockfile, test หรือ runbook ที่ใช้จริงก่อนอัปเดตตารางนี้
:::

### 11.G :icon[server] ดัชนี ADR

ตารางนี้เป็น **decision summary ภายในสเปก** จำนวน 8 รายการ; repo ปัจจุบันยังไม่มีไฟล์ `docs/adr/ADR-00x-*.md` แยก ดังนั้นอย่าอ้างว่าเป็น formal ADR archive จนกว่าจะสร้างไฟล์และกำหนด owner/review process

:::details ตาราง ADR (8 ข้อ)

| ADR | ชื่อ | บริบท → ตัดสินใจ → ผลที่ตามมา |
|---|---|---|
| ADR-001 | **Single origin** | สอง SPA + API ใช้ cookie session; production/staging จึงให้ Fly image เดียวเสิร์ฟ `/`, `/admin/`, `/api/*` และ local ใช้ Vite proxy → cookie `__Host-sid`, SameSite=Lax + Origin check และไม่มี CORS. ถ้าแยก browser origin ภายหลังต้องออกแบบ CORS/CSRF ใหม่ (หัวข้อ 04, 09) |
| ADR-002 | **Vite SPA ไม่ใช่ Next.js** | มี API แยกอยู่แล้ว, ไม่มีความต้องการ SEO/SSR, ทีม 1–3 คน → Vite + React 19 + TanStack Router build เป็น static files → Node process ลดจาก 3 เหลือ 1 (api), route guard/data loading ทำผ่าน Router/Query เอง; ถ้าทีม standardise Next.js เปลี่ยนได้ใน `apps/*` โดย API/DB ไม่กระทบ |
| ADR-003 | **EXCLUDE constraint + advisory lock** | ทุกห้อง auto-confirm แบบ first-come-first-served; constraint A ตัวเดียวห้าม slot ทับกันใน `CONFIRMED`/`CHECKED_IN`, writer ทุกทางใช้ `pg_advisory_xact_lock(hashtext(room_id))` ตามลำดับล็อกกลาง และ map `23P01` → 409. ไม่มี PENDING/constraint B/approval mode ตาม CB-01; EXCLUDE อยู่ใน custom migrationและห้าม `drizzle-kit push` นอก local (หัวข้อ 05) |
| ADR-004 | **In-process scheduler + sweep (ไม่มี queue library)** | งาน idempotent รันใน API process เมื่อ `WORKER_ENABLED=true`: `jobs/index.ts` จัด loop/lock/health, `sweep.ts` ทำ auto-release/complete/reminder, `drain.ts` ส่ง outbox และ `maintenance.ts` purge. pino บันทึก failure; `/readyz` ตรวจ sweep freshness. **Historical decision:** ไม่ใช้ pg-boss จึงไม่มี dependency/schema/retry model ชุดที่สอง |
| ADR-005 | **SMTP relay ของบริษัท + outbox** | FR-009 Must, NFR ส่งถึง > 99 %, email ล้มเหลวห้าม rollback การจอง, บริษัทมี Workspace/M365 อยู่แล้ว → ตาราง `notifications` เขียนในธุรกรรมเดียวกับ booking; worker `notify.send` ส่งผ่าน Nodemailer → relay; retry/backoff + DLQ; Mailpit ใน dev → ต้องได้ credential จาก IT ก่อน W4; เปลี่ยน provider = transport config เดียว; ไม่มี webhook/bounce handling ใน MVP (หัวข้อ 09) |
| ADR-006 | **better-auth** | ต้องการ session ใน Postgres, admin สร้าง/ระงับบัญชีและ revoke ทันที, argon2id; hand-rolled ก็แค่ ~150 บรรทัด → better-auth + admin plugin โดย wrapper รับเฉพาะ `employee_code` แล้ว resolve ไป internal email credential, `@node-rs/argon2` → dependency 1.x อายุน้อยจึงต้อง spike ก่อน — **spike W0 ผ่านแล้ว** (11.D) พร้อมเงื่อนไข: field map ต้องครบ, deactivate ต้องลบ session เอง, lockout เป็นงานของเรา; fallback hand-rolled sessions ยังออกแบบไว้; pin exact |
| ADR-007 | **Calendar grid เขียนเอง** | ปัจจุบันใช้ CSS grid ที่เขียนใน repo สำหรับ 3 ห้อง × 18 ช่องโดยไม่มี FullCalendar/Radix/dnd-kit. **Future 1.1:** หากเพิ่ม drag-and-drop ต้องมี dialog "เลื่อนเวลา…" เป็น keyboard alternative และเลือก/install library ตอนลงมือจริง; month/recurring ยังเป็น backlog |
| ADR-008 | **Superseded: VM + compose** | ข้อเสนอ VM เดิมถูกแทนที่โดย D-31 แล้ว D-33 (2026-08-27) และไม่มี Caddy/prod compose ใน repo. Deploy ปัจจุบัน = Supabase + Fly.io app เดียว; `infra/compose.yml` ใช้ local dev เท่านั้น. เก็บ ADR นี้เป็นประวัติ ไม่ใช่ runbook หรือตัวเลือกที่ระบบกำลังรัน |
:::

### 11.H :icon[warn] สิ่งที่ต้องยืนยันกับบริษัท (Open confirmations)

14 ข้อ **ทุกข้อมี default ที่ทีมสร้างอยู่แล้ว จึงไม่ block W1** — ข้อเหล่านี้เปลี่ยนได้ด้วยการแก้ setting, seed หรือ constant ไม่ใช่การเขียนใหม่ ควรปิดให้จบใน W0 เพื่อไม่ให้กระทบ seed, email และ UAT บันทึกคำตอบไว้ที่ `docs/decisions/W0-confirmations.md`

ข้อ 9 และ 14 เป็น input ฝั่ง IT/ผู้บริหาร ไม่ใช่การตัดสินใจทางธุรกิจ แต่เป็น blocker ของ go-live จึงรวมไว้ที่เดียวกัน · ข้อ **5 และ 10–13 ต้องการการยอมรับเป็นลายลักษณ์อักษร** (ส่วนต่างจาก requirement, scope, นิยาม, นโยบายข้อมูล) ไม่ใช่แค่รับทราบ

| # | ☐ | เรื่อง | Default ที่สร้าง | ผู้ตอบ | ต้องได้ภายใน | ต้นทุนถ้าเปลี่ยน |
|---|---|---|---|---|---|---|
| 1 | ☐ | ชื่อผลิตภัณฑ์และโลโก้ (D-05) | ReserveFlow | ผู้บริหาร / สื่อสารองค์กร | W6 (ก่อน UAT) | constant `APP_NAME` + ไฟล์โลโก้ < 1 ชม. |
| 2 | ☐ | "Webboard" ในเอกสารบริษัทหมายถึงอะไร (D-21) | Admin Dashboard; ไม่สร้างกระดานประกาศ | เจ้าของ requirement | W0 | ถ้าเป็นประกาศ → banner ใน Phase 1.1 |
| 3 | ☐ | SMTP relay (hosting ปิดโดย D-33: Supabase SG + Fly `sin` ที่ `https://reserveflow-api.fly.dev`; custom domain เป็น optional): ระบบเมล **Google Workspace หรือ M365**, บัญชี `noreply@<domain>` | Deploy ตาม D-33; ส่งเมลผ่าน relay ของบริษัท | ฝ่าย IT | W3 (SMTP ก่อน W4) | Workspace vs M365 = ความต่างระหว่างแก้ `.env` กับเขียน XOAUTH2 (11.D ข้อ 4); Postmark fallback ถ้าไม่มี relay |
| 4 | ☑ | ข้อมูล canonical initializer (D-24): ห้อง, บัญชี, แผนก, ตำแหน่งงาน และอุปกรณ์ | ปิดแล้ว 2026-08-26: Horizon/Summit/Grove ทุกห้อง auto-confirm, capacity 20, microphone 1 + projector 1; 8 แผนก × 10 EMPLOYEE, 8 job titles แบบ deterministic; `AU-001` ADMIN และ `AU-002`–`AU-081` EMPLOYEE; ไม่มี FACILITY account | เจ้าของระบบ | ปิดแล้ว | เปลี่ยน manifest + migration/data review; ห้ามแก้ production แบบข้าม initializer safety |
| 5 | ☐ | **เซ็นรับส่วนต่างจาก requirement (มติลูกค้า CB-01, 2026-08-24)**: FR-005 (โหมด Auto/Manual ต่อห้อง) **ไม่ทำตามที่ระบุ** · FR-006 (approve/reject พร้อมเหตุผล) **แทนที่ด้วยสิทธิ์ยกเลิกพร้อมเหตุผลของ admin** · US-004 **ไม่ใช้แล้ว** — ทุกห้องเป็น first-come-first-served; RTM §2.7 บันทึกทั้งสามแถวเป็น "เปลี่ยนตามมติลูกค้า (CB-01)" | สร้างตามมตินี้แล้ว (ไม่มีระบบอนุมัติในโค้ด) | เจ้าของ requirement | W6 (ก่อน UAT sign-off) | กลับคำ = สร้างระบบอนุมัติทั้งชุดใหม่ (สถานะ, constraint, หน้าจอ, อีเมล) — ไม่ใช่ config |
| 6 | ☐ | บัญชี local ที่ admin สร้างก่อน แล้ว SSO ทีหลัง (D-08) | ใช่ | ฝ่าย IT | W0 | เพิ่ม OAuth provider ใน better-auth ภายหลัง |
| 7 | ☑ | ใช้ `employee_code` เป็น sign-in identity เดียว; ไม่ใช้ email/mobile เป็น factor (D-09) | ยืนยันแล้ว: `employee_code` + password; email ยังอยู่ในฐานข้อมูลสำหรับบัญชี/invite/reset/แจ้งเตือน | เจ้าของ requirement | ปิดแล้ว 2026-08-25 | เปลี่ยน contract + UI + security tests หากต้องเพิ่ม identifier |
| 8 | ☐ | ไม่มีเพดานระยะเวลาการจองนอกจากเวลาทำการ (D-11) | ไม่มีเพดาน (`max_duration_minutes = null`) | เจ้าของ requirement | W0 | ใส่ตัวเลขในหน้า Settings |
| 9 | ☐ | ผู้ถือ key backup (`age`) และผู้อนุมัติ deploy prod บน GitHub environment (≥ 2 คนมีชื่อ) | Tech lead + 1 คนจากบริษัท | Tech lead + ฝ่าย IT | W6 (ก่อน release gate) | — (เป็นชื่อคน ไม่ใช่โค้ด) |
| 10 | ☐ | **Written waiver: Admin drag & drop เลื่อนไป Phase 1.1** ทั้งที่ NFR Usability ใน PDF ระบุไว้ (C1-22) | เลื่อนไป 1.1 — MVP ใช้ dialog "เลื่อนเวลา…" ซึ่งทำงานเทียบเท่าและเข้าถึงได้ด้วยคีย์บอร์ด | เจ้าของ requirement | **W0** | ไม่ได้ waiver → T-102 เข้า W6 และต้องมี dev คนที่สาม |
| 11 | ☐ | **ยอมรับเป็นลายลักษณ์อักษรว่านิยาม NFR-5 "delivery > 99 %" = relay รับไว้ ÷ ที่พยายามส่ง** (ตัดที่อยู่ที่ไม่มีจริงออก) ไม่ใช่ inbox delivery — relay ของบริษัทไม่มี webhook จึงวัด inbox ไม่ได้ (C1-18, IR-01; spike ยืนยันว่ายังไม่ปิด — 11.D ข้อ 5) | นิยามตามนี้ + เฝ้า bounce ของ `MAIL_FROM` + หน้า outbox/dead-letter ให้ admin | เจ้าของ requirement + ฝ่าย IT | **W0** | ถ้าต้องการวัด inbox จริง → ย้ายไป Postmark/SES (ต้องขอ DNS + ค่าใช้จ่ายรายเดือน) |
| 12 | ☐ | **HR/DPO ยืนยันตาราง PII inventory + ระยะเก็บรักษา + ผู้รับผิดชอบ DSAR/แจ้งเหตุละเมิด** และเป็นเจ้าของปฏิทินวันหยุดบริษัทประจำปี (C1-19; ตารางอยู่หัวข้อ 05) | ตามตารางในหัวข้อ 05 (booking free-text 24 เดือน, อีเมลผู้เข้าร่วม 12 เดือน, audit 24 เดือน, pseudonymise หลังพ้นสภาพ 12 เดือน) | HR / DPO | **W0** | เปลี่ยนระยะเก็บ = แก้ตัวเลขใน `maintenance.daily` ไม่กี่ชั่วโมง |
| 13 | ☐ | **HR/DPO + IT รับทราบกติกาการใช้ข้อมูลจริง (CF-05)**: dump ของ prod เปิด **เพื่อทดสอบ/ซ้อม** ได้เฉพาะใน environment ชั่วคราวที่แยกขาด `rf-drill` **บน VM ชั่วคราวแยก ไม่ใช่ VM ของ prod** และต้องส่ง `pg_restore -f -` + `scrub` + assert ว่าไม่พบตัวตนจริง ผ่าน `psql --single-transaction` สายเดียวเป็นธุรกรรมเดียว ก่อนมี service ใดเข้าถึง แล้ว `down -v`; การ restore เพื่อ **rollback/DR กลับเข้า `rf-prod` ที่หยุดแล้ว** อนุญาตโดยชัดเจน (ผู้อนุมัติ 2 ชื่อ + incident note, ไม่ scrub); **staging ใช้ seed/test data เท่านั้นตลอดโครงการ** | ตามที่ระบุ (ไม่มีทางเลือกอื่นในสเปก) | HR / DPO + ฝ่าย IT | **W0** | ถ้าต้องการข้อมูลจริงใน UAT ต้องมี VM + Mailpit แยกต่อทีม + DPIA เพิ่ม (ไม่อยู่ใน MVP) |
| 14 | ☐ | กำลังคน: 3 คน (lead + 2 devs) สำหรับปฏิทิน 8 สัปดาห์ หรือ 2 คนแล้วยืดเป็น ~W10–W11 (หัวข้อ 08; ผู้รีวิวภายนอกได้ตัวเลขเดียวกันคนละทาง — 11.D) | 3 คน / 8 สัปดาห์ | ผู้บริหารโครงการ | **W0** | ถ้า 2 คน: เลื่อนวัน go-live หรืออนุมัติ cut list ล่วงหน้า |
