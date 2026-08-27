# Production deploy — runbook

The repository contains the application deployment configuration, but production is **not yet
turn-key or verified**. The Supabase project CA, verified-TLS provisioning for CI/migrations,
unique employee onboarding, authenticated topology smoke test, restore-drill tooling and admin
break-glass recovery remain go-live gates in addition to external account setup.

**Architecture:** **Supabase** (Postgres, `ap-southeast-1`) + **Fly.io** (the API, region `sin`,
always-on) + **Vercel** (both SPAs on one origin, `/api/*` rewritten to Fly).

Budget about 90 minutes for a first run, most of it waiting on builds.

---

## Before you start

**Accounts** — Supabase (free), Fly.io (~$3–4/month, needs a card), Vercel (Hobby, free),
Cloudflare R2 (free). GitHub already has the repo.

**Local tools** — a checkout of this repo with `pnpm install` already run (Node ≥ 24, pnpm 10.27.0
— Phase 1.6 and Phase 6 are workspace scripts, not global binaries), plus `flyctl`, `psql`,
`openssl`, and `age` (for backup keys).

**Answers you need from the business**, because they block Phase 6 and Phase 3 respectively:

- Confirm the committed canonical starting dataset is the intended launch dataset: Horizon,
  Summit and Grove (capacity 20; one microphone and projector each), eight departments,
  80 employee accounts and one administrator account. Change the manifest and review it before
  initialization rather than patching production afterward.
- Whether the corporate SMTP relay authenticates with **credentials or an IP allowlist**. An IP
  allowlist needs a dedicated Fly egress IP — find out before launch day, not during it.

**External assumptions to re-check against current vendor terms before go-live:**

- whether the selected Vercel plan permits this use and its current price;
- which backup/PITR guarantees the selected Supabase plan currently includes. The repository's
  encrypted backup workflow remains required until the business verifies an alternative.

---

## Order of operations

Each phase produces a value the next one needs, so do not parallelize:

```
Supabase → Vercel (get the domain) → Fly (needs that domain) → GitHub CI → initialize → verify → backups
```

---

## Phase 1 — Supabase

### 1.1 Create the project

Region **`ap-southeast-1` (Singapore)**. Not cosmetic: your users are in Bangkok, the API runs in
Fly's `sin`, and the calendar has a 2-second p95 budget. Save the database password.

### 1.2 Generate the application role password

```bash
openssl rand -base64 24 | tr '+/' '-_'
```

This is for `rf_app`, separate from the `postgres` password. Keep it — Phase 3 needs it.

**The `tr` is not decoration.** Plain `base64` emits a `/` about 40% of the time, and a `/` in the
password makes the Phase 3.2 connection string an unparseable URL: the API refuses to boot with an
`Invalid URL` error against `DATABASE_URL`, which points at the connection string rather than at the
generator that caused it. If you already set a password containing `/`, percent-encode it as `%2F`
in the URL only — `bootstrap.sql` takes the literal.

### 1.3 Run the bootstrap SQL

Copy [`infra/supabase/bootstrap.sql`](../infra/supabase/bootstrap.sql) into the Supabase **SQL
Editor** (it runs as `postgres`), replacing `CHANGE_ME` with the password from 1.2.

**Edit a scratch copy — do not commit the real password.**

It enables `btree_gist` and `citext`, creates the `rf_app` login role, sets
`search_path = public, extensions` (without which `citext` columns and gist operator classes fail
to resolve for `rf_app`), applies role-level statement timeouts (managed Postgres has no editable
`postgresql.conf`), grants DML plus default privileges so future migrated tables inherit them, and
revokes everything from `anon` and `authenticated`.

### 1.4 Two dashboard steps that SQL cannot do

**a. Settings → API → Exposed schemas → remove every entry, including `public`.**
Default privileges granted by `supabase_admin` cannot be altered from `postgres`, so this is the
only thing that fully closes PostgREST. Skip it and your bookings, mobile numbers and audit log are
readable with the public anon key.

