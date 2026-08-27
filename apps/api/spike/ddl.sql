-- T-008 spike DDL: spec §6.2 `0001_departments_auth.sql`, applied verbatim except
-- where marked "SPEC DELTA". Throwaway — the spike drops these at the end.
SET lock_timeout = '5s'; SET statement_timeout = '60s';

DROP TABLE IF EXISTS password_setup_tokens, verifications, accounts, sessions, users, departments CASCADE;

-- SPEC DELTA 0: rf_owner has CREATE on schema public but NOT on the database, so
-- `CREATE EXTENSION citext` fails with 42501 even though citext is a *trusted*
-- extension. It must be created by the bootstrap superuser (infra/db/init) or
-- rf_owner needs GRANT CREATE ON DATABASE. Pre-created here by the superuser.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citext') THEN
    RAISE EXCEPTION 'citext extension missing - create it as the bootstrap superuser';
  END IF;
END $$;

CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       citext NOT NULL UNIQUE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  email          citext NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_verified boolean NOT NULL DEFAULT false,
  image          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  role           text NOT NULL DEFAULT 'EMPLOYEE' CHECK (role IN ('EMPLOYEE','ADMIN','FACILITY')),
  banned         boolean NOT NULL DEFAULT false,
  ban_reason     text,
  ban_expires    timestamptz,
  employee_code  citext NOT NULL UNIQUE CHECK (employee_code ~ '^[A-Za-z0-9-]{3,20}$'),
  department_id  uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  mobile         text CHECK (mobile ~ '^0[0-9]{9}$'),
  status         text NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','ACTIVE','DISABLED')),
  failed_logins  smallint NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  disabled_at    timestamptz,
  created_by     uuid REFERENCES users(id),
  CONSTRAINT users_disabled_consistent CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL)),
  CONSTRAINT users_banned_mirror       CHECK (banned = (status = 'DISABLED'))
);
CREATE INDEX users_department_idx ON users (department_id);
CREATE INDEX users_role_idx ON users (role) WHERE status = 'ACTIVE';
CREATE INDEX users_created_by_idx ON users (created_by) WHERE created_by IS NOT NULL;

CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  ip_address      text,
  user_agent      text,
  impersonated_by uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SPEC DELTA 1: better-auth 1.7 requires a NOT NULL `issuer` on account.
  issuer      text NOT NULL,
  account_id  text NOT NULL,
  provider_id text NOT NULL,
  password    text,
  access_token            text,
  refresh_token           text,
  id_token                text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_idx ON accounts (user_id);
-- SPEC DELTA 2: better-auth declares UNIQUE (issuer, accountId) on account.
CREATE UNIQUE INDEX accounts_issuer_account_id_idx ON accounts (issuer, account_id);

CREATE TABLE verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);

CREATE TABLE password_setup_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose    text NOT NULL CHECK (purpose IN ('INVITE','RESET','FORGOT')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_setup_tokens_user_idx ON password_setup_tokens (user_id) WHERE used_at IS NULL;

-- rf_app runs the app; rf_owner owns the DDL (spec §10.6). No DELETE by default.
GRANT USAGE ON SCHEMA public TO rf_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO rf_app;
GRANT DELETE ON sessions, password_setup_tokens, verifications, accounts TO rf_app;
