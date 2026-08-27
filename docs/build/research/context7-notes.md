# Context7-verified library facts (2026-08-23)

## Drizzle ORM (/drizzle-team/drizzle-orm-docs)
- Generated columns supported in schema: `col.generatedAlwaysAs(sql\`tstzrange(start_at, end_at, '[)')\`)` → emits `GENERATED ALWAYS AS (...) STORED`.
- `tstzrange` column type: not built-in → define via `customType<{ data: string }>({ dataType: () => 'tstzrange' })`.
- EXCLUDE constraints (`EXCLUDE USING gist (room_id WITH =, slot WITH &&) WHERE (...)`) are NOT expressible in the pgTable DSL → add with a custom SQL migration: `drizzle-kit generate --custom` (empty migration file you fill with `CREATE EXTENSION IF NOT EXISTS btree_gist; ALTER TABLE bookings ADD CONSTRAINT ...`).
- Consequence: never use `drizzle-kit push` against shared/prod DBs (it introspects and may try to reconcile/drop constraints it doesn't know); use `drizzle-kit generate` + `drizzle-kit migrate` (or programmatic `migrate()`) only. GiST indexes themselves ARE supported: `index('x').using('gist', t.col)`.

## pg-boss (/timgit/pg-boss, v10+ API)
- Queues must be created first: `await boss.createQueue('booking.auto-release', { retryLimit: 5, retryDelay: 30, retryBackoff: true, deadLetter: 'dlq' })`.
- Delayed job: `boss.send({ name, data, options: { startAfter: <Date|ISO>, singletonKey: bookingId } })` → perfect for "auto-release at start_at + 15 min" and "reminder at start_at − 30 min" with one job per booking (singletonKey dedupes). Cancel/reschedule → just let the job run and re-check state in SQL (idempotent guard), or `boss.cancel(id)`.
- Cron: `boss.schedule('sweep.expire-pending', '*/5 * * * *', {}, { tz: 'Asia/Bangkok' })` for safety-net sweeps.
- Worker: `boss.work(name, { localConcurrency: 2 }, async ([job]) => {...})` — handler receives an ARRAY of jobs.
- Runs inside the API process (same Postgres), no Redis; can be split into a separate worker process later with zero code change (same `boss.work` registrations).
