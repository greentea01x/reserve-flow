# Production deploy — Fly.io runbook

The repository contains the production deployment configuration, but production is **not yet
turn-key or verified**. The Supabase project CA, verified-TLS provisioning for CI/migrations,
unique employee onboarding, authenticated topology smoke test, restore-drill tooling, and admin
break-glass recovery remain go-live gates in addition to external account setup.

**Architecture:** **Supabase** PostgreSQL (`ap-southeast-1`) plus **one Fly.io app** (`sin`,
always-on). The Fly image serves the employee SPA at `/`, the admin SPA at `/admin/`, the API at
`/api/`, and the in-process scheduler. The canonical production origin is
`https://reserveflow-api.fly.dev`.

Budget about 75 minutes for a first run, most of it waiting on builds and external provisioning.

---

## Before you start

**Accounts** — Supabase, Fly.io, Cloudflare R2, and GitHub.

**Local tools** — a checkout of this repo with `pnpm install` already run (Node ≥ 24, pnpm
10.27.0), plus `flyctl`, `psql`, `openssl`, and `age` for backup keys.

**Answers you need from the business:**

- Confirm the committed canonical starting dataset is the intended launch dataset: Horizon,
  Summit, and Grove (capacity 20; one microphone and projector each), eight departments,
  80 employee accounts, and one administrator account. Change and review the manifest before
  initialization rather than patching production afterward.
- Confirm whether the corporate SMTP relay authenticates with credentials or an IP allowlist.
  An IP allowlist requires dedicated Fly egress; decide before launch day.
- Confirm whether the default `reserveflow-api.fly.dev` origin is acceptable or a custom domain is
  required. A custom domain must replace `PUBLIC_BASE_URL` and every production smoke-test URL
  before deployment.

**External assumptions to re-check before go-live:**

- current Fly.io pricing and capacity for the selected always-on machine;
- backup/PITR guarantees of the selected Supabase plan. The encrypted backup workflow remains
  required until the business verifies an acceptable alternative.

---

## Order of operations

Each phase produces a value the next phase needs:

```text
Supabase → Fly app and canonical origin → GitHub CI → initialize → verify → backups
```

---

## Phase 1 — Supabase

### 1.1 Create the project

Use region **`ap-southeast-1` (Singapore)**. Users are in Bangkok, Fly runs in `sin`, and the
availability path has a two-second p95 target. Save the database password.

### 1.2 Generate the application-role password

```bash
openssl rand -base64 24 | tr '+/' '-_'
```

This password belongs to `rf_app`, separate from the `postgres` password. Plain base64 frequently
contains `/`, which must otherwise be percent-encoded inside a connection URL.

### 1.3 Run the bootstrap SQL

Copy [`infra/supabase/bootstrap.sql`](../infra/supabase/bootstrap.sql) into the Supabase SQL Editor
and replace `CHANGE_ME` in a scratch copy with the password from 1.2. **Never commit the real
password.**

The script enables `btree_gist` and `citext`, creates the `rf_app` login role, configures
`search_path`, applies role-level statement timeouts, grants runtime DML/default privileges, and
revokes access from `anon` and `authenticated`.

### 1.4 Complete the two dashboard-only steps

1. **Settings → API → Exposed schemas:** remove every entry, including `public`. This closes
   PostgREST access to bookings, contact data, and audit records.
2. **Database → SSL:** download the project CA and commit the public certificate:

   ```bash
   cp ~/Downloads/prod-ca-2021.crt infra/supabase/prod-ca.crt
   git add infra/supabase/prod-ca.crt
   git commit -m "chore: add Supabase production CA"
   ```

The Fly image sets `NODE_EXTRA_CA_CERTS=/app/infra/supabase/prod-ca.crt`. Without the file,
`sslmode=verify-full` cannot verify the database certificate.

### 1.5 Collect the two connection strings

| Purpose | Connection | Used as |
|---|---|---|
| Fly runtime | Direct `db.<ref>.supabase.co:5432` | Fly secret `DATABASE_URL`, login role `rf_app` |
| CI, migrations, initialization, backup | Supavisor **session** pooler on `:5432` | GitHub secret or operator-only value using `postgres` |

Copy the assigned pooler host from **Settings → Database → Connection pooling**. Never use
port `6543`: transaction pooling breaks prepared statements and advisory-lock semantics, and the
application rejects it.

Require verified TLS everywhere. Runtime uses `NODE_EXTRA_CA_CERTS`; Node migration/initializer
jobs need the same CA; libpq tools need `PGSSLROOTCERT` or `sslrootcert` plus
`sslmode=verify-full`. The current GitHub workflows do not yet provision that CA, so production
migration and backup remain blocked until the CA is wired and tested. Do not remove `sslmode` as a
workaround.

