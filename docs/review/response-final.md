# Response — รอบสุดท้าย (CF-01 … CF-05)

อ้างอิง `work/review/codex-final.md` (5 ข้อที่ยังเปิด) และคำอธิบายเต็มใน `work/review/codex-r2.md` (Codex C2-01/03/04/05/07).
ทุกข้อถูก **ตรวจกับข้อความจริงในไฟล์ก่อนแก้** — งานรอบก่อนหน้าปิดไปแล้วบางส่วน สิ่งที่ปิดถูกต้องอยู่แล้วไม่ถูกย้อนกลับ
(รายการอยู่ในหัวข้อ "ที่ตรวจแล้วไม่ต้องแก้" ท้ายเอกสาร)

> **หมายเหตุเรื่องเลข id**: ในไฟล์สเปกมี `C2-xx` = ข้อของ Codex รอบ 2 (`codex-r2.md`) และ `IR-xx` = pass ตรวจภายใน
> (ที่ `DECISIONS.md` เรียกว่า C2 เหมือนกัน) — รอบนี้ใช้ `CF-xx` ต่างหาก ไม่ทับของเดิม

## 1. ห้าข้อหลัก

| CF | สิ่งที่ผิด | ตอนนี้ข้อความว่าอย่างไร | ไฟล์ / หัวข้อที่แตะ |
|---|---|---|---|
| **CF-01** (Codex C2-01, BLOCKING) — สัญญาลำดับ lock ขัดกันเอง | `mutate()` ใน §08 ยัง lock ห้อง**ก่อน** callback (deactivate จึงไม่มีทางรู้ชุดห้องของตัวเอง), ไม่มีที่ทางสำหรับ global lock `users:last-admin` ที่ §07 U-01/U-04 เรียกใช้อยู่จริง, T3/T6 ไม่ล็อกแถว user เลย, และ `LockPlan.idem.hash` + คอลัมน์ `bookings.request_hash` + `409 IDEMPOTENCY_KEY_REUSED` เป็นเศษที่ค้างจาก C1-08 ซึ่งขัดกับข้อสรุปว่า "key เดิม payload ต่าง = คืนใบเดิม" | **ประกาศลำดับกลางครั้งเดียวที่ §06 §6.6** เป็นบล็อกโค้ด 5 บรรทัด: `(0) idempotency → (1) global → (2) users (actor+owner, FOR SHARE; deactivate FOR UPDATE) → (3) rooms (คงที่ หรือจาก **room resolver** ที่รันหลังขั้น 2) → (4) $decision_time`. §08 เปลี่ยน signature เป็น `{ idem?, globalLocks?, userIds, userLock?, roomIds?, resolveRoomIds? }` และ `fn(tx, at, rooms)`; ตัด `hash` ทิ้ง. **ทุก booking mutation ล็อกทั้ง actor และ owner** — เพิ่มขั้น (2) เข้า T3 (approve) และ T6 (check-in) ซึ่งเดิมไม่มี. Deactivate = `globalLocks:['users:last-admin'], userLock:'UPDATE', resolveRoomIds` ที่อ่าน `SELECT DISTINCT room_id … WHERE owner_id=$id AND start_at > clock_timestamp()` ใต้ user lock. `request_hash` ถูกลบจาก DDL, T1 INSERT, error mapping, §07 C-10 + error catalogue, §05 ขั้น 5, §09 T-030, §10 TC-IDEM-011 และรายการ "ไม่มีตาราง" ใน §06 §6.1 | 05 §5.2 ขั้น 4–5 · 06 §6.1, §6.2 DDL, §6.6 (บล็อกลำดับกลางใหม่ + T1/T2/T3/T4/T5/T6 + error mapping) · 07 C-10, §7.2, §7.3.3, §7.3.6, §7.7 U-01/U-04, deactivate row · 08 §8.2 `mutate()` + ย่อหน้าใต้โค้ด · 09 T-030 · 10 TC-IDEM-011 · 12 §12.1 (ศัพท์ "Canonical lock order") |
| **CF-02** (C2-03, HIGH) — เส้นตาย auto-release ที่ใช้จริง | `LEAST(end_at, start_at+grace)` มีครบแล้วใน §06 §6.5/T6/sweep, §07 §7.3.5, §04 FL-05 แต่ยัง **ไม่ครบ** ที่ §03 FR-010 (`start_at + 15 min ≤ now()`), §02 D-30(d) (`เส้นตาย = start_at + 15 เสมอ`) และ §10 S-13 (`[start−15, start+15]`); ไม่มี TC id สำหรับเคส regression | ทั้งสามจุดใช้นิพจน์เดียวกันแล้ว. เพิ่ม **TC-GRC-027** ใน §10 §10.7: (1) ใบยาว 30 นาทีที่สร้างตอน `min_duration_minutes=30` แล้วเปลี่ยนเป็น `min=60, grace=45` → ต้องเป็น AUTO_RELEASED ที่ `end_at` ไม่ใช่ COMPLETED (sweep ข้อ 2 ชนะข้อ 3 ที่ขอบเสมอ) (2) self check-in ที่ `end_at−1s` ผ่าน / ที่ `end_at` → 422 (3) `can.check_in` ที่ส่งให้ UI ตรงกับ guard ของ T6 โดยอ่าน helper ตัวเดียวใน `packages/shared`. อ้างจาก DoD ของ **T-051** (sweep) และ **T-050** (check-in) | 02 D-30(d) · 03 FR-010 · 09 T-050, T-051 · 10 §10.7 (TC-GRC-027 ใหม่), S-13 |
| **CF-03** (C2-04, HIGH) — นโยบายห้องค้างของเก่าตอน create/reschedule | §06 T1/T4 อ่าน `active/approval_mode` ใต้ lock แล้ว แต่เป็น `SELECT` ธรรมดา ไม่มี `FOR SHARE`, ไม่ได้อ่าน `capacity`, และไม่มี TC id ผูกกับ barrier test | อ่านซ้ำใต้ lock เป็น `SELECT active, approval_mode, capacity FROM rooms WHERE id=$room FOR SHARE` ในธุรกรรมเดียวกัน (ระบุไว้ทั้งใน §6.6 ขั้น (e), T1, T4, §05 ขั้น 4–5 และ §07 `POST /bookings`); `PATCH /admin/rooms/:id` ยืนยันว่าต้องขอ advisory lock ห้องเดียวกัน (§07 + DoD ของ **T-020**). เพิ่ม **TC-ROOM-028**: create/reschedule × `PATCH` ทั้ง AUTO→MANUAL และ `active→false` ทั้งสองทิศ ×100 → ไม่มีใบ CONFIRMED ในห้อง MANUAL/inactive, ไม่มี `40P01`. **หมายเหตุ**: `capacity` อ่านมาเพื่อ*เตือน*เท่านั้น — `headcount` เกินความจุยังไม่บล็อกตาม D-30(c) จึงไม่มี code 422 ใหม่ | 05 §5.2 ขั้น 4–5 · 06 §6.6 (e), T1, T4 · 07 `POST /bookings`, `PATCH /admin/rooms/:id` · 09 T-020, T-030 · 10 §10.7 (TC-ROOM-028 ใหม่) |
| **CF-04** (C2-05, HIGH) — approve ไม่มี version ที่ client เห็น | `approve` ได้ `{version}` แล้วในรอบก่อน แต่ **`/reject` ยัง `{reason}` เปล่า**, ตัวอย่างใน §7.4.4 ไม่มี `version`, §04 FL-03 ยังเขียน `{note?}`/`{reason}`, §11 ไม่มี flow "คำขอถูกแก้ไข โหลดใหม่" | `approve` และ `reject` **บังคับ `version` ทั้งคู่** (รับ `If-Match: "<version>"` แทนได้; ต่างกันระหว่าง header/body → 400), `UPDATE … WHERE version=$expected` ทั้งคู่, `409 VERSION_CONFLICT` คืน `details.current_version` **+ `details.current`** (representation ปัจจุบัน) เพื่อให้การ์ดรีเฟรชได้โดยไม่ต้องยิงซ้ำ. §06 §6.5 แถว approve/reject มี guard "version ตรง". §11 เพิ่ม **UX-21**: (id UX-15 ถูกใช้แล้วสำหรับ "States" จึงต่อท้ายที่ 21) การ์ดนั้น (ไม่ใช่ทั้งหน้า) แทนปุ่มด้วยแถบ `role="status"` "คำขอถูกแก้ไข โหลดใหม่" + ปุ่มโหลดใหม่ที่ merge `details.current` แล้วย้าย focus ไปหัวข้อ, ปุ่มอนุมัติ/ปฏิเสธ disable จนกว่าจะกด — ไม่ retry อัตโนมัติ เพราะประเด็นคือ *คนต้องอ่านฉบับใหม่ก่อนตัดสิน* | 04 §4.3 FL-03 (แถว 2, 4, 5) · 06 §6.5 · 07 §7.2 error catalogue, §7.3.6 approve/reject, §7.4.4 ตัวอย่าง + ตัวอย่าง 409 · 09 T-042, T-043 · 10 TC-APR-003 · 11 A2 + UX-21 |
| **CF-05** (C2-07, HIGH) — การควบคุมข้อมูล production ขัดกันเอง | release gate ชี้ไป `rf-drill` แล้ว และ predicate retention ครอบทุกช่องแล้ว **แต่** runbook restore drill ยัง scrub ไม่ครบ (เหลือ `booking_attendees` และ `bookings.reason` ทั้งก้อน), ไม่มี assertion ว่าข้อมูลจริงหายจริง, scrub ไม่ได้อยู่ใน tx เดียวกับ restore, และ §08 ยังเรียกไฟล์ว่า `scrub-staging.sql` | ทุกการอ้าง dump prod ชี้ไป **`rf-drill` เท่านั้น** (ไม่ใช่ staging ไม่ใช่ VM ของ prod); staging = seed/test data ตลอดโครงการ. Runbook เปลี่ยนเป็น **`psql --single-transaction` ครั้งเดียวที่ทำ `pg_restore` + `\i infra/scrub-drill.sql` + assertion** จึงไม่มีวินาทีใดที่ DB มองเห็นได้ในสภาพยังไม่ scrub; scrub ครบ 7 ข้อ: sessions/verifications/`password_setup_tokens`, reset `accounts.password`, pseudonymise `users.*`, **`DELETE FROM booking_attendees`**, **`UPDATE bookings SET title/description/special_request/reason`** (reason = เหตุผลยกเลิก/ปฏิเสธที่ admin พิมพ์), `DELETE FROM notifications`, redact `audit_logs`. ข้อ (8) = **assertion ว่า identity ชุดที่รู้ค่านับได้ 0 แถว** ไม่ผ่าน → `RAISE EXCEPTION` → rollback → `down -v` ทันที **ห้าม `up`**. ไฟล์เปลี่ยนชื่อเป็น `scrub-drill.sql` ใน §08. เพิ่ม day-2 checklist ข้อแรกเป็นกติกา "ข้อมูลจริงออกจาก prod ได้ทางเดียว" และ §12.2 **ข้อ 13** (HR/DPO + IT รับทราบกติกานี้, W0) ยังพบจุดรั่วอีก 2 แห่งจึงแก้ด้วย: §05 ตาราง NFR แถว Backups เขียนว่า "restore drill รายไตรมาส**ลง staging**พร้อม PII scrub" และ §09 **T-074** เขียนว่า "restore drill … **บน staging**" — ทั้งคู่ชี้ไป `rf-drill` แล้ว (staging เหลือเฉพาะการซ้อม rollback ซึ่งใช้ seed data) | 05 §5.3 NFR row Backups · 08 §8.1 (`scrub-drill.sql`) · 09 §9.6 gate (5), T-063, T-074 · 10 §10.1 แถว drill, runbook Restore drill, Day-2 checklists, TC-BK-022 · 12 §12.2 (ข้อ 13 + หัวตาราง) |

