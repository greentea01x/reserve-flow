\getenv rf_owner_password RF_OWNER_PASSWORD
\getenv rf_app_password RF_APP_PASSWORD
\getenv reserveflow_database POSTGRES_DB

select format(
  'create role rf_owner login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password %L',
  :'rf_owner_password'
)
where not exists (select 1 from pg_roles where rolname = 'rf_owner')
\gexec

select format(
  'create role rf_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password %L',
  :'rf_app_password'
)
where not exists (select 1 from pg_roles where rolname = 'rf_app')
\gexec

select format('revoke create, temporary on database %I from public', :'reserveflow_database')
\gexec

select format('grant connect on database %I to rf_owner, rf_app', :'reserveflow_database')
\gexec

-- rf_owner runs migrations, and drizzle-kit keeps its bookkeeping in a `drizzle` schema it
-- creates on first run — which needs CREATE on the database, not just on `public`.
-- On Supabase the migration role is `postgres`, which already has it.
select format('grant create on database %I to rf_owner', :'reserveflow_database')
\gexec

revoke create on schema public from public;
grant usage, create on schema public to rf_owner;
grant usage on schema public to rf_app;

grant select, insert, update, delete on all tables in schema public to rf_app;
grant usage, select, update on all sequences in schema public to rf_app;

alter default privileges for role rf_owner in schema public
  grant select, insert, update, delete on tables to rf_app;
alter default privileges for role rf_owner in schema public
  grant usage, select, update on sequences to rf_app;

-- Extensions are created here, as the bootstrap superuser, not in a migration: rf_owner has
-- CREATE on schema public but not on the database, so `create extension` fails with 42501
-- even for trusted extensions (T-008 spike, Δ4).
create extension if not exists btree_gist;
create extension if not exists citext;
