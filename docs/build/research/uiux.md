# ReserveFlow v2 — UX / a11y research notes (senior product designer)

Inputs reviewed: `work/v1-sections/mockups.html` (11 panels; the split file is truncated after Approval — Reports + QR check-in panels were pulled from `inputs/spec.html` lines ~71656–78652), `work/v1.css`, `work/v1.js`, `inputs/requirements.txt` (FR/NFR/US), `inputs/company.txt`, BRIEF Stitch facts.
Companion files: `work/research/mockup-admin-users.html`, `work/research/mockup-admin-rooms.html` (drop-in `.screen` panels; verified to use only v1.css classes; rendered OK at 1400px).

Legend for priorities: **M** = must ship in MVP, **S** = should, **C** = could/defer.

---

## 1. Screen inventory v2

### 1.1 Employee app (`apps/web`) — mobile-first (people book & check in from phones)

| # | Screen | Purpose / primary actions | States to design | FR / US | v1 |
|---|---|---|---|---|---|
| E0 | **Login** | Email *or* employee code + password; "จำฉันไว้"; link ลืมรหัสผ่าน. Drop the mobile-number field (Q-09). | error: credentials wrong / account locked (rate limit) / **account deactivated → "บัญชีถูกปิดใช้งาน ติดต่อ Admin"**; loading on submit | gate for all | ✅ (needs field change) |
| E0b | **Set / reset password** (invite link + forgot-password link, same screen) | Replaces Register in prod: Admin creates the account → email link (24 h) → user sets password. | expired/used link, weak password, success → auto-login | Q-08 | ❌ missing (v1 "Register" exists; keep only as prototype or delete) |
| E1 | **Home / Dashboard** | Quick search (date, start, end, people, features) = the Stitch "Quick Book"; today's schedule; room status now; pending count. | empty "วันนี้ยังไม่มีการประชุม"; loading skeleton | FR-001/002, US-001 | ✅ |
| E2 | **Search results (ห้องว่าง)** | Cards of rooms that satisfy criteria; "เลือกห้อง". Show approval-mode as info pill, not as the status badge. | **empty: "ไม่มีห้องว่าง 13:00–14:00" + nearest free slots per room**; loading; error/retry | FR-002, FR-011, US-001 | ✅ (capacity filter bug in mock data: Grove 8 คน shown for 10-person search) |
| E3 | **Room detail + date/time picker** | Photo, capacity, features, hours, approval mode; month picker (disable past, >30 d, closed days); 30-min slot timeline + start/end selects bound together; legend. | no free slot today → suggest next day; loading slots; stale → refetch on focus | FR-001 (per-room day), FR-002 | ✅ (slot grid needs rework, see §2) |
| E4 | **Booking form** | Title, attendees (email chips + pick employee), private switch, special request, .ics checkbox, **priority/purpose when room is Manual**; CTA label differs: "ยืนยันการจอง" (auto) vs "ส่งคำขอจอง" (manual). | **409 conflict inline alert (US-002)** with "เลือกเวลาอื่น / ดูห้องอื่น"; validation; submitting (disabled + idempotency key); offline | FR-003/004/005/007, US-002/003/007 | ✅ (no error state) |
| E5 | **Booking result / detail** | One page for both: after submit (Confirmed vs Pending explained, "กำลังส่งอีเมล", add-to-calendar) and later from the list: full details, attendees, status timeline (ส่งคำขอ → อนุมัติโดย → เช็กอิน), actions: แก้ไขรายละเอียด, เลื่อนเวลา, ยกเลิก, เช็กอิน (inside window), ส่งคำเชิญอีกครั้ง; rejection reason. | loading; 404/403; past/locked (meeting started) | FR-006 reason, FR-008, FR-009 | ❌ missing (v1 only toasts) |
| E6 | **My bookings** | Upcoming (default) / ประวัติ tabs; status filter chips; row actions. | empty + CTA "จองห้อง"; loading | FR-008, US-005 | ✅ |
| E7 | **Reschedule / edit** | Change time/room = re-run availability + conflict; warn "อาจต้องรออนุมัติใหม่" for manual rooms (Q-13); editing title/attendees never re-approves. | conflict; pending re-approval | FR-008, Q-13 | ❌ ("แก้ไข" button is dead) |
| E8 | **Cancel confirmation dialog** | Consequences: "คืน slot ทันที · แจ้งผู้เข้าร่วม"; optional reason; no undo (say so). | — | FR-008, US-005 | ❌ (v1 cancels instantly) |
| E9 | **Calendar / ตารางเวลา** (room-week & all-rooms-day) | Read-only calendar for everyone (FR-001 **Must**); Busy / รออนุมัติ / ว่าง; Private shows "ไม่ว่าง"; click free cell → prefilled booking. | empty week; loading skeleton; p95 ≤ 2 s | FR-001, US-007, NFR perf | ❌ (nav link dead — **biggest gap vs a Must FR**) |
| E10 | **Check-in landing** (after scanning room QR on phone) | Shows the booking matching room+time for this user; "เช็กอินตอนนี้"; countdown to auto-release; window 15 min before → 15 min after start (Q-16). | no booking for you now; too early; too late (auto-released); already checked-in; token expired | FR-010, US-006 | ✅ partially (v1 panel mixes kiosk + phone) |
| E11 | **Profile / settings** | Name, team (read-only), email, change password; notification prefs **C**; language toggle **C** (Thai-only MVP). | — | — | ❌ (nav link dead) |
| E12 | Notifications (in-app list) | Email is the Must channel (FR-009). In-app bell = **C**; recommend defer, remove the bell from MVP nav rather than ship a dead icon. | — | FR-009 | ❌ (bell shows "2" with nothing behind it) |
| E13 | Error / system pages: 403 (role), 404, 500, session expired, maintenance | — | — | — | ❌ |

