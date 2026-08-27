# Change brief — CB-01…CB-03 (client decisions, 2026-08-24)

Binding for every agent touching the spec, the mockups, or the code. Where this brief and any
existing section disagree, THIS wins. Apply the change everywhere; do not leave half-removed
concepts behind.

---

## CB-01 · First-come-first-served. There is no approval step.

**Decision (client):** a booking is confirmed the moment it commits. No admin approves anything.

### Remove entirely

| Thing | Where |
|---|---|
| `PENDING_APPROVAL` status | status enum, state machine, every table/flow/diagram |
| `EXPIRED` status | it only existed for "pending past start time" — with no pendings it has no producer |
| `REJECTED` status | nothing rejects a booking any more (admin *cancels*, see below) |
| `rooms.approval_mode` (`AUTO` / `MANUAL`) | DDL, seed, admin room form, API, all prose |
| EXCLUDE constraint **B** (pending vs confirmed) | only constraint **A** survives — and it is now the entire concurrency story |
| `GET /admin/approvals`, `POST /admin/bookings/:id/approve`, `POST /admin/bookings/:id/reject` | API, folder structure, tickets, tests |
| `CONFLICT_LOST` reason code, loser auto-rejection sweep | data model transactions, flows |
| Approval Center screen (`A2`) + "คำขอรออนุมัติ" KPI | admin app, mockups, screen inventory, nav |
| `booking.requested` / `booking.rejected` email templates | notification matrix, outbox, email module |
| conflict-group concepts, `conflicts_with[]`, approval SLA | everywhere |
| `approval-conflict` diagram | delete; remove references |

### Consequences to state positively

- `POST /bookings` outcome is binary: **`201 CONFIRMED`** or **`409 SLOT_UNAVAILABLE`** (with alternatives). There is no third path.
- The booking lifecycle becomes: `CONFIRMED → CHECKED_IN → COMPLETED`, with `CANCELLED` and `AUTO_RELEASED` as the exits. Five states, down from eight.
- Constraint **A** (`EXCLUDE USING gist (room_id WITH =, slot WITH &&) WHERE status IN ('CONFIRMED','CHECKED_IN')`) is now the single guarantee. The concurrency gate test is unchanged and matters more: 100 parallel requests → exactly one `201`.
- The per-room advisory lock stays (it serialises writers per room and keeps error messages deterministic), but the lock *order* section simplifies: no approval transaction to interleave.
- Admin keeps exactly one intervention: **cancel any booking, reason required**, audit-logged, owner notified (`booking.cancelled`). That is the whole of admin's power over other people's bookings.
- `decided_by` / `decided_at` / `reason_code` columns: keep only what cancellation needs (`cancelled_by`, `cancelled_at`, `cancel_reason`). Drop approval-specific columns.

### Requirement traceability — be honest, do not fake coverage

The official requirement PDF marks **FR-005** (per-resource Auto/Manual approve mode) and
**FR-006** (Admin approve/reject with reason) as **Must**, and **US-004** is an admin-approval
story. This change means we do **not** implement them as written. Record it as a deviation, not
as satisfied:

- **FR-005 — ไม่ทำตามที่ระบุ (client decision).** ทุกห้องเป็น first-come-first-served; ไม่มีโหมด Manual approve.
- **FR-006 — แทนที่ด้วยสิทธิ์ยกเลิกของ admin.** Admin ยกเลิกการจองใดก็ได้พร้อมเหตุผลบังคับ + audit + แจ้งผู้จอง แทนการอนุมัติ/ปฏิเสธล่วงหน้า.
- **US-004 — ไม่ใช้แล้ว.**

Put these three rows in the RTM with status "เปลี่ยนตามมติลูกค้า (CB-01)" and add one line to the
appendix's business-confirmation list so the deviation is visible to whoever signs off. Do **not**
quietly renumber or delete FR-005/FR-006.

---

## CB-02 · QR on the door is the check-in mechanism, and it is in MVP

**Decision (client):** a printed QR code is fixed to each meeting-room door. The user scans it
with their phone to activate their booking session. In the real installation this releases the
door lock; **we build only the app side** — the spec must say that explicitly and scope the
hardware out.