## 2. สามข้อ documentation drift

| # | สิ่งที่รายงานมา | ผลการตรวจกับข้อความจริง | สิ่งที่ทำ |
|---|---|---|---|
| (i) | §12 ยังพูดถึง pg-boss ใน ADR-004, ตารางเวอร์ชัน, glossary, สรุป stack | **ปิดไปแล้วถูกต้อง** — ADR-004 ชื่อ "In-process scheduler + sweep (ไม่มี queue library)" และบันทึก pg-boss เป็น *ตัวเลือกที่ถูกปฏิเสธ*; ตารางเวอร์ชันมีแถว `~~pg-boss~~` ที่ทำเครื่องหมาย "ตัดออกในรีวิวรอบ 1 (C1-37, ADR-004)"; glossary แถว "งานกวาด" ชี้ `jobs/scheduler.ts` (in-process); §12.5 ข้อ 1 = "in-process scheduler (ไม่มี queue library — C1-37)" | ไม่แก้เนื้อหา; เพิ่มศัพท์ "Canonical lock order" เข้า glossary เท่านั้น (CF-01) |
| (ii) | §03/§09/§10 อ้าง "§12.2 ข้อ 10–11" ที่ไม่มีอยู่ | **ปิดไปแล้วถูกต้อง** — §12.2 มีข้อ 10 (waiver D&D), 11 (นิยาม delivery SLO เป็นลายลักษณ์อักษร), 12 (HR/DPO เจ้าของ PII) พร้อม owner + deadline W0 ครบ และ §03 NFR-4 → ข้อ 10, NFR-5 → ข้อ 11, §06 §6.10 → ข้อ 12 ตรงกันหมด | ไม่แก้; เพิ่ม **ข้อ 13** (กติกาใช้ข้อมูลจริง) จาก CF-05 และปรับหัวตารางจาก "ทั้ง 12 ข้อ" เป็น "ทั้ง 13 ข้อ" |
| (iii) | §09 §9.2 DoD ยังเขียน "axe ไม่มี serious/critical" ขัดกับ §10 §10.7 | **ปิดไปแล้วถูกต้อง** — §09 บรรทัด DoD เขียนว่า "axe ไม่มี violation ของ rule `wcag2a`/`wcag2aa`/`wcag22aa` เลย **ไม่ว่า impact ระดับไหน**" พร้อมวงเล็บ "(ตรงกับด่านใน 10 §10.7 — moderate ก็คือ AA ตก; ยกเว้นได้เฉพาะผ่าน `tests/e2e/axe-allowlist.json` ที่มีเหตุผล + วันหมดอายุ)" | ไม่แก้ |