### 1.2 Admin app (`apps/admin`) — desktop-first, tablet OK (approvals, room-door check-in)

| # | Screen | Purpose / primary actions | States | FR / US | v1 |
|---|---|---|---|---|---|
| A1 | **Dashboard** | KPIs (utilization, bookings, pending w/ oldest age, no-show), "ต้องดำเนินการ" list, room status tiles. Remove ambiguous "Export" button. | loading; zero data first month | FR-012 | ✅ |
| A2 | **Approval center** | Pending queue grouped by conflict; sort oldest first / starts soonest; per request: requester, team, purpose, priority, attendees, wait time. **Approve → confirm "อีก N คำขอที่ทับจะถูกปฏิเสธอัตโนมัติ"**; **Reject → reason dialog (required, FR-006)**. | empty "ไม่มีคำขอค้าง"; approve failed (slot taken by admin reschedule) | FR-005/006, US-004 | ✅ (no reason dialog) |
| A3 | **Room calendar (all rooms, day/week)** + drag-and-drop reschedule (admin only) + keyboard alternative ("เลื่อนเวลา…" dialog) | Optimistic move → server conflict check → rollback + toast on 409; D&D asks reason? No — audit only; owner gets email. | conflict on drop; loading | NFR usability, FR-001 | ❌ (nav dead) |
| A4 | **All bookings** (search/filter by room, user, status, date) | Admin cancel with reason (Q-14), manual check-in (company.txt "ผ่านแอดมินหน้าห้อง"), open detail. | empty filter result; loading; pagination | FR-008/010 | ❌ |
| A5 | **Booking detail (admin)** | Same component as E5 + audit trail + admin actions (approve/reject/cancel/check-in/reschedule). | — | FR-006 | ❌ |
| A6 | **Rooms list** (cards) | Status (เปิดให้จอง / ปิดปรับปรุง), capacity, features, approval mode, hours; actions: แก้ไข, ดูปฏิทิน, QR หน้าห้อง (print), ปิดชั่วคราว. | only 3 rooms → cards, no pagination | FR-005/011 | ❌ → **mockup provided** |
| A7 | **Room edit form** | name, description, capacity, floor, features (chips + add new), approval mode, business hours + weekdays (blank = system default), active toggle / maintenance range, photo upload, internal note. Rule: mode/hours change affects new requests only. | validation; closing a room with future bookings → confirm + notify | FR-005/011 | ❌ → **mockup provided** |
| A8 | **Users list** | Search, filter by role/status/team, pagination; CSV import **S**. | empty search; loading | BRIEF deliverable 2 | ❌ → **mockup provided** |
| A9 | **User create/edit drawer** + deactivate | name, employee code, email (login), mobile, team, role (Employee/Admin/Facility), active toggle; password via emailed set-password link (admin never sees/sets passwords); reset-link button; deactivate = confirm dialog (reason, auto-cancel future bookings, reversible); no hard delete (audit); cannot deactivate self / last admin. | duplicate email/code; invite pending ("รอตั้งรหัสผ่าน") | BRIEF deliverable 2 | ❌ → **mockup provided** |
| A10 | **Settings** | Booking policy (min 60, increment 30, max 4 h, advance 30 d, check-in window, auto-release 15 min), default business hours, **holidays list** (closed dates), email sender name, announcement text (see §4 Webboard). One page, few fields. | — | business rules, Q-10/11/12 | ❌ (nav dead) |
| A11 | **Reports** | Date range + room filter; utilization bars; outcome breakdown; heatmap with numbers; CSV export (PDF = C). Denominator = business hours minus holidays, stated on page. | no data; loading | FR-012, US-008 | ✅ |
| A12 | Audit log | Read-only table over `audit_logs` (actor, entity, action, before/after), filter by date/actor/entity. Cheap; **S**. | empty | tech baseline | ❌ |
| A13 | Webboard / Announcements | See §4 — **defer**; if insisted: single announcement banner managed in Settings. | — | company.txt "ดู Webboard" | ❌ |

