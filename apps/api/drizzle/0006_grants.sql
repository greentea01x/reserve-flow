SET lock_timeout = '5s'; SET statement_timeout = '60s';
--> statement-breakpoint
-- Privileges for rf_app, the role the API connects as. Migrations run as the schema owner
-- (`postgres` on Supabase); rf_app itself is created by infra/supabase/bootstrap.sql.
--
-- bootstrap.sql deliberately grants the full DML set, including DELETE, so that the tables
-- created by 0001–0005 are usable the moment they exist. This file narrows that down. It has
-- to REVOKE: granting a smaller set on top does NOT shrink an existing ACL, so a plain GRANT
-- here would silently leave DELETE in place and the "no DELETE by default" rule of §09 would
-- be off without anything failing (W0 S8).
GRANT USAGE ON SCHEMA public TO rf_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO rf_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rf_app;
--> statement-breakpoint
-- 1) Drop the DELETE that bootstrap's default privileges handed to every table above.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM rf_app;
--> statement-breakpoint
-- 2) Stop future tables from inheriting DELETE. Again REVOKE, not a narrower GRANT.
--    ALTER DEFAULT PRIVILEGES only affects objects created by the role named here, and that
--    role differs by environment: rf_owner locally (infra/db/init/01-roles.sql), postgres on
--    Supabase (infra/supabase/bootstrap.sql). current_user is whoever is running this
--    migration, which is exactly the role that created the tables above.
DO $$
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE DELETE ON TABLES FROM rf_app', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO rf_app', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rf_app', current_user);
END $$;
--> statement-breakpoint
-- 3) Hand DELETE back only where the code genuinely deletes rows: retention jobs (§5.10),
--    replace-the-whole-set endpoints, and hard delete of a user with no history.
--    bookings / rooms / departments / settings / business_hours are absent on purpose —
--    cancelling is a status change, closing a room is active=false, settings are upserted.
GRANT DELETE ON sessions, verifications, password_setup_tokens, booking_attendees,
                notifications, room_features, holidays, features, users TO rf_app;
--> statement-breakpoint
-- audit_logs is append-only for everyone. The trigger in 0000 is the second lock, and it
-- stops the schema owner too.
REVOKE UPDATE, DELETE ON audit_logs FROM rf_app;