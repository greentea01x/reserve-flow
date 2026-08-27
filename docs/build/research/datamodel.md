# ReserveFlow v2 — Database & Domain Design (PostgreSQL 16)

Baseline = v1 `data.html` + `tech.html`. Timezone: all columns `timestamptz`; day/hour math uses `AT TIME ZONE 'Asia/Bangkok'` explicitly. Scale: ~80 users, 3 rooms, ≈5k booking rows/year — every "index" below is for correctness of the plan shape, not for load.

## 0. What changed vs v1 (gaps fixed)

| v1 | v2 decision | Why |
|---|---|---|
| `checkins` table with `token_hash` | Dropped. Check-in = 3 columns on `bookings` (`checked_in_at/by`, `checkin_method`). QR token is a stateless HMAC (room_id + 60-s bucket), no table, no rotation job. | One-time-use adds nothing: check-in is idempotent per booking and requires the scanner's own session. Add a table only if you need revocation. |
| `rooms.business_hours_id` (per room) | **Global** `business_hours` (7 rows, isodow) + global `holidays`. | 3 rooms, identical hours. Per-room = add nullable `room_id` later (one migration). |
| `notifications` (send log) | Same table doubles as **transactional outbox** + delivery log (written in the booking tx; pg-boss worker drains it). | One table satisfies "email failure never rolls back booking" and the >99% delivery metric. |
| `DRAFT` status | **Removed.** | A draft occupies no slot, needs a purge job and pollutes "My bookings". The form is client state. |
| `EXPIRED` undefined | `PENDING_APPROVAL` whose `start_at` passed with no decision → `EXPIRED` (sweep job). | Admin cannot approve a meeting that already started. |
| `COMPLETED` undefined | Set by the same minute sweep when `end_at <= now()` for `CHECKED_IN`/`CONFIRMED`. | Keeps live partial indexes small; reports group by status without CASE. |
| Only 1 exclusion constraint | **Two**: confirmed×confirmed, and pending×confirmed (pending×pending still allowed). | DB guarantees "no request over a taken slot" and forces the approve tx to reject losers before confirming the winner. |
| `version` mentioned only | `version` increments on *every* row change (user or job). Clients send it back (`If-Match`). | Optimistic lock for PATCH/drag-drop; also `.ics SEQUENCE`. |
| Missing | `sessions`, `settings`, `holidays`, `idempotency_key` (unique per user), `cancelled_by/at/reason`, `confirmed_at`, `approval_mode` snapshot, `ics_uid`, audit as append-only. | |

---

## 1. DDL

Migration 0001 (run as the migrator/owner role; Drizzle DSL cannot express EXCLUDE → custom SQL migration, see context7 notes).

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- gist on uuid/int + range
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive email/employee_code
-- gen_random_uuid() is core in PG13+

-- ---------- enums ----------
CREATE TYPE user_role      AS ENUM ('EMPLOYEE','ADMIN','FACILITY');
CREATE TYPE user_status    AS ENUM ('ACTIVE','DISABLED');
CREATE TYPE approval_mode  AS ENUM ('AUTO','MANUAL');
CREATE TYPE booking_status AS ENUM (
  'PENDING_APPROVAL','CONFIRMED','CHECKED_IN','COMPLETED',
  'REJECTED','CANCELLED','AUTO_RELEASED','EXPIRED');
CREATE TYPE notification_status AS ENUM ('PENDING','SENT','FAILED');

-- ---------- updated_at trigger (one function, reused) ----------
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ---------- master data ----------
CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,16}$'),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code   citext NOT NULL UNIQUE CHECK (employee_code ~ '^[A-Za-z0-9-]{3,20}$'),
  email           citext NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name       text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  mobile          text CHECK (mobile ~ '^0[0-9]{9}$'),          -- Thai 10-digit; contact/recovery only, NOT a login factor
  password_hash   text NOT NULL,                                -- argon2id
  must_change_password boolean NOT NULL DEFAULT true,           -- admin-provisioned temp password
  role            user_role   NOT NULL DEFAULT 'EMPLOYEE',
  status          user_status NOT NULL DEFAULT 'ACTIVE',
  department_id   uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  failed_logins   smallint NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  disabled_at     timestamptz,
  created_by      uuid REFERENCES users(id),                    -- admin who provisioned; NULL for seed
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_disabled_consistent CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);
CREATE INDEX users_department_idx ON users (department_id);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Hand-rolled sessions (used only if Better Auth is NOT adopted; Better Auth brings its own
-- session/account/verification tables and maps `users` via additionalFields).
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,                 -- sha256(hex) of the random cookie value; raw token never stored
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,             -- 1 day, or 30 days with "remember me"
  ip            inet,
  user_agent    text
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);   -- daily purge

CREATE TABLE rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{2,32}$'),  -- 'horizon'; used in URLs/QR
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  floor         text,
  location      text,                              -- 'Garden Wing'
  description   text,
  capacity      integer NOT NULL CHECK (capacity BETWEEN 1 AND 500),
  approval_mode approval_mode NOT NULL DEFAULT 'AUTO',
  image_url     text,
  active        boolean NOT NULL DEFAULT true,     -- soft delete; bookings FK RESTRICT
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_rooms_updated BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE features (
  key   text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,32}$'),   -- 'projector'
  name  text NOT NULL,                                      -- Thai display name (UI may override via i18n map)
  icon  text                                                -- lucide icon name
);

CREATE TABLE room_features (
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES features(key) ON DELETE RESTRICT,
  quantity    integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  PRIMARY KEY (room_id, feature_key)
);

-- Global opening hours, one row per ISO weekday (1 = Mon … 7 = Sun).
-- ponytail: global; add nullable room_id when a room needs different hours.
CREATE TABLE business_hours (
  weekday    smallint PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7),
  is_open    boolean NOT NULL,
  open_time  time,
  close_time time,
  CONSTRAINT business_hours_valid CHECK (NOT is_open OR (open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time))
);

CREATE TABLE holidays (
  day   date PRIMARY KEY,
  name  text NOT NULL
);