Admins also book rooms → admin app user menu has "ไปหน้าจองห้อง" (same session cookie, different app). No need to duplicate employee screens in admin.

### 1.3 Shared / kiosk / facility

| # | Screen | Purpose | States | FR | v1 |
|---|---|---|---|---|---|
| K1 | **Room door display** (tablet per room, kiosk mode, no login after setup) | Big status: ว่าง / จองแล้ว (เริ่ม 14:00) / กำลังใช้งาน / ปิดปรับปรุง; next meeting; **Private → "จองแล้ว" only, no title** (Q-15); rotating QR for check-in; optional "เช็กอิน" button for admin-assisted check-in (admin PIN or the admin just uses A4 on the same tablet). | offline (show last known + banner); no bookings today | FR-010 | ✅ partial (v1 "QR check-in" = kiosk+phone hybrid; split it) |
| K2 | Check-in landing (phone) | = E10 | | FR-010 | ✅ partial |
| K3 | **Facility daily run-sheet** (Facility role, read-only, printable) | Today/tomorrow per room: time, room, headcount, special request (น้ำดื่ม/เบรก), status; titles masked for private. Simple list page, no side nav. | empty day | stakeholder #3 in requirements.txt | ❌ |
| K4 | Email templates (not screens but UI surface): confirmed (+.ics), pending received, approved, rejected (reason), cancelled (by owner/admin), auto-released, reminder before start, account invite / password reset, room closed. Thai, plain, one CTA link each. | — | FR-007/009 | ❌ (only described) |

---

## 2. UX review of v1 screens — concrete issues & fixes

**Login / Register**
1. Three credentials (รหัสพนักงาน + เบอร์มือถือ + รหัสผ่าน) is friction with no security gain (Q-09). Use *email or employee code* + password. Mobile stays on the profile for contact/recovery.
2. No error/locked/deactivated states. Add generic "อีเมลหรือรหัสผ่านไม่ถูกต้อง" (don't leak which), lockout after N tries, and a distinct deactivated message (users who leave the company must be told why they can't log in).
3. Register: v1 already says "prototype only". v2: delete the panel, replace with **Set password (invite)** screen. Fewer screens, matches admin-provisioned accounts.

**Dashboard**
4. Greeting "สวัสดีค่ะ 👋" — system voice must not carry a gender particle (ค่ะ/ครับ). Use "สวัสดี, วิโนทัย". Apply globally: no ค่ะ/ครับ/นะคะ in UI strings; polite neutral Thai.
5. Search panel: date is a free text input ("26 ส.ค. 2026") → native `<input type=date>` (mobile gets OS picker for free). Start/End as selects in 30-min steps **bound together**: changing start sets end = start+60 min if invalid; end options < start+60 are disabled. People: numeric input, not a select with one option.
6. "🔔 2" and "TH" buttons lead nowhere. Remove both from MVP (see E12; Thai-only MVP). Dead controls in a mockup become dead controls in the product.
7. KPI "เวลาใช้ห้องเดือนนี้" is noise for employees; replace with "คำขอรออนุมัติ" detail or drop to 3 KPIs.

**Available rooms**
8. Summit's status badge says "⌛ Manual approval" in the slot where the other cards say "✓ Available" — mixes *availability state* with *approval mode*. Every card: availability badge (ว่าง / ไม่ว่าง) + a neutral pill "ต้องขออนุมัติ" in the meta row. Copy all-Thai: "ว่าง", not "Available".
9. Grove (8 คน) is listed for a 10-person search. Spec: rooms failing capacity/feature filters are hidden, with a one-line "ซ่อน 1 ห้องที่ความจุไม่พอ · แสดงทั้งหมด" toggle so users understand why only 2 appear.
10. No empty state. US-001 can legitimately return 0 rooms; design it with the next free slots for each room ("Horizon ว่าง 14:00–15:00") — that is the single most useful thing the page can do.
11. "เรียงตามความเหมาะสม" sort and duplicate filter chips: with 3 rooms, remove sorting; keep only the criteria summary + "แก้ไขการค้นหา".