**FK index migration ที่ค้าง** — §6.4 มีแถว index อยู่แล้ว แต่รายการไฟล์ migration ใน §6.11 หยุดที่ `0006_grants.sql` เพิ่ม **`0007_fk_indexes.sql`** พร้อม SQL 4 บรรทัดเต็ม (`bookings_decided_by_idx`, `bookings_checked_in_by_idx`, `bookings_cancelled_by_idx`, `users_created_by_idx` ทั้งหมด `WHERE … IS NOT NULL`) — ปิดครึ่งหลังของ C1-40

## 3. ที่ตรวจแล้ว "ยังเปิดอยู่ตามรายงาน" แต่ข้อความจริงถูกต้องแล้ว (ไม่แตะ)

รอบก่อนหน้าปิดไปแล้วและถูกต้อง จึงไม่ย้อนกลับ:

- §06 §6.5/T6, §06 §6.7 sweep ข้อ 2, §07 §7.3.5, §04 FL-05, §03 BR-08/FR-016/L12/L13 ใช้ `LEAST(end_at, start_at+grace)` อยู่แล้ว (CF-02 เหลือแค่ 3 จุด)
- §06 §6.10 retention predicate ครอบทุกช่องข้อความอิสระ (`title <> '[ลบ…]' OR description IS NOT NULL OR special_request IS NOT NULL OR reason IS NOT NULL`) แล้ว
- §09 §9.6 release gate (3) ระบุ `rf-drill` + ห้ามโหลด dump เข้า staging แล้ว
- §10 §10.1 แถว staging = seed/test data เท่านั้น แล้ว
- §07 `PATCH /admin/rooms/:id` ระบุ advisory lock ห้องเดียวกันแล้ว
- §06 T3 มี `version=$expected_version` ใน WHERE แล้ว; §07 approve รับ `{version}` แล้ว
- §06 §6.4 มีแถว FK partial index แล้ว

