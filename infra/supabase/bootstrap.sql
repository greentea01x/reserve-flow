-- One-time bootstrap for a Supabase project (prod and staging alike).
-- Run as the `postgres` role: SQL editor, or psql over DATABASE_URL_MIGRATE
-- (the Supavisor SESSION pooler on :5432 — never :6543).
--
-- Replace CHANGE_ME with a generated password (openssl rand -base64 24) before running.
--
-- Dashboard steps that CANNOT be done in SQL — do these in the same sitting:
--   1. Settings -> API -> "Exposed schemas": remove ALL entries (public included) so
--      PostgREST serves nothing over the anon key. The revokes below are the braces;
--      this is the belt.
--   2. Database -> Extensions: enable btree_gist and citext — or keep the CREATE
--      EXTENSION lines below, which do the same thing when run as `postgres`.
--   3. Database -> SSL: download the project CA, commit it as infra/supabase/prod-ca.crt
--      (the API image bakes it for sslmode=verify-full).

-- Supabase installs extensions into the `extensions` schema, not `public`.
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;

-- rf_app: the runtime role. Login only, no DDL — migrations run as `postgres`
-- over DATABASE_URL_MIGRATE. (No rf_owner here: `postgres` owns the schema on Supabase.)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rf_app') then
    create role rf_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls
      password 'CHANGE_ME';
  end if;
end
$$;

-- Without this, `citext` column types and gist operator classes fail to resolve for rf_app,
-- because they live in `extensions` (trap T7).
alter role rf_app set search_path = public, extensions;

-- Role-level timeouts: postgresql.conf is not editable on managed Postgres (trap T19).
alter role rf_app set statement_timeout = '10s';
alter role rf_app set idle_in_transaction_session_timeout = '30s';

grant usage on schema public to rf_app;
grant select, insert, update, delete on all tables in schema public to rf_app;
grant usage, select, update on all sequences in schema public to rf_app;

-- Migrations run as `postgres`, so tables created later must inherit rf_app's DML grants.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to rf_app;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to rf_app;

-- Close the PostgREST surface (trap T8): Supabase's defaults grant anon/authenticated broad
-- privileges in `public`; bookings, mobile numbers, and audit logs must not be readable with
-- the public anon key. RLS is deliberately NOT enabled — the app connects as rf_app and the
-- API owns authorization; the fix here is to remove the grants, not to police them per-row.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
-- Default privileges granted by `supabase_admin` cannot be altered from `postgres`;
-- dashboard step 1 (exposed schemas = none) is what closes that residual gap.
