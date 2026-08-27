# ReserveFlow v2 — REST API design (one backend, two web apps)

Baseline: v1 "REST API draft" (v1-sections/data.html, 12 rows). v2 keeps every v1 path that survives, adds the missing areas (admin users, settings, notifications, audit, health, webhooks, check-in for admin/kiosk), and pins conventions so both `apps/web` and `apps/admin` talk to the same `apps/api` with one typed client.

Table names follow v1 (`users, departments, rooms, features, room_features, bookings, booking_attendees, approval_actions, checkins, notifications, business_hours, audit_logs`). Deltas from v1 are listed once in §0 and never silently.

---

## 0. Deltas vs v1 data model (state once, then consistent everywhere)

| Change | Why |
|---|---|
| **Drop `DRAFT` status.** Lifecycle = `PENDING_APPROVAL → CONFIRMED → CHECKED_IN → COMPLETED` + terminals `REJECTED, CANCELLED, AUTO_RELEASED, EXPIRED`. | Drafts live in the browser form; no server row needed (YAGNI). |
| `business_hours.timezone` dropped; `business_hours.room_id uuid NULL` added (NULL = company default, non-NULL = per-room override). `rooms.business_hours_id` dropped. | One timezone (Asia/Bangkok) is a constant. Per-room override is one nullable FK instead of a join table. |
| New table `holidays(date PK, name)`. | Q-10: booking-day policy; utilization denominator. |
| New table `settings(id=1, data jsonb, updated_at, updated_by)`; zod-validated. | Policies are one JSON doc, not 15 columns. |
| New tables `sessions(id, token_hash, user_id, expires_at, remember, ip, user_agent, created_at)`, `password_tokens(token_hash PK, user_id, purpose INVITE/RESET, expires_at, used_at)`, `idempotency_keys(user_id, key, request_hash, status, body jsonb, created_at, PK(user_id,key))`. | Cookie sessions, invite/reset links, Idempotency-Key replay. |
| `checkins.token_hash` dropped (QR tokens are stateless HMAC; see §2.6). `checkins.method` (`QR`/`ADMIN`) added. | No token table to clean up. |
| `rooms` + `photo_url`, `checkin_secret bytea`, `description`, `location` (e.g. "Executive Boardroom · 4th Floor"). | Mockups show photo + location; secret enables per-room QR rotation. |
| `bookings` + `headcount int`, `cancel_reason`, `cancelled_by`, `approved_at`, `approved_by`, `reason_code` (REJECTED/CANCELLED/AUTO_RELEASED: why). `version int NOT NULL DEFAULT 1` kept. | Capacity validation, reports, audit. |
| `booking_attendees` + `user_id uuid NULL` (resolved by email at write time), `last_sent_at`. `response_status` stays but is always `NONE` in MVP (no RSVP parsing). | Lets internal attendees see private details + "attending" scope. |
| `approval_actions` + `auto boolean` (true when system auto-rejected a conflict loser). | Distinguish admin decisions from loser sweep. |
| `notifications` becomes a single multi-channel table: `channel IN_APP/EMAIL`, `user_id NULL` (in-app target), `recipient_email NULL`, `type`, `booking_id NULL`, `payload jsonb`, `read_at`, `provider_message_id`, `status QUEUED/SENT/DELIVERED/BOUNCED/COMPLAINED/DEFERRED/FAILED`, `attempts`, `last_event_at`. | One table serves the bell icon **and** the email outbox/webhook tracking; no rename. |
| `users` + `password_hash` (argon2id), `status ACTIVE/DISABLED/INVITED`, `must_change_password`, `last_login_at`. Roles: `EMPLOYEE / ADMIN / FACILITY`. | Admin-provisioned accounts. |

JSON field names on the wire = column names (**snake_case**). One naming scheme DB → API → zod → UI; no mapping layer.

---

## 1. Conventions

### 1.1 Base, format, IDs
- Base path `/api/v1`. `Content-Type: application/json; charset=utf-8` both ways, except photo/CSV upload (`multipart/form-data`) and CSV export (`text/csv`).
- IDs are UUIDs (DB default `gen_random_uuid()`). Enums are UPPER_SNAKE strings.
- Success: single resource → the object; lists → `{ "data": [...], "page": {...} }` (or `{ "data": [...] }` for unpaginated lists).
- Header `X-Request-Id` accepted/echoed; generated if absent. Appears in every error body and audit row.
- `Accept-Language` is ignored: `message` is English developer text; the **UI localizes by `code`** (Thai-first strings live in `packages/shared/i18n`). Emails are rendered server-side in Thai.

### 1.2 Auth: httpOnly session cookie (decided) — not bearer
- Deploy both apps and the API **on one origin** behind the reverse proxy: `/` → employee app, `/admin/` → admin app, `/api/` → API, `/uploads/` → static. Dev: Vite proxy `/api` → `localhost:3000` so the origin stays the same.
- Cookie `__Host-rf_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`. Value = 32 random bytes (base64url); DB stores sha256. TTL 12 h sliding, or 30 days if `remember_me`.
- **CSRF**: SameSite=Lax blocks cross-site POST/PATCH/DELETE; additionally the API rejects any non-GET/HEAD/OPTIONS request whose `Origin` (fallback `Sec-Fetch-Site`) is not the app origin → `403 CSRF_REJECTED`. No CSRF token, no double-submit cookie. Webhooks (§5) carry no cookie and are exempt (signature-verified instead).
- Why not bearer/JWT: two first-party browser apps, one origin, ~80 users. Bearer forces token storage reachable by JS (XSS), refresh-token plumbing, and manual logout revocation. Cookie sessions give server-side revocation (deactivate user ⇒ delete sessions) for free and SSO later (OIDC) still ends in the same cookie. No third-party API consumers exist.
- CORS: none configured (same origin). If someone insists on `admin.` subdomain later: `Domain=` cookie + CORS `credentials: true` — discouraged.

### 1.3 Timezone
- All timestamps ISO-8601 **with offset**. Requests may send `Z` or any offset; responses always `+07:00` (server formats in `Asia/Bangkok`).
- Date-only params (`date`, `from`, `to` in calendar/reports) are `YYYY-MM-DD` **Bangkok calendar days** (`from` inclusive 00:00, `to` inclusive 24:00).
- Business hours/holidays compare wall-clock in Asia/Bangkok. "now" is the server clock; client clock is never trusted. DB columns are `timestamptz`.

### 1.4 Pagination, sorting, filtering
- `?page=1&page_size=20` (max 100). Response `page: { page, page_size, total }`. Offset pagination on purpose (tiny data; admin tables need totals; cursor is YAGNI).
- `?sort=-created_at,title` (leading `-` = desc); each endpoint whitelists sortable fields.
- Filters are explicit named query params per endpoint (no generic filter DSL). Multi-value = comma list (`features=projector,video_call`).
- Unpaginated (bounded) lists: rooms, features, departments, calendar (≤ 31 days), settings.

### 1.5 Error envelope
```json
{ "code": "SLOT_UNAVAILABLE", "message": "Room is already booked in that window", "details": { "...": "..." }, "request_id": "01J..." }
```
`code` is stable and typed (`ErrorCode` enum in `packages/shared`). `details` is code-specific (documented per code). Validation errors use `details.issues: [{ path: ["start_at"], message }]` (zod issues passthrough).

