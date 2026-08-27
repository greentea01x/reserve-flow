# T-009 — SMTP + calendar-invite spike (Mailpit)

**Status:** GO. Every acceptance point was proven against the real Mailpit on `127.0.0.1:1025`,
not simulated. 24/24 assertions pass.
**Gate:** NFR-5 (email + `.ics` delivery > 99 %) and every row of the notification matrix (03 §3.7).
**Blocking unknown that survives this spike:** the company relay (Google Workspace vs Microsoft 365)
— see [Swapping Mailpit for the real relay](#swapping-mailpit-for-the-real-relay).

## What landed

| Path | Purpose |
|---|---|
| `apps/api/src/email/ics.ts` | RFC 5545/5546 `REQUEST` and `CANCEL` invites via `ical-generator@11.1.0` |
| `apps/api/src/email/mailer.ts` | Nodemailer SMTP transport, deterministic `Message-ID`, `MAIL_FROM` helpers |
| `apps/api/src/email/templates.ts` | Thai HTML + plain-text bodies for `booking.confirmed` and `booking.auto_released` |
| `apps/api/test/email.test.ts` | 13 unit assertions, no network — runs in `pnpm test` |
| `apps/api/spike/t009-smtp-ics.ts` | Throwaway end-to-end prover. Delete when T-040/T-041 land. |

Reproduce:

```
node --env-file=.env \
  --import apps/api/node_modules/tsx/dist/loader.mjs \
  --conditions=development \
  apps/api/spike/t009-smtp-ics.ts
```

It wipes the Mailpit store, sends three messages, reads them back through
`http://127.0.0.1:8025/api/v1/*`, and writes the two `.ics` files plus `evidence.json` to
`$SPIKE_OUT` (default `/tmp/t009`). Exit code is non-zero if any assertion fails.

## 1. Thai multipart mail actually renders

Three sends, all `250` accepted, all readable back through Mailpit's decoder (an independent MIME
implementation — this is not just "we said UTF-8 and got a 250").

```
250 2.0.0 Ok: queued as 4ydG5qkspK2VAjuO5QdTL5     booking.confirmed     → owner
250 2.0.0 Ok: queued as 29crL9RYCBpML5UEQRLrxn     booking.auto_released → owner
250 2.0.0 Ok: queued as 07whuNITAcDeiTG0u4A2GR     booking.confirmed (replay of the same row)
```

MIME tree that Nodemailer produced (from the raw source, `/api/v1/message/{id}/raw`):

```
multipart/mixed
├── multipart/alternative
│   ├── text/plain;    charset=utf-8   (Content-Transfer-Encoding: base64)
│   ├── text/html;     charset=utf-8   (quoted-printable)
│   └── text/calendar; charset=utf-8; method=REQUEST   (quoted-printable)
└── application/ics; name=invite.ics   (base64, Content-Disposition: attachment)
```

### Encoding findings

- **Bodies survive intact.** Mailpit's decoded `Text` and `HTML` contain the Thai verbatim
  (`เรียน คุณสมชาย ใจดี`, `ห้องประชุมฮอไรซัน ชั้น 12`) with zero U+FFFD replacement characters.
- **Subjects fold into multiple RFC 2047 encoded-words.** A Thai subject is ~3 bytes/char, so a
  one-line subject becomes eight `=?UTF-8?B?…?=` words across eight header lines. Mailpit rejoins
  them correctly. Nothing to do, but do not write a header parser that assumes one encoded-word.
- **Display names in `To:` are encoded too** (`=?UTF-8?B?4Liq4Lih4LiK4Liy4Lii…?=`), so Thai
  recipient names are safe.
- **Nodemailer picks base64 or quoted-printable per part, per message**, whichever is shorter. The
  same template came out quoted-printable in one message and base64 in another. Both round-trip;
  do not assert on the encoding anywhere.
- **The `.ics` is byte-identical after the round trip.** The `application/ics` attachment pulled
  back out of Mailpit compares `===` against the string we generated, for both REQUEST and CANCEL.
- **Line folding never splits a Thai codepoint.** `ical-generator` counts UTF-8 octets (and
  surrogate pairs) when folding at 75 octets. Verified: no U+FFFD, and unfolding restores
  `LOCATION:ห้องประชุมฮอไรซัน ชั้น 12` exactly — including the space that sits right at a fold point,
  the classic place where a naive unfolder eats a character.
- **`Date:` is UTC** (`Date: Sun, 23 Aug 2026 23:19:40 +0000`), matching the "containers run UTC"
  decision (05/V-06). Local time appears only in the rendered body.