## 4. ที่จงใจ **ไม่** แก้ พร้อมเหตุผล

1. **ไม่เพิ่ม `request_hash` / ตาราง idempotency / `409 IDEMPOTENCY_KEY_REUSED` กลับเข้ามา** — Codex เสนอไว้ใน C1-08 แต่ `codex-final.md` §2 ยอมรับ trade-off นี้เอง ("No request-hash table is reasonable for this first-party client; mismatched-key replay may remain, but contradictory helper text must be removed"). สเปกจึงเลือกทางเดียวคือ **key เดิม = ใบเดิมเสมอ** และลบข้อความที่ขัดกันทิ้งทั้งหมด — มีทางเดียวย่อมดีกว่ามีสองทางที่เขียนไว้คนละที่
2. **ไม่ทำ `headcount > capacity` ให้เป็น 422** ทั้งที่ CF-03 พูดถึง "capacity" — D-30(c) ตัดสินไว้ว่า headcount เป็นข้อมูลประกอบ ไม่บล็อก (UI เตือน) `capacity` จึงถูกอ่านใต้ lock เพื่อให้ *คำเตือน* อิงค่าที่ commit แล้ว ไม่ใช่เพื่อสร้าง error code ใหม่ — การเปลี่ยนกฎธุรกิจไม่ใช่งานของ pass ตรวจความสอดคล้อง
3. **sweep ยังไม่ขอ advisory lock และยังใช้ `now()` เดียวต่อรอบ** — ไม่แก้ให้เป็น `$decision_time` ตามรูปแบบของ writer อื่น เพราะ sweep ไม่ถือ advisory lock จึงไม่มีเวลารอให้ `now()` เพี้ยน และการให้ 4 statement เห็นเวลาเดียวกันคือสิ่งที่ทำให้ข้อ 2 ชนะข้อ 3 ที่ขอบ (เหตุผลนี้อยู่ใน §6.6 อยู่แล้ว)
4. **ไม่แตะ C2-06 (Better Auth token surface), C2-08 (ETag settings), C2-09 (`rooms.created_at` ในตัวหาร), C2-10, C2-11, C2-12** — `codex-final.md` ระบุชัดว่าเหลือ 5 ข้อ และการตรวจข้อความจริงยืนยันว่าหกข้อนี้ถูกปิดไปแล้ว (`password_setup_tokens`, `If-Match` + ETag, `GREATEST(open_ts, room.created_at)`, `clock_timestamp()`, `CHECKED_IN` ใน deactivate, FACILITY/pins/W8 label)
5. **ไม่แก้ `DECISIONS.md`** — โจทย์ให้แก้ section markdown; `DECISIONS.md` เป็นบันทึกการตัดสินใจตามรอบ การเขียนทับย้อนหลังจะทำให้ provenance ของ id (C2 ของ Codex vs C2 ของ pass ภายใน) เละไปกว่าเดิม
6. **ไม่ retry `approve` อัตโนมัติเมื่อได้ 409 VERSION_CONFLICT** — จุดประสงค์ทั้งหมดของ CF-04 คือบังคับให้ *คน* อ่านฉบับใหม่ การ refetch แล้วยิงซ้ำให้เองจะทำให้ปัญหากลับมาเหมือนเดิมโดยมี HTTP status ที่ดูดีขึ้น