-- ---------- policy settings (key/value) ----------
-- Validated by zod in packages/shared on read; cached in-process for 60 s.
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- bookings ----------
CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  created_by       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,   -- owner/requester
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description      text CHECK (length(description) <= 2000),
  special_request  text CHECK (length(special_request) <= 1000),
  is_private       boolean NOT NULL DEFAULT false,
  start_at         timestamptz NOT NULL,
  end_at           timestamptz NOT NULL,
  slot             tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
  status           booking_status NOT NULL,
  approval_mode    approval_mode NOT NULL,          -- snapshot of rooms.approval_mode at create / last reschedule
  version          integer NOT NULL DEFAULT 1,      -- bumps on every change (user or job); = .ics SEQUENCE
  idempotency_key  uuid NOT NULL,                   -- from Idempotency-Key header (client-generated per form submit)
  ics_uid          uuid NOT NULL DEFAULT gen_random_uuid(),  -- stable across updates; rotated only if CONFIRMED drops back to PENDING
  confirmed_at     timestamptz,                     -- set each time status becomes CONFIRMED
  checked_in_at    timestamptz,
  checked_in_by    uuid REFERENCES users(id),
  checkin_method   text CHECK (checkin_method IN ('QR','ADMIN')),
  auto_released_at timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  cancel_reason    text CHECK (length(cancel_reason) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- DB-level sanity (policy-dependent limits — min/increment/max/advance — live in settings and are enforced in the API)
  CONSTRAINT bookings_time_order  CHECK (end_at > start_at),
  CONSTRAINT bookings_15min_grid  CHECK (extract(epoch FROM start_at)::bigint % 900 = 0
                                     AND extract(epoch FROM end_at)::bigint   % 900 = 0),  -- any sane increment (15/30/60) satisfies this
  CONSTRAINT bookings_hard_max    CHECK (end_at - start_at <= interval '12 hours'),       -- hard ceiling; lets range queries use start_at btree
  CONSTRAINT bookings_checkin_ok  CHECK (status <> 'CHECKED_IN'    OR (checked_in_at IS NOT NULL AND checkin_method IS NOT NULL)),
  CONSTRAINT bookings_cancel_ok   CHECK (status <> 'CANCELLED'     OR cancelled_at IS NOT NULL),
  CONSTRAINT bookings_release_ok  CHECK (status <> 'AUTO_RELEASED' OR auto_released_at IS NOT NULL),
  CONSTRAINT bookings_confirm_ok  CHECK (status NOT IN ('CONFIRMED','CHECKED_IN','COMPLETED') OR confirmed_at IS NOT NULL),

  CONSTRAINT bookings_idem_unique UNIQUE (created_by, idempotency_key),

  -- (A) no two live bookings overlap in the same room
  CONSTRAINT bookings_no_overlap_confirmed
    EXCLUDE USING gist (room_id WITH =, slot WITH &&)
    WHERE (status IN ('CONFIRMED','CHECKED_IN')),

  -- (B) a pending request may not overlap a live booking (and vice-versa); pending×pending IS allowed.
  --     ((status='PENDING_APPROVAL')::int) WITH <> : pairs conflict only when exactly one side is pending.
  CONSTRAINT bookings_no_pending_over_confirmed
    EXCLUDE USING gist (room_id WITH =, slot WITH &&, ((status = 'PENDING_APPROVAL')::int) WITH <>)
    WHERE (status IN ('PENDING_APPROVAL','CONFIRMED','CHECKED_IN'))
);
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes (the two EXCLUDE constraints already create partial GiST indexes on (room_id, slot) for live rows)
CREATE INDEX bookings_room_start_idx   ON bookings (room_id, start_at);            -- calendar day/week per room (incl. COMPLETED history), ORDER BY start_at
CREATE INDEX bookings_owner_idx        ON bookings (created_by, start_at DESC);    -- "My bookings"
CREATE INDEX bookings_pending_idx      ON bookings (start_at) WHERE status = 'PENDING_APPROVAL';              -- admin queue, expiry sweep
CREATE INDEX bookings_live_idx         ON bookings (start_at, end_at) WHERE status IN ('CONFIRMED','CHECKED_IN'); -- auto-release / complete / reminder sweeps

CREATE TABLE booking_attendees (
  booking_id uuid  NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  email      citext NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name       text,
  PRIMARY KEY (booking_id, email)
);
CREATE INDEX booking_attendees_email_idx ON booking_attendees (email);   -- "am I an attendee?" for private-title unmasking

-- Typed, user-visible decision history (system auto-reject has actor_id NULL). Append-only.
CREATE TABLE approval_actions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL CHECK (action IN ('APPROVE','REJECT')),
  reason     text CHECK (length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_reject_needs_reason CHECK (action <> 'REJECT' OR reason IS NOT NULL)
);
CREATE INDEX approval_actions_booking_idx ON approval_actions (booking_id, created_at DESC);

-- Outbox + delivery log. Rows are INSERTed inside the booking transaction; worker drains them.
CREATE TABLE notifications (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id          uuid REFERENCES bookings(id) ON DELETE SET NULL,   -- NULL for user.welcome etc.
  kind                text NOT NULL,                 -- template key, see §7
  dedupe_key          text NOT NULL DEFAULT '',      -- version for *_UPDATED, offset-minutes for REMINDER
  recipient_email     citext NOT NULL,
  payload             jsonb NOT NULL,                -- everything the template + .ics need (snapshot at enqueue time)
  status              notification_status NOT NULL DEFAULT 'PENDING',
  attempts            smallint NOT NULL DEFAULT 0,
  last_error          text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_dedupe UNIQUE (booking_id, kind, recipient_email, dedupe_key)  -- makes every enqueue idempotent (ON CONFLICT DO NOTHING)
);
CREATE INDEX notifications_pending_idx ON notifications (created_at) WHERE status = 'PENDING';
CREATE INDEX notifications_provider_idx ON notifications (provider_message_id);   -- SES bounce/delivery webhooks

-- Append-only. actor_id NULL = system/job.
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,            -- 'booking.create','booking.approve','user.disable','settings.update', ...
  entity_type text NOT NULL,            -- 'booking','user','room','settings',...
  entity_id   text NOT NULL,
  before      jsonb,
  after       jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx  ON audit_logs (actor_id, created_at DESC);