### Behaviour

1. The QR is **static per room** and encodes `https://<host>/check-in/<roomCode>`. Three printed
   signs, regenerated only if a room is renamed.
2. Scanning opens the phone browser. If not signed in → sign in, then return to the same URL.
3. The server resolves the booking itself from **who scanned** and **which room**: a `CONFIRMED`
   booking in that room where the scanner is owner or attendee and `now` is inside
   `[start−checkin_open_before, LEAST(end_at, start+checkin_grace))`.
4. **Has access → success modal.** Booking becomes `CHECKED_IN`, `checkin_method='QR'`. Modal
   shows room, title, time, and states that the door is being released. Copy must not promise
   hardware we do not ship: the modal says the booking is activated; a footnote in the spec says
   the door-controller integration is out of scope for this system.
5. **No access → failure modal**, with the reason and what to do next:
   - no booking for this person in this room right now → `NO_BOOKING_IN_WINDOW`
   - booking exists but it is too early / too late → `CHECKIN_WINDOW_CLOSED` (show `opens_at`)
   - unknown room code → `404`
   - already checked in → treat as success (idempotent), modal says already activated
6. Auto-release is unchanged: no check-in by `start + grace` → `AUTO_RELEASED`.

### Everything else about check-in stays

The self check-in button (My Bookings / booking detail / reminder-email link) and admin check-in
remain — QR is now simply the third and *primary* entry point, and it moves from Phase 1.1 into
**MVP**. `checkin_method` keeps `SELF | QR | ADMIN`.

### Security note to update

The QR is now MVP, so S-13's threat model becomes a shipped control, not a deferred one: static
QR + login + owner/attendee check + time window + room match. Residual risk (someone photographs
the sign and activates from their desk) is accepted and logged with IP — it only ever lets a
person activate *their own* booking. Keep that reasoning; drop the "(1.1)" markers.

### Mockups — this is a required update

In `docs/spec/build/assets/mockups.html`:
- Rework the existing `checkin` panel into the **phone** experience: a narrow phone-frame screen
  showing the scan landing with the room name, the booking, and a primary "เปิดใช้งานการจอง" action.
- Add the **success modal** state (green: เช็กอินสำเร็จ · กำลังปลดล็อกประตู, with room/time/title).
- Add the **failure modal** state (red: เช็กอินไม่สำเร็จ, with the reason line and a "ดูการจองของฉัน" link).
- Show the printed door sign itself (the QR artwork already in the panel) as a small inset so the
  reader understands where the code lives.
- **Delete the `approval` (Approval Center) tab and panel** — CB-01 removed that screen. Renumber
  nothing else; keep every other panel byte-identical. Do not regenerate this file from scratch —
  it carries four deliberate fixes documented in `PENDING-FIXES.md` PF-03.

---

## CB-03 · A rescheduled booking never gives up its slot on failure

**Decision (client):** editing a booking to a time that is already taken must fail, and the
booking keeps its previous, still-valid time.

This is already the intended behaviour; make it **explicit and testable** rather than implied:

- `PATCH /bookings/:id` changing `start_at`/`end_at`/`room_id` is a single transaction guarded by
  constraint A. On violation it returns `409 SLOT_UNAVAILABLE` and the row is **unchanged** —
  the original slot is never released "optimistically" and then re-acquired.
- The UI must state this: on `409` the form shows the conflict, offers alternatives, and the
  booking visibly stays at its old time. No silent revert, no lost booking.
- Add a test: `TC-BK-0xx` — booking at 13:00–14:00, attempt to move it onto another booking's
  14:00–15:00 → `409`, and re-reading the booking still shows 13:00–14:00 with the same `version`.
- Say plainly in the flows section that there is no intermediate state where the booking holds
  neither slot.

---

## CB-04 · Weekend (answer, no change needed)

Weekends are already excluded structurally: `business_hours` has 7 rows keyed by ISO weekday with
Saturday and Sunday closed, and every availability/calendar query joins
`extract(isodow FROM day)` against `is_open`. Admin-managed `holidays` sit on top. No slot can be
generated or booked outside an open weekday. Keep as is; make sure the requirements section says
this in one visible line rather than only in SQL.