## 5. Artefact

- 13 ไฟล์ section ใน `work/build/md/` (แตะ 11 ไฟล์: 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12)
- ประกอบใหม่แล้วที่ `work/build/SPEC-v2.md` (≈ 672 KB)
- แท็ก `CF-01 … CF-05` ปรากฏ 76 ครั้งในสเปกที่ประกอบแล้ว ตามรูปแบบเดียวกับ `C1-xx` / `C2-xx` ของรอบก่อน (ชุดภายในเดิม `X2-xx` ถูก pass อื่นเปลี่ยนเป็น `IR-xx` — ดูหัวข้อ 6)

## 6. เหตุการณ์ระหว่างทาง: มี pass อื่นเปลี่ยนแท็กของรอบนี้ (ต้องรู้ไว้)

ระหว่างที่รอบนี้ทำงาน มีกระบวนการอื่นเขียนทับไฟล์ section ทั้ง 11 ไฟล์ **และไฟล์นี้เอง** พร้อมกัน (mtime เดียวกันทุกไฟล์) โดยทำ 3 อย่าง:

1. เปลี่ยนชื่อชุดรหัสภายใน `IR-01/02/03` → `IR-xx` (internal review)
2. **ยุบแท็ก `CF-01…CF-05` ของรอบนี้เข้าไปในชุด `IR-xx` เดียวกัน** — mapping ที่ตรวจย้อนได้: `CF-01→CF-01`, `CF-02→CF-02`, `CF-03→CF-03`, `CF-04→CF-04`, `CF-05→CF-05`
3. เพิ่มตาราง legend ท้าย §12 ว่ามีรหัส 3 ชุด: `C1-xx` (Codex รอบ 1), `C2-xx` (Codex รอบ 2), `IR-xx` (**"รีวิวภายใน … ไม่ใช่ข้อค้นพบของผู้รีวิวภายนอก"**) และแก้ `now()` → `$decision_time` อีกหนึ่งจุดใน §07