-- App role cannot rewrite history
REVOKE UPDATE, DELETE ON audit_logs, approval_actions FROM app;
```

Notes
- `btree_gist` supports `<>` in exclusion constraints; casting the bool to `int` avoids depending on `gist_bool_ops` (PG14+). Both constraints are **immediate** (not deferrable) on purpose: the approve tx rejects losers in one statement, then confirms the winner in the next.
- Updating a row never conflicts with its own old version (exclusion check ignores tuples deleted by the current tx) → reschedule is a plain `UPDATE`.
- Why no `checkin_tokens` table: see §4. Why no `idempotency` table: the key lives on the booking row, unique per user, forever.

---

## 2. Booking state machine

States: `PENDING_APPROVAL`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED` (terminal-good), `REJECTED`, `CANCELLED`, `AUTO_RELEASED`, `EXPIRED` (terminal-bad). No `DRAFT` (see §0). `EXPIRED` = pending request whose `start_at` passed with no admin decision.

Slot is occupied only while status ∈ {CONFIRMED, CHECKED_IN}; PENDING shows as "under review" but does not block other pendings.

| From | Event | Who | Guard | To | Side effects (same tx unless noted) |
|---|---|---|---|---|---|
| — | create, room AUTO | EMPLOYEE, ADMIN | policy checks (§3), constraint A/B | CONFIRMED | `confirmed_at=now()`, `approval_mode='AUTO'`; outbox `BOOKING_CONFIRMED` (+ics REQUEST) → owner+attendees; audit |
| — | create, room MANUAL | EMPLOYEE, ADMIN* | constraint B (no live overlap) | PENDING_APPROVAL | outbox `BOOKING_SUBMITTED` → owner, `APPROVAL_NEEDED` → all active ADMINs; audit. *ADMIN creating in a manual room goes straight to CONFIRMED (they are the approver). |
| PENDING_APPROVAL | approve | ADMIN | `start_at > now()` | CONFIRMED | reject overlapping pendings (→REJECTED, reason `SLOT_TAKEN`, actor NULL), `confirmed_at=now()`, `approval_actions APPROVE`; outbox `BOOKING_CONFIRMED` (+ics) to winner, `BOOKING_REJECTED` to each loser; audit each |
| PENDING_APPROVAL | reject (reason required) | ADMIN | — | REJECTED | `approval_actions REJECT`; outbox `BOOKING_REJECTED`; audit |
| PENDING_APPROVAL | expire | job | `start_at <= now()` | EXPIRED | outbox `BOOKING_EXPIRED` → owner; audit (actor NULL) |
| PENDING_APPROVAL | cancel | owner, ADMIN | — | CANCELLED | `cancelled_*`; outbox `BOOKING_CANCELLED` → owner (no ics; none was sent); audit |
| PENDING_APPROVAL | reschedule / change room | owner, ADMIN | version match, policy, constraint B | PENDING_APPROVAL | `version++`, `approval_mode` re-snapshot; outbox `BOOKING_UPDATED` → owner; audit |
| CONFIRMED | cancel (+reason if ADMIN) | owner, ADMIN | `end_at > now()` | CANCELLED | slot released instantly (row leaves partial index); outbox `BOOKING_CANCELLED` (+ics CANCEL) → owner+attendees; audit |
| CONFIRMED | reschedule by ADMIN (incl. drag-drop) | ADMIN | version match, constraint A/B | CONFIRMED | reject overlapping pendings; `confirmed_at=now()`, `version++`; outbox `BOOKING_UPDATED` (+ics REQUEST, SEQUENCE=version); audit |
| CONFIRMED | reschedule by owner, room AUTO | owner | version match, policy, A/B | CONFIRMED | as above |
| CONFIRMED | reschedule by owner, room MANUAL (time or room changed) | owner | version match, policy, B | PENDING_APPROVAL | `confirmed_at=NULL`, **`ics_uid` rotated**; outbox `BOOKING_CANCELLED`-ics CANCEL (old UID) to attendees + `BOOKING_SUBMITTED` to owner + `APPROVAL_NEEDED` to admins; audit |
| any live | edit details only (title/description/attendees/private/special_request) | owner, ADMIN | version match | unchanged | `version++`; if CONFIRMED: outbox `BOOKING_UPDATED` (+ics REQUEST SEQUENCE=version) to owner+attendees (new attendees get REQUEST, removed get CANCEL); audit |
| CONFIRMED | check-in via QR | owner or attendee (EMPLOYEE/ADMIN) | `start_at-early ≤ now() < GREATEST(start_at,confirmed_at)+grace`, token valid for this room | CHECKED_IN | `checked_in_at/by`, `checkin_method='QR'`; audit. No email. |
| CONFIRMED | check-in by staff | ADMIN, FACILITY | `start_at-early ≤ now() < end_at` | CHECKED_IN | `checkin_method='ADMIN'`; audit |
| CONFIRMED | auto-release | job | `checkin.enabled`, `checked_in_at IS NULL`, `GREATEST(start_at,confirmed_at)+grace <= now()` | AUTO_RELEASED | `auto_released_at`; outbox `BOOKING_AUTO_RELEASED` (+ics CANCEL) → owner+attendees; audit |
| CHECKED_IN, CONFIRMED | complete | job | `end_at <= now()` | COMPLETED | audit only (CONFIRMED→COMPLETED happens when check-in is disabled or confirmation came within the grace window) |

Everything else → `409 INVALID_STATE`. Terminal states never transition (no "reopen"; admin creates a new booking).

---

## 3. Concurrency design

Principles
1. The DB is the arbiter: constraints A/B decide races; app code only produces friendly errors.
2. Every booking-mutating API transaction takes `SELECT pg_advisory_xact_lock(hashtext(room_id::text))` **before any row lock** (read the room_id with a plain SELECT first). `-- ponytail: one writer per room at a time. Removes deadlock reasoning in multi-row approve/reschedule txs. Drop it (and retry on 40P01) only if rooms ≫ 100.` The sweep job (§4.1) is the one writer that does not take room locks; a deadlock between it and an API tx is theoretically possible (same row, same minute) — PG aborts one, the API retries once, the sweep simply runs again next minute.
3. Status guards in every `UPDATE ... WHERE status = ...`; 0 rows affected → `409 INVALID_STATE` (or `STALE_VERSION` when the version predicate is present).
4. Outbox + audit rows are inserted in the same tx; after commit the API calls `boss.send('notify.send', {id})` for each new outbox row (best effort — the `notify.sweep` cron catches anything missed).

