# UI/UX handoff brief

For anyone (human or AI) restyling the ReserveFlow front ends. Read this before editing
`apps/web` or `apps/admin`.

The visual layer is deliberately plain and *should* be improved. What follows is the short
list of things that look like styling but are actually correctness, plus the stack rules
that keep the app deployable.

---

## Ground rules

1. **Work on a branch.** Keep the repository CI checks green (API tests plus both app
   typecheck/lint/build checks) so a regression is one `git diff` away from being understood.
2. **Restyle, don't rearchitect.** Change tokens, spacing, typography, layout, motion,
   component markup. Do not rewrite data fetching, mutations, guards, or validation.
3. **Every screen already carries its real Thai copy.** It came from the approved mockups.
   Reword only deliberately — do not let a model paraphrase Thai UI text into something new,
   and never machine-translate it back through English.
4. **Re-run the verification checklist at the bottom** before calling it done.

---

## Files that carry correctness — change with care, keep the behaviour

| File | What must survive |
|---|---|
| `apps/web/src/routes/booking-new.tsx` | One `Idempotency-Key` per submit press, reused on retry, cleared on any 4xx. This is what stops a double-click becoming two bookings. |
| `apps/web/src/components/conflict-alert.tsx` + booking form | On `409 SLOT_UNAVAILABLE` the form keeps every field and offers the server's alternatives. Losing form state here is the difference between "pick another room" and "type it all again". |
| `apps/web/src/components/reschedule-panel.tsx` | A failed reschedule leaves the booking on its **old** slot (CB-03). Never release-then-reacquire. |
| `apps/web/src/routes/check-in.tsx` | Check-in fires **only** on a deliberate press. It must never run on mount — a preview fetch or refresh would consume someone's check-in. |
| `apps/web/src/routes/login.tsx` | `safeInternalPath` (open-redirect guard) and `leavesThisApp` (the admin app is a separate bundle and needs a real document navigation). Both are unit-tested in `login.test.ts` — keep the tests passing. |
| `apps/admin/src/routes/authed.tsx` | The role guard. A non-admin must be refused **before** any admin data is requested. |
| `apps/admin/src/components/confirm-dialog.tsx` | Focus trapped and restored, Esc/backdrop rules, and consequence text for guarded destructive flows. Room-photo deletion is a current exception and mutates immediately. |
| `apps/admin/src/components/csv-import-dialog.tsx` | First action is a **dry run**; only a separate explicit action commits. This polarity was inverted once already. |
| `apps/admin/src/components/deactivate-dialog.tsx` | States the real cascade with a real count: future bookings cancelled, sessions ended. |
| `apps/admin/src/routes/users.tsx` | Last-admin protection is explained **before** the click (button replaced by the reason), never surfaced as an error after. |
| `apps/*/src/lib/datetime.ts`, `lib/slots.ts` | API speaks UTC ISO; UI displays Asia/Bangkok. Do not add a second conversion, and do not "simplify" to the browser's local zone. |
| `packages/ui/src/slot-grid.tsx` | The calendar's keyboard contract (roving tabindex, arrows/Home/End, Enter/Space, Esc) and its own `overflow-x` container. Restyle freely; keep the interaction model. |

**Rule of thumb:** files under `api/`, `lib/`, and anything named `*-dialog`, `authed`, or
`login` encode decisions. Files under `components/` and `routes/` are mostly presentation —
but read the surrounding comments first; the non-obvious constraints are commented.

---

## Stack rules (breaking these breaks the build or the deploy)

- **Tailwind v4**, configured via `@theme` in CSS — there is no `tailwind.config.js`. Most
  AI tools emit v3 config and v3-only utilities; those will silently not apply.
- **No new UI libraries.** shadcn/ui, Radix, TanStack Table and sonner are *not* installed
  and should not be added. The apps hand-roll Tailwind on native elements: `<dialog>` for
  modals, `role="switch"` buttons, plain `<table>`, `role="status"` for async announcements.
- **Fonts are self-hosted** (`@fontsource-variable/noto-sans-thai`). Do not swap to a Google
  Fonts `<link>`. Thai text in a fallback font is an NFR failure, and the external request
  is exactly what self-hosting avoids.
- **Design tokens live in `packages/ui/src/tokens.css`** and are shared by both apps. Change
  them there, not per-app, or the two apps drift apart.
- **Both apps ship from one origin in production** (`/` and `/admin/`). Nothing may assume
  its own hostname.
- Accessibility is a requirement, not a nice-to-have: labelled controls, visible focus,
  keyboard-operable tables and dialogs, `aria-live` on async results.

---

## The gap you should know about

