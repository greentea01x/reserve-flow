SET lock_timeout = '5s'; SET statement_timeout = '60s';
--> statement-breakpoint
-- The whole concurrency story of this system, in one constraint.
--
-- Bookings that hold a room (CONFIRMED / CHECKED_IN) may not overlap within that room. Every
-- booking that commits is confirmed, so first come, first served falls out of this directly:
-- writers INSERT or UPDATE and let the database decide. There is no SELECT-then-INSERT
-- anywhere in the codebase, and no advisory lock.
--
-- `23P01` is the answer for "taken", which the API maps to 409 SLOT_UNAVAILABLE.
--
-- COMPLETED / CANCELLED / AUTO_RELEASED fall outside the WHERE, so changing status frees the
-- slot immediately without deleting the row.
--
-- Immediate, NOT deferrable, on purpose: a reschedule that collides fails on the statement
-- rather than at COMMIT, so the whole UPDATE rolls back and the booking keeps its original
-- time and version. There is never a moment where the old slot is released and the new one
-- not yet held (BR-05 / CB-03).
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap_confirmed
  EXCLUDE USING gist (room_id WITH =, slot WITH &&)
  WHERE (status IN ('CONFIRMED','CHECKED_IN'));