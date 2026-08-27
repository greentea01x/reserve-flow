---
ticket: W0-gate-review
status: done
verdict: go-with-caveats
date: 2026-08-24
reviews: [T-008, T-009]
gate_for: schema freeze (§06), NFR-5, T-012, T-040/T-041
tags: [review, gate, w0]
---

# W0 gate review — adversarial re-verification of T-008 and T-009

Nothing below is taken from the two spike reports. Every "CONFIRMED" row was re-run by this
review against the live PostgreSQL 18.6 in `infra/compose.yml` and the live Mailpit on
`127.0.0.1:1025`, with assertions written independently of the spike scripts, and — where the
original evidence came from a tool that could itself be wrong — decoded a second time with a
different implementation (`psql` instead of Drizzle, Python's `email` package instead of
Mailpit's decoder, a hand-written RFC 5545 unfolder instead of the spike's).

**Verdict: GO WITH CAVEATS.** Both technology choices are sound and every hands-on claim in
scope survived. Neither *gate* is fully closed: §06 cannot be frozen from T-008's list as
written (the spec's `accounts` DDL is unrunnable — proven twice with `42703`), and T-009's own
body says NFR-5 is not closed while its header says `Status: GO`.

## How this was verified

| Method | What it covered |
|---|---|
| `apps/api/spike/verify-w0.ts` (written for this review, 21 assertions, since deleted) | employee_code sign-in, argon2id, revocation, token single-use **plus a real concurrency race**, `.ics` generation, live SMTP send |
| `psql -U rf_owner` straight into the container | password hashes, `issuer`, row state, grants, `show timezone`, `CREATE EXTENSION` privilege probe |
| `apps/api/spike/verify-inv.ts` (written for this review, since deleted) | `getAuthTables()` dump; destructive probes that drop columns from `accounts` and re-attempt sign-in |
| Python `email` + `base64`/`quoted-printable`, and a hand-written unfolder | decoded MIME bodies and `.ics` — a second decoder, not Mailpit's |
| Re-running both spikes as their own authors documented | reproducibility of the published evidence |

Gate commands, forced uncached (`turbo run … --force`, `Cached: 0`):

| Command | Exit code |
|---|---|
| `pnpm lint` | **0** — 6/6 tasks, biome clean, 18 files in `@reserveflow/api` |
| `pnpm typecheck` | **0** — 6/6 tasks |
| `pnpm test` | **0** — 7/7 tasks; `@reserveflow/api` 13 tests in 2 files, `@reserveflow/shared` 1 |
| `pnpm build` | **0** — 6/6 tasks |

> `pnpm lint` first returned **254** in this shell — an artefact of the local `rtk` command
> shim rewriting it to `eslint`, which this repo does not use. Run through `rtk proxy` it is 0.
> Not a repository problem; recorded so the number is not mistaken for a regression.

---

## 1 · Claim-by-claim

### T-008 — better-auth

| # | Claim | Verdict | Evidence I personally observed |
|---|---|---|---|
| 1 | The Drizzle/pg adapter drives the real database | **CONFIRMED** | Applied `spike/ddl.sql` as `rf_owner`; every `auth.api.*` call below hit those tables; `psql` shows the resulting rows |
| 2 | `additionalFields` round-trip | **CONFIRMED** | `createUser` with `employee_code:'ZQ-7781', department_id, mobile, status:'ACTIVE'`; `psql` returned `employee_code=ZQ-7781, status=ACTIVE, role=ADMIN` |
| 3 | `citext` makes the code lookup case-insensitive | **CONFIRMED** | `WHERE employee_code = 'zq-7781'` matched exactly 1 row stored as `ZQ-7781` |
| 4 | **Sign-in with `employee_code` (not an email) works** | **CONFIRMED, narrower than the row implies** | Two separate facts: `signInEmail({email:'zq-7781'})` is rejected **HTTP 400** by better-auth, and the app-side resolve `employee_code → email → signInEmail` returns **HTTP 200** with a session row. The mechanism is ours, not better-auth's, and no HTTP route implements it yet — `apps/api/src/app.ts` mounts only `/api/healthz` and `/api/readyz`. "PASS / HTTP 200" in T-008 §2 is an in-process `asResponse` object, not a served endpoint |
| 5 | **The stored hash really is argon2id** | **CONFIRMED** | Read straight out of Postgres with `psql`, not through Drizzle: `$argon2id$v=19$m=65536,t=3,p=1$…`, length 97. Parsed: algorithm `argon2id`, `v=19`, `m=65536`, `t=3`, `p=1`; base64 digest decodes to **32 bytes**. `argon2.verify(hash, correct)=true`, `(hash, wrong)=false`. Not scrypt (`hex:hex`) format. Same on all three users, including the one whose password was written by the redeem path |
| 6 | `__Host-sid` cookie flags | **CONFIRMED** | `__Host-sid=…; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`, no `Domain`, only cookie set |
| 7 | Session persisted in Postgres | **CONFIRMED** | 1 row in `sessions` with `ip_address=10.4.4.4`, `user_agent=verify/1.0` |
| 8 | `banned=true` alone does **not** revoke a live session | **CONFIRMED** | After `UPDATE users SET banned=true, status='DISABLED', disabled_at=now()`, `getSession()` with the same cookie still returned a valid session |
| 9 | **Deactivation rejects a previously-valid session on the very next request** | **CONFIRMED** | Ordered, same `Headers` object: `getSession` valid → valid again (rules out upstream memoisation) → `DELETE FROM sessions` (1 row) → **the very next `getSession` returned `null`**. `session.cookieCache` is `undefined` in the resolved options, so this is not a cold-cache artefact |
| 10 | Sign-in afterwards is refused | **CONFIRMED** | `HTTP 403 {"code":"BANNED_USER"}` |
| 11 | `auth.api.banUser` is unusable against the §06 DDL | **CONFIRMED** | Re-ran T-008's own spike: `threw: 23514 users_banned_mirror — new row for relation "users" violates check constraint "users_banned_mirror"` |
| 12 | `createUser` without a password writes **zero** `accounts` rows | **CONFIRMED** | 0 rows; sign-in before redeem is `HTTP 401` |
| 13 | **The set-password token cannot be redeemed twice** | **CONFIRMED, and strengthened** | Sequential: `first=redeemed`, `second=TOKEN_INVALID_OR_USED`. **Concurrently** — two transactions racing the same token with a 250 ms hold inside each — exactly one committed, `used_at` set once, and the winner's password is the one that signs in (`200`) while the loser's does not (`401`). T-008 §7c *asserts* "no race" but never raced it; it does now |
| 14 | Expired token is refused | **CONFIRMED** | Token with `expires_at` in the past → rejected |
| 15 | The redeem path's own hash is argon2id | **CONFIRMED** | `$argon2id$v=19$m=65536,t=3,p=1$…` via `auth.$context.password.hash`; sign-in after redeem `HTTP 200` |
| 16 | Only `sha256(token)` is stored | **CONFIRMED (by inspection), assertion is vacuous** | True of the code and of the table. But the spike "proves" it with `timingSafeEqual(a, a)` on the same buffer — a tautology that cannot fail. Do not carry that assertion into `TC-AUTH-009` |
| 17 | No native rate limiting on `auth.api.*`; native limiter only on `auth.handler` | **CONFIRMED** | Re-ran: 10 in-process wrong-password calls → `401×10`, no `429`; through `auth.handler` with the limiter on → `401,401,401,401,401,429,429,429,429,429` |
| 18 | better-auth never touches `failed_logins`/`locked_until` | **CONFIRMED** | Both unchanged (`0` / `null`) after 20 failed attempts |
| 19 | Δ4 — `CREATE EXTENSION` fails as `rf_owner` | **CONFIRMED by my own probe** | `create extension pg_trgm` as `rf_owner` → `ERROR: permission denied to create extension "pg_trgm" / HINT: Must have CREATE privilege on current database`. The fix is already applied: `citext` and `btree_gist` both exist, created by `infra/db/init/01-roles.sql` |
| 20 | Δ10 — default privileges hand `rf_app` `DELETE` on every new table | **CONFIRMED by my own probe** | Created `_dp_probe` as `rf_owner`; `information_schema.role_table_grants` showed `rf_app: DELETE, INSERT, SELECT, UPDATE`. All six spike tables likewise, including `users` and `departments`, which `ddl.sql` never granted `DELETE` on |
| 21 | Δ1 — `accounts` needs `issuer` | **CONFIRMED but INCOMPLETE** | `issuer` is absent from the spec (0 occurrences of the string in `ReserveFlow_Spec_v2.md`). Dropping it → sign-in dies `42703: column "issuer" does not exist`. **The report stops one delta short**: dropping the six OAuth columns the spec leaves in a *comment* kills sign-in the same way. See §2 |
| 22 | Δ6 — remember-me 30 days is not achievable | **CONFIRMED (true branch)** | `rememberMe:true` → `Max-Age=604800` (7 d), not 30 d. The `rememberMe:false` browser-session-cookie half was not re-tested here |
| 23 | The inventory is "better-auth's own declaration, not a guess" | **CONFIRMED with two inaccuracies** | I re-ran `getAuthTables()`; the column lists match. But better-auth declares `indexes: []` for `session` and `verification` — the report's "indexed" annotations on `session.user_id` and `verification.identifier` describe **our** DDL, not better-auth's. And `account` declares its unique index over the logical names `["issuer","accountId"]` |

### T-009 — SMTP + `.ics`

| # | Claim | Verdict | Evidence I personally observed |
|---|---|---|---|
| 24 | **`DTSTART` is UTC `"Z"`, no `TZID`, no `+07:00`** | **CONFIRMED** | My own generation + my own RFC 5545 unfolder: `DTSTART:20260827T060000Z`, `DTEND:20260827T073000Z`, `DTSTAMP:20260823T233424Z`, all matching `^\d{8}T\d{6}Z$`, no `;TZID=` on any of the three, in both REQUEST and CANCEL |
| 25 | The UTC instant is the Bangkok wall time asked for | **CONFIRMED** | `20260827T060000Z` converted to UTC+07:00 = `2026-08-27T13:00:00+07:00` |
| 26 | **CANCEL shares the UID and increments SEQUENCE** | **CONFIRMED** | Both files carry `UID:aa11bb22-…@reserveflow.local` byte-identically; `SEQUENCE:3` → `SEQUENCE:4`; CANCEL also carries `METHOD:CANCEL` **and** `STATUS:CANCELLED`, REQUEST `METHOD:REQUEST` + `STATUS:CONFIRMED`; `ORGANIZER` is the owner with `SENT-BY="mailto:no-reply@…"`; exactly 2 `ATTENDEE` lines each |
| 27 | Folding is octet-correct and never eats a character | **CONFIRMED** | Zero lines over 75 octets; no bare LF and no bare CR; no U+FFFD; the raw bytes decode as strict UTF-8; unfolding restores `LOCATION:ห้องประชุมฮอไรซัน ชั้น 12` including the space that sits at the fold |
| 28 | The missing-final-CRLF workaround | **CONFIRMED** | Both generated files end with `\r\n` |
| 29 | **Thai survives in the decoded message body** | **CONFIRMED with a second decoder** | Pulled the raw messages from Mailpit and parsed them with Python's `email` package, not Mailpit's: `text/plain`, `text/html` and `text/calendar` all contain Thai with **zero** U+FFFD; `Subject` decodes to `ยืนยันการจอง: ห้องประชุมฮอไรซัน ชั้น 12 · วันพฤหัสบดีที่ 27 สิงหาคม พ.ศ. 2569 เวลา 13:00–14:30 น.`; the `To:` display name decodes to `สมชาย ใจดี` |
| 30 | The `.ics` is byte-identical after the MIME round trip | **CONFIRMED** | Attachment extracted by Python and compared to my generated bytes: equal, 1264 B (REQUEST) and 1193 B (CANCEL) |
| 31 | Multiple RFC 2047 encoded-words per subject; encoding varies per part | **CONFIRMED** | 8 and 10 encoded-words in the two raw subjects; `text/html` came out quoted-printable in one message and base64 in the other, same template. Do not assert on the encoding |
| 32 | Deterministic `Message-ID` | **CONFIRMED** | `Message-ID: <notif-9001@reserveflow.local>` verbatim in the raw message; the spike's replay of row `4711` produced the identical header both times |
| 33 | "`Date:` is UTC, matching the containers-run-UTC decision (05/V-06)" | **HALF-REFUTED** | `Date: Sun, 23 Aug 2026 23:34:24 +0000` — the header is correct. The **reason given is false**: `infra/compose.yml` sets `TZ: Asia/Bangkok` and `PGTZ: Asia/Bangkok` on postgres and `TZ: Asia/Bangkok` on mailpit, and `show timezone` in the live database returns `Asia/Bangkok`, `now()` returns `+07`. V-06 says "Node + Postgres ทำงานเป็น UTC". The containers do **not** run UTC; the `+0000` comes from Nodemailer, which always emits UTC |
| 34 | `notifications.provider_message_id` is mis-described in the spec | **CONFIRMED** | Spec line reads `provider_message_id text, -- Message-ID จาก SMTP relay`; what the relay returns is `250 2.0.0 Ok: queued as 7NmkdaFkeuEDsRN8IpQIlO` |
| 35 | 24/24 spike assertions pass | **CONFIRMED** | Re-ran: 24 PASS, 0 FAIL, exit 0 — but only after repairing the documented command (row 37) |
| 36 | User-supplied text is HTML-escaped | **CONFIRMED, with one gap** | `escapeHtml` covers `& < > " '` on every interpolated text node and there is a unit test. `cta.url` is interpolated into `href="${cta.url}"` **unescaped**. Not exploitable today (`PUBLIC_BASE_URL` + a uuid), but it is the one hole to close before any user-influenced URL reaches `layout()` |
| 37 | The published reproduce commands | **REFUTED, both reports** | T-008: `pnpm --dir apps/api exec tsx --env-file=../../.env spike/t008.ts` → `node: ../../.env: not found`, exit 9; the header-comment `--filter` variant fails identically. Works only from inside `apps/api`. T-009: `--import apps/api/node_modules/tsx/dist/loader.mjs` → `ERR_MODULE_NOT_FOUND: Cannot find package 'apps'`, exit 1; needs `./apps/…`. Both spikes pass once the commands are fixed |
| 38 | "`apps/api/test/email.test.ts` — 13 unit assertions" | **REFUTED as written** | `email.test.ts` has **10** test cases and 35 `expect()` calls. 13 is the whole `@reserveflow/api` suite (email 10 + `app.test.ts` 3), which is what `vitest` reported |
| 39 | "Status: GO" for the NFR-5 gate | **REFUTED by the report's own body** | The same document says the relay identity is a "blocking unknown that survives this spike", that definition (1) of *delivered* "must be accepted in writing by the requirement owner", that "this spike does not close it" (IR-01), and that no client round trip was performed. A gate whose acceptance criterion is still unagreed is not closed |
| 40 | "Tree status at hand-off: all green" | **CONFIRMED** | Exit 0 on all four, forced uncached |

**Not re-verified** (out of the six in scope, recorded so nobody reads silence as confirmation):
Δ7 (`adminRoles` without `roles` 403s every admin endpoint) — the mitigation is already in
`src/auth/index.ts` and was not removed to reproduce the failure; Δ6's `rememberMe:false`
branch; `session.updateAge` sliding behaviour; T-009's failure-mode table (relay down, 535,
`550` recipient) — none of it was exercised, it is a design note, not evidence; and the
client-side round trip, which T-009 correctly flags as UAT work.

