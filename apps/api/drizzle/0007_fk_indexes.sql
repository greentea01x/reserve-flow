SET lock_timeout = '5s'; SET statement_timeout = '60s';
--> statement-breakpoint
-- Three foreign keys point back at `users` and no query reads them. They exist so that
-- DELETE FROM users (hard delete of a user with no history, §06) does not sequential-scan
-- bookings and users. Partial because all three columns are NULL in the overwhelming
-- majority of rows, which makes them nearly free on write (C1-40).
--
-- Declared here and nowhere else — do not duplicate them into 0001 or 0003.
CREATE INDEX bookings_checked_in_by_idx ON bookings (checked_in_by) WHERE checked_in_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX bookings_cancelled_by_idx  ON bookings (cancelled_by)  WHERE cancelled_by  IS NOT NULL;
--> statement-breakpoint
CREATE INDEX users_created_by_idx       ON users (created_by)       WHERE created_by    IS NOT NULL;