### 1.6 Error catalogue
| HTTP | code | When / details |
|---|---|---|
| 400 | `BAD_REQUEST` | malformed JSON / unknown query param type |
| 400 | `VALIDATION_ERROR` | zod shape failure; `details.issues[]` |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | POST /bookings without header |
| 401 | `UNAUTHENTICATED` | no/expired session |
| 401 | `INVALID_CREDENTIALS` | login; never says which field |
| 403 | `FORBIDDEN` | role/ownership check failed |
| 403 | `FORBIDDEN_PRIVATE` | sub-resource of a PRIVATE booking you cannot see (attendees, history, resend) |
| 403 | `ACCOUNT_DISABLED` | user.status=DISABLED (login or any call; session is also deleted) |
| 403 | `PASSWORD_CHANGE_REQUIRED` | `must_change_password` and path ≠ /auth/change-password, /auth/me, /auth/logout |
| 403 | `CSRF_REJECTED` | Origin mismatch |
| 403 | `FEATURE_DISABLED` | check-in endpoints when `settings.checkin.enabled=false` |
| 404 | `NOT_FOUND` | resource missing (or inactive room for employees). Booking ids are already visible via the calendar, so `GET /bookings/:id` returns the masked view (§1.11) rather than 404/403 |
| 409 | `SLOT_UNAVAILABLE` | overlap with CONFIRMED/CHECKED_IN (pre-check or DB exclusion `23P01`); `details: { room_id, start_at, end_at, alternatives: [{room_id, name}] }` |
| 409 | `VERSION_CONFLICT` | PATCH `version` ≠ row version; `details: { current_version }` |
| 409 | `INVALID_STATUS_TRANSITION` | e.g. approve a CONFIRMED, reschedule a CANCELLED; `details: { status, action }` |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | same key, first request still running |
| 409 | `ALREADY_EXISTS` | duplicate `employee_code` / `email` / department `code` / feature `key`; `details.field` |
| 409 | `USER_HAS_HISTORY` | DELETE user with bookings/actions → use deactivate |
| 409 | `LAST_ADMIN` / `CANNOT_MODIFY_SELF` | role/deactivate guards |
| 409 | `IN_USE` | delete feature/department referenced by rows |
| 410 | `TOKEN_EXPIRED` | invite/reset/QR token expired or used |
| 413 | `PAYLOAD_TOO_LARGE` | photo > 5 MB, CSV > 2 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | photo not jpeg/png/webp |
| 422 | `IDEMPOTENCY_KEY_REUSED` | same key, different request hash |
| 422 | `OUTSIDE_BUSINESS_HOURS` | start/end outside room hours or `details.reason: "HOLIDAY" \| "CLOSED_DAY" \| "HOURS"`; `details: { open, close }` |
| 422 | `MIN_DURATION` / `MAX_DURATION` / `SLOT_INCREMENT` | `details: { min_minutes }` etc. |
| 422 | `MAX_ADVANCE` | start beyond `max_advance_days`; `details: { latest_start_at }` |
| 422 | `IN_PAST` | start_at < now − 5 min grace |
| 422 | `ROOM_INACTIVE` | room.active=false |
| 422 | `CAPACITY_EXCEEDED` | headcount > room.capacity |
| 422 | `PENDING_NOT_ALLOWED` | manual-approval room and start_at < now + `approval.min_lead_time_min` (no admin could review in time) — `details: { earliest_start_at }` |
| 422 | `CHECKIN_WINDOW_CLOSED` | outside `[start − open_before, start + grace]`; `details: { opens_at, closes_at }` |
| 422 | `INVALID_CHECKIN_TOKEN` | bad HMAC / wrong format |
| 422 | `NO_BOOKING_IN_WINDOW` | valid room token but caller has no CONFIRMED booking in that room inside the window |
| 422 | `REASON_REQUIRED` | reject / admin-cancel without reason (kept separate from VALIDATION_ERROR so the UI can focus the field) |
| 423 | `ACCOUNT_LOCKED` | 10 failed logins / 15 min; `Retry-After` |
| 429 | `RATE_LIMITED` | `Retry-After` seconds |
| 500 | `INTERNAL` | includes `request_id` only |
| 503 | `UNAVAILABLE` | readiness probe failing |

Idempotent-by-state rule: repeating the **same** transition (cancel an already-CANCELLED booking as the same actor, approve an already-CONFIRMED one, check-in twice) returns `200` with the current representation, not 409. Only *different/illegal* transitions are `INVALID_STATUS_TRANSITION`.

### 1.7 Idempotency-Key
- Header `Idempotency-Key: <uuid>` — **required** on `POST /bookings`; optional on `PATCH /bookings/:id`, `POST /admin/users/import`. Other mutations are state-idempotent (above).
- Scope: `(user_id, key)`, TTL 24 h. Flow: `INSERT idempotency_keys(status=IN_PROGRESS)`; on unique violation → if stored response exists, replay it (same status + body + header `Idempotent-Replayed: true`); if request hash differs → `422 IDEMPOTENCY_KEY_REUSED`; if still IN_PROGRESS → `409 IDEMPOTENCY_IN_PROGRESS`.
- Both 2xx and 4xx outcomes are stored (so a retried 409 SLOT_UNAVAILABLE stays 409). 5xx is not stored (retry re-executes).

### 1.8 Rate limits (in-process memory store; single API instance. Move to Postgres-backed if >1 instance.)
| Scope | Limit |
|---|---|
| `POST /auth/login` | 5/min per IP+employee_code; account lockout 15 min after 10 failures/15 min |
| `POST /auth/forgot-password` | 3/h per identifier, 10/h per IP |
| `POST /bookings` | 30/min per user |
| `POST /check-in` | 10/min per user |
| `POST /bookings/:id/attendees/resend` | 3/h per booking |
| `GET /rooms/:id/checkin-token` | 4/min per session (display polls every 30 s) |
| everything else | 600/min per session |

### 1.9 Versioning
Path prefix `/api/v1`. Additive changes (new fields, new endpoints, new enum values on **output**) do not bump. Breaking = `/api/v2` side by side. Clients must ignore unknown fields. Realistically v1 forever for an internal tool.

### 1.10 Roles
`EMPLOYEE` (book), `ADMIN` (everything), `FACILITY` (read-only schedule + check-in people at the room + room-display device). A room-display tablet logs in with a FACILITY account (`remember_me`) — no device-token mechanism.

### 1.11 Visibility levels (used by every booking-returning endpoint)
| Level | Who | Fields |
|---|---|---|
| `FULL` | owner, internal attendee (email match), ADMIN | everything incl. description, attendees, special_request, history, `can` |
| `PUBLIC` | any employee, booking `privacy=PUBLIC` | id, room, start/end, status, title, owner `{id, full_name, department}`, headcount, attendee_count |
| `BUSY` | any employee, booking `privacy=PRIVATE` | id, room, start/end, status, `title: "Busy"`, `privacy`, `is_private_masked: true`; owner `null` |
| `FACILITY` | FACILITY role | id, room, start/end, status, headcount, special_request, owner full_name; title masked to "Busy" if PRIVATE |

Masking happens in the serializer, not in SQL → one query, then `serializeBooking(row, viewer)`. Tested by TC-PRV-004 (direct API call).

---

## 2. Endpoints

Role column: `E` employee, `A` admin, `F` facility, `*` any authenticated, `-` none. Status codes listed are the non-generic ones (401/403/429/500 apply everywhere).

### 2.1 Auth
| Method & path | Roles | Request | Response | Codes | Rules / side effects |
|---|---|---|---|---|---|
| `POST /auth/login` | - | `{ identifier: string (employee_code or email), password: string, remember_me?: boolean }` | `{ user, department }` + `Set-Cookie` | 200, 401 INVALID_CREDENTIALS, 403 ACCOUNT_DISABLED, 423 ACCOUNT_LOCKED | argon2id verify; rotate session id; audit `LOGIN` / `LOGIN_FAILED`; `users.last_login_at`. Mobile number is **not** a login factor (Q-09 decided). |
| `POST /auth/logout` | * | – | 204 | | delete session row, clear cookie |
| `GET /auth/me` | * | – | `{ user: {id, employee_code, full_name, email, mobile, role, status, department_id, must_change_password, last_login_at}, department: {id, code, name} }` | 200 | cheap; front-ends call on boot |
| `POST /auth/change-password` | * | `{ current_password, new_password (min 10) }` | 204 | 401 INVALID_CREDENTIALS (wrong current) | clears `must_change_password`; revokes **other** sessions |
| `POST /auth/forgot-password` | - | `{ identifier }` | 202 always | | if user exists & has email: `password_tokens(RESET, 30 min)` + email with `/reset-password?t=`; rate limited |
| `POST /auth/reset-password` | - | `{ token, new_password }` | 204 | 410 TOKEN_EXPIRED | used for both RESET and INVITE tokens; marks used; revokes all sessions; sets status ACTIVE |
| `POST /auth/register` | - | — **not implemented in prod.** | | | Self-registration exists only behind `ALLOW_SELF_REGISTRATION=true` for demo seeds (brief §Auth). Not in the typed client. |

