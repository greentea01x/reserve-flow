SET lock_timeout = '5s'; SET statement_timeout = '60s';
--> statement-breakpoint
-- No CREATE EXTENSION here: btree_gist and citext are installed by the bootstrap superuser
-- (infra/supabase/bootstrap.sql). The migration role cannot create extensions, and on Supabase
-- they land in the `extensions` schema, not `public` (W0 S7 / trap T7).

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint
-- audit_logs is append-only. DELETE is allowed only for the declared retention job, which
-- announces itself by setting the GUC; everything else raises, including the schema owner.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('rf.audit_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
