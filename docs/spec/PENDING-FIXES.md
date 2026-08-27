# Pending fixes — apply after the restructure build completes

## PF-01 · remember-me: 30 days is not implementable (BLOCKING a contract lie)

**Evidence.** `docs/spikes/W0-gate-review.md` row 22, re-verified against better-auth 1.7.1
running on live PostgreSQL: `rememberMe: true` yields `Max-Age=604800` (7 days), not 30. The
30-day figure was never achievable through better-auth's public API. What better-auth *does*
give natively is the other axis: `rememberMe: false` issues a **browser-session cookie** (dies
when the browser closes), `true` issues a **persistent cookie** for the configured session
lifetime.

**Decision.** Keep the checkbox, redefine it honestly:

> `remember_me: true` → persistent `__Host-sid` cookie for the 7-day sliding session.
> `remember_me: false` → browser-session cookie; closing the browser signs the user out.

Rationale: it is what the library actually does, it costs zero custom code, the login checkbox
from the UI reference keeps a real meaning, and for an internal tool a 30-day session was the
weaker security posture anyway. Rejected alternatives: raising the global session to 30 days
(applies to everyone, including shared machines); building custom session extension (real work
for a cosmetic gain).

**Every site that must change** (verified with Python — note that most of the 37 `30 วัน`
matches in the sections are the *advance-booking window* or *backup retention* and MUST NOT be
touched; only the session ones below):

| # | File | What it says now | Change to |
|---|---|---|---|
| 1 | `00-overview.md` at-a-glance | `session 7 วัน (จำฉันไว้ 30 วัน)` | `session 7 วัน (จำฉันไว้ = คุกกี้ค้างเครื่อง; ไม่ติ๊ก = ออกเมื่อปิดเบราว์เซอร์)` |
| 2 | `02-requirements.md` BR-10 | `... จำฉันไว้ 30 วัน` | same wording as above |
| 3 | `03-user-flows.md` flow 3 / login step | `remember_me` implying 30 d | keep the field, fix any 30-day text |
| 4 | `06-api-contract.md` C-03 | `TTL 7 วันแบบ sliding, remember_me = 30 วัน` | `TTL 7 วัน sliding; remember_me = persistent vs browser-session cookie` |
| 5 | `06-api-contract.md` sign-in body | `remember_me?: boolean` | unchanged (it is real) — document the semantics |
| 6 | `06-api-contract.md` `GET /me` | returns `session.remember_me` | drop it from the response; the client does not need it. If kept, it means persistent-vs-session, not 30 days |
| 7 | `08-implementation-plan.md` T-012 DoD | asserts 30-day remember-me | assert the cookie-type difference instead |
| 8 | `09-devops-security-qa.md` S-01 | session/cookie policy line | align |
| 9 | Appendix (decisions) | the original 30-day business rule | record as amended, with this reason |

Also confirm (do not assume): §06 U-04 deactivate already deletes session rows in the same
transaction — the W0 finding that `banned=true` alone does not revoke. If it does, no change;
say so explicitly in the review log.

## PF-02 · provenance paths

`docs/review/` and `docs/build/` now hold the nine review artifacts the appendix cites by
filename, the render pipeline, and the seven research notes. The appendix must cite these
in-repo paths, not `/private/tmp/...` scratchpad paths, which are wiped.

`docs/build/research/uiux.md` carries 42 UX fixes of which 21 made the document — the rest are
a real backlog. Point at it from the UI section rather than leaving them orphaned.

## PF-03 · do not regenerate the mockups

`docs/build/mockups-v1-full.html` is a balanced-tag extraction with four deliberate fixes
(kicker renumbered, self-registration link replaced with "ติดต่อ Admin", three dead
`จัดการห้อง` links wired to `adminRooms`, `ผู้ใช้งาน` link added). Reuse the file; regenerating
from the original reverts all four.

## PF-04 · U-04 deactivate — VERIFIED (no change needed)

Confirmed, not assumed. Three independent statements in the working copy all delete the session
rows inside the transaction rather than relying on the `banned` flag:

- `06-api-contract.md` U-04 — one tx: lock `users:last-admin` → `SELECT … FOR UPDATE` the user
  → room resolver under the user lock → … → delete sessions.
- `07-folder-structure.md` `users/` module contract — "deactivate = FOR UPDATE user → delete
  sessions (tx เดียวกัน) + cancel future bookings".
- `08-implementation-plan.md` T-014 DoD — "`FOR UPDATE` user → ลบ sessions ใน tx".

Observable behaviour is specified too: `status=DISABLED` ⇒ sessions deleted ⇒ an old cookie gets
`401 UNAUTHENTICATED`, while a surviving session or fresh sign-in gets `403 ACCOUNT_DISABLED`
because the guard joins `users.status` on every request. The design was never exposed to the
"banned flag does not revoke" failure the spike found. Record as verified with those cites in
the review log.

## PF-05 · keep `users_banned_mirror` — reject the "drop the mirror" suggestion

Suggested: drop the `banned` mirror so `users.status` is the single source of truth, removing
the `auth.api.banUser` conflict instead of working around it. The instinct (one source of truth)
is right; the proposed mechanism makes it worse. Examined and rejected:

- The **column cannot go**. better-auth's admin plugin declares `banned` / `ban_reason` /
  `ban_expires` and its adapter `SELECT`s them by name — dropping the column reproduces the
  `42703` failure class the `issuer` finding just cost us.
- **Dropping the CHECK is actively unsafe.** `CHECK (banned = (status = 'DISABLED'))` is what
  made `auth.api.banUser` fail loudly. Without it that call succeeds, setting `banned=true`
  while `status` stays `ACTIVE` — and since our guard reads `users.status`, the "banned" user
  keeps working. An admin would believe they had disabled someone who is still signed in. A
  silent security hole is a worse trade than a route we do not expose.
- A `GENERATED ALWAYS AS (status = 'DISABLED') STORED` column would be provably drift-free, but
  better-auth's INSERT path would then hit `428C9 cannot insert into generated column`. Not
  worth the risk for a column nothing reads.

**Decision: keep the column and the CHECK; keep `banUser`/`unbanUser` 404'd; make our
`POST /admin/users/:id/deactivate` the only writer of `banned`.** The constraint is not a
workaround — it is the thing that proved the two states can never drift, and it caught the
library's attempt to drift them on the first run. Document `banned` as a mirror maintained
solely by the deactivate transaction, with `users.status` as the semantic source of truth.