### 2.2 Rooms & features
| Method & path | Roles | Request | Response | Codes | Rules |
|---|---|---|---|---|---|
| `GET /rooms` | * | `?active=true&capacity_min=&features=a,b` | `{ data: Room[] }` — `Room = { id, name, location, floor, description, capacity, approval_mode: AUTO\|MANUAL, active, photo_url, features: [{ key, display_name, icon, quantity }], business_hours: [{ weekday, open, close }] (effective = override or default) }` | 200 | employees get `active=true` forced |
| `GET /rooms/:id` | * | – | `Room` | 404 | |
| `GET /features` | * | – | `{ data: [{ id, key, display_name, icon }] }` | | |
| `GET /departments` | * | – | `{ data: [{ id, code, name, active }] }` | | |
| `POST /admin/rooms` | A | `{ name, location?, floor?, description?, capacity: int ≥1, approval_mode, active?: true, features?: [{ feature_id, quantity }] }` | `Room` 201 | 409 ALREADY_EXISTS(name) | generates `checkin_secret`; audit |
| `PATCH /admin/rooms/:id` | A | any subset of above | `Room` | | changing `approval_mode` affects **new** requests only (FR-005 acceptance) |
| `PUT /admin/rooms/:id/features` | A | `[{ feature_id, quantity }]` | `Room` | | replace set |
| `PUT /admin/rooms/:id/business-hours` | A | `[{ weekday 0–6, open "HH:mm", close "HH:mm" }] \| null` | `Room` | 422 VALIDATION_ERROR (open<close) | null = remove override, use default |
| `POST /admin/rooms/:id/photo` | A | multipart `file` (jpeg/png/webp ≤ 5 MB) | `{ photo_url }` | 413, 415 | stored under `/uploads/rooms/<id>.<ext>` (local disk or S3 per stack decision); resized server-side to ≤1600px |
| `DELETE /admin/rooms/:id/photo` | A | – | 204 | | |
| `POST /admin/rooms/:id/checkin-secret/rotate` | A | – | 204 | | invalidates all outstanding QR tokens for the room |
| `POST /admin/features` / `PATCH /admin/features/:id` / `DELETE /admin/features/:id` | A | `{ key, display_name, icon? }` | | 409 ALREADY_EXISTS / IN_USE | |
| `POST /admin/departments` / `PATCH /admin/departments/:id` | A | `{ code, name, active }` | | 409 ALREADY_EXISTS | no delete — deactivate |

No room DELETE: set `active=false` (history keeps FK). Inactive rooms vanish from employee lists/availability; existing bookings untouched (admin decides to cancel).

### 2.3 Availability & calendar
| Method & path | Roles | Request | Response | Codes | Rules |
|---|---|---|---|---|---|
| `GET /availability` | * | `?start=ISO&end=ISO&headcount=int?&features=a,b?` | `{ start, end, rooms: [{ room: RoomLite, available: bool, approval_mode, reasons: ["BUSY"\|"CLOSED"\|"HOLIDAY"\|"CAPACITY"\|"MISSING_FEATURE"\|"INACTIVE"], pending_overlaps: int, busy_until?: ISO }] }` | 200, 422 (window rules) | Returns **all** active rooms with a verdict so the UI can explain empty states (FR-011 acceptance). Applies the same window validators as POST /bookings (so the UI sees the 422 before the user types a title). `pending_overlaps` only for MANUAL rooms ("2 คำขอรอพิจารณาในช่วงนี้"). |
| `GET /calendar` | * | `?from=YYYY-MM-DD&to=YYYY-MM-DD&room_id=uuid?` (≤ 31 days) | `{ from, to, rooms: RoomLite[], business_hours: {...}, holidays: [date], bookings: BookingView[] }` — statuses included: PENDING_APPROVAL, CONFIRMED, CHECKED_IN, COMPLETED | 200, 400 | One query `WHERE slot && tstzrange(from,to) AND status IN (...)`, index `(room_id, start_at)`; masked per viewer (§1.11). This is the feed for day/week views **and** the room-detail slot list (slots are derived client-side with `computeSlots()` from `packages/shared`, same helper the server uses to validate — no `/slots` endpoint). p95 ≤ 2 s budget is trivially met; cache headers `Cache-Control: private, no-store`. |
| `GET /bookings?scope=mine` | * | see §2.4 | | | "My schedule" = `scope=mine` (owner) ∪ `scope=attending` (attendee email = mine). |

### 2.4 Bookings
`Booking` (FULL view):
```
{ id, room: {id, name, location}, room_id, owner: {id, full_name, employee_code, department: {id, name}}, created_by_id,
  title, description, privacy: "PUBLIC"|"PRIVATE", status, start_at, end_at, headcount, special_request,
  attendees: [{ email, name, user_id, response_status: "NONE", last_sent_at }],
  approval: { mode: "AUTO"|"MANUAL", decided_by: {id, full_name}|null, decided_at, reason, reason_code }|null,
  checkin: { checked_in_at, method: "QR"|"ADMIN", by: {id, full_name} }|null,
  cancel: { cancelled_at, by, reason }|null,
  version, created_at, updated_at,
  can: { edit: bool, reschedule: bool, cancel: bool, checkin: bool } ,   // server-computed for the viewer
  history: [{ at, actor: {id, full_name}|null, action, reason?, auto? }]  // approval_actions + checkins + cancel, newest last
}
```