App-level validation before any tx (from `settings`, in Asia/Bangkok): `end-start >= min_minutes`, `(end-start) % increment == 0`, `<= max_minutes`, `start_at >= now()` floored to increment, `start_at <= now() + max_advance_days`, inside `business_hours` of that weekday and not a `holiday` (ADMIN may override hours/holidays), room active, capacity ≥ attendee count (soft warning only).

Error mapping (pg error → HTTP)
| pg code / condition | constraint | HTTP | body.code |
|---|---|---|---|
| `23P01 exclusion_violation` | `bookings_no_overlap_confirmed` | 409 | `SLOT_TAKEN` ("ห้องไม่ว่างแล้ว") |
| `23P01` | `bookings_no_pending_over_confirmed` | 409 | `SLOT_TAKEN` |
| `23505 unique_violation` | `bookings_idem_unique` | — | handled by `ON CONFLICT`; return existing booking 200 |
| `23514 check_violation` | any | 422 | `INVALID_TIME` (should be caught by zod first) |
| `40P01 deadlock` / `40001` | — | retry once, then 503 | — |
| UPDATE affected 0 rows, version predicate | — | 409 | `STALE_VERSION` (client refetches) |
| UPDATE affected 0 rows, status predicate | — | 409 | `INVALID_STATE` |

### 3.1 Create — AUTO room
```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext($room::text));

INSERT INTO bookings (room_id, created_by, title, description, special_request, is_private,
                      start_at, end_at, status, approval_mode, confirmed_at, idempotency_key)
VALUES ($room, $me, $title, $desc, $req, $private, $start, $end, 'CONFIRMED', 'AUTO', now(), $idem)
ON CONFLICT (created_by, idempotency_key) DO NOTHING
RETURNING *;
-- 0 rows → retry of an earlier submit: SELECT * FROM bookings WHERE created_by=$me AND idempotency_key=$idem; return it (200).
-- 23P01 → tx aborted → 409 SLOT_TAKEN.

INSERT INTO booking_attendees (booking_id, email, name) SELECT $id, * FROM unnest($emails::citext[], $names::text[]);
-- shared helper: no-op in AUTO rooms unless the room was switched from MANUAL with pendings outstanding
UPDATE bookings SET status='REJECTED', version=version+1
 WHERE room_id=$room AND status='PENDING_APPROVAL' AND id<>$id AND slot && tstzrange($start,$end,'[)')
 RETURNING id, created_by;                      -- → approval_actions(REJECT,'SLOT_TAKEN',actor NULL) + BOOKING_REJECTED outbox rows
INSERT INTO notifications (booking_id, kind, recipient_email, payload) VALUES ($id,'BOOKING_CONFIRMED',$owner_email,$payload), ...attendees
ON CONFLICT DO NOTHING;
INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after) VALUES ($me,'booking.create','booking',$id,$row);
COMMIT;
```
Two employees submit the same slot: both take the advisory lock in turn; the first INSERT commits, the second hits constraint A → `409 SLOT_TAKEN` (US-002). Without the lock the result is identical (constraint decides); the lock only makes the later multi-row txs simpler.

### 3.2 Create — MANUAL room
Same as 3.1 with `status='PENDING_APPROVAL', approval_mode='MANUAL', confirmed_at=NULL`, skip the auto-reject helper, outbox = `BOOKING_SUBMITTED` (owner) + `APPROVAL_NEEDED` (every `users WHERE role='ADMIN' AND status='ACTIVE'`). Constraint B rejects a request over a live booking (the UI should never offer such a slot; this is the race net). Overlapping pendings are allowed and appear as a *conflict group* in the admin queue:
```sql
-- admin queue: pendings with their competitors
SELECT p.*, array_remove(array_agg(o.id), NULL) AS competing_ids
FROM bookings p
LEFT JOIN bookings o ON o.room_id=p.room_id AND o.id<>p.id AND o.status='PENDING_APPROVAL' AND o.slot && p.slot
WHERE p.status='PENDING_APPROVAL' AND p.start_at > now()
GROUP BY p.id ORDER BY p.start_at;
```

### 3.3 Approve winner + auto-reject losers (one tx)
```sql
BEGIN;
SELECT room_id, start_at, end_at FROM bookings WHERE id=$id;   -- plain read (no FOR UPDATE): 404 if missing
SELECT pg_advisory_xact_lock(hashtext($room::text));          -- ALWAYS the first lock taken; row locks come from the UPDATEs below

-- losers first (constraint B would otherwise block the winner)
WITH losers AS (
  UPDATE bookings SET status='REJECTED', version=version+1
   WHERE room_id=$room AND status='PENDING_APPROVAL' AND id<>$id AND slot && tstzrange($start,$end,'[)')
   RETURNING id, created_by)
INSERT INTO approval_actions (booking_id, actor_id, action, reason)
SELECT id, NULL, 'REJECT', 'SLOT_TAKEN' FROM losers
RETURNING booking_id;                       -- app also writes BOOKING_REJECTED outbox + audit per loser

UPDATE bookings SET status='CONFIRMED', confirmed_at=now(), version=version+1
 WHERE id=$id AND status='PENDING_APPROVAL' AND start_at > now()
 RETURNING *;                                -- 0 rows → 409 INVALID_STATE (already decided / expired)
                                             -- 23P01 (constraint A) → 409 SLOT_TAKEN: a live booking appeared (admin reschedule) → admin must reject instead
INSERT INTO approval_actions (booking_id, actor_id, action, reason) VALUES ($id, $admin, 'APPROVE', $note);
INSERT INTO notifications ... BOOKING_CONFIRMED (winner owner + attendees) ON CONFLICT DO NOTHING;
INSERT INTO audit_logs ...;
COMMIT;
```
Two admins approving two competing requests at once: the advisory lock serializes them; the second finds its booking already `REJECTED` → `409 INVALID_STATE` with message "ถูกปฏิเสธแล้วเพราะอีกคำขอได้รับอนุมัติ".