---

## 2 · Schema-freeze inputs

### 2a · The definitive list of what better-auth owns

Re-derived by running `getAuthTables(auth.$context.options)` in this review, with the
`modelName`/`fields` mapping from `apps/api/src/auth/index.ts` applied. `id` is implicit on
every model and is **not** generated by better-auth (`advanced.database.generateId: false`),
so Postgres' `gen_random_uuid()` DEFAULT supplies it.

**`user` → `users`** — `full_name` (NOT NULL), `email` (NOT NULL, UNIQUE), `email_verified`
(NOT NULL, default, `input:false`), `image` (null), `created_at` (NOT NULL, default),
`updated_at` (NOT NULL, default, onUpdate), `role` (null, `input:false`), `banned` (null,
default, `input:false`), `ban_reason` (null, `input:false`), `ban_expires` (null,
`input:false`), `employee_code` (NOT NULL, UNIQUE), `department_id` (NOT NULL), `mobile`
(null), `status` (null, default `INVITED`). Declared indexes: **none**.

**`session` → `sessions`** — `expires_at` (NOT NULL), `token` (NOT NULL, UNIQUE), `created_at`
(NOT NULL, default), `updated_at` (NOT NULL, onUpdate), `ip_address` (null), `user_agent`
(null), `user_id` (NOT NULL, FK `user.id` ON DELETE CASCADE), `impersonated_by` (null,
`input:false`). Declared indexes: **none** — `sessions_user_idx` and `sessions_expires_idx`
are ours to keep.