**Room & time**
12. Slot grid is inconsistent: 08:30-based 1-hour cells, then a gap 12:30–13:00, then "13:00–14:00" busy — a booking that doesn't align with the grid can't be represented. Decide the grid: **30-min cells from 08:30 to 17:30 (18 cells)**; a booking paints the cells it covers. Selection = tap first cell, tap last cell (or drag); the two selects under the grid mirror the selection (this is also the keyboard/screen-reader path). Stitch reference has both slot list and start/end dropdowns — keep both, bound.
13. "Pending" semantics in availability (Q-06): auto rooms never show pending. Manual rooms: cells with a pending request are **still selectable**, styled yellow with text "มีคำขอรอ" and a note when selected: "มีคำขออื่นรออนุมัติในช่วงนี้ — Admin จะเลือกเพียง 1 รายการ". Busy cells (Confirmed/Checked-in) are not selectable and never show a title. Add a legend row (ว่าง · มีคำขอรอ · ไม่ว่าง · เลือกแล้ว) with icons, not only colors.
14. Month picker: weekends use `.off` red (same red as busy) → reads as "fully booked". Closed days = muted gray + "ปิด" tooltip; past days and days > 30 d ahead disabled with reason ("จองล่วงหน้าได้ถึง 22 ก.ย."). Decide 30 days vs calendar month (Q-12) — UI copy depends on it; recommend 30 days (simpler to explain).
15. "แชร์" / "♡" (favourite) — noise for 3 rooms; remove.
16. "Executive Suite" rendered as `badge ok` (green) — green is reserved for available/confirmed. Room category = neutral tag.

**Booking form**
17. Private toggle is a static `<span class="toggle">` — needs a real switch (`role=switch`, label). Copy: "ประชุมส่วนตัว — ผู้อื่นเห็นเพียง 'ไม่ว่าง'; ผู้จัด ผู้เข้าร่วม และ Admin ยังเห็นรายละเอียด" (answers Q-15 in the UI itself).
18. Missing the single most important error: **conflict at confirm (US-002)**. Inline alert above the CTA: "ห้อง Horizon ไม่ว่างแล้วในช่วง 14:00–15:00 (มีคนจองก่อนเมื่อสักครู่)" + buttons "เลือกเวลาอื่น" (back to E3 with fresh slots) / "ดูห้องอื่นที่ว่าง". Don't toast it.
19. Manual-approval rooms: the business slide says Admin picks "the more important agenda", but the form collects no importance/purpose → Approval center's "High/Medium" bars have no data source. Add **ระดับความสำคัญ (ปกติ/สูง/เร่งด่วน) + วัตถุประสงค์ (1 line)** shown only when the room is Manual. Flag to data model (`bookings.priority`, `purpose`).
20. CTA and expectation: auto room "ยืนยันการจอง →" with "ยืนยันทันทีถ้าไม่ทับกัน"; manual room "ส่งคำขอจอง →" with "Admin จะตอบภายใน 1 วันทำการ" (set the SLA in Settings). Toast "จองสำเร็จ และส่งอีเมลแล้ว" overclaims (email is async) → "จองสำเร็จ · กำลังส่งอีเมลยืนยัน".
21. Double-submit protection: disable CTA + spinner; idempotency key per form instance (already in tech). After success go to **E5 detail**, not to the list + toast.
22. Attendees: validate email format + company domain hint; add employee picker (combobox over users) — cheap because the users table exists; keep free-email too for guests.

**My bookings**
23. Cancel has no confirmation and the toast claims "คืน Slot ทันที" before the server answered. Add AlertDialog (E8). Destructive actions always confirm; non-destructive ones toast.
24. "แก้ไข" leads nowhere → E7 flow; disable once the meeting started; hide cancel after end.
25. Missing statuses in the list: ถูกปฏิเสธ (with reason visible), ปล่อยอัตโนมัติ (auto-released), เช็กอินแล้ว, เสร็จสิ้น. Show reason inline for rejected — it's required by FR-006 so it must surface somewhere.
26. Split Upcoming vs ประวัติ; default Upcoming sorted by start. 4 status chips + 4 rows is fine for a mock, but real lists need the split.
27. Mixed-language fragments "Private · 3 attendees", "Cancelled by owner" → "ส่วนตัว · ผู้เข้าร่วม 3 คน", "ยกเลิกโดยผู้จอง".

**Admin dashboard**
28. Good structure. Remove top-right "Export" (export belongs to Reports). Nav lacks Users, All bookings, Settings → add (see §4). Pending KPI should say *oldest wait* ("รอสูงสุด 47 นาที") — that's what drives action.