| Method & path | Roles | Request | Response | Codes | Rules / side effects |
|---|---|---|---|---|---|
| `POST /bookings` | E, A | header `Idempotency-Key`; `{ room_id, start_at, end_at, title (1–120), description? (≤2000), privacy?: "PUBLIC" (default), headcount?: int ≥1, special_request? (≤1000), attendees?: [{ email, name? }] (≤50, unique, lowercased), send_invites?: true, owner_id? (ADMIN only: book on behalf), override_hours?: false (ADMIN only) }` | `Booking` 201 + `Location` | 201, 400 IDEMPOTENCY_KEY_REQUIRED, 409 SLOT_UNAVAILABLE, 422 OUTSIDE_BUSINESS_HOURS / MIN_DURATION / MAX_DURATION / SLOT_INCREMENT / MAX_ADVANCE / IN_PAST / ROOM_INACTIVE / CAPACITY_EXCEEDED / PENDING_NOT_ALLOWED | Validation order: shape → room active → `end>start`, `start ≥ now−5min`, duration ∈ [min,max] & multiple of increment, `start ≤ now+max_advance_days` → hours/holiday (skip if admin `override_hours`) → headcount ≤ capacity → mode: **AUTO** ⇒ insert `CONFIRMED` (DB exclusion constraint is the last word; `23P01` → 409 with `alternatives` = rooms free in same window); **MANUAL** ⇒ lead-time check, pre-check overlap with CONFIRMED/CHECKED_IN (409; pending may never be approvable) ⇒ insert `PENDING_APPROVAL` (overlapping pendings allowed). Same tx: audit `BOOKING_CREATE`. After commit: emails (owner confirmation or "pending" notice; attendees .ics only when CONFIRMED and `send_invites`), in-app notif to admins for pending, pg-boss jobs `reminder` (start − reminder_before) and `auto-release` (start + grace, if checkin enabled & CONFIRMED) with `singletonKey=booking_id`, payload `{booking_id, expected_start_at}`. |
| `GET /bookings` | * | `?scope=mine\|attending\|all&status=a,b&room_id=&from=YYYY-MM-DD&to=&page&page_size&sort=-start_at`; admin-only extras: `owner_id, department_id, q (title/owner name/employee_code)` | `{ data: BookingView[], page }` | 200, 403 (scope=all needs A/F) | default `scope=mine`, default range = today → +30 d when no status filter |
| `GET /bookings/:id` | * | – | `BookingView` per §1.11 (non-viewers get BUSY/PUBLIC view, not 403) | 200, 404 | `can` computed for viewer |
| `PATCH /bookings/:id` | owner, A | `{ version (required), title?, description?, privacy?, headcount?, special_request?, start_at?, end_at?, room_id?, override_hours? (A) }` | `{ booking, reapproval_required: bool }` | 200, 409 VERSION_CONFLICT / SLOT_UNAVAILABLE / INVALID_STATUS_TRANSITION, 422 window codes | Allowed when status ∈ {PENDING_APPROVAL, CONFIRMED}. Owner: only before `start_at`. **Time/room change** = reschedule: full window validation, exclusion constraint (row updates itself so no self-conflict), `version+1`, .ics `SEQUENCE+1` same `UID`; if room is MANUAL and actor is not ADMIN ⇒ status back to `PENDING_APPROVAL` (`reapproval_required: true`; old slot released — UI must warn); if AUTO ⇒ stays CONFIRMED. **Detail-only change** (title/description/privacy/headcount/special_request) never triggers reapproval (Q-13). Admin drag&drop = this endpoint with `start_at/end_at[/room_id]` and keeps CONFIRMED. Jobs re-sent (old job no-ops because `expected_start_at` mismatch). Audit `BOOKING_UPDATE` / `BOOKING_RESCHEDULE` with before/after. |
| `POST /bookings/:id/cancel` | owner, A | `{ reason?: string }` (required for admin, ≥ 3 chars) | `Booking` | 200, 409 INVALID_STATUS_TRANSITION, 422 REASON_REQUIRED | Status ∈ {PENDING_APPROVAL, CONFIRMED}; owner only while `now < end_at`; admin anytime. Slot free the instant the tx commits (FR-008). Emails owner (+attendees `.ics METHOD:CANCEL`), admins if it was pending. Cancels pending jobs (they no-op anyway). |
| `PUT /bookings/:id/attendees` | owner, A | `[{ email, name? }]` (≤50) | `Booking` | 200, 409 INVALID_STATUS_TRANSITION (terminal states) | Replace set; diff ⇒ invite email to added, cancel .ics to removed; no reapproval; `version` not required (not an optimistic-lock field; last write wins on a list). |
| `POST /bookings/:id/attendees/resend` | owner, A | `{ emails?: string[] }` (default all) | 202 `{ queued: int }` | 403 FORBIDDEN_PRIVATE, 429 | Only when CONFIRMED/CHECKED_IN. Rate 3/h per booking. |
| `GET /bookings/:id/ics` | FULL viewers | – | `text/calendar` | | Same payload as the emailed invite (same UID); "Add to calendar" button. |

Admin can also cancel/reschedule others' bookings through the same paths (role check). No separate `/admin/bookings/*` except approval + check-in actions below.

### 2.5 Admin approvals
| Method & path | Roles | Request | Response | Codes | Rules |
|---|---|---|---|---|---|
| `GET /admin/approvals` | A | `?room_id=&from=&to=&page&page_size` (pending only) | `{ data: [{ group_key, room: RoomLite, start_at, end_at, conflict: bool, bookings: [Booking FULL + waiting_minutes, sla_breached] }], page, summary: { pending_total, conflict_groups, oldest_waiting_minutes } }` | 200 | Groups = connected components of overlapping PENDING intervals per room (sort by start, merge). Singletons are groups with `conflict:false`. Sorted oldest first. `sla_breached` = waiting > `approval.sla_minutes` (setting, default 240). |
| `POST /admin/bookings/:id/approve` | A | `{ note?: string, reject_conflicts?: true }` | `{ booking, rejected_conflicts: [{ id, owner: {full_name}, start_at, end_at }] }` | 200, 409 INVALID_STATUS_TRANSITION / SLOT_UNAVAILABLE | Tx: `SELECT … FOR UPDATE`; `UPDATE status=CONFIRMED, approved_at, approved_by`; exclusion violation ⇒ 409 `SLOT_UNAVAILABLE` with `details.conflicting_booking_id` (admin may see it); insert `approval_actions(APPROVE)`; if `reject_conflicts` (default from `settings.approval.auto_reject_losers`): all other PENDING in same room overlapping the winner ⇒ `REJECTED`, `reason_code=CONFLICT_LOST`, `approval_actions(REJECT, auto=true, admin_id=actor)`; audit; commit. After: winner email + .ics + reminder/auto-release jobs; each loser email ("ถูกปฏิเสธ: ช่วงเวลาถูกจัดสรรให้คำขออื่น") + in-app. If approved after `start_at`, auto-release deadline = `approved_at + grace`. |
| `POST /admin/bookings/:id/reject` | A | `{ reason: string (≥3) }` | `Booking` | 200, 409, 422 REASON_REQUIRED | `approval_actions(REJECT)`; email owner with reason (FR-006). |
| `POST /admin/approvals/bulk` | A | `{ actions: [{ booking_id, action: "APPROVE"\|"REJECT", reason? }] }` (≤50) | `{ results: [{ booking_id, ok: bool, status?, code?, message? }] }` 200 | | Sequential, each its own tx (so one conflict does not roll back the rest). Approving two overlapping ids in one batch: second gets `SLOT_UNAVAILABLE` — correct, not a bug. |

### 2.6 Check-in (feature-flagged by `settings.checkin.enabled`; FR-010 Could)
Token design (stateless): `token = base64url( room_id[16B] ‖ window_u32 ‖ HMAC-SHA256(room.checkin_secret, room_id ‖ window)[0..16] )`, `window = floor(now / token_ttl_sec)`. Valid windows: current and previous (so ≤ 2×TTL, default TTL 120 s). QR payload = `https://<host>/check-in?t=<token>`; the employee app route `/check-in` POSTs it (after login redirect if needed). Nothing stored; rotation is time-based; `rooms.checkin_secret` rotation kills all tokens.

| Method & path | Roles | Request | Response | Codes | Rules |
|---|---|---|---|---|---|
| `GET /rooms/:id/checkin-token` | A, F | – | `{ token, expires_at, qr_payload, room: RoomLite, now_showing: BookingView\|null, next: BookingView\|null }` | 200, 403 FEATURE_DISABLED | Room-display page polls every 30 s; `now_showing/next` lets the same page show "Busy until 14:00 — Weekly Sync (or Busy)". |
| `POST /check-in` | E, A | `{ token }` | `{ booking, already_checked_in: bool }` | 200, 410 TOKEN_EXPIRED, 422 INVALID_CHECKIN_TOKEN / NO_BOOKING_IN_WINDOW / CHECKIN_WINDOW_CLOSED, 403 FEATURE_DISABLED | Decode → room; find caller's booking in that room with `status=CONFIRMED` and `now ∈ [start − open_before, start + grace]`; set `CHECKED_IN`, insert `checkins(method=QR, checked_in_by=caller)`; audit. If already CHECKED_IN → 200 `already_checked_in:true`. Internal attendees may also check in on the owner's behalf (`FULL` viewers) — prevents "owner stuck in traffic" auto-release. |
| `POST /admin/bookings/:id/check-in` | A, F | `{ note? }` | `Booking` | 200, 409 INVALID_STATUS_TRANSITION, 422 CHECKIN_WINDOW_CLOSED | "Check-in via admin at the room" (company PDF). Same window rule; `checkins(method=ADMIN)`. Admin may pass `?force=true` to check in outside the window (audit notes it). |
| `POST /admin/bookings/:id/release` | A | `{ reason }` | `Booking` | 200, 409 | Manual no-show release before the job fires (status → `AUTO_RELEASED`, `reason_code=MANUAL_RELEASE`). Optional; one-liner on top of the job code. |