Thai time rendering uses `Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok' })`, which gives
the Buddhist era for free: *"วันพฤหัสบดีที่ 27 สิงหาคม พ.ศ. 2569 เวลา 13:00–14:30 น."* — no date
library needed.

## 2 & 3. The calendar invites

Fixture: booking `1f3c2b6e-9d47-4a51-9f0a-2b8e7c5d1a04`, 2026-08-27 **13:00–14:30 Asia/Bangkok**,
owner สมชาย ใจดี, two attendees, `bookings.version` 3 at CONFIRMED and 4 after the sweep flips it
to AUTO_RELEASED.

### REQUEST (`booking.confirmed`)

Exact bytes, CRLF-terminated (shown with LF here; `DTSTAMP` is generation time):

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ReserveFlow//reserveflow//TH
METHOD:REQUEST
BEGIN:VEVENT
UID:1f3c2b6e-9d47-4a51-9f0a-2b8e7c5d1a04@reserveflow.local
SEQUENCE:3
DTSTAMP:20260823T232604Z
DTSTART:20260827T060000Z
DTEND:20260827T073000Z
SUMMARY:ประชุมวางแผนงบประมาณไต
 รมาสที่ 4 (ฝ่ายการเงิน) · ห้อ
 งประชุมฮอไรซัน ชั้น 12
LOCATION:ห้องประชุมฮอไรซัน ชั้น 
 12
DESCRIPTION:ผู้จอง: สมชาย ใจดี (ฝ่าย
 การเงินและบัญชี)\nผู้เข้าร
 ่วม 8 คน\nรายละเอียด: http://localhost:5173/
 bookings/1f3c2b6e-9d47-4a51-9f0a-2b8e7c5d1a04
ORGANIZER;CN="สมชาย ใจดี";SENT-BY="mailto:no-reply@reser
 veflow.local":mailto:somchai.jaidee@reserveflow.local
ATTENDEE;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL;PARTSTAT=NEEDS-ACTION;RSVP
 =TRUE;CN="ปรียา วงศ์สว่าง":MAILTO:preeya.wongs
 awang@reserveflow.local
ATTENDEE;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL;PARTSTAT=NEEDS-ACTION;RSVP
 =TRUE;CN="อาทิตย์ ศรีสุข":MAILTO:arthit.srisuk@r
 eserveflow.local
URL;VALUE=URI:http://localhost:5173/bookings/1f3c2b6e-9d47-4a51-9f0a-2b8e7
 c5d1a04
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR
```

### CANCEL (`booking.auto_released`, owner + attendees)

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ReserveFlow//reserveflow//TH
METHOD:CANCEL
BEGIN:VEVENT
UID:1f3c2b6e-9d47-4a51-9f0a-2b8e7c5d1a04@reserveflow.local
SEQUENCE:4
DTSTAMP:20260823T232604Z
DTSTART:20260827T060000Z
DTEND:20260827T073000Z
SUMMARY:ประชุมวางแผนงบประมาณไต
 รมาสที่ 4 (ฝ่ายการเงิน) · ห้อ
 งประชุมฮอไรซัน ชั้น 12
LOCATION:ห้องประชุมฮอไรซัน ชั้น 
 12
DESCRIPTION:ผู้จอง: สมชาย ใจดี (ฝ่าย
 การเงินและบัญชี)\nผู้เข้าร
 ่วม 8 คน\nรายละเอียด: http://localhost:5173/
 bookings/1f3c2b6e-9d47-4a51-9f0a-2b8e7c5d1a04
ORGANIZER;CN="สมชาย ใจดี";SENT-BY="mailto:no-reply@reser
 veflow.local":mailto:somchai.jaidee@reserveflow.local
ATTENDEE;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL;CN="ปรียา วง
 ศ์สว่าง":MAILTO:preeya.wongsawang@reserveflow.local
ATTENDEE;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL;CN="อาทิตย์ 
 ศรีสุข":MAILTO:arthit.srisuk@reserveflow.local
URL;VALUE=URI:http://localhost:5173/bookings/1f3c2b6e-9d47-4a51-9f0a-2b8e7
 c5d1a04
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR
```

That is the full set a real client needs to remove the event: same `UID`, higher `SEQUENCE`,
`METHOD:CANCEL` in both the VCALENDAR **and** the MIME `Content-Type`, and `STATUS:CANCELLED`.
`PARTSTAT`/`RSVP` are dropped on CANCEL — an RSVP request is meaningless for an event being deleted.

### The time-zone decision, and why there is no `TZID`

`DTSTART:20260827T060000Z` **is** 13:00 in Asia/Bangkok. Bangkok is a fixed UTC+07:00 offset with no
DST, so a UTC instant is unambiguous and every client renders it back in the viewer's local zone.
Consequences:

- The `+07:00` form the original deck proposed is **not a legal RFC 5545 DATE-TIME** at all
  (R-35 / V-06). It is now impossible to emit: `ics.ts` never sets `timezone` or `floating`, which
  is the only way `ical-generator` would produce a `TZID` parameter or a floating local time.
- **No `VTIMEZONE` component is needed**, so we never ship a tz database inside the invite and can
  never ship a stale one.
- The conversion boundary is the DB: `timestamptz` in, `Date` out, formatted for humans only at the
  edge. The unit test pins `13:00+07:00 → 20260827T060000Z` so a regression here fails `pnpm test`.

### `ORGANIZER` is the owner — the review finding, closed

`ORGANIZER` carries the **booking owner**, with `SENT-BY="mailto:no-reply@…"` naming the mailbox
that actually transmitted it. This is the whole reason the owner must also receive the CANCEL
(D-30b / C1-14 / C2-02): a calendar client keys the event off `UID` + `ORGANIZER`, so if only the
attendees get the CANCEL, the *organiser's own* calendar keeps a phantom booking for a room that has
already been released. `booking.auto_released` therefore goes to owner **and** attendees with the
CANCEL attached; `booking.auto_released_admin` is a separate `template_key` with an explanatory body
and no `.ics`, which also keeps the `notifications_dedupe` key from colliding when an admin is also
the owner.

Without `SENT-BY`, Exchange in particular is prone to ignoring an iMIP message whose `ORGANIZER`
does not match the SMTP sender. This costs one property and removes that failure mode.

## 4. Structural validation of the `.ics`

Validated in the spike and re-asserted in `apps/api/test/email.test.ts`:

| Check | Result |
|---|---|
| CRLF everywhere, no bare LF/CR | pass |
| File terminated with CRLF after `END:VCALENDAR` | pass **after a fix — see below** |
| Every line ≤ 75 octets (measured in octets, not characters) | pass |
| Continuation lines start with exactly one SP; unfolding restores the original strings | pass |
| No U+FFFD anywhere (folding did not split a UTF-8 sequence) | pass |
| `VCALENDAR` outermost; required properties `VERSION`, `PRODID`, `METHOD`, `BEGIN/END:VEVENT`, `UID`, `SEQUENCE`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `ORGANIZER`, `ATTENDEE` | pass |
| `DTSTART`/`DTEND`/`DTSTAMP` match `^\d{8}T\d{6}Z$`, no `TZID` parameter | pass |
| `UID` = `<booking id>@<domain>`, identical across REQUEST and CANCEL | pass |
| `SEQUENCE` equals `bookings.version` (3 → 4) | pass |
| `ORGANIZER` is the owner and carries `SENT-BY` | pass |
| Exactly one `ATTENDEE` line per invitee | pass |
| CANCEL carries `METHOD:CANCEL` + `STATUS:CANCELLED` | pass |

**Library bug found and worked around:** `ical-generator@11.1.0` emits `END:VCALENDAR` with **no
trailing CRLF**. RFC 5545 §3.1 terminates every content line with CRLF, and strict parsers are
entitled to reject the last line. `buildCalendarInvite` appends it when missing (one line, with a
comment). Pinned version, so this cannot silently change.

**Not verified: opening the file in a real client.** macOS Calendar has no non-interactive import
path — `open -a Calendar file.ics` raises a GUI dialog and would write into the user's real calendar,
which is not something a spike should do. No offline iCalendar parser (`icalendar`, `ical.js`,
`icalBuddy`) is installed on this machine either. The validation above is therefore
specification-driven, not client-driven. **Before go-live, UAT must include one manual round trip per
target client** — send REQUEST, accept, send CANCEL, confirm the event disappears — on Google
Calendar, Outlook desktop/web, and iOS Calendar. That belongs on the T-041 / UAT checklist.

## 5. The two templates

`booking.confirmed` (+ REQUEST `.ics`) and `booking.auto_released` (+ CANCEL `.ics`, to the owner)
render as Thai HTML plus a plain-text alternative, one CTA each, per 03 §3.7.

Notes for T-041:

- User-controlled strings (booking title, room name, person names) are HTML-escaped before they
  reach the body. There is a unit test for it. Keep that when the templates are rewritten.
- The spec assigns react-email to T-041. It is **not installed**, and these two templates needed
  nothing beyond template literals. Adding React + `@react-email/components` for eleven mostly-text
  Thai emails is three dependencies and a build step for no visible gain — worth a deliberate
  decision rather than inheriting it. Either way `renderTemplate(key, data)` is the seam.