**b. Database → SSL → download the project CA**, and commit it:

```bash
cp ~/Downloads/prod-ca-2021.crt infra/supabase/prod-ca.crt
git add infra/supabase/prod-ca.crt && git commit -m "Add Supabase project CA"
```

**This is a hard prerequisite, not a nicety.** The API image sets
`NODE_EXTRA_CA_CERTS=/app/infra/supabase/prod-ca.crt`. If the file is missing, Node prints one
warning line and ignores it — and then `sslmode=verify-full` cannot verify Supabase's certificate,
so the API fails to reach the database with a TLS error that looks nothing like a missing file.

### 1.5 Collect the two connection strings

| Purpose | Which | Used as |
|---|---|---|
| API runtime | **Direct**: `db.<ref>.supabase.co:5432` (IPv6-only on free — fine from Fly) | Fly secret `DATABASE_URL`, as `rf_app` |
| CI, migrations, backups | **Supavisor SESSION pooler**: `aws-<n>-ap-southeast-1.pooler.supabase.com:5432` (GitHub runners are IPv4-only) | GitHub secret `DATABASE_URL_MIGRATE`, as `postgres` |

Copy the pooler host verbatim from **Settings → Database → Connection pooling**. The shard number
is assigned per project — it is not always `aws-0`.

**Require verified TLS for runtime, migrations, initialization and backups.** Runtime uses
`NODE_EXTRA_CA_CERTS`; Node migration/initializer jobs need the same CA, while libpq tools need
`PGSSLROOTCERT` (or `sslrootcert`) and `sslmode=verify-full`. The current GitHub workflows do not yet
provision that CA and `infra/supabase/prod-ca.crt` is not committed, so production migration,
initialization and backup are blocked until this is wired and tested. Do not omit `sslmode` as a
workaround: node-postgres otherwise defaults to non-TLS.

> **Never use port `:6543`.** Transaction pooling breaks prepared statements and advisory-lock
> semantics. The app's env validation rejects that port at boot rather than failing strangely later.

### 1.6 Run the migrations

```bash
NODE_EXTRA_CA_CERTS="$PWD/infra/supabase/prod-ca.crt" \
DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-<n>-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full' \
  pnpm db:migrate
```

> ⚠️ **Migration `0008` needs care on a live database.** Build its indexes out of band **first**
> with `CREATE INDEX CONCURRENTLY`, then run the migration — it is written as an `IF NOT EXISTS`
> no-op. `audit_logs` takes an insert on every sign-in attempt, and a plain `CREATE INDEX` locks it.
> On a fresh, empty database this does not matter; from the second deploy on, it does.

### 1.7 Confirm the schema

```sql
select extname from pg_extension where extname in ('btree_gist','citext');   -- expect both
select rolname from pg_roles where rolname = 'rf_app';                        -- expect one row
select count(*) from information_schema.tables where table_schema = 'public'; -- expect your tables
```

---

## Phase 2 — Vercel (first pass, to obtain the domain)

**Create ONE project, not one per app.** Both SPAs ship from a single origin: `/` is the employee
bundle, `/admin/` the admin bundle. Two projects would mean two origins, and the `__Host-` session
cookie cannot span origins — the admin app would have no session, and since it has no sign-in page
of its own, nobody could log into it at all.

1. Import the GitHub repo.
2. **Root Directory: the repository root.** Not `apps/web`, not `apps/admin`.
3. Leave the build settings alone — [`vercel.json`](../vercel.json) supplies
   `buildCommand: pnpm build:vercel` and `outputDirectory: apps/web/dist`. That command builds both
   apps and copies the admin bundle to `apps/web/dist/admin/`, which is the single tree the rewrites
   expect.
4. **Environment variables: none.** The front ends never learn an API hostname — they call relative
   `/api/...` paths and `vercel.json` rewrites them. If a `VITE_API_URL` ever appears, treat it as a
   design regression.