**`account` → `accounts`** — `issuer` (**NOT NULL**), `account_id` (NOT NULL), `provider_id`
(NOT NULL), `user_id` (NOT NULL, FK `user.id` ON DELETE CASCADE), `access_token` (null),
`refresh_token` (null), `id_token` (null), `access_token_expires_at` (null),
`refresh_token_expires_at` (null), `scope` (null), `password` (null — the argon2id hash lives
here), `created_at` (NOT NULL, default), `updated_at` (NOT NULL, onUpdate). Declared index:
`UNIQUE (issuer, accountId)`. Credential rows carry `issuer='local:credential'`,
`account_id=users.id`, `provider_id='credential'` — confirmed in `psql`.

**`verification` → `verifications`** — `identifier` (NOT NULL), `value` (NOT NULL),
`expires_at` (NOT NULL), `created_at` (NOT NULL, default), `updated_at` (NOT NULL, default,
onUpdate). Declared indexes: **none**.

**Ours alone, never read or written by better-auth**: `users.failed_logins`, `locked_until`,
`last_login_at`, `disabled_at`, `created_by`, and the whole of `password_setup_tokens`. They
must stay nullable or carry a DB default, because better-auth's INSERT never mentions them.
No `rateLimit` table (`rateLimit.storage !== 'database'`).