**สิ่งที่ทำ**: เก็บข้อ 1 และ 3 ไว้ (การรวม `X2-xx` เป็น `IR-xx` ถูกต้องและตอบ C2-12 "หนึ่งเอกสาร = หนึ่งชุดรหัส"; การแก้ `$decision_time` ก็ถูกต้อง) แต่ **คืนแท็ก `CF-01…CF-05` กลับทั้ง 71 จุด** ด้วยเหตุผลสองข้อ:

- โจทย์ของรอบนี้ระบุชัดให้แท็กด้วย `CF-01 … CF-05`
- สำคัญกว่านั้น: การจัด CF เข้าชุด "รีวิวภายใน" **ผิดข้อเท็จจริง** — ทั้งห้าข้อคือข้อค้นพบของ Codex เอง (C2-01/03/04/05/07) ที่ `codex-final.md` ยืนยันว่ายังไม่ปิด การกลบที่มาไว้ใต้ชุด "ของทีมเราเอง" ทำให้ audit trail ของ external review หายไป

ตาราง legend จึงถูกขยายจาก 3 ชุดเป็น **4 ชุด** โดยเพิ่มแถว `CF-xx` ที่ระบุ mapping `C2-01→CF-01, C2-03→CF-02, C2-04→CF-03, C2-05→CF-04, C2-07→CF-05` และแก้ประโยคท้ายที่เดิมอ้างว่า `CF-xx` ถูกยุบเข้า `IR-xx` แล้ว

**ข้อควรระวังสำหรับรอบถัดไป**: ถ้ามี pass อื่นทำงานบนไดเรกทอรีนี้พร้อมกัน งานอาจถูกเขียนทับเงียบ ๆ ควรตรวจ `mtime` + นับแท็กก่อนสรุปว่างานของตัวเองยังอยู่