### 3.4 Reschedule / edit (PATCH, optimistic version)
```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext($new_room::text));
-- if room changes, also lock the old room id (both, ordered by hashtext value to be deterministic)

-- decide $new_status in app: actor ADMIN → 'CONFIRMED' (if currently CONFIRMED) / keep PENDING if currently PENDING;
-- owner + room AUTO → 'CONFIRMED'; owner + room MANUAL + (time or room changed) → 'PENDING_APPROVAL'.
-- when $new_status = CONFIRMED: run the auto-reject-pendings helper first (id<>$id).

UPDATE bookings
   SET room_id=$new_room, start_at=$start, end_at=$end,
       status=$new_status,
       approval_mode=$room_mode_now,
       confirmed_at = CASE WHEN $new_status='CONFIRMED' THEN now() ELSE NULL END,
       ics_uid      = CASE WHEN status='CONFIRMED' AND $new_status='PENDING_APPROVAL' THEN gen_random_uuid() ELSE ics_uid END,
       version=version+1
 WHERE id=$id AND version=$expected_version
   AND status IN ('PENDING_APPROVAL','CONFIRMED')
   AND (created_by=$me OR $is_admin)
 RETURNING *;
-- 0 rows → 409 STALE_VERSION (or INVALID_STATE/403; app distinguishes with one SELECT)
-- 23P01 → 409 SLOT_TAKEN (drag-drop UI snaps back)
-- outbox per state table; audit with before/after
COMMIT;
```
Detail-only edits use the same UPDATE without time/room/status changes (`version=version+1` still). Attendee diff: `DELETE ... WHERE booking_id=$id AND email <> ALL($keep)`, `INSERT ... ON CONFLICT DO NOTHING`.

### 3.5 Cancel
```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext($room::text));   -- not strictly needed; keeps the "one writer per room" invariant
UPDATE bookings
   SET status='CANCELLED', cancelled_at=now(), cancelled_by=$me, cancel_reason=$reason, version=version+1
 WHERE id=$id AND status IN ('PENDING_APPROVAL','CONFIRMED') AND end_at > now()
   AND (created_by=$me OR $is_admin)
 RETURNING *;                     -- 0 rows: if already CANCELLED → 200 (idempotent), else 409 INVALID_STATE
-- outbox BOOKING_CANCELLED (+ics CANCEL if it was CONFIRMED); audit
COMMIT;
```
Admin cancel requires `cancel_reason` (zod). Slot is free the instant this commits (FR-008).

### 3.6 Idempotency
- `POST /bookings` requires header `Idempotency-Key: <uuid>` generated once per form submit; stored on the row, `UNIQUE (created_by, idempotency_key)`. Retries return the original booking (200). Different payload with same key → still returns the original (documented; key is per submission, not per payload).
- `approve/reject/cancel/check-in` are naturally idempotent via status guards (repeat → 200 if already in target state, else 409).
- `PATCH` uses `version` (`If-Match` or body) — a replayed PATCH fails with `STALE_VERSION`, which is the correct outcome.

---

## 4. Jobs (pg-boss, same Postgres, worker entry in `apps/api`)

Queues (`boss.createQueue` at boot):

| queue | trigger | retry | what |
|---|---|---|---|
| `booking.sweep` | `boss.schedule('booking.sweep','* * * * *',{},{tz:'Asia/Bangkok'})` | none (next tick retries) | one tx, four guarded statements below |
| `notify.send` | `boss.send` after commit, `singletonKey: notificationId` | retryLimit 5, retryDelay 30 s, backoff | send one outbox row |
| `notify.sweep` | cron `* * * * *` | — | enqueue `notify.send` for `PENDING` rows older than 60 s (missed/after crash) |
| `maintenance.daily` | cron `15 3 * * *` | — | purge expired sessions, retention (§9) |

Why a per-minute sweep instead of one delayed job per booking: reschedules/cancels would need job reconciliation (and pg-boss `singletonKey` would *drop* the re-sent job while the stale one is queued). A sweep reads current state; ±60 s on a 15-min grace is irrelevant. `-- ponytail: sweep; switch to startAfter jobs only if second-precision is ever required.`

### 4.1 `booking.sweep` (all statements idempotent; running twice or concurrently changes nothing)
```sql
BEGIN;
-- parameters from settings: $grace (checkin.grace_minutes), $enabled (checkin.enabled), $offsets (reminder.offsets_minutes)

-- 1) expire undecided requests
WITH x AS (
  UPDATE bookings SET status='EXPIRED', version=version+1
   WHERE status='PENDING_APPROVAL' AND start_at <= now()
   RETURNING id, created_by)
INSERT INTO notifications (booking_id, kind, recipient_email, payload)
SELECT x.id, 'BOOKING_EXPIRED', u.email, jsonb_build_object('bookingId', x.id) FROM x JOIN users u ON u.id=x.created_by
ON CONFLICT DO NOTHING;                             -- + audit rows from the same CTE (app builds them from RETURNING)

-- 2) auto-release no-shows
WITH r AS (
  UPDATE bookings SET status='AUTO_RELEASED', auto_released_at=now(), version=version+1
   WHERE $enabled AND status='CONFIRMED' AND checked_in_at IS NULL
     AND GREATEST(start_at, confirmed_at) + make_interval(mins => $grace) <= now()
   RETURNING id, created_by, version)
INSERT INTO notifications (...) SELECT ... 'BOOKING_AUTO_RELEASED' for owner + attendees (payload includes ics CANCEL data) ON CONFLICT DO NOTHING;

-- 3) complete finished meetings
UPDATE bookings SET status='COMPLETED', version=version+1
 WHERE status IN ('CHECKED_IN','CONFIRMED') AND end_at <= now();

-- 4) reminders (one per offset; UNIQUE(booking_id,kind,recipient,dedupe_key) makes it exactly-once)
INSERT INTO notifications (booking_id, kind, dedupe_key, recipient_email, payload)
SELECT b.id, 'BOOKING_REMINDER', o::text, u.email, jsonb_build_object('bookingId', b.id, 'offset', o)
FROM unnest($offsets::int[]) o, bookings b JOIN users u ON u.id=b.created_by
WHERE b.status='CONFIRMED' AND b.start_at > now() AND b.start_at <= now() + make_interval(mins => o)
ON CONFLICT DO NOTHING;
COMMIT;
```
Double run: every UPDATE is guarded by `status`, every INSERT by the unique key → second run is a no-op. Admin approving at the same instant as step 1: row lock → one wins; the other sees 0 rows → 409.