### 2b · Every conflict with the §06 DDL

Ordered by whether §06 can be frozen without resolving it.

| # | Where | Conflict | Proof |
|---|---|---|---|
| **S1** | §6.2 `accounts` | No `issuer` column, no `UNIQUE (issuer, account_id)`. Add `issuer text NOT NULL` + `CREATE UNIQUE INDEX accounts_issuer_account_id_idx ON accounts (issuer, account_id)` | `issuer` appears **0 times** in the spec. Dropped it from the live table → sign-in `42703: column "issuer" does not exist` |
| **S2** | §6.2 `accounts` | `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope` exist **only inside a `--` comment** in the spec's DDL. better-auth's `account` model declares all six and the adapter `SELECT`s them by name | Dropped exactly those six from the live table → sign-in `42703`, query text `select "id","user_id","issuer","account_id","provider_id","password","access_token",…`. **T-008 does not flag this**; its Δ1 names only `issuer` |
| **S3** | §6.11 config list | The spec freezes only `user.modelName`, `user.fields.name`, the three other `modelName`s and `generateId:false`. Without the rest of the `fields` maps that `src/auth/index.ts` actually carries — `user.emailVerified/createdAt/updatedAt`, all six `session.*`, all ten `account.*`, all three `verification.*` — better-auth addresses camelCase columns (`emailVerified`, `userId`, `expiresAt`, `ipAddress`, `accountId`, `providerId`, `accessTokenExpiresAt`, …) that §06 never creates | Same `42703` class as S1/S2. The working config is `apps/api/src/auth/index.ts`; freeze *that file*, not the four-item list in §6.11 |
| **S4** | §6.11 config list | `admin({ defaultRole, adminRoles })` alone leaves the plugin's own fields unmapped → columns `banReason`, `banExpires`, `impersonatedBy`. Needs `schema: { user: { fields: { banReason: 'ban_reason', banExpires: 'ban_expires' } }, session: { fields: { impersonatedBy: 'impersonated_by' } } }` | Present in the shipped config; §6.11 does not mention it |
| **S5** | §6.11 config list | `adminRoles: ['ADMIN']` alone is validated case-insensitively but looked up by exact key → every admin endpoint answers "not allowed". Needs `roles: { ADMIN: adminAc, EMPLOYEE: userAc, FACILITY: userAc }` | Present in the shipped config; not re-tested by removing it |
| **S6** | §6.2 `users` + §07 | `users_banned_mirror` makes `auth.api.banUser`/`unbanUser` fail. Keep the CHECK; 404 both endpoints; make `POST /admin/users/:id/deactivate` the only writer of `banned` | `23514 users_banned_mirror` observed |
| **S7** | §6.2 preamble + `0000_extensions_and_functions.sql` | `CREATE EXTENSION citext` / `btree_gist` cannot run as `rf_owner`. Drop both lines from `0000_…sql`; they belong in `infra/db/init/01-roles.sql` (already applied) | `permission denied to create extension "pg_trgm"` as `rf_owner`; both extensions present, created by the bootstrap superuser |
| **S8** | `0006_grants.sql` vs `infra/db/init/01-roles.sql` | `01-roles.sql` already runs `alter default privileges for role rf_owner … grant select, insert, update, **delete** … to rf_app`. A second `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE` **does not shrink** that ACL — an explicit `ALTER DEFAULT PRIVILEGES FOR ROLE rf_owner IN SCHEMA public REVOKE DELETE ON TABLES FROM rf_app` is required, or `delete` must come out of `01-roles.sql`. Otherwise §6.11's own schema definition-of-done item (5), "`DELETE FROM bookings` as `rf_app` → permission denied", fails | Fresh table created as `rf_owner` arrives with `rf_app: DELETE, INSERT, SELECT, UPDATE` |
| **S9** | §6.2 `sessions.expires_at` comment | "7 วัน sliding / 30 วัน remember-me" is not reachable through better-auth's public API | `rememberMe:true` → `Max-Age=604800`. Redefine remember-me, or T-012 re-issues the cookie after sign-in |
| **S10** | §6.2 `departments` vs `src/auth/schema.ts` | Spec: `code text CHECK (code ~ '^[A-Z0-9_]{2,16}$')`, plus `active boolean NOT NULL DEFAULT true` and a `set_updated_at` trigger. Spike schema: `citext('code')`, no `active`, no trigger. Reconcile when T-009 moves the table to `src/db/schema/` | Both files read side by side |
| **S11** | §6.11 file layout | Spec puts the better-auth schema at `apps/api/src/db/schema/auth.ts`; the spike put it at `apps/api/src/auth/schema.ts` | — |
| **S12** | §6.5 `notifications` | `provider_message_id text -- Message-ID จาก SMTP relay` is wrong; store the relay's queue id from the 250 line | Spec text vs `250 2.0.0 Ok: queued as …` |
| **S13** | `infra/compose.yml` vs V-06 | V-06 fixes "Node + Postgres ทำงานเป็น UTC"; the compose file sets `TZ`/`PGTZ` to `Asia/Bangkok` on postgres and `TZ` on mailpit. Every `now()::date`, `date_trunc('day', …)` and `timestamp`-cast in §06 reporting resolves in the session zone, so this must be an explicit decision before the freeze, not an accident | `show timezone` → `Asia/Bangkok`; `now()` → `…+07` |
| S14 | §6.2 `users` | Informational — better-auth declares `role`, `banned`, `status` nullable/`input:false`; §06's `NOT NULL DEFAULT` is stricter and works because the plugin's create hook always supplies a value. **No change; do not "fix" it toward the library** | `getAuthTables()` output |
| S15 | §6.2 indexes | Informational — better-auth declares **no** indexes on `session` or `verification`. `sessions_user_idx`, `sessions_expires_idx`, `verifications_identifier_idx` are ours; keep them, but do not describe them as better-auth's | `indexes: []` for both models |