- Fonts: the HTML asks for `'Sarabun','Noto Sans Thai',sans-serif`. No webfont is embedded; Thai
  renders from system fonts in every mail client tested by Mailpit's preview.

## 6. What a transactional outbox needs from this transport

### Deterministic `Message-ID`

`outboxMessageId(id, domain)` → `<notif-{notifications.id}@{domain}>`, passed to Nodemailer as
`messageId` and confirmed present verbatim in the raw message. Proven: sending row `4711` twice
produced the identical header both times.

The domain is **derived from `MAIL_FROM`** (`mailDomainFrom()`), not configured separately, so
swapping relays cannot leave the `Message-ID` or the `.ics` `UID` pointing at a domain the new
relay's SPF/DKIM does not cover. No new environment variable.

Honest limit: **Mailpit does not deduplicate.** Three sends produced three stored messages, two of
them sharing `<notif-4711@…>`. Message-ID dedupe is a behaviour of the *receiving* mailbox
(Gmail and Exchange both do it); it makes at-least-once delivery tolerable, it does not make it
exactly-once. The dedupe we control is `notifications_dedupe` at enqueue time.

### Failure modes the worker must handle

| Mode | What the transport does | Worker response |
|---|---|---|
| Relay down / DNS failure | `sendMail` rejects (`ECONNREFUSED`, `ENOTFOUND`) | `attempts+1`, backoff, stay `PENDING` |
| Relay slow / hung socket | rejects after `connectionTimeout`/`greetingTimeout`/`socketTimeout` = 10 s each | same; the 10 s cap is why a row lock is never held long |
| Auth rejected (535) | rejects on connect — **every** row fails identically | backoff will burn all 8 attempts and DLQ the whole queue; alert on the *rate* of `FAILED`, not on single rows |
| One bad recipient | resolves with the address in `info.rejected`, `info.accepted` empty | permanent — mark `FAILED` immediately, do **not** retry a `550`. NFR-5 excludes invalid addresses from the denominator |
| Message too large / content rejected | rejects with a 5xx | permanent, same treatment |
| Crash after `250`, before `COMMIT` | nothing observable | row stays `PENDING`, resends with the same `Message-ID` — the duplicate the mailbox absorbs |