**Approval center**
29. Conflict grouping is the right idea; keep. Fix: **Reject must open a reason dialog** (FR-006); v1 rejects instantly. Approve in a conflict group → confirm "อนุมัติ Executive Client Review และปฏิเสธอีก 1 คำขอที่ทับกันอัตโนมัติ (เหตุผลมาตรฐาน: ห้องถูกจัดสรรให้การประชุมอื่น)". Auto-rejecting losers with a canned reason is the lazy, clear choice; admin can still edit the reason.
30. Priority bars (90% / 58%) are an unlabeled visual with no data source (see #19). Replace with text "ความสำคัญ: สูง · วัตถุประสงค์: …" — readable, screen-reader-friendly.
31. Show wait time and start proximity on every request (only the single request has "รอ 47 นาที"); sort by start time ascending (most urgent first). Empty state: "ไม่มีคำขอค้าง".
32. Keep buttons as real `<button>` (they are) with text labels (they are) — good.

**Reports**
33. Add date range + room filter; CSV export (PDF = C). Heatmap is color-only with a green→yellow→red scale that collides with the status semantics (high utilization is not "bad"). Use a single-hue sequential scale (g0→g2→g6) **and print the number in each cell**. Provide "ดูเป็นตาราง" toggle for charts (a11y text alternative, also what Finance will paste into Excel).
34. State the denominator on the page ("ชั่วโมงทำการ จ–ศ 08:30–17:30 หักวันหยุด") — it's in v1 spec text but not on the screen.

**QR check-in**
35. The panel conflates the door kiosk (QR + countdown) with the phone landing (button "Check-in ตอนนี้", "กลับ Dashboard"). Split into K1 (kiosk: status + QR + next meeting, no dashboard button) and E10 (phone: your booking + check-in + countdown). Add the before-start window (Q-16: 15 min before → 15 after) and what happens at 0 ("ห้องจะถูกปล่อยให้คนอื่นจอง"). Privacy note is right: Private → "จองแล้ว" only.
36. Admin-assisted check-in (company.txt): a "เช็กอิน" action on A4/A5 is enough; no PIN pad needed on the kiosk in MVP.

**Cross-cutting**
37. **Language consistency**: headings are English ("Available Rooms", "My Bookings", "Admin Dashboard", "Approval Center", "Utilization Report") while nav/body are Thai. Decide Thai-first UI strings with English only for technical nouns users already say (Projector, Check-in, Auto-approve, .ics). Statuses in Thai: ว่าง / ไม่ว่าง / รออนุมัติ / ยืนยันแล้ว / ถูกปฏิเสธ / ยกเลิกแล้ว / เช็กอินแล้ว / ปล่อยอัตโนมัติ / เสร็จสิ้น (keep English enum in code). Single i18n file from day 1 (`packages/shared/i18n/th.ts`) even if only Thai ships.
38. **Dates**: pick one calendar and pin it in a `formatDate()` helper. Recommendation: **พ.ศ. via `Intl.DateTimeFormat('th-TH')`** (platform default for th-TH is the Buddhist calendar → zero code, what all 80 employees and older users expect, matches company paperwork). v1 mock shows "2026" (Gregorian) — flip to "26 ส.ค. 2569"; omit the year when it's the current year in lists. Gregorian/ISO stays in API, CSV, .ics. If the team prefers ค.ศ., the only rule that matters is *never mix*; never show a bare 2-digit year.
39. **Time**: 24-hour, zero-padded, en-dash ranges "08:30–17:30", optional "น." only in emails/prose. Timezone is fixed Asia/Bangkok — never show "+07:00" to users.
40. **Responsiveness**: v1 `.app` grid (205 px side nav) forces `min-width:710px` below 800 px — fine for a spec prototype, wrong for the product. Employee app: bottom tab bar (หน้าแรก · ค้นหา · ตารางเวลา · การจอง · โปรไฟล์) on < 768 px, left rail on desktop; tables → stacked cards; slot grid → vertical list with 2 columns; forms single column. Admin app: collapsible sidebar, tablet landscape as the minimum; data tables scroll horizontally inside their container.
41. **Feedback system**: define once — skeleton for lists; empty state with one CTA; error with retry; toast only for success of non-destructive actions; AlertDialog for destructive/irreversible; inline alerts for server-side validation (conflict). v1 has none of empty/loading/error.
42. Icons: v1 uses emoji/glyphs (▦ ⌕ ▣ 🛡 👥). Emoji render differently per OS and can't be recolored or sized reliably; use lucide icons with `aria-hidden` and visible text labels.

---

## 3. Accessibility review vs NFR ("รองรับการปรับขนาดตัวอักษรและ Contrast ปานกลาง เพื่อให้ผู้อาวุโสมองเห็นปฏิทินชัดเจน")

Target: WCAG 2.2 AA (text 4.5:1, large text 3:1, UI components/graphics 3:1, focus visible, target size ≥ 24 px, reflow at 320 px, 200% zoom). Measured ratios below (WCAG relative-luminance formula, computed from v1 tokens).

### 3.1 Contrast of the pastel palette

| Pair (v1 usage) | Ratio | Verdict |
|---|---|---|
| `--ink` #17324D on #D9F1E0 / #F9E9B9 / #F7D6D6 | **11.0 / 10.9 / 9.7** | pass AAA — pastel backgrounds + dark text is a sound base |
| `--ink2` #3F586C on the three pastels | 6.2 / 6.2 / 5.5 | pass AA |
| Badge text `--g6` #427B5A on #D9F1E0 (.ok, .chip.on, .slot.sel, active nav) | **4.18** | **fail** AA normal text (badges are 11 px bold) |
| Badge text `--y6` #936F25 on #F9E9B9 (.pending, .slot.pen, .avatar) | **3.83** | **fail** |
| Badge text `--r6` #A04F4F on #F7D6D6 (.bad, .slot.busy) | **4.17** | **fail** |
| `--muted` #71818E on white / g0 / y0 / n0 | 4.01 / 3.79 / 3.86 / 3.69 | **fail** — used for labels & helper text at 8–9 px |
| Primary button white on `--g6` | 4.99 | pass (barely) |
| `--g6` link on white | 4.99 | pass |
| Input border #CBD7CC on white (non-text, 3:1) | **1.49** | **fail** (1.4.11) |
| Focus ring `#72B98B24` (14% alpha) / focus border #72B98B | ~invisible / 2.33 | **fail** focus-visible |
| Status dots 8 px (#72B98B / #B7892E / #BF6666) on white | 2.3 / 3.2 / 4.0 | color-only + too small → remove or always pair with text |
| Pastel vs pastel: g1/y1 1.01, g1/r1 1.13, y1/r1 1.12 | ~1.0–1.1 | **indistinguishable for CVD/low vision** — status must never be carried by the fill alone |
| Chart bars g2/y2/r2 on white | 1.4–1.7 | fail 3:1 graphics; value labels exist (good) — add table alternative |

**Token fixes (keep the pastels, darken the ink-on-pastel tokens one step):**
- `--g6` → **#35664A** (5.6 on g1, 6.7 on white; primary button white-on-green becomes 6.7)
- `--y6` → **#7A5B1C** (5.2 on y1, 6.3 on white)
- `--r6` → **#8F3F3F** (5.3 on r1, 7.1 on white)
- `--muted` → **#5B6B78** (5.5 on white, ≥5.0 on tinted cards)
- input border → **#7F9A88** (3.05 on white) or simply `--ink2` at 1 px; focus = `outline: 2px solid #35664A; outline-offset: 2px` (no alpha ring as the only indicator)
- chart bars: use the 6-level tokens (g6/y6/r6) or outline bars with `--ink2`
The three pastels themselves are fine as backgrounds; they must always carry a text/icon label.

### 3.2 Font scaling & type
- Mockups are drawn at 8–11 px (prototype scale) — **do not carry these sizes into the product**. Base 16 px (1 rem), body ≥ 14 px, labels/captions ≥ 12 px, all sizes in rem; no fixed-height text containers; test at browser zoom 200% and OS font-size 200% (reflow, no horizontal scroll at 320 px CSS width).
- Offer an in-app "ขนาดตัวอักษร: ปกติ / ใหญ่ / ใหญ่มาก" switch (CSS `html{font-size:100/112.5/125%}` persisted) — one line of CSS, directly answers the NFR for older users, and helps the door display.
- Thai type: Noto Sans Thai (looped, very legible) — see §5. Line-height ≥ 1.6 (Thai stacks vowels/tone marks above and below); **no negative letter-spacing on Thai** (v1 headings use −0.03…−0.055 em; tone marks collide). `lang="th"` on `<html>` so browsers apply Thai dictionary line-breaking; `overflow-wrap:anywhere` only on user-generated strings.
- Numbers/time: `font-variant-numeric: tabular-nums` in slot grids, tables, countdown.

### 3.3 Status not by color alone
Every status surface in v1 that relies on fill: slot cells, calendar `.off`, heatmap, KPI tint, dots. Rule: **fill + icon/text + (for cells) a border or pattern**. Slot cells: ว่าง (no icon), มีคำขอรอ (⌛ + text), ไม่ว่าง (✕ + strikethrough, already in v1), เลือกแล้ว (✓ + 2 px border). Badges already have text + glyph — keep. Heatmap: number in every cell. Charts: legend with patterns or labels + "ดูเป็นตาราง".

### 3.4 Keyboard, focus, structure
- Side nav: `<nav aria-label>` + `<a aria-current="page">`; skip link to main.
- Slot picker: `role="grid"` or radiogroup with arrow keys; the start/end selects are the guaranteed keyboard path; announce selection via `aria-live="polite"`.
- Switches (private, active): `<button role="switch" aria-checked>`; chips used as filters: `aria-pressed`.
- Dialogs (cancel, reject reason, deactivate): focus trap, Esc closes, focus returns to trigger, destructive button last and not default-focused.
- Forms: `<label for>` everywhere; required marked in text ("*" + legend "* จำเป็น"); errors tied with `aria-describedby` and summarized at the top for long forms.
- **Drag & drop (admin calendar)**: every event has a "เลื่อนเวลา…" menu item opening a dialog (room, date, start, end) — same API call as a drop. Announce drop result. This is the NFR's "keyboard alternative" and also the tablet path.
- Countdown: `aria-live="polite"`, update announcements every minute, not every second.
- Prefers-reduced-motion: disable `.screen` enter animation / transitions.
- Target size: `.tiny` controls are 10 px — product minimum 32 px tall, 44 px on touch (bottom tabs, slot cells, row actions).
- Automated gate: axe + Playwright on every PR; manual pass with VoiceOver + keyboard on E3/E4/A2/A3 (the risky screens).

---

## 4. Information architecture & navigation

**Employee app** (bottom tabs on mobile, left rail on desktop — same 5 items; keep "จองด่วน" as a persistent primary button on home and a FAB on mobile):
หน้าแรก (E1) · ค้นหาห้อง (E2–E4) · ตารางเวลา (E9) · การจองของฉัน (E6, badge = pending count) · โปรไฟล์ (E11, logout). Stitch nav (Dashboard, Room Search, My Bookings, Schedule, Settings) maps 1:1. Check-in landing (E10) is reached by QR deep link, not nav.

**Admin app** (collapsible sidebar; order = frequency of use):
ภาพรวม (A1) · คำขออนุมัติ (A2, count badge) · ปฏิทินห้อง (A3) · การจองทั้งหมด (A4) · ห้องประชุม (A6/A7) · ผู้ใช้งาน (A8/A9) · รายงาน (A11) · ตั้งค่า (A10: นโยบายการจอง / วันหยุด / อีเมล / ประกาศ) · บันทึกระบบ (A12, S). User menu: ไปหน้าจองห้อง (employee app), ออกจากระบบ.

**Role-aware nav**: roles = EMPLOYEE, ADMIN, FACILITY. Server returns the role in the session; nav is rendered from a role → items map; routes are guarded server-side too (403 page, not a blank). Facility sees only K3 (+ print). Admin sees everything in the admin app and is a normal employee in the employee app. No per-permission matrix in MVP (three roles, 80 users — a role enum is enough; `ponytail`).

**"Webboard" (company.txt: Admin "ดู Webboard")** — ambiguous. Three readings: (a) announcements board (admin posts notices employees see), (b) internal forum/comments, (c) the slide author meant "dashboard". (b) is out of scope (moderation, notifications — a different product). Recommend: **defer; ask the stakeholder**. If they want (a), ship the lazy version: one `announcements` table (title, body, active, starts/ends) edited in Settings, rendered as a dismissible banner on employee Home and Login. ~half a day; no separate nav item.

---

## 5. Design system notes (for `packages/ui`)

**Tokens to keep from v1** (rename to semantic names):
- Neutrals: `--ink` #17324D (text), `--ink2` #3F586C (secondary text), `--muted` → #5B6B78 (see §3), `--bg` #F7F9F5, `--line` #DFE7DF, `--n0/--n1` (info/neutral surface).
- Semantic surfaces (pastels, keep): `success/available` g0 #F1FBF4 · g1 #D9F1E0 · g2 #B9E3C5; `pending/warning` y0 #FFFAF0 · y1 #F9E9B9 · y2 #EFD58A; `danger/busy/conflict` r0 #FFF5F5 · r1 #F7D6D6 · r2 #EDBABA. Semantic ink on them: g7 #35664A / y7 #7A5B1C / r7 #8F3F3F (replace g6/y6/r6).
- Mapping (decide and document once): **green = ว่าง / ยืนยันแล้ว / เช็กอินแล้ว; yellow = รออนุมัติ / เตือน (check-in countdown); red = ไม่ว่าง (occupied) / ชนกัน / ถูกปฏิเสธ / ปล่อยอัตโนมัติ / ยกเลิก; neutral n = ข้อมูล / เสร็จสิ้น / ปิดห้อง.** Note the collision with the company slide where 🟡 = "Reserved (ยังไม่เช็กอิน)" and 🟢 = "Checked-in": in the app, a confirmed-not-yet-checked-in booking is green "ยืนยันแล้ว" with a yellow *countdown chip* only inside the check-in window. Always label.
- Radii 10–20 px, soft shadows, pastel gradients on auth/hero only — keep; they're the product's personality. Dark mode: not in MVP.

**Typography (Thai)**: **Noto Sans Thai** (Google Fonts / `@fontsource-variable/noto-sans-thai`, self-host — internal network) for everything; Latin falls back to Noto Sans / system UI. Rationale: looped (มีหัว) letterforms are the most legible for older readers, full weight range, free, pairs with Noto Sans for English terms. IBM Plex Sans Thai is a fine loopless modern alternative if the brand wants a techier look (slightly lower legibility at small sizes); Sarabun if they want the "official Thai document" feel. Avoid Kanit/Prompt for body. Weights: 400 body, 600 emphasis, 700 headings (v1's 900 everywhere is heavy in Thai). Scale: 12 / 14 / 16 / 18 / 22 / 28 / 36 px, line-height 1.6 body / 1.3 headings.

**Component list → shadcn/ui (Radix) mapping** (the stack agent may swap the kit; the list is the contract):
Button (primary/secondary/outline/danger/ghost; sm/md/lg) · Badge/StatusBadge (status enum → label + icon + tokens; one component, no ad-hoc colors) · Chip/ToggleGroup (feature filters, weekdays) · Input / Textarea / Select / Checkbox / Switch · DatePicker (native `<input type=date>` first; shadcn Calendar+Popover only if the native one fails the 30-day/closed-day constraints on desktop) · TimeRangePicker (custom: 30-min slot grid + 2 selects, shared by E3/E7/A3 dialog) · Combobox/TagInput (attendees, user picker) · Card / KPI stat · DataTable (TanStack Table; admin lists, pagination, sort) · Tabs · Dialog / AlertDialog (cancel, reject reason, deactivate, close room) · Sheet/Drawer (user & room edit) · Toast (sonner) · Skeleton · EmptyState · Alert (inline conflict/error) · Tooltip · DropdownMenu (row actions) · Avatar · Sidebar/BottomTabs · Pagination · Countdown · Calendar grid (custom CSS grid: 3 rooms × 18 half-hour rows/day, week = 5–7 columns; D&D via dnd-kit; **warning: FullCalendar resource views (resource-timegrid) are a paid Scheduler license** — not needed for 3 rooms) · Chart (Recharts bar) + Heatmap (CSS grid with numbers) · QR (qrcode.react) · PrintSheet (K1 QR poster, K3 run-sheet).

---

## 6. New mockup panels (delivered)

- `work/research/mockup-admin-users.html` — **Admin · Users**: filter chips + search, users table (ผู้ใช้ / ทีม / บทบาท / สถานะ / จัดการ) with states *ใช้งานอยู่ · รอตั้งรหัสผ่าน · ปิดใช้งาน*, self-row guard ("ปิดบัญชีตัวเองไม่ได้"), pagination; right-hand edit drawer (name, code, mobile, email, team, role select with role descriptions, active switch, password-by-link note + reset link, audit line, save/cancel) and a red "ปิดใช้งานบัญชี" zone spelling out consequences (future bookings auto-cancelled, audit kept, reversible).
- `work/research/mockup-admin-rooms.html` — **Admin · Rooms**: three room cards with status badge (เปิดให้จอง / ปิดปรับปรุง), approval-mode pill in the meta row, actions (แก้ไข / ดูปฏิทิน / QR หน้าห้อง); below, left preview (photo + upload, facts, "changes affect new requests only" note) and the edit form (name, description, capacity, floor, feature chips + add, approval mode select with one-line explanations, business hours selects + weekday chips + system-default hint, active toggle with maintenance note, internal note, danger "ปิดห้องชั่วคราว…", cancel/save).
- Both use only classes in `v1-classes.txt` (verified by script) + inline margins like v1; each file's header comment lists the 3 integration steps (tab button, nav links, paste into `.stage`). Tab names: `adminUsers`, `adminRooms`. Existing admin panels' dead "▣ จัดการห้อง" links should point to `showScreen('adminRooms')`, and "👥 ผู้ใช้งาน" should be added to their nav.
- Not mocked (recommend adding in v2 if budget allows, in priority order): E9 Calendar/ตารางเวลา (Must FR-001, currently no screen), A3 admin calendar with D&D, E5 booking detail, A10 Settings/holidays, K3 facility run-sheet. A text spec for each is in §1.

## Decisions the doc writers should take to the tech lead
1. Thai-first strings + พ.ศ. via `Intl th-TH` (or ค.ศ. — but one, pinned in `formatDate`).
2. Darken the three semantic ink tokens + muted + border/focus (tokens above) — keeps the v1 look, passes AA.
3. 30-min slot grid with bound start/end selects; pending requests in manual rooms are visible and selectable.
4. Reject → reason dialog; approve in conflict group → auto-reject losers with canned reason.
5. Delete Register; add Set-password/invite; users managed by Admin (mockup provided).
6. Add the missing Must screen: Calendar (E9), plus booking detail (E5) and cancel dialog (E8).
7. Defer: in-app notifications, EN toggle, Webboard (ask), PDF export, favourites/share.