### 4.2 `notify.send` worker
```sql
BEGIN;
SELECT * FROM notifications WHERE id=$1 AND status='PENDING' FOR UPDATE SKIP LOCKED;  -- 0 rows → done (already sent / being sent)
-- render template + .ics from payload, call SES
UPDATE notifications SET status='SENT', sent_at=now(), provider_message_id=$mid, attempts=attempts+1 WHERE id=$1;
COMMIT;
-- on provider error: UPDATE ... SET attempts=attempts+1, last_error=$e; throw → pg-boss retries; after retryLimit: SET status='FAILED' (dead-letter → admin "email failures" list)
```
Holding the row lock across the SES call (~200 ms) is fine at this volume; a crash mid-send leaves the row `PENDING` → re-sent (at-least-once; acceptable for email). SES delivery/bounce webhooks update by `provider_message_id` → feeds the >99% delivery metric (`SENT & delivered / (SENT - suppressed)`).

### 4.3 Check-in rules
- Window (settings): `checkin.early_minutes=15`, `checkin.grace_minutes=15`. QR self check-in allowed `start_at - 15m ≤ now() < GREATEST(start_at, confirmed_at) + 15m`; auto-release fires at the same upper bound, so late-confirmed bookings still get 15 min.
- Staff check-in (ADMIN/FACILITY, admin app "Today" list): allowed from `start_at - early` until `end_at`.
- **QR token = stateless HMAC** (no table): kiosk/door page (`GET /rooms/:code/checkin-qr`, ADMIN/FACILITY session or a per-room kiosk key) renders a QR every 30 s encoding `https://<app>/checkin?t=<base64url(room_code.bucket.hmac16)>` where `bucket = floor(epoch/60)` and `hmac = HMAC-SHA256(CHECKIN_SECRET, room_code||bucket)`. Verifier accepts `bucket ∈ {now, now-1}` (60–120 s validity). Employee scans → logs in → `POST /checkin {t}`:
```sql
UPDATE bookings b
   SET status='CHECKED_IN', checked_in_at=now(), checked_in_by=$me, checkin_method='QR', version=version+1
 WHERE b.room_id=$room AND b.status='CONFIRMED'
   AND now() >= b.start_at - make_interval(mins=>$early)
   AND now() <  GREATEST(b.start_at, b.confirmed_at) + make_interval(mins=>$grace)
   AND (b.created_by=$me OR EXISTS (SELECT 1 FROM booking_attendees a WHERE a.booking_id=b.id AND a.email=$my_email))
 RETURNING b.*;     -- 0 rows → 404 NO_BOOKING_TO_CHECK_IN ("ไม่มีการจองที่เช็กอินได้ในห้องนี้ตอนนี้")
```
A photographed QR is useless after 2 minutes and still requires the scanner's own login. `-- ponytail: add a checkin_tokens(token_hash, room_id, expires_at) table only if one-time-use/revocation becomes a requirement.`
- Optional DDL if insisted: `CREATE TABLE checkin_tokens (token_hash text PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id), expires_at timestamptz NOT NULL, used_at timestamptz); CREATE INDEX ON checkin_tokens (expires_at);` + purge in `maintenance.daily`.

---

## 5. Availability & calendar queries

### 5.1 Free/pending/busy slots per room for a date (FR-001 room-detail slot list)
`$1 date`, `$2 increment minutes` (from settings), optional `$3 room_id`.
```sql
WITH day AS (
  SELECT $1::date AS d, extract(isodow FROM $1::date)::int AS dow
), hours AS (
  SELECT bh.open_time, bh.close_time
  FROM business_hours bh, day
  WHERE bh.weekday = day.dow AND bh.is_open
    AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = day.d)       -- closed day → 0 rows → no slots
), slots AS (
  SELECT r.id AS room_id, s AS slot_start, s + make_interval(mins => $2) AS slot_end
  FROM rooms r, day, hours,
       LATERAL generate_series((day.d + hours.open_time)  AT TIME ZONE 'Asia/Bangkok',
                               (day.d + hours.close_time) AT TIME ZONE 'Asia/Bangkok' - make_interval(mins => $2),
                               make_interval(mins => $2)) AS s
  WHERE r.active AND ($3::uuid IS NULL OR r.id = $3)
)
SELECT s.room_id, s.slot_start, s.slot_end,
       CASE WHEN bool_or(b.status IN ('CONFIRMED','CHECKED_IN')) THEN 'BUSY'
            WHEN bool_or(b.status = 'PENDING_APPROVAL')          THEN 'PENDING'
            WHEN s.slot_start < now()                             THEN 'PAST'
            ELSE 'FREE' END AS state
FROM slots s
LEFT JOIN bookings b
       ON b.room_id = s.room_id
      AND b.status IN ('PENDING_APPROVAL','CONFIRMED','CHECKED_IN')
      AND b.slot && tstzrange(s.slot_start, s.slot_end, '[)')          -- hits the partial GiST index of constraint B
GROUP BY 1,2,3
ORDER BY 1,2;
```
≈ 18 slots × 3 rooms = 54 rows; sub-millisecond.

### 5.2 Room search for a requested window (FR-002, FR-011)
```sql
SELECT r.*
FROM rooms r
WHERE r.active
  AND r.capacity >= $people
  AND NOT EXISTS (SELECT 1 FROM bookings b
                   WHERE b.room_id=r.id AND b.status IN ('CONFIRMED','CHECKED_IN')
                     AND b.slot && tstzrange($start,$end,'[)'))
  AND NOT EXISTS (SELECT 1 FROM unnest($features::text[]) f            -- every requested feature must exist
                   WHERE NOT EXISTS (SELECT 1 FROM room_features rf WHERE rf.room_id=r.id AND rf.feature_key=f))
ORDER BY r.capacity, r.name;
```
Pending rooms (MANUAL) are returned with a flag `has_pending` (separate EXISTS) so the UI can say "มีคำขอรออนุมัติ".