Nothing in `bookings`, `notifications` (beyond S12), or `audit_logs` is affected.
`password_setup_tokens` as specified in §6.2 is correct exactly as written and its single-use
guarantee now holds under real concurrency.

---

## 3 · Blocking before W1

1. **S1 + S2 — the §06 `accounts` DDL is unrunnable as written.** Seven columns, not one.
   Proven twice with `42703`. `0001_departments_auth.sql` cannot be generated against the
   frozen text until this is fixed.
2. **S3 + S4 + S5 — freeze the config file, not the four-item list.** §6.11's snippet omits
   every field map except `user.fields.name`. Make `apps/api/src/auth/index.ts` the normative
   artefact and have §6.11 point at it.
3. **S8 — the `DELETE` default-privilege contradiction.** It silently defeats §10.6's
   "no DELETE by default" and fails §6.11's own schema definition-of-done. One line, but it
   has to land in the same migration wave as `0006_grants.sql`.
4. **Google Workspace vs Microsoft 365 (D-23).** Unowned, unanswered, on the W4/W6 critical
   path, and the difference between "edit `.env`" and "build XOAUTH2 token handling". T-009 is
   right that this is the blocking unknown; it needs an owner and a date, not another spike.
5. **NFR-5's definition of *delivered* (IR-01).** T-009's header says `GO`; its body says the
   definition "must be accepted in writing by the requirement owner" and "this spike does not
   close it". Get the sign-off, then the gate closes. Until then the header overstates.