5. Deploy. The site will load and every `/api/*` call will fail until Phase 3 — that is expected.
6. **Write down the production domain.** Phase 3 needs it.

If your Fly app will not be named `reserveflow-api`, change it now in all three places it is baked
in rather than read from an env var: the rewrite destination in [`vercel.json`](../vercel.json),
`app =` in [`fly.toml`](../fly.toml), and the readyz URL in
[`deploy.yml`](../.github/workflows/deploy.yml).

---

## Phase 3 — Fly (the API)

### 3.1 Create the app

```bash
flyctl apps create reserveflow-api
```

### 3.2 Set the secrets

```bash
flyctl secrets set --app reserveflow-api \
  DATABASE_URL='postgresql://rf_app:<pw-from-1.2>@db.<ref>.supabase.co:5432/postgres?sslmode=verify-full' \
  PUBLIC_BASE_URL='https://<your-vercel-domain>' \
  BETTER_AUTH_SECRET='<from `openssl rand -base64 32`, stored first>' \
  SMTP_HOST='<relay host>' SMTP_PORT='587' \
  SMTP_USER='<user>' SMTP_PASS='<pass>' \
  MAIL_FROM='ReserveFlow <no-reply@yourdomain>' \
  MAIL_REPLY_TO='facility@yourdomain'
```

Two things people get wrong here:

- **Do not set `DATABASE_URL_MIGRATE` on Fly.** Runtime validation treats it as optional and the API
  never migrates at boot. The real value grants migration ownership and belongs only in GitHub for
  `deploy.yml`/`backup.yml`; Fly sees only the `rf_app` `DATABASE_URL`.
- **`PUBLIC_BASE_URL` is the Vercel domain, not the Fly one.** It is what the browser sees, and it
  drives both the session cookie and the canonical-host redirect. Point it at Fly and pages will
  load while sign-in silently fails.
- **Generate `BETTER_AUTH_SECRET` once and store it** in the password manager *before* you run the
  command — `flyctl` never shows a secret's value again after it is set, and Phase 6 needs one.
  Never generate it at container startup — that would invalidate every session on every deploy.

`NODE_ENV`, `PORT`, `TRUST_PROXY`, `WORKER_ENABLED` and `LOG_LEVEL` are already set in `fly.toml`
and need no secrets. Everything else the runtime requires is in the block above;
`fly.staging.toml` follows the same runtime-only separation and has no migration credential.

### 3.3 Deploy

```bash
flyctl deploy --remote-only --config fly.toml
flyctl logs --app reserveflow-api
```

`fly.toml` pins `min_machines_running = 1` and `auto_stop_machines = false`, because the 60-second
sweep and the outbox drain run in-process. Do not "optimize" those away — a scale-to-zero API stops
releasing no-show bookings and stops sending mail.

### 3.4 Confirm the API is alive

```bash
curl -sS https://reserveflow-api.fly.dev/api/readyz
```

`readyz` checks the database **and** sweep freshness, so a 200 here proves Supabase connectivity,
the CA file, and the scheduler all at once.

---

## Phase 4 — Confirm the two halves are joined

```bash
curl -sS https://<your-vercel-domain>/api/readyz
```

A 200 through the **Vercel** domain proves the rewrite works. If this fails while 3.4 succeeds, the
rewrite target in `vercel.json` is wrong.

---

## Phase 5 — GitHub secrets and CI

Add these as **repository** secrets. `FLY_API_TOKEN` may instead live in the `production`
environment, but nothing else may: `deploy.yml` declares `environment: production` and
`backup.yml` declares no environment at all, so an environment-scoped secret expands to an empty
string there instead of erroring — `pg_dump --dbname=""` fails, nothing lands in R2, and you find
out when you need a restore.