### 5.3 Calendar with private masking (FR-001, US-007)
Masking is decided in SQL (`can_view`) and **fields are projected in the API layer** — the masked response never contains title/description/attendees/owner.
```sql
SELECT b.id, b.room_id, b.start_at, b.end_at, b.status, b.is_private, b.version,
       (NOT b.is_private
        OR b.created_by = $me
        OR $role = 'ADMIN'
        OR EXISTS (SELECT 1 FROM booking_attendees a WHERE a.booking_id=b.id AND a.email=$my_email)) AS can_view,
       b.title, b.created_by, u.full_name AS owner_name, d.name AS department_name, b.special_request
FROM bookings b
JOIN users u ON u.id=b.created_by
JOIN departments d ON d.id=u.department_id
WHERE b.room_id = ANY($rooms)
  AND b.status IN ('PENDING_APPROVAL','CONFIRMED','CHECKED_IN','COMPLETED')
  AND b.start_at < $to AND b.start_at >= $from - interval '12 hours' AND b.end_at > $from   -- uses bookings_room_start_idx; 12 h = bookings_hard_max
ORDER BY b.room_id, b.start_at;
```
API projection (TS): `can_view ? full : { id, room_id, start_at, end_at, status, is_private:true, title:'Busy' }`. FACILITY gets `special_request` even when masked (setup need), never title/owner. Tests assert the masked JSON has no `title` key via direct API calls (NFR Security).

---

## 6. Permission matrix

| Action | EMPLOYEE | ADMIN | FACILITY |
|---|---|---|---|
| Login / change own password / view own profile | ✔ | ✔ | ✔ |
| View calendar & availability (masked private) | ✔ | ✔ | ✔ |
| View private meeting details | owner / attendee only | ✔ (all) | ✖ (sees room/time/special_request only) |
| Search rooms, create booking | ✔ | ✔ (manual room → directly CONFIRMED) | ✖ |
| Edit details / reschedule / cancel **own** booking | ✔ (reschedule in manual room → re-approval) | ✔ | ✖ |
| Reschedule / cancel **others'** bookings (incl. drag-drop) | ✖ | ✔ (reason required on cancel) | ✖ |
| Book outside business hours / on holidays | ✖ | ✔ (override, audited) | ✖ |
| Approve / reject requests | ✖ | ✔ | ✖ |
| Self check-in via QR | ✔ (own or as attendee) | ✔ | ✖ |
| Check-in others (staff/kiosk) | ✖ | ✔ | ✔ |
| View today's schedule incl. special requests (setup list) | ✖ | ✔ | ✔ |
| Manage rooms, features, business hours, holidays | ✖ | ✔ | ✖ |
| Manage users (create, edit, role, disable/enable, reset password) | ✖ | ✔ (cannot disable self / last ADMIN) | ✖ |
| Settings (policy) | ✖ | ✔ | ✖ |
| Reports (utilization, outcomes, no-show, heatmap), export | ✖ | ✔ | ✖ |
| Email failures / audit log viewer | ✖ | ✔ | ✖ |
| Hard-delete user / room | ✖ | only if no bookings reference it (FK RESTRICT); otherwise disable | ✖ |

Enforced in one API policy module (`can(actor, action, resource)`); queries always add the row-scoping predicates shown above. "Remove user" in the admin UI = `status='DISABLED'` + `DELETE FROM sessions WHERE user_id=…`; future live bookings of a disabled user are listed to the admin with a one-click "cancel all" (not automatic).

---

## 7. Notification matrix (email only in MVP; React Email templates; `ics` lib)

| Event (kind) | Recipients | .ics | Template key / dedupe_key |
|---|---|---|---|
| `BOOKING_SUBMITTED` (manual room) | owner | — | `booking.submitted` |
| `APPROVAL_NEEDED` | every ACTIVE ADMIN | — | `approval.needed` (one row per admin) |
| `BOOKING_CONFIRMED` (auto create / approve) | owner + attendees | `METHOD:REQUEST`, `SEQUENCE:<version>` | `booking.confirmed` |
| `BOOKING_REJECTED` (admin reject or lost conflict) | owner | — | `booking.rejected` (reason; `SLOT_TAKEN` has its own copy) |
| `BOOKING_UPDATED` (reschedule / edit while CONFIRMED) | owner + attendees (added → REQUEST, removed → CANCEL) | `REQUEST`, `SEQUENCE:<version>` | `booking.updated` / dedupe_key = version |
| `BOOKING_CANCELLED` | owner + attendees | `METHOD:CANCEL` (only if it was CONFIRMED) | `booking.cancelled` (shows admin reason if any) |
| `BOOKING_AUTO_RELEASED` | owner + attendees | `CANCEL` | `booking.auto_released` |
| `BOOKING_EXPIRED` | owner | — | `booking.expired` |
| `BOOKING_REMINDER` | owner | — (link + QR deep link) | `booking.reminder` / dedupe_key = offset minutes (default `[15]`) |
| `USER_WELCOME` / `USER_PASSWORD_RESET` | the user | — | `user.welcome`, `user.reset` (temp password link, `must_change_password`) |

.ics rules: `UID:<ics_uid>@reserveflow`, `SEQUENCE:<booking.version>` (monotonic), `ORGANIZER` = noreply + `CN` owner, `DTSTART/DTEND` in UTC, `STATUS:CONFIRMED` / `STATUS:CANCELLED`, `METHOD` in both the MIME part (`text/calendar; method=REQUEST`) and the VCALENDAR. A CONFIRMED booking that drops back to PENDING sends CANCEL under the old UID and gets a fresh `ics_uid`, so the later approval is a clean new invite in every client. No email on check-in or complete. Pending bookings never send .ics.

---

## 8. Utilization (FR-012)

Definitions (per room, per period, business hours only):
- `available_hours` = Σ over days in period where `business_hours.is_open` and day ∉ `holidays` of `(close_time − open_time)`; for the current month the period end is capped at `now()` (report says "to date").
- `used_hours` = Σ of `slot ∩ business window` durations for bookings with status ∈ {`COMPLETED`, `CHECKED_IN`} (actually used). Admin-override bookings outside hours are clipped.
- `booked_hours` (secondary) = same sum over {`CONFIRMED`,`CHECKED_IN`,`COMPLETED`} — includes future.
- `utilization_pct = 100 × used_hours / available_hours`.
- `CANCELLED`, `REJECTED`, `EXPIRED`: excluded from both numerator and denominator (slot was released/never held). `AUTO_RELEASED`: not used → 0 in numerator; counted in **no-show rate** = `auto_released / (completed + auto_released)`.
- Outcome mix = count by status over bookings whose `start_at` falls in the period.