### 1.6 Run the migrations once from a controlled workstation

```bash
NODE_EXTRA_CA_CERTS="$PWD/infra/supabase/prod-ca.crt" \
DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-<n>-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full' \
  pnpm db:migrate
```

Migration `0008` needs special handling after launch: create its indexes concurrently before the
migration, then let the guarded `IF NOT EXISTS` statements become no-ops. A fresh empty database
does not need that workaround.

### 1.7 Confirm the schema

```sql
select extname from pg_extension where extname in ('btree_gist','citext');
select rolname from pg_roles where rolname = 'rf_app';
select count(*) from information_schema.tables where table_schema = 'public';
```

---

## Phase 2 — Fly.io full-stack application

### 2.1 Create the app

```bash
flyctl apps create reserveflow-api
```

The name is retained for compatibility, but this is the **full ReserveFlow application**, not an
API-only deployment. [`fly.toml`](../fly.toml) declares
`PUBLIC_BASE_URL=https://reserveflow-api.fly.dev`, and [`apps/api/Dockerfile`](../apps/api/Dockerfile)
builds and copies both SPA distributions plus the API into one image.

If the app name or canonical domain changes, update these together before deployment:

- `app` and `PUBLIC_BASE_URL` in `fly.toml`;
- production URLs in `.github/workflows/deploy.yml`;
- this runbook and the architecture specification.

### 2.2 Set runtime secrets

```bash
flyctl secrets set --app reserveflow-api \
  DATABASE_URL='postgresql://rf_app:<pw-from-1.2>@db.<ref>.supabase.co:5432/postgres?sslmode=verify-full' \
  BETTER_AUTH_SECRET='<from `openssl rand -base64 32`, stored first>' \
  SMTP_HOST='<relay host>' SMTP_PORT='587' \
  SMTP_USER='<user>' SMTP_PASS='<pass>' \
  MAIL_FROM='ReserveFlow <no-reply@yourdomain>' \
  MAIL_REPLY_TO='facility@yourdomain'
```

- Do not place `DATABASE_URL_MIGRATE` on Fly. It grants migration ownership and belongs only in
  controlled migration/backup jobs.
- `PUBLIC_BASE_URL` is non-secret configuration in `fly.toml`. It drives canonical-host redirects,
  Better Auth URLs, the `__Host-sid` cookie, CSRF origin checks, and links in notifications.
- Generate `BETTER_AUTH_SECRET` once and store it before setting the secret. Never generate it at
  container startup; doing so invalidates sessions after every deploy.
- `NODE_ENV`, `PORT`, `PUBLIC_BASE_URL`, `TRUST_PROXY`, `WORKER_ENABLED`, and `LOG_LEVEL` are
  configured in `fly.toml`.

### 2.3 Deploy the image

```bash
flyctl deploy --remote-only --config fly.toml
flyctl logs --app reserveflow-api
```

The image build runs the complete monorepo build. The runtime contains:

- `apps/web/dist` for employee routes at `/`;
- `apps/admin/dist` for admin routes at `/admin/`;
- `apps/api/dist` for `/api/` and the background scheduler.

`min_machines_running = 1` and `auto_stop_machines = false` are intentional. Scaling to zero stops
no-show release, booking completion, reminders, and outbox delivery.

### 2.4 Verify all three surfaces on the same origin

```bash
curl --fail https://reserveflow-api.fly.dev/api/readyz
curl --fail --output /dev/null https://reserveflow-api.fly.dev/
curl --fail --output /dev/null https://reserveflow-api.fly.dev/admin/
```

Then open representative deep links such as `/rooms` and `/admin/bookings`. A successful SPA
fallback proves Fly is serving both front ends. `readyz` proves database connectivity and scheduler
freshness. All browser requests remain same-origin, so no CORS layer or cross-site cookie is needed.

---

## Phase 3 — GitHub secrets and delivery

Add these as repository secrets. `FLY_API_TOKEN` may instead live in the `production` environment,
but backup secrets must remain available to `backup.yml`, which declares no environment.