There is **no automated end-to-end coverage of the UI flows**. The API has an integration suite
and the front ends have unit tests for pure logic, but "click through booking → conflict → check-in"
is verified by a browser pass, not by CI. That is precisely why a UI rewrite can regress
behaviour silently, and why the checklist below is not optional.

`docs/testing/e2e-plan.md` describes the intended browser coverage if you want to automate it.

## Employee search-room dashboard contract

- A successful employee login lands on `/rooms`; authenticated `/` is a compatibility redirect
  to the same page. Preserve deep-link redirects such as booking details and QR check-in.
- Desktop navigation starts with the primary `ค้นหาห้อง` action, followed by
  `การจองของฉัน`, `ตารางเวลาห้องทั้งหมด`, and `โปรไฟล์`. There is no separate Home item.
  Mobile exposes the same four destinations in that order.
- The demo dataset has exactly three active rooms — Horizon, Summit, and Grove — each with
  capacity 20, one microphone, and one projector. The default dashboard presents those three
  room cards in one row on desktop and one column on mobile.
- Search filters start collapsed behind a compact `ค้นหาห้องว่าง` control. Expanding it reveals
  date, linked start/end times, headcount, and equipment without changing the `/rooms` route;
  submitted values remain in the URL so reload and back/forward navigation are deterministic.
- Calendar booking blocks show `ผู้จอง: <display name>`. Private meeting titles and all other
  details remain masked; `/calendar` exposes only the calendar-specific `owner_display_name` string
  to EMPLOYEE/ADMIN. An unrelated FACILITY viewer still receives no private owner name.
- Fully elapsed slots use the stronger neutral `n1` surface and the `เวลาผ่านแล้ว` legend.
  Lead-time/max-advance restrictions remain the quieter disabled state, and closed hours keep
  their own `n0` state.
- My Bookings uses an explicit employee filter set: `จองแล้ว`, checked in, completed, and
  cancelled. The employee surface describes `CONFIRMED` as `จองแล้ว`; admin and domain copy may
  retain `ยืนยันแล้ว`. `AUTO_RELEASED` remains a real no-show state for scheduling, audit, and
  reporting, but it is not a quick-filter chip; employee-facing records describe the outcome as
  `ไม่ได้เช็กอิน`.
- Check-in eligibility comes from `can.check_in` and confirmed booking details refresh every
  30 seconds so a page left open crosses the window without a reload. The page explains that the
  action appears 15 minutes before start and that the room QR is the primary route.
- In local development only, `DEMO_TOOLS_ENABLED=true` on a loopback database exposes
  `เดโม: ทดลองเช็กอิน` for an owned future booking. It prepares the booking server-side and
  opens the real `/check-in/<roomCode>` landing; the landing must still require a deliberate
  button press.

---

## Verification checklist after any UI work

Run these — all must pass:

```bash
command pnpm --filter @reserveflow/web typecheck && command pnpm --filter @reserveflow/web lint && command pnpm --filter @reserveflow/web test && command pnpm --filter @reserveflow/web build
```

```bash
command pnpm --filter @reserveflow/admin typecheck && command pnpm --filter @reserveflow/admin lint && command pnpm --filter @reserveflow/admin test && command pnpm --filter @reserveflow/admin build
```

Run the mutating checklist below **only against a disposable local/demo/test database**—never the
canonical launch target. Then click through using employee ID `AU-001` (admin) or `AU-002`
(employee) and the credentials
provided for the currently initialized database (`INITIALIZE_ADMIN_PASSWORD` and
`INITIALIZE_EMPLOYEE_PASSWORD`). Do not hard-code a shared demo password in source or
documentation. Email and mobile are retained as account/profile data, but neither is accepted as
a sign-in ID.

1. Sign in, land on `/rooms`; sign in with `?redirect=/admin/` lands on the **admin**
   app, not the employee 404.
2. Employee opening `/admin/` gets a clean refusal, not a broken shell.
3. Calendar: weekends closed; employee calendar marks elapsed empty slots gray; booked blocks show
   the booker and private titles stay masked. Past styling on booked cells, room detail and admin
   calendar is a known consistency gap; keyboard navigation must still work.
4. Create a booking; double-click submit produces **one** booking.
5. Force a conflict: the form keeps its content and offers alternatives.
6. Reschedule onto a taken slot: the booking stays on its original time.
7. `/check-in/<roomCode>`: nothing fires until the button is pressed; success and failure
   result panels both render in the same page.
   With local demo tools enabled, use `เดโม: ทดลองเช็กอิน` from My Bookings to prepare this
   scenario without waiting for wall-clock time.
8. Admin cancel: empty reason refused; the dialog says the owner will be notified.
9. CSV import: first action previews and changes nothing.
10. At 390px width, no screen scrolls sideways.
