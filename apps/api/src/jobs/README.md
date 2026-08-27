# jobs

In-process scheduler (`server.ts` → `startScheduler`): `booking.sweep` every 60s,
`notify.send` every 10s (plus a post-commit `kick()` from booking mutations, wired through
`createApp`'s `kickOutbox`), and `maintenance.daily` at 03:15 Asia/Bangkok (retention purge,
§5.10). Each round is a cross-instance singleton via `pg_try_advisory_xact_lock` — a second
instance skips the round, never blocks. All scheduler state lives in the `startScheduler`
closure; the returned handle carries `kick`/`health`/`stop`, and `stop()` resolves only after
in-flight rounds finish, so the caller may close the pool afterwards.

## Outbox delivery semantics (`notify.send`)

Delivery is **at-least-once**. The drain claims a due PENDING notification and, in the same
committed transaction, leases it: `attempts + 1` and `next_attempt_at` pushed out by the spec
backoff curve (30s · 2^n, capped at 32m). The SMTP send happens only after that commit, so a
crash between the relay's 250 and the SENT mark retries after the backoff — at most one send
per persisted attempt, making the 8-attempt dead-letter cap a hard ceiling on duplicates.
The deterministic Message-ID `<notif-{id}@{domain}>` stays stable across retries, letting
receiving MTAs that dedupe by Message-ID drop the extra copy.