```sql
-- $from date, $to date (inclusive), Asia/Bangkok
WITH days AS (
  SELECT d::date AS day, bh.open_time, bh.close_time
  FROM generate_series($from::date, $to::date, interval '1 day') d
  JOIN business_hours bh ON bh.weekday = extract(isodow FROM d)::int AND bh.is_open
  WHERE NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = d::date)
), windows AS (
  SELECT tstzrange((day + open_time)  AT TIME ZONE 'Asia/Bangkok',
                   LEAST((day + close_time) AT TIME ZONE 'Asia/Bangkok', now()), '[)') AS win
  FROM days
  WHERE (day + open_time) AT TIME ZONE 'Asia/Bangkok' < now()
), avail AS (
  SELECT coalesce(sum(extract(epoch FROM upper(win) - lower(win))) / 3600, 0) AS hours FROM windows
), used AS (
  SELECT b.room_id,
         sum(extract(epoch FROM upper(b.slot * w.win) - lower(b.slot * w.win))) / 3600 AS hours
  FROM bookings b JOIN windows w ON b.slot && w.win
  WHERE b.status IN ('COMPLETED','CHECKED_IN')
  GROUP BY b.room_id
), outcomes AS (
  SELECT room_id,
         count(*) FILTER (WHERE status='COMPLETED')     AS completed,
         count(*) FILTER (WHERE status='CANCELLED')     AS cancelled,
         count(*) FILTER (WHERE status='AUTO_RELEASED') AS auto_released,
         count(*) FILTER (WHERE status IN ('REJECTED','EXPIRED')) AS not_granted
  FROM bookings
  WHERE start_at >= $from::date::timestamp AT TIME ZONE 'Asia/Bangkok'
    AND start_at <  ($to::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
  GROUP BY room_id
)
SELECT r.id, r.name,
       round(coalesce(u.hours,0)::numeric, 1)                               AS used_hours,
       round(a.hours::numeric, 1)                                           AS available_hours,
       round(100 * coalesce(u.hours,0)::numeric / nullif(a.hours,0), 1)     AS utilization_pct,
       o.completed, o.cancelled, o.auto_released, o.not_granted,
       round(100.0 * o.auto_released / nullif(o.completed + o.auto_released, 0), 1) AS no_show_pct
FROM rooms r CROSS JOIN avail a
LEFT JOIN used u     ON u.room_id = r.id
LEFT JOIN outcomes o ON o.room_id = r.id
ORDER BY utilization_pct DESC NULLS LAST;
```
Heatmap (weekday × start hour, used bookings in period): `SELECT extract(isodow FROM start_at AT TIME ZONE 'Asia/Bangkok') dow, extract(hour FROM start_at AT TIME ZONE 'Asia/Bangkok') hr, count(*) FROM bookings WHERE status IN ('COMPLETED','CHECKED_IN') AND start_at BETWEEN … GROUP BY 1,2`. Note: the v1 mockup number "244/360 h" is illustrative; with 9 h × ~21 business days × 3 rooms the real denominator is ≈567 h/month.

---

## 9. Seed data & retention / PII

Seed (`packages/db/seed.ts`, idempotent `ON CONFLICT DO NOTHING`):
- `departments` (8, the "8 teams"; names are placeholders to confirm): `EXEC ฝ่ายบริหาร`, `HR ทรัพยากรบุคคล`, `FIN การเงิน`, `SALES ขาย`, `MKT การตลาด`, `ENG วิศวกรรม/ไอที`, `OPS ปฏิบัติการ`, `CS บริการลูกค้า`.
- `rooms` (3, from the Stitch reference): `horizon` Horizon Room – Executive Boardroom, 4F, cap 20, **MANUAL** (VIP boardroom, US-004); `summit` Summit Room – Creative Space, 5F, cap 12, AUTO; `grove` Grove Room – Garden Wing, 2F, cap 8, AUTO.
- `features`: `projector`, `tv`, `whiteboard`, `video_conference`, `conference_phone`, `hdmi`. `room_features`: Horizon projector×1 + video_conference + conference_phone + whiteboard; Summit tv + whiteboard + hdmi; Grove tv + whiteboard.
- `business_hours`: Mon–Fri 08:30–17:30 open; Sat/Sun closed. `holidays`: Thai public holidays for the current year (admin maintains).
- `settings`: `booking.min_minutes=60`, `booking.increment_minutes=30`, `booking.max_minutes=240` (v1 Q-11 proposal, confirm), `booking.max_advance_days=30` (Q-12: 30 days, not calendar month), `checkin.enabled=true`, `checkin.early_minutes=15`, `checkin.grace_minutes=15`, `reminder.offsets_minutes=[15]`.
- `users`: one ADMIN `ADM001` (email + password from env `SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD`, `must_change_password=true`); dev-only seed adds 8 employees `EMP001..EMP008` (one per department), 1 FACILITY `FAC001`, all with a printed dev password — guarded by `NODE_ENV !== 'production'`.

Retention / PII
- `users.mobile`: contact/recovery only; never a login factor; shown only to ADMIN and the user; excluded from logs and audit `before/after` (audit redacts `password_hash`, `mobile`). Recommend dropping the "Mobile number" field from the login page (v1 Q-09).
- Private titles: never leave the API for non-authorized viewers (§5.3); audit rows contain titles → audit viewer is ADMIN-only; no titles in email subjects for private bookings ("[Private] การประชุม" + room/time in body only to owner/attendees).
- `booking_attendees` (external emails) and `notifications.payload` (contain names/emails/titles): purge rows whose booking ended > 12 months ago (`maintenance.daily`); bookings themselves kept (reports) with title intact.
- `audit_logs`: keep 24 months, then delete by `created_at`. `sessions`: delete expired daily. Disabled users are kept (FK); on request anonymise `full_name/email/mobile` after 12 months (`employee_code` retained for report joins).
- Backups/PITR: per stack doc (30-day retention); seed + migrations re-create everything else.

---

## 10. Open points to confirm with the customer (carry into v2 questions)
1. `booking.max_minutes` (4 h?) and whether back-to-back by the same owner counts as one (Q-11).
2. Should FACILITY see private titles? Current design: no (setup notes only).
3. Admin-created booking in a MANUAL room goes straight to CONFIRMED — confirm.
4. Reminder offsets (15 min only, or also day-before).
5. Webboard/announcements (company PDF) — out of the data model until clarified.