| Secret | Used by | Value |
|---|---|---|
| `FLY_API_TOKEN` | deploy | `fly tokens create deploy --app reserveflow-api` |
| `DATABASE_URL_MIGRATE` | deploy, backup | verified-TLS Supavisor session-pooler URL |
| `BACKUP_AGE_PUBLIC_KEY` | backup | `age-keygen` public key |
| `R2_ENDPOINT` | backup | Cloudflare R2 endpoint |
| `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | backup | R2 credentials |
| `HEALTHCHECKS_PING_URL` | backup | dead-man's-switch URL required by the current workflow |

Keep the `age` private key offline in a password manager. Backups do not need it; restores do.

Automatic deployment from pushes is disabled for now. In GitHub, open
**Actions → Deploy → Run workflow** when a production deployment is intended. The manual
[`deploy.yml`](../.github/workflows/deploy.yml) run will:

1. install the frozen dependency graph;
2. migrate the database;
3. build and deploy the single Fly image;
4. verify `/`, `/admin/`, and `/api/readyz` at the canonical Fly origin.

The image makes employee, admin, API, and worker code one release unit. There is no cross-platform
frontend/API version skew.

---

## Phase 4 — Initialize canonical data

The initializer refuses any database with operational history, including audit rows created by a
failed sign-in. Stop the public app before initialization:

```bash
flyctl scale count 0 --app reserveflow-api
```

```sql
ALTER DATABASE postgres SET reserveflow.environment = 'production';
```

Reconnect, then follow [DATABASE-INITIALIZATION.md](DATABASE-INITIALIZATION.md) using:

- `INITIALIZE_DATABASE_URL`: verified-TLS session-pooler URL;
- `INITIALIZE_ENVIRONMENT=production`;
- `INITIALIZE_ALLOW_PRODUCTION=true`;
- `INITIALIZE_CONFIRM=initialize:postgres`;
- the same `BETTER_AUTH_SECRET` used by Fly;
- distinct 10–128 character administrator and employee bootstrap passwords.

Run `pnpm db:initialize --apply`. Without `--apply`, it is a no-op. Do not reopen public service
until unique employee credentials and an administrator credential-recovery path are provisioned.
The canonical initializer intentionally creates predictable demo identities and is not a complete
production onboarding solution.

Never use `pnpm db:seed:demo` against production. It only accepts an isolated `_demo` database with
the `demo` environment marker; see [DEMO-SEED.md](DEMO-SEED.md).

---

## Phase 5 — Verify without polluting canonical data

Do not point Playwright, `TEST_DATABASE_URL`, or mutation-heavy browser journeys at the newly
initialized production database. Use a disposable verification database for those tests.

1. Confirm `/api/readyz`, `/`, `/admin/`, and representative employee/admin deep links on
   `https://reserveflow-api.fly.dev`.
2. Run the read-only invariant queries from `DATABASE-INITIALIZATION.md`: three rooms, 81 users,
   canonical equipment, and zero operational rows.
3. Confirm PostgREST is closed:

   ```bash
   curl "https://<ref>.supabase.co/rest/v1/rooms?apikey=<anon-key>"
   ```

   It must not return application data.
4. Test SMTP transport with a designated operational mailbox without creating a booking or account
   invitation.
5. Run the backup workflow manually, decrypt the output, restore it into an isolated database, and
   assert schema/data/constraints. `pg_restore --list` alone is not a restore drill.
6. Define and rehearse administrator credential recovery before go-live.
7. After unique credentials exist, perform one controlled sign-in, authenticated API read, unsafe
   same-origin mutation check, and sign-out through the Fly origin. Preserve the session/audit
   evidence as release verification.

---

## Phase 6 — Ongoing operations

`backup.yml` runs nightly at 19:00 UTC (02:00 Bangkok): `pg_dump --format=custom` is encrypted with
`age`, uploaded to R2, and retained for 30 days. It also pings the database weekly because a free
Supabase project may pause after inactivity.

Rollback the application with:

```bash
flyctl releases --app reserveflow-api
flyctl deploy --image <previous-image> --config fly.toml
```

Migrations remain forward-only. The Fly image is atomic for employee, admin, API, and jobs, but a
rollback must still be compatible with the already-applied schema. A data recovery plan is credible
only after the isolated restore drill succeeds.

---

## Traps worth re-reading

- Keep `PUBLIC_BASE_URL` equal to the exact public Fly/custom origin. A mismatch breaks canonical
  redirects, authentication URLs, notification links, and unsafe-request origin checks.
- Keep `/api/*` responses `Cache-Control: no-store`; cached availability can cause stale booking
  decisions.
- Never run `drizzle-kit push` outside disposable local development.
- `fly.staging.toml` needs its own Supabase project and `BETTER_AUTH_SECRET`.
- Keep production always-on while jobs run in the API process.
- Do not claim backup readiness until a real restore and assertion pass is recorded.

## Cost

Expected baseline: Supabase plan + one always-on Fly shared machine + R2 storage/operations. Recheck
current vendor pricing and plan limits before approval; repository documentation must not be treated
as a current price quote.