Background (pg-boss, not HTTP): `booking.auto-release` at `start + grace` → if still CONFIRMED and `expected_start_at` matches ⇒ `AUTO_RELEASED` once (TC-QR-006 idempotent under retry), notify owner/admins; `booking.reminder` at `start − reminder_before_min`; `sweep.complete` every 5 min: CHECKED_IN/CONFIRMED past `end_at` ⇒ COMPLETED; `sweep.expire-pending`: PENDING past `start_at` ⇒ EXPIRED (notify owner).

### 2.7 Admin users
`User = { id, employee_code, full_name, email, mobile, department: {id, code, name}, role, status: ACTIVE|DISABLED|INVITED, must_change_password, last_login_at, created_at, bookings_count }`

| Method & path | Roles | Request | Response | Codes | Rules |
|---|---|---|---|---|---|
| `GET /admin/users` | A | `?q=&role=&status=&department_id=&page&page_size&sort=full_name` | `{ data: User[], page }` | | `q` matches employee_code / full_name / email (ILIKE) |
| `GET /admin/users/:id` | A | – | `User` + `recent_bookings: BookingView[5]` | 404 | |
| `POST /admin/users` | A | `{ employee_code, full_name, email, mobile?, department_id, role: EMPLOYEE (default)\|ADMIN\|FACILITY, onboarding: "INVITE_EMAIL" (default)\|"TEMP_PASSWORD" }` | `User` 201 (+ `temp_password` **only** for TEMP_PASSWORD, shown once) | 409 ALREADY_EXISTS (employee_code/email) | INVITE_EMAIL ⇒ status INVITED + `password_tokens(INVITE, 7 d)` + email with set-password link; TEMP_PASSWORD ⇒ ACTIVE + `must_change_password=true`. Audit. |
| `PATCH /admin/users/:id` | A | `{ full_name?, email?, mobile?, department_id?, role? }` | `User` | 409 ALREADY_EXISTS / LAST_ADMIN / CANNOT_MODIFY_SELF (role) | role demotion of the last ADMIN blocked; admins cannot change their own role |
| `POST /admin/users/:id/deactivate` | A | `{ reason?, cancel_future_bookings?: true }` | `User` | 409 CANNOT_MODIFY_SELF / LAST_ADMIN | status DISABLED; **delete all sessions**; cancel future PENDING/CONFIRMED bookings (`reason_code=OWNER_DISABLED`, attendees get cancel .ics) when flag true (default). |
| `POST /admin/users/:id/reactivate` | A | – | `User` | | |
| `POST /admin/users/:id/reset-password` | A | `{ mode: "EMAIL_LINK" (default)\|"TEMP_PASSWORD" }` | `{ temp_password? }` 200 | | EMAIL_LINK ⇒ RESET token 24 h + email; TEMP ⇒ `must_change_password=true`; revokes sessions |
| `POST /admin/users/:id/resend-invite` | A | – | 202 | 409 INVALID_STATUS_TRANSITION (not INVITED) | new INVITE token |
| `DELETE /admin/users/:id` | A | – | 204 | 409 USER_HAS_HISTORY / CANNOT_MODIFY_SELF | **Hard delete only if** the user has 0 bookings, 0 approval_actions, 0 audit rows as actor (i.e. created by mistake). Otherwise 409 with `details.hint: "deactivate"`. Deactivation is the normal "remove". (PDPA: add an `anonymize` action later if HR asks; not in MVP.) |
| `POST /admin/users/import` | A | multipart `file` CSV (`employee_code,full_name,email,mobile,department_code,role`), `?dry_run=true&onboarding=INVITE_EMAIL\|TEMP_PASSWORD`; optional `Idempotency-Key` | `{ summary: { rows, create, update, skip, error }, rows: [{ line, employee_code, action: CREATE\|UPDATE\|SKIP\|ERROR, message?, temp_password? }] }` | 413, 400 VALIDATION_ERROR (bad header) | Upsert by `employee_code`; existing users get name/email/mobile/department/role updated (never status/password). `dry_run` = validate + preview, no writes. ≤ 2 MB, ≤ 1000 rows (we have 80). |

### 2.8 Settings (policies)
`Settings` (zod in `packages/shared`, defaults from the slides):
```json
{
  "booking":  { "min_duration_min": 60, "max_duration_min": 240, "slot_increment_min": 30, "max_advance_days": 30, "max_attendees": 50 },
  "approval": { "auto_reject_losers": true, "min_lead_time_min": 30, "sla_minutes": 240, "expire_pending_after_start": true },
  "checkin":  { "enabled": true, "open_before_min": 15, "grace_min": 15, "token_ttl_sec": 120 },
  "notifications": { "reminder_before_min": 30, "from_name": "ReserveFlow", "reply_to": "facility@uiruai.co.th", "notify_admins_on_pending": true },
  "business_hours_default": [ { "weekday": 1, "open": "08:30", "close": "17:30" }, "… weekday 2–5 …" ]
}
```
| Method & path | Roles | Request | Response | Rules |
|---|---|---|---|---|
| `GET /settings` | * | – | `Settings` + `holidays: [{date, name}]` + `server_time` | Public within the company; front-ends cache 5 min. The same object drives `computeSlots()`/validators in `packages/shared`. |
| `PUT /admin/settings` | A | full `Settings` | `Settings` | Whole-document replace (zod), `version`-less (last write wins; two admins editing settings concurrently is not a real risk). Audit with before/after. Changes apply to **new** validations only. |
| `PUT /admin/holidays` | A | `[{ date, name }]` | same | replace set for the year(s) in payload |

### 2.9 Reports (A only; FR-012 Could + company "dashboard")
| Method & path | Query | Response |
|---|---|---|
| `GET /admin/reports/utilization` | `from, to (≤ 366 d), room_id?, group_by=room\|day\|week\|month\|department` | `{ from, to, formula: "booked_hours / open_hours", rows: [{ key (room or period), room?, open_hours, booked_hours, used_hours, utilization_pct, bookings, completed, cancelled, rejected, no_show (=AUTO_RELEASED), avg_headcount }] }` — `open_hours` = Σ business hours on non-holiday days (room override aware); `booked_hours` = overlap of CONFIRMED/CHECKED_IN/COMPLETED bookings with open hours; `used_hours` = CHECKED_IN/COMPLETED only (= booked when check-in disabled). Denominator rule documented per v1 FR-012 acceptance. |
| `GET /admin/reports/outcomes` | `from, to, room_id?` | `{ totals: { created, confirmed, completed, cancelled_by_owner, cancelled_by_admin, rejected, auto_released, expired }, no_show_rate, avg_approval_minutes, p90_approval_minutes, by_status_per_day: [...] }` |
| `GET /admin/reports/heatmap` | `from, to, room_id?` | `{ cells: [{ weekday 0–6, hour 0–23, booked_hours, bookings }] }` — popular slots |
| `GET /admin/reports/top-rooms` | `from, to` | `{ rows: [{ room, bookings, booked_hours }] }` (company slide: "ห้องที่ถูกใช้งานมากที่สุด") — can be `utilization?group_by=room` sorted; kept as alias only if the dashboard wants it, otherwise drop |
| `GET /admin/reports/export` | `type=bookings\|utilization&from&to&room_id?` | `text/csv; charset=utf-8` with BOM (Excel-Thai friendly), `Content-Disposition: attachment; filename="bookings_2026-08.csv"`. Streams; ≤ 366 days. Bookings export includes owner, department, status, reason_code, checked_in_at — title blanked for PRIVATE unless `include_private_titles=true` (audit `REPORT_EXPORT`). |

Report queries hit `bookings` directly with the `(room_id, start_at)` index; no materialized views at this scale (3 rooms × ~30/day).