| Secret | Used by | Value |
|---|---|---|
| `FLY_API_TOKEN` | deploy | `fly tokens create deploy --app reserveflow-api` |
| `DATABASE_URL_MIGRATE` | deploy, backup | Supavisor **session** pooler URL from 1.5 |
| `BACKUP_AGE_PUBLIC_KEY` | backup | `age-keygen` public key (`age1...`) |
| `R2_ENDPOINT` | backup | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | backup | Cloudflare R2 |
| `HEALTHCHECKS_PING_URL` | backup | Dead-man's switch so a silently failing backup gets noticed. **Not optional as `backup.yml` stands** — the heartbeat step has no `if:` guard, and `curl ""` exits 2, so an unset value fails the run after a good backup already uploaded |

**Keep the `age` private key offline** — in a password manager, never in this repo. Backups do not
need it; restores are impossible without it.

From now on, pushing to `main` runs [`deploy.yml`](../.github/workflows/deploy.yml): migrations →
Fly deploy → poll `/api/readyz`. Vercel deploys itself from its git integration.

---

## Phase 6 — Initialize canonical data (go-live blocked until unique onboarding exists)

**Stop the API before you start, and understand why.** The initializer refuses any database with
operational history, and `audit_logs` counts: every sign-in attempt against an unknown employee
code writes an `auth.login_failed` row *before* the request is rejected. One bot or one curious
tester hitting the domain since Phase 3 is enough to abort this phase with
`Refusing demo seed: operational data found (audit_logs=1)`.

```bash
flyctl scale count 0 --app reserveflow-api
```

```sql
ALTER DATABASE postgres SET reserveflow.environment = 'production';
```

Reconnect so the setting is visible, then follow
[DATABASE-INITIALIZATION.md](DATABASE-INITIALIZATION.md), replacing the values in its example
`.env` block with:

- `INITIALIZE_DATABASE_URL` — the verified-TLS **session pooler** URL from 1.5; provision the CA for
  Node with `NODE_EXTRA_CA_CERTS`
- `INITIALIZE_ENVIRONMENT=production` — must equal the marker you just set. Leave the doc's
  `development` in place and the run aborts with
  `Connected database environment marker must equal development`
- `INITIALIZE_ALLOW_PRODUCTION=true`
- `INITIALIZE_CONFIRM=initialize:postgres`
- `BETTER_AUTH_SECRET` (≥ 32 chars), plus `INITIALIZE_ADMIN_PASSWORD` and
  `INITIALIZE_EMPLOYEE_PASSWORD` — 10–128 chars each, and they must differ

Run it with `pnpm db:initialize --apply`; without `--apply` it is a no-op. For production, **do not
restore public service yet**: the initializer assigns one shared employee bootstrap credential to
80 predictable IDs, and the employee set-password landing is hidden. Service may resume only after
an approved per-user credential/onboarding workflow has provisioned unique credentials and the
administrator credential has been rotated. Until then this procedure is suitable for local/demo or
closed staging only.

If it aborts on `audit_logs=N`, preserve those real sign-in attempts. The normal pre-launch recovery
is to rebuild the unused project or use a separately reviewed/exported correction procedure; never
use the retention purge flag merely to bypass the initializer guard.

> **Read this before running it.** `db:initialize` installs the committed canonical dataset exactly:
> Horizon/Summit/Grove (capacity 20; microphone 1 + projector 1 each), eight departments,
> 80 `EMPLOYEE` accounts (`AU-002`–`AU-081`) across eight deterministic job titles, and one `ADMIN`
> account (`AU-001`). It reads separate admin/employee initialization credentials from the
> environment, never prints their values, and preserves existing canonical credential hashes on a
> safe rerun. Treat those credentials as bootstrap credentials. The final employee web currently
> hides invite/reset landing pages, so rotate credentials through Profile or an approved external
> account workflow rather than relying on the admin email-link action.

`db:initialize` is intentionally production-capable only with the explicit production opt-in,
confirmed database name/environment, migrated schema, advisory lock, and empty operational state
described above. **`pnpm db:seed:demo` is a different command**: it accepts only a database ending
in `_demo` with environment marker `demo`, rejects production, and must never receive the normal
application database URL ([DEMO-SEED.md](DEMO-SEED.md)).