6. **S13 — container timezone.** Decide before the schema freeze, because §06's date-bucketed
   reporting depends on it.
7. **Fix the two reproduce commands** (row 37). Published evidence that does not re-run is
   evidence nobody will check twice.

## 4 · Safe to proceed

- **Adopt better-auth 1.7.1.** Every mechanism the decision rests on was re-proven
  independently: Postgres-backed sessions we can delete, argon2id we control end to end,
  `createUser` with no password, `getSession` with no cache in front of it.
- **Deactivate = one transaction that sets `status`/`banned`/`disabled_at` *and* deletes the
  session rows.** Flipping the flag alone leaves the user signed in for up to seven days —
  reconfirmed here. Keep the `users.status` join in `requireAuth` as belt and braces.
- **`password_setup_tokens` redeem as a single `UPDATE … WHERE used_at IS NULL AND expires_at
  > now() RETURNING …`.** Now proven race-safe under genuine concurrency, not just asserted.
  Carry it into `TC-AUTH-009` — but replace the vacuous `timingSafeEqual(a, a)` assertion.
- **Keep `src/email/ics.ts`, `mailer.ts`, `templates.ts` as the T-040/T-041 seam.** The `.ics`
  is RFC-correct on every axis I could check offline, byte-stable through MIME, and Thai
  survives two independent decoders.
- **Keep `ical-generator` pinned at 11.1.0** with the trailing-CRLF workaround, and re-check
  it if the pin ever moves.
- **Δ4 is already fixed** in `infra/db/init/01-roles.sql`; no further action.
- **Delete `apps/api/spike/*` at the end of W1**, as both reports say. Nothing in `src/` should
  be deleted with them.
- Still genuinely open and correctly flagged by T-009: the manual client round trip (Google
  Calendar, Outlook desktop/web, iOS) belongs on the T-041/UAT checklist. No offline iCalendar
  parser is installed on this machine either, so this review could not close it.