### 2.10 Notifications (in-app)
| Method & path | Roles | Request | Response |
|---|---|---|---|
| `GET /notifications` | * | `?unread=true&page&page_size` | `{ data: [{ id, type, booking_id, payload: { title, body, booking_status? }, read_at, created_at }], page, unread_count }` — `channel=IN_APP AND user_id=me` |
| `POST /notifications/read` | * | `{ ids: uuid[] }` \| `{ all: true }` | `{ unread_count }` |
| `GET /admin/notifications/emails` | A | `?booking_id=&status=&page` | email outbox rows (`channel=EMAIL`): recipient, type, status, attempts, provider_message_id, last_event_at — the "delivery dashboard" for NFR Reliability (Q-19 denominator = rows with status ≠ FAILED_PRE_SEND; delivered / (sent − suppressed)). |
| `POST /admin/notifications/emails/:id/retry` | A | – | 202 | re-enqueue a FAILED/BOUNCED email |

Types: `BOOKING_CONFIRMED, BOOKING_PENDING, BOOKING_APPROVED, BOOKING_REJECTED, BOOKING_CANCELLED, BOOKING_RESCHEDULED, BOOKING_REMINDER, BOOKING_AUTO_RELEASED, BOOKING_EXPIRED, APPROVAL_REQUESTED (admins), ATTENDEE_INVITE, ATTENDEE_UPDATE, ATTENDEE_CANCEL, ACCOUNT_INVITE, PASSWORD_RESET`.

No push/WebSocket: the bell polls `GET /notifications?unread=true&page_size=1` every 60 s. (SSE later if anyone complains.)

### 2.11 Audit log
| Method & path | Roles | Request | Response |
|---|---|---|---|
| `GET /admin/audit-logs` | A | `?entity=booking\|user\|room\|settings\|auth&entity_id=&actor_id=&action=&from=&to=&page&page_size` | `{ data: [{ id, at, actor: {id, full_name}\|null, entity, entity_id, action, before, after, ip, request_id }], page }` |

Written inside the same transaction as every mutation (bookings, approvals, check-in, users, rooms, settings, login/login-failed/logout). Append-only (no UPDATE/DELETE grants for the app role). Not exposed to employees except through `Booking.history` (their own).

### 2.12 Health & meta
| Method & path | Roles | Response |
|---|---|---|
| `GET /health` | - | `200 { status: "ok", version, time }` — liveness, no DB |
| `GET /health/ready` | - | `200 { db: "ok", jobs: "ok" }` or `503 UNAVAILABLE` — `SELECT 1` + pg-boss started |
| `GET /api/docs` | dev only | OpenAPI JSON generated from the zod route definitions (Scalar/Swagger UI) — documentation, not codegen (§6) |

### 2.13 Webhooks (inbound)
| Method & path | Auth | Rules |
|---|---|---|
| `POST /webhooks/email/:provider` | provider signature (Resend: Svix `svix-id/svix-timestamp/svix-signature`; Postmark: Basic auth + IP allowlist) | See §5 |

---

## 3. Full examples — the 6 critical calls

### 3.1 `POST /bookings`
Request (AUTO room, private, with attendees):
```http
POST /api/v1/bookings
Idempotency-Key: 5c1d2d1c-9a1f-4d4b-8b7e-3c1b1d3a9f10
Content-Type: application/json

{
  "room_id": "0b2a7d1e-3c4f-4a5b-9c6d-7e8f9a0b1c2d",
  "start_at": "2026-08-26T14:00:00+07:00",
  "end_at":   "2026-08-26T15:00:00+07:00",
  "title": "Product Roadmap Review",
  "description": "Q4 roadmap alignment",
  "privacy": "PRIVATE",
  "headcount": 8,
  "special_request": "ขอโปรเจคเตอร์สำรองและน้ำดื่ม 8 ขวด",
  "attendees": [
    { "email": "teamlead@uiruai.co.th", "name": "Napa" },
    { "email": "designer@uiruai.co.th" }
  ],
  "send_invites": true
}
```
Response `201 Created` (AUTO ⇒ CONFIRMED immediately):
```http
HTTP/1.1 201 Created
Location: /api/v1/bookings/7a6c3b0e-2f11-4e3a-b0a1-9d8c7b6a5f40

{
  "id": "7a6c3b0e-2f11-4e3a-b0a1-9d8c7b6a5f40",
  "room_id": "0b2a7d1e-3c4f-4a5b-9c6d-7e8f9a0b1c2d",
  "room": { "id": "0b2a7d1e-3c4f-4a5b-9c6d-7e8f9a0b1c2d", "name": "Horizon Room", "location": "Executive Boardroom · 4th Floor" },
  "owner_id": "2f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c",
  "owner": { "id": "2f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c", "full_name": "วิโนทัย ทัดทอง", "employee_code": "EMP-0001", "department": { "id": "d1", "name": "Technology" } },
  "created_by_id": "2f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c",
  "title": "Product Roadmap Review",
  "description": "Q4 roadmap alignment",
  "privacy": "PRIVATE",
  "status": "CONFIRMED",
  "start_at": "2026-08-26T14:00:00+07:00",
  "end_at": "2026-08-26T15:00:00+07:00",
  "headcount": 8,
  "special_request": "ขอโปรเจคเตอร์สำรองและน้ำดื่ม 8 ขวด",
  "attendees": [
    { "email": "teamlead@uiruai.co.th", "name": "Napa", "user_id": "a1…", "response_status": "NONE", "last_sent_at": null },
    { "email": "designer@uiruai.co.th", "name": null, "user_id": null, "response_status": "NONE", "last_sent_at": null }
  ],
  "approval": { "mode": "AUTO", "decided_by": null, "decided_at": "2026-08-23T10:12:03+07:00", "reason": null, "reason_code": null },
  "checkin": null,
  "cancel": null,
  "version": 1,
  "created_at": "2026-08-23T10:12:03+07:00",
  "updated_at": "2026-08-23T10:12:03+07:00",
  "can": { "edit": true, "reschedule": true, "cancel": true, "checkin": false },
  "history": [ { "at": "2026-08-23T10:12:03+07:00", "actor": { "id": "2f9e…", "full_name": "วิโนทัย ทัดทอง" }, "action": "CREATED" },
               { "at": "2026-08-23T10:12:03+07:00", "actor": null, "action": "AUTO_APPROVED" } ]
}
```
Same request against a MANUAL room (Summit) ⇒ `201` with:
```json
{ "…": "…", "status": "PENDING_APPROVAL",
  "approval": { "mode": "MANUAL", "decided_by": null, "decided_at": null, "reason": null, "reason_code": null },
  "can": { "edit": true, "reschedule": true, "cancel": true, "checkin": false },
  "history": [ { "at": "…", "actor": { "…": "…" }, "action": "CREATED" } ] }
```
(UI copy for pending: "ส่งคำขอแล้ว รออนุมัติ — ช่วงเวลานี้ยังไม่ถูกจองจนกว่า Admin จะอนุมัติ". Attendee invites are **not** sent until approved.)

Conflict (`23P01` or pre-check):
```http
HTTP/1.1 409 Conflict
{
  "code": "SLOT_UNAVAILABLE",
  "message": "Horizon Room is already booked between 14:00 and 15:00",
  "details": {
    "room_id": "0b2a7d1e-…", "start_at": "2026-08-26T14:00:00+07:00", "end_at": "2026-08-26T15:00:00+07:00",
    "alternatives": [ { "room_id": "9c8b…", "name": "Grove Room", "approval_mode": "AUTO" } ]
  },
  "request_id": "01J5Z3…"
}
```
Replayed retry (same key) ⇒ identical status/body + `Idempotent-Replayed: true`.

