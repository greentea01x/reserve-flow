SET lock_timeout = '5s'; SET statement_timeout = '60s';
--> statement-breakpoint
-- GET /admin/audit-logs sorts by id DESC — the identity column is insertion order, so the
-- primary key already serves the unfiltered page. These cover the two filters that had no
-- index at all on the fastest-growing table in the system (a row per sign-in attempt):
-- `action` carries id so the sort is read off the index, and `created_at` supports the
-- from/to range scan.
--
-- DEPLOY: build these out of band FIRST, with CREATE INDEX CONCURRENTLY, then run the
-- migration as the metadata no-op IF NOT EXISTS makes it. A plain CREATE INDEX takes
-- ShareLock on audit_logs, and every mutation in the API writes its audit row in the same
-- transaction as the change — so a build here freezes bookings, check-ins and admin writes
-- alike, for up to the 60s statement_timeout above. drizzle-kit wraps each file in a
-- transaction, so CONCURRENTLY cannot be expressed in here. Empty table (fresh env) → just
-- run it.
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" USING btree ("action","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);