---

## Phase 7 — Verify without polluting the canonical data

Do not point Playwright, `TEST_DATABASE_URL`, or a browser booking/check-in journey at the newly
initialized database. Run mutating journeys against an isolated disposable database before this
phase. The canonical target gets read-only/infrastructure checks immediately after initialization.
This preserves the manifest but **does not prove authenticated cookie/CSRF behavior through
Vercel**:

1. **`/api/readyz` → 200 through the Vercel domain** (Phase 4 above).
2. **Open `/`, `/admin/`, and representative deep links** and confirm the two Vercel SPA fallbacks
   load without creating a session or mutation.
3. **Run the read-only invariant queries from `DATABASE-INITIALIZATION.md`**: 3 rooms, 81 users,
   canonical equipment, and zero bookings/sessions/notifications/audit rows.
4. **Test SMTP transport outside the booking flow** with a designated operational mailbox; record
   the result without inserting an application booking or account invitation.
5. **Confirm PostgREST is closed:**
   ```bash
   curl "https://<ref>.supabase.co/rest/v1/rooms?apikey=<anon-key>"   # must NOT return data
   ```
6. **Run the backup workflow manually once**, confirm an object lands in R2, decrypt it, then restore
   it into an isolated database and assert schema, data and constraints. The repository currently
   lacks the scrub/assert drill scripts, so this gate is not yet passable. Listing the archive is
   only an integrity precheck:
   ```bash
   age --decrypt --identity backup-key.txt reserveflow-<stamp>.dump.age | pg_restore --list | head
   ```
   `pg_restore --list` alone is not restore proof.
7. **Measure the public/static and readiness paths from Bangkok**. Measure authenticated calendar
   p95 only against an isolated verification database, not the canonical target.
8. **Define and rehearse administrator credential recovery.** The repository currently has no
   reset CLI and the employee set-password landing is hidden; do not go live until an approved
   break-glass workflow exists and has been tested without exposing a password or bypassing audit.
9. **After unique credentials are provisioned, run a controlled canary sign-in, authenticated API
   call, unsafe same-origin mutation check, and sign-out through the real Vercel → Fly topology.**
   Preserve the resulting session/audit evidence as legitimate release verification; `/readyz`
   alone cannot prove authentication or proxy/cookie behavior.

---

## Phase 8 — Ongoing operations

`backup.yml` runs nightly at 19:00 UTC (02:00 Bangkok): `pg_dump --format=custom` piped through
`age`, uploaded to R2, with 30-day retention. It also pings the database every Sunday, because
**Supabase free pauses after 7 days idle and resume is manual**. The 60-second sweep is the primary
thing keeping it awake; the weekly ping survives a week-long Fly outage.

**Rollback:** `flyctl releases --app reserveflow-api`, then
`flyctl deploy --image <previous-image>`. Migrations are **forward-only**. GitHub orchestrates
migrate → Fly, while Vercel deploys independently from Git integration; no Fly-before-Vercel order is
enforced. Frontend, API and migrations must therefore remain compatible in both version-skew
directions. A bad data migration can use backup recovery only after a real restore drill has passed.

---

## Traps worth re-reading

- **Vercel caches external rewrites** for projects created after 2026-04-06. A cached availability
  grid is a double-booking-shaped bug. `vercel.json` disables it and the API sends
  `Cache-Control: no-store` on `/api` — keep both.
- **Never `drizzle-kit push`** outside local development.
- **`fly.staging.toml`** exists if you want a staging app; it needs its own Supabase project and its
  own `BETTER_AUTH_SECRET`.
- The Fly image also carries both SPA bundles, so the API can serve the front ends directly if you
  ever need to drop Vercel.

## Cost

Supabase $0 + Fly ~$3–4 + Vercel $0 (Hobby) + R2 $0 ≈ **$3–4/month**, with the Hobby licensing risk
as the one thing that could force a $20/month line item.