### 3.2 `GET /availability`
```http
GET /api/v1/availability?start=2026-08-26T13:00:00%2B07:00&end=2026-08-26T14:00:00%2B07:00&headcount=10&features=projector
```
```json
{
  "start": "2026-08-26T13:00:00+07:00",
  "end": "2026-08-26T14:00:00+07:00",
  "rooms": [
    { "room": { "id": "0b2a…", "name": "Horizon Room", "location": "Executive Boardroom · 4th Floor", "capacity": 20, "photo_url": "/uploads/rooms/0b2a.webp", "features": [ { "key": "projector", "display_name": "Projector", "quantity": 1 }, { "key": "video_call", "display_name": "Video call", "quantity": 1 } ] },
      "available": true, "approval_mode": "AUTO", "reasons": [], "pending_overlaps": 0 },
    { "room": { "id": "5e4d…", "name": "Summit Room", "capacity": 12, "features": [ { "key": "projector", "…": "…" }, { "key": "whiteboard", "…": "…" } ] },
      "available": true, "approval_mode": "MANUAL", "reasons": [], "pending_overlaps": 2 },
    { "room": { "id": "9c8b…", "name": "Grove Room", "capacity": 8, "features": [ { "key": "video_call", "…": "…" } ] },
      "available": false, "approval_mode": "AUTO", "reasons": ["CAPACITY", "MISSING_FEATURE"], "pending_overlaps": 0 }
  ]
}
```
A `BUSY` room additionally has `"busy_until": "2026-08-26T14:00:00+07:00"` (first instant the room is free again, for "ว่างหลัง 14:00"). Window violations return the same 422 codes as POST /bookings (e.g. `OUTSIDE_BUSINESS_HOURS` with `details: { open: "08:30", close: "17:30" }`).

### 3.3 `GET /calendar` (masked)
Viewer = employee Kitti (not owner/attendee of the private booking).
```http
GET /api/v1/calendar?from=2026-08-26&to=2026-08-26&room_id=0b2a7d1e-3c4f-4a5b-9c6d-7e8f9a0b1c2d
```
```json
{
  "from": "2026-08-26", "to": "2026-08-26",
  "rooms": [ { "id": "0b2a…", "name": "Horizon Room", "approval_mode": "AUTO", "capacity": 20 } ],
  "business_hours": { "0b2a…": [ { "weekday": 3, "open": "08:30", "close": "17:30" } ] },
  "holidays": [],
  "bookings": [
    { "id": "7a6c…", "room_id": "0b2a…", "start_at": "2026-08-26T14:00:00+07:00", "end_at": "2026-08-26T15:00:00+07:00",
      "status": "CONFIRMED", "privacy": "PRIVATE", "title": "Busy", "owner": null, "headcount": null, "attendee_count": null,
      "visibility": "BUSY", "is_mine": false },
    { "id": "c3d4…", "room_id": "0b2a…", "start_at": "2026-08-26T09:00:00+07:00", "end_at": "2026-08-26T10:00:00+07:00",
      "status": "CONFIRMED", "privacy": "PUBLIC", "title": "Weekly Product Sync",
      "owner": { "id": "…", "full_name": "วิโนทัย ทัดทอง", "department": { "id": "d1", "name": "Technology" } }, "headcount": 8, "attendee_count": 6,
      "visibility": "PUBLIC", "is_mine": false },
    { "id": "e5f6…", "room_id": "0b2a…", "start_at": "2026-08-26T10:30:00+07:00", "end_at": "2026-08-26T11:30:00+07:00",
      "status": "PENDING_APPROVAL", "privacy": "PUBLIC", "title": "Design Workshop", "owner": { "…": "…" }, "visibility": "PUBLIC", "is_mine": true }
  ]
}
```
Same call as the owner/attendee/ADMIN returns the first entry with `visibility: "FULL"`, real title, owner, `description`, `special_request`, `attendees`, `can`. FACILITY gets `visibility: "FACILITY"`: `title: "Busy"`, `special_request` present, owner `full_name` present, no description/attendees. The front-end `computeSlots(settings, business_hours, bookings, date)` turns this into the 08:30–09:30 … list with FREE/BUSY/PENDING/CLOSED/PAST cells.

### 3.4 `POST /admin/bookings/:id/approve` (with loser handling)
```http
POST /api/v1/admin/bookings/e5f6a7b8-…/approve
{ "note": "Client meeting takes priority", "reject_conflicts": true }
```
```json
{
  "booking": { "id": "e5f6a7b8-…", "status": "CONFIRMED", "room": { "name": "Summit Room" },
               "start_at": "2026-08-27T13:00:00+07:00", "end_at": "2026-08-27T14:00:00+07:00",
               "approval": { "mode": "MANUAL", "decided_by": { "id": "adm1", "full_name": "Room Admin" }, "decided_at": "2026-08-23T10:30:00+07:00", "reason": "Client meeting takes priority", "reason_code": null },
               "version": 2, "…": "…" },
  "rejected_conflicts": [
    { "id": "f7a8b9c0-…", "owner": { "id": "…", "full_name": "กิตติ" }, "start_at": "2026-08-27T13:00:00+07:00", "end_at": "2026-08-27T14:00:00+07:00", "reason_code": "CONFLICT_LOST" }
  ]
}
```
Failure when someone else got CONFIRMED in between (exclusion constraint fires inside the tx):
```json
{ "code": "SLOT_UNAVAILABLE", "message": "Another confirmed booking now overlaps this request", "details": { "conflicting_booking_id": "…", "start_at": "…", "end_at": "…" }, "request_id": "…" }
```
(the request stays PENDING; admin can reject it with a reason.) Approving a non-pending ⇒ `409 INVALID_STATUS_TRANSITION { "status": "CANCELLED", "action": "APPROVE" }`.

### 3.5 `PATCH /bookings/:id` (reschedule)
Owner moves a CONFIRMED booking in a MANUAL room:
```http
PATCH /api/v1/bookings/e5f6a7b8-…
{ "version": 2, "start_at": "2026-08-27T15:00:00+07:00", "end_at": "2026-08-27T16:00:00+07:00" }
```
```json
{ "booking": { "id": "e5f6a7b8-…", "status": "PENDING_APPROVAL", "start_at": "2026-08-27T15:00:00+07:00", "end_at": "2026-08-27T16:00:00+07:00", "version": 3, "approval": { "mode": "MANUAL", "decided_by": null, "decided_at": null, "reason": null, "reason_code": null }, "…": "…" },
  "reapproval_required": true }
```
Admin drag&drop the same booking: identical request ⇒ `status` stays `CONFIRMED`, `reapproval_required: false`, `.ics` with `SEQUENCE:1` sent to attendees (`BOOKING_RESCHEDULED`). Stale version:
```json
{ "code": "VERSION_CONFLICT", "message": "Booking was modified by someone else", "details": { "current_version": 3 }, "request_id": "…" }
```
Detail-only edit (`{ "version": 3, "title": "Design Workshop (v2)", "privacy": "PRIVATE" }`) ⇒ `reapproval_required: false`, no emails except attendee `ATTENDEE_UPDATE` if title changed on a CONFIRMED booking.

### 3.6 `POST /check-in`
```http
POST /api/v1/check-in
{ "token": "CypqPh48SluOvHbw8e9oJQAARvCBx6Xk6sO7nMoNEmlUaqFtSA" }
```
```json
{ "booking": { "id": "7a6c…", "status": "CHECKED_IN", "room": { "name": "Horizon Room" }, "start_at": "2026-08-26T14:00:00+07:00",
               "checkin": { "checked_in_at": "2026-08-26T13:52:10+07:00", "method": "QR", "by": { "id": "2f9e…", "full_name": "วิโนทัย ทัดทอง" } }, "version": 2, "…": "…" },
  "already_checked_in": false }
```
Errors: scanned at 13:40 ⇒ `422 CHECKIN_WINDOW_CLOSED { "opens_at": "2026-08-26T13:45:00+07:00", "closes_at": "2026-08-26T14:15:00+07:00" }`; photo of an old QR ⇒ `410 TOKEN_EXPIRED`; scanned the Grove QR ⇒ `422 NO_BOOKING_IN_WINDOW { "room": "Grove Room" }`.
Display device: `GET /rooms/0b2a…/checkin-token` ⇒ `{ "token": "Cypq…", "expires_at": "2026-08-26T13:54:00+07:00", "qr_payload": "https://rooms.uiruai.co.th/check-in?t=Cypq…", "now_showing": { "…": "BUSY view" }, "next": { "…": "…" } }`.

---

## 4. Authorization matrix