`info` gives exactly four useful fields: `messageId` (ours), `accepted`, `rejected`, `response`
(the relay's final line, e.g. `250 2.0.0 Ok: queued as 4ydG5qkspK2VAjuO5QdTL5`). Since the spec puts
one recipient per `notifications` row, the success condition is `accepted.length === 1 &&
rejected.length === 0`.

### What "delivered" can honestly mean

NFR-5 asks for > 99 %. **SMTP gives us handoff, not delivery.** The `250` proves the relay took
custody; nothing after that is visible without provider webhooks or log access, and a message can
still be silently dropped, spam-foldered, or bounced later. Two measurable definitions, in
descending honesty:

1. **`delivery = rows the relay accepted ÷ rows we attempted`, excluding invalid addresses.** This
   is computable from `notifications` alone: `SENT / (SENT + FAILED)` with permanent-invalid rows
   excluded from the denominator. It is what the spec already commits to (NFR-5), and it is what
   this spike measured: 3/3.
2. **Plus asynchronous bounce watching on the `MAIL_FROM` mailbox.** Bounces arrive minutes to hours
   later, out of band, and are counted manually. Not a live metric.

Anything stronger — "reached the inbox", "was opened" — requires a provider with a delivery-event
API (SES/SendGrid/Postmark webhooks, or Graph API message tracking on M365). We do not have one and
should not pretend to. **Definition (1) must be accepted in writing by the requirement owner** —
this is the open item already recorded as 12 §12.2 item 11 (IR-01), and this spike does not close it.

The admin outbox screen plus the retry button (07) is the operational answer to the residual
percentage: a human can see and re-drive every row that did not reach `SENT`.

## Swapping Mailpit for the real relay

**Still UNKNOWN: whether the company is on Google Workspace or Microsoft 365** (D-23, question 3 in
02 §2.2, owner = company IT). This is on the critical path for W4 (email) and W6 (staging deploy).

### If the relay speaks SMTP AUTH (Google Workspace, or M365 with SMTP AUTH still enabled)

Only `.env` changes. **No code change** — `createMailer` already switches implicit TLS on port 465,
requires STARTTLS for every non-loopback host, and only sends `AUTH` when `SMTP_USER` is non-empty.

| Variable | Mailpit today | Real relay |
|---|---|---|
| `SMTP_HOST` | `127.0.0.1` | `smtp-relay.gmail.com` / `smtp.office365.com` (or the internal relay) |
| `SMTP_PORT` | `1025` | `587` (STARTTLS) or `465` (implicit TLS) |
| `SMTP_USER` | *(empty — no AUTH)* | service account / app password identity |
| `SMTP_PASS` | *(empty)* | secret, from the managed secret store, never in the image |
| `MAIL_FROM` | `ReserveFlow <no-reply@reserveflow.local>` | `ReserveFlow <no-reply@<company domain>>` — **must** be a domain covered by the relay's SPF/DKIM, and it doubles as the bounce mailbox someone has to actually watch |
| `MAIL_REPLY_TO` | `facility@reserveflow.local` | the real facility mailbox |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | the real origin — it is baked into every CTA link and into the `.ics` `URL` |

`MAIL_FROM` is load-bearing twice over: it sets the `.ics` `UID` domain and the `Message-ID` domain.
Changing it changes every future `UID`; **do not change it after bookings exist in production**, or
already-sent invites will no longer match their own CANCELs.

Also required on the DNS side, by company IT, not by us: SPF include for the relay, DKIM signing for
the sending domain, and a DMARC record that does not quarantine the new sender.

### If it is Microsoft 365 — schedule risk

Microsoft has been disabling Basic Authentication for client SMTP submission tenant-wide. If SMTP
AUTH is off, **none of the table above helps**, and there are two real options:

1. **A high-volume connector / internal relay** — M365 accepts anonymous SMTP from a fixed source IP
   on port 25. `SMTP_USER`/`SMTP_PASS` stay empty and only `SMTP_HOST`/`SMTP_PORT` change, but it
   requires the VM to have a static IP that IT is willing to allowlist on the connector. Fastest
   path if IT will do it.
2. **OAuth 2.0 (XOAUTH2) client-credentials submission** — this needs an Entra app registration,
   admin consent, a token cache, and a scheduled token refresh in the worker. Nodemailer supports
   `auth.type: 'OAuth2'`, so it is not a rewrite, but it **is** new code, new secrets handling, and a
   dependency on a tenant admin who is not on this project. Nodemailer's SMTP OAuth path is also not
   covered by this spike at all.

Option 2 is a **schedule risk against W4**, and the reason NFR-5 says to prove the real path in W0.
Escalate the Workspace-vs-M365 question now; if the answer is M365, get IT to confirm connector vs
OAuth in the same conversation, because the two have very different costs.

Until the answer arrives: Mailpit stays the local and staging transport (RK-10 already fixes staging
to Mailpit only), and `WORKER_ENABLED=false` remains the kill switch.

## Deltas and follow-ups for the spec

1. **`notifications.provider_message_id` is mis-described.** The spec comments it as "Message-ID จาก
   SMTP relay". The relay does not give us a Message-ID — we *set* one, deterministically, before
   sending. What the relay returns is a queue id inside the 250 line
   (`250 2.0.0 Ok: queued as 4ydG5qkspK2VAjuO5QdTL5`), and that is the only handle for tracing a
   message in the relay's own logs. Recommend: store the 250 response line (or the parsed queue id)
   in `provider_message_id`, and drop the idea that it holds a Message-ID — that value is already
   reconstructible from `notifications.id`.
2. **No `MAIL_DOMAIN` env var is needed** (derive from `MAIL_FROM`). `apps/api/src/env.ts` needs no
   change for T-040.
3. **react-email for T-041 is worth re-deciding** — see §5.
4. **`ical-generator` 11.1.0 misses the final CRLF.** Worked around in `ics.ts`; re-check if the pin
   ever moves.
5. **Client round-trip UAT is not covered by any existing test case.** TC-EMAIL-014 tests our output;
   nothing tests that Google/Outlook/iOS actually delete the event on CANCEL. Add a manual UAT step.

## Tree status at hand-off

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — all green.

For part of this spike, `typecheck`/`build` failed on `apps/api/src/auth/index.ts`
(`Argument of type 'unknown' is not assignable to parameter of type 'DB'`). That file belongs to
T-008 and was being edited concurrently — the error moved from line 59 to 65 to 66 across three
runs — so it was left alone rather than fixed into a conflict, and the T-008 author has since
resolved it. Everything T-009 added also typechecks clean in isolation under the project's flags.

Two pre-existing lint errors in `apps/api/spike/t008.ts` were fixed in passing, because they blocked
`pnpm lint` for the whole repo: an unused `hashPassword` import, and a floating promise in
`.finally(async …)` (rewritten as top-level `try/catch/finally`, which also stops the process from
being able to exit before the cleanup runs).