| Endpoint group | EMPLOYEE | FACILITY | ADMIN | Notes |
|---|---|---|---|---|
| `/auth/*` | own | own | own | `change-password` revokes other sessions |
| `GET /rooms*`, `/features`, `/departments`, `/settings` | read (active only) | read | read (all) | |
| `/admin/rooms*`, `/admin/features*`, `/admin/departments*`, `/admin/settings`, `/admin/holidays` | – | – | full | |
| `GET /availability`, `GET /calendar` | yes, masked (PUBLIC/BUSY, FULL for own/attending) | yes, FACILITY view | yes, FULL | masking at serializer; tested by direct API call |
| `POST /bookings` | as self | – | self or `owner_id` (on behalf), `override_hours` | |
| `GET /bookings?scope=` | `mine`, `attending` | `all` (FACILITY view) | `all` + admin filters | |
| `GET /bookings/:id` | view per §1.11 (never 403) | FACILITY view | FULL | sub-resources (`/ics`, `/attendees`, `history`) ⇒ `403 FORBIDDEN_PRIVATE` for PRIVATE non-viewers, `403 FORBIDDEN` for PUBLIC non-owners |
| `PATCH /bookings/:id`, `PUT …/attendees`, `…/resend`, `POST …/cancel` | owner only; before start (cancel: before end); owner reschedule in MANUAL room ⇒ reapproval | – | any booking, any time; `cancel` needs reason; reschedule never reapproves | |
| `/admin/approvals*`, `/admin/bookings/:id/approve|reject|release` | – | – | yes | admin cannot approve own request? **Allowed** (80 people, admin is also an employee) but audit marks `self_approval: true` in `after`. |
| `GET /rooms/:id/checkin-token` | – | yes | yes | room display |
| `POST /check-in` | own/attending CONFIRMED in window | – | same | |
| `POST /admin/bookings/:id/check-in` | – | yes (window) | yes (`force`) | |
| `/admin/users*` | – | – | yes; guards `CANNOT_MODIFY_SELF`, `LAST_ADMIN` | |
| `/admin/reports*` | – | – | yes | private titles blanked in exports unless `include_private_titles` (audited) |
| `/notifications*` | own | own | own; `/admin/notifications/emails` all | |
| `/admin/audit-logs` | – | – | yes | employees see their own `Booking.history` only |
| `/webhooks/*` | signature | | | no session |
| `/health*` | public | | | |

`must_change_password=true` ⇒ everything except `/auth/me|change-password|logout` returns `403 PASSWORD_CHANGE_REQUIRED`.
`status=DISABLED` ⇒ sessions deleted at deactivation; any surviving request ⇒ `403 ACCOUNT_DISABLED`.

---

## 5. Inbound webhook — email delivery events

`POST /api/v1/webhooks/email/:provider` (`resend` or `postmark`; pick one at stack decision, code both adapters only if the provider changes).

- Verify: Resend ⇒ Svix signature over raw body (`svix-id`, `svix-timestamp`, `svix-signature`, tolerance 5 min); Postmark ⇒ HTTP Basic credentials from env + optional IP allowlist. Bad signature ⇒ `401` (no body). Always read the **raw** body before JSON parsing.
- Map: `email.sent→SENT`, `email.delivered→DELIVERED`, `email.delivery_delayed→DEFERRED`, `email.bounced→BOUNCED`, `email.complained→COMPLAINED` (Postmark: `Delivery`, `Bounce`, `SpamComplaint`, `Transient bounce`).
- Update: `UPDATE notifications SET status=?, last_event_at=?, payload = payload || {event} WHERE provider_message_id = ? AND channel='EMAIL'`. Unknown message id ⇒ still `200` (don't make the provider retry forever). Idempotent: later-timestamped events win; duplicates are no-ops (`last_event_at >= event.at` ⇒ skip).
- Side effect: hard bounce on an attendee email ⇒ in-app notification to the owner ("ส่งอีเมลให้ x ไม่สำเร็จ"); hard bounce on a user's own email ⇒ in-app to admins.
- Respond `200 {"ok":true}` within 5 s; no DB-heavy work inline (it is one UPDATE).
- Dev: `pnpm email:simulate-webhook` script posts a signed fake event (no tunnel required for unit tests; use provider test mode + ngrok for one manual check).

---

## 6. Typed client: **zod schemas in `packages/shared` (decided), not OpenAPI codegen**

Decision: the zod schema is the contract; the API validates requests/responses with it, both front-ends import the same schemas for forms (react-hook-form + zodResolver), response typing (`z.infer`), and runtime parsing. OpenAPI is **emitted** from those schemas for `/api/docs` (humans) — never the source of truth, never a codegen step.

Why this beats an OpenAPI-generated client here:
1. One TypeScript monorepo, one team: a generated client adds a build step, a generated `src/gen` folder to ignore/commit, and a second type system (OpenAPI → TS) that drifts from the runtime validators. zod gives compile-time **and** runtime types from one file.
2. The business validators (`computeSlots`, duration/advance/hours rules, `ErrorCode`, `BookingStatus`, `Settings`) must live in shared code anyway so the UI pre-validates exactly like the server; OpenAPI cannot carry that logic.
3. Error codes as a `z.enum` ⇒ exhaustive `switch` in the UI for Thai messages; nothing to regenerate when a code is added.
4. If the API framework is Hono (leaning), `hono/client` (`hc<AppType>`) gives end-to-end typed calls directly from the zod-validated routes with zero codegen; if NestJS, `nestjs-zod` + a 150-line hand-written `packages/api-client` (`api.bookings.create(input)` = `fetch` + `schema.parse`) is all that is needed. Either way the schemas package is identical.

Layout:
```
packages/shared/src/
  schemas/        auth.ts rooms.ts bookings.ts approvals.ts checkin.ts users.ts settings.ts reports.ts notifications.ts common.ts (Page, ErrorBody, ISODateTime)
  enums.ts        BookingStatus, Privacy, Role, ApprovalMode, ErrorCode, NotificationType
  rules/          computeSlots.ts validateWindow.ts (pure functions over Settings + business_hours + holidays + bookings)
  i18n/           errorMessages.th.ts (ErrorCode → Thai), status labels
packages/api-client/   createApi(baseUrl): typed functions per endpoint; credentials:'include'; parses with schemas; maps ErrorBody → ApiError(code, details)
```
Rules: the API never hand-writes a response shape — it returns `BookingSchema.parse(serialize(row, viewer))` in dev/test (strip in prod for speed if ever measurable). Request bodies are `schema.strict()` (unknown keys rejected) so typos surface; responses are lenient for clients (ignore unknown fields).

---

## 7. Decisions the doc writers should carry into the v2 spec (one-liners)
- Session cookie + Origin check; single origin; no CSRF token; no bearer. Mobile number never a login factor.
- snake_case JSON = column names; ISO-8601 `+07:00`; date-only = Bangkok days.
- `Idempotency-Key` mandatory on `POST /bookings`; state-idempotent transitions elsewhere.
- DRAFT dropped; `EXPIRED` for pending past start; `AUTO_RELEASED` for no-shows; `reason_code` explains every terminal state.
- Pending never holds the slot; pendings may overlap; approve is a tx whose loser sweep is explicit (`reject_conflicts`), the exclusion constraint only guards CONFIRMED/CHECKED_IN.
- Owner reschedule in a MANUAL room goes back to PENDING and releases the old slot (UI must warn); admin reschedule never reapproves.
- Check-in: stateless rotating HMAC QR per room (display tablet on a FACILITY session) + admin/facility manual check-in; attendees may check in for the owner; feature-flagged.
- Private masking is a serializer concern with 4 visibility levels; `GET /bookings/:id` returns the masked view rather than 403.
- One `notifications` table for in-app + email outbox; webhook updates it; bell polls.
- Admin "remove user" = deactivate (+ revoke sessions, cancel future bookings); hard delete only for never-used accounts.
- Settings = one JSON document with zod defaults from the slides (60 min min, 240 max, 30-min increment, 30 days ahead, 08:30–17:30 Mon–Fri, 15/15 check-in window).
- Typed client = shared zod, OpenAPI for docs only.
