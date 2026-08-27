# ReserveFlow — DevOps / Security / QA research notes (v2 input)

Scope assumptions (from BRIEF.md): Node 22 LTS, pnpm monorepo + Turborepo, `apps/api` (REST + pg-boss in-process), `apps/web` + `apps/admin` (assume Vite SPAs served as static files; SSR variant noted where it differs), Postgres 16, ~80 users / 3 rooms / Asia/Bangkok, 1–3 devs, 6–8 week MVP. Ponytail stance: fewest moving parts, but trust boundaries (validation, authz, idempotency, audit, backups) are never simplified away.

Decisions are stated as decisions. "verify" = price/version I believe is current but should be checked before the doc is finalized.

---

## 1. Environments & configuration

### 1.1 Topology (one origin, path-routed)

Decision: **single public origin** `https://reserve.<company>.co.th` with path routing — `/` → employee SPA, `/admin/` → admin SPA (Vite `base: '/admin/'`), `/api/` → API. Staging = `https://staging.reserve.<company>.co.th`, same layout.

Why: one cookie (`__Host-sid`) serves both apps, **no CORS config at all**, no cookie `Domain` attribute, SameSite=Lax is sufficient for CSRF (see §4), one TLS cert, one Caddy block. Three subdomains would buy nothing at this scale and add CORS + cookie-domain bugs.

SSR variant (if Next.js is picked): `web`/`admin` become Node containers behind the same Caddy paths; everything else below is unchanged.

### 1.2 Environments

| Env | Where | DB | Email | Who uses | Notes |
|---|---|---|---|---|---|
| **local** | dev laptop: `docker compose up` (postgres, mailpit) + `pnpm dev` (api/web/admin on host, hot reload) | `postgres:16-alpine` container, seeded | Mailpit (SMTP :1025, UI :8025) | devs | `compose.yml` default profile = infra only. Profile `full` builds & runs api/caddy images for prod-like testing. |
| **test** (CI) | GitHub Actions service containers | `postgres:16` service, migrated per job | Mailpit service container | CI | Same compose images locally via `compose.ci.yml` for debugging. |
| **staging** | **same VM as prod**, second compose project (`rf-staging`), own Postgres container/volume | restored from scrubbed prod dump on demand | **Mailpit** behind Caddy basic-auth (`staging.reserve…/mail`) — UAT testers read mails there; no real mail leaves staging | devs, UAT, admin training | Joins shared docker network `edge`; Caddy in prod project routes the staging hostname. |
| **prod** | VM, compose project `rf-prod` | Postgres 16 container, volume, backups → object storage | company SMTP relay (see §4.14) | everyone | Deploy by tag, see §2/§7. |

Skipping: per-PR preview envs (no value for 1–3 devs), separate staging VM (doubles cost, no isolation need — staging has its own Postgres container and `.env`).

### 1.3 Local `compose.yml` (sketch)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: reserveflow }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data, ./infra/db/init:/docker-entrypoint-initdb.d:ro]  # creates rf_owner / rf_app roles, btree_gist
    healthcheck: { test: ["CMD-SHELL","pg_isready -U postgres"], interval: 5s }
  mailpit:
    image: axllent/mailpit
    ports: ["1025:1025","8025:8025"]
  # --- profile full: prod-like ---
  api:
    profiles: [full]
    build: { context: ., dockerfile: apps/api/Dockerfile }
    env_file: .env
    depends_on: { postgres: { condition: service_healthy } }
  caddy:            # serves web + admin static bundles, proxies /api → api
    profiles: [full]
    build: { context: ., dockerfile: infra/caddy/Dockerfile }   # multi-stage: build SPAs → COPY dist into caddy:2
    ports: ["8080:80"]
volumes: { pgdata: {} }
```

Prod `compose.prod.yml` = `postgres`, `api`, `caddy` (+ `migrate` one-shot service using the api image, `profiles: [tools]`). Backups run from host cron (§4.10), not a container. That is **3 long-running containers** for the whole product.

### 1.4 `.env` matrix

Rule: every variable is validated at boot by a zod schema in `packages/shared/env.ts` (fail fast, print missing *names* never values). `.env.example` committed with every key. Build-time vs runtime is explicit.

| Variable | Used by | Purpose | local | staging | prod |
|---|---|---|---|---|---|
| `NODE_ENV` | api | mode | `development` | `production` | `production` |
| `PORT` | api | listen port | 3000 | 3000 | 3000 |
| `TZ` | api, postgres | **always `UTC`** in processes; Bangkok is an app constant (`APP_TZ='Asia/Bangkok'` in `packages/shared`), not config | UTC | UTC | UTC |
| `DATABASE_URL` | api | app connection as `rf_app` (DML only) | `postgres://rf_app:…@localhost/reserveflow` | compose-internal host | compose-internal host |
| `DATABASE_URL_MIGRATE` | migrate step only | `rf_owner` (DDL). Not present in api runtime container | same host | same | same |
| `PUBLIC_BASE_URL` | api | absolute links in emails/.ics/QR, cookie Secure flag | `http://localhost:5173` | `https://staging.reserve…` | `https://reserve…` |
| `TRUST_PROXY` | api | read `X-Forwarded-For` from Caddy for audit IP / rate-limit | `false` | `true` | `true` |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS` | api | nodemailer transport | mailpit:1025 / false / – | mailpit | company relay (§4.14) |
| `MAIL_FROM` / `MAIL_REPLY_TO` | api | `"ReserveFlow <reserve@company.co.th>"` | any | same as prod | company address |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` | api | errors + perf; release = git sha injected by CI | empty (disabled) | staging / 1.0 | production / 0.2 |
| `LOG_LEVEL` | api | pino | debug | info | info |
| `UPLOADS_DIR` | api | room photos on a volume (`/data/uploads`) | `./.data/uploads` | volume | volume |
| `WORKER_ENABLED` | api | `true` = this process runs pg-boss workers + schedules. Single flag that allows splitting a worker later (`// ponytail: one process; flip to a 2nd container if job CPU ever hurts API p95`) | true | true | true |
| `VITE_SENTRY_DSN`, `VITE_APP_ENV` | web, admin (**build-time**) | browser Sentry | empty | staging | production |
| *(none)* | web, admin | API base URL — **not a variable**: same-origin `/api` | | | |
| `POSTGRES_PASSWORD`, `RF_OWNER_PASSWORD`, `RF_APP_PASSWORD` | postgres init script | superuser + two roles (§4.11) | dev values | secret | secret |
| `DOMAIN`, `STAGING_DOMAIN`, `ACME_EMAIL` | caddy | vhosts + Let's Encrypt account | – | set | set |
| `IMAGE_TAG` | compose (prod/staging) | which `ghcr.io/<org>/reserveflow-{api,caddy}:<sha>` to run; rollback = change this | – | sha | sha |
| Host-only (backup script): `BACKUP_AGE_RECIPIENT`, rclone remote `r2:` config, `HEALTHCHECKS_URL` | cron | encrypt → upload → heartbeat | – | – | set |
| CI secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `PROD_ENV_FILE`, `STAGING_ENV_FILE`, `SENTRY_AUTH_TOKEN` | GitHub Environments | deploy + sourcemaps; `GITHUB_TOKEN` pushes to GHCR | | | |

Deliberately **no** `SESSION_SECRET` and **no** `QR_TOKEN_SECRET`: sessions and check-in tokens are random 256-bit opaque values stored as SHA-256 hashes in Postgres (§4.1, §4.13). Nothing to sign, nothing to rotate. Business tunables (check-in window, auto-release grace, business hours, holidays, slot increment, max advance days) live in a `settings` table edited by Admin, not in env — they are product config, not deployment config.

### 1.5 Secrets handling

- Local: `.env` (gitignored) copied from `.env.example`; dev-only passwords.
- CI/CD: GitHub **Environments** `staging` and `production`; `production` has a required reviewer + `v*` tag rule. The whole env file lives as one secret (`PROD_ENV_FILE`) — the deploy job writes it to `/srv/reserveflow/prod/.env` (mode 0600, owner `deploy`) over SSH and restarts. Rotation = edit secret → re-run deploy.
- VM: secrets only in that file; never in images, build args, or compose YAML; `docker compose config` never committed.
- Skipped: SOPS/age-encrypted env in git, Vault, Doppler. Add SOPS if >3 people need to edit secrets with an audit trail.
- Sentry DSNs are not treated as secrets. The only real secrets: 3 DB passwords, SMTP credential, backup storage keys + age private key, SSH deploy key.

---

## 2. CI/CD (GitHub Actions)

### 2.1 Pipeline

```
PR / push main:   setup ─┬─ lint ─┬─ typecheck ─┬─ unit ─┬─ integration (PG service) ─┬─ e2e-smoke (PG+Mailpit services) ─┬─ migrations-check
                         (all parallel after setup; ~6–8 min total)
push main:        + build-images (GHCR, tag sha) → deploy-staging (SSH) → e2e-full against staging (non-blocking) → k6 calendar p95 (nightly too)
tag v*:           reuse sha image → [manual approval: Environment=production] → deploy-prod (pre-dump, migrate, up -d) → smoke (/readyz, login page 200)
```

Required status checks on `main`: `lint`, `typecheck`, `unit`, `integration`, `e2e-smoke`, `migrations-check`. Squash merge, linear history, 1 approval when ≥2 devs.

### 2.2 Workflow skeleton (`.github/workflows/ci.yml`)

```yaml
name: ci
on: { pull_request: {}, push: { branches: [main], tags: ['v*'] } }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
env: { PNPM_VERSION: 10, NODE_VERSION: 22 }   # verify current pnpm major
jobs:
  setup: &setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: actions/cache@v4            # turbo local cache; no remote cache needed at this size
        with: { path: .turbo, key: turbo-${{ runner.os }}-${{ github.sha }}, restore-keys: turbo-${{ runner.os }}- }
  lint:       { <<: *setup, steps: [..., { run: pnpm turbo lint } ] }          # eslint + prettier --check
  typecheck:  { <<: *setup, steps: [..., { run: pnpm turbo typecheck } ] }     # tsc -b
  unit:       { <<: *setup, steps: [..., { run: pnpm turbo test:unit } ] }     # vitest
  integration:
    <<: *setup
    services:
      postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: postgres }, ports: ['5432:5432'],
                  options: >- --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10 }
      mailpit:  { image: axllent/mailpit, ports: ['1025:1025','8025:8025'] }
    env: { DATABASE_URL_MIGRATE: postgres://postgres:postgres@localhost:5432/postgres, DATABASE_URL: ..., SMTP_HOST: localhost }
    steps: [..., { run: pnpm --filter @rf/db migrate }, { run: pnpm --filter api test:integration }]   # includes TC-CON-001 race test
  e2e-smoke:
    <<: *setup  # + same services
    steps: [..., { run: pnpm turbo build }, { run: pnpm exec playwright install --with-deps chromium },
            { run: pnpm --filter e2e test --grep @smoke }]   # Playwright webServer starts built api + vite preview for web/admin
  migrations-check:
    <<: *setup  # + postgres service
    steps: [..., { run: pnpm --filter @rf/db check },          # drizzle-kit generate produces no diff → schema & SQL in sync
            { run: pnpm --filter @rf/db migrate },              # from empty DB
            { run: git fetch --tags && ./infra/scripts/migrate-from-last-tag.sh }]  # previous release's schema + seed → new migrations apply cleanly
  build-images:
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')
    needs: [lint, typecheck, unit, integration, e2e-smoke, migrations-check]
    permissions: { packages: write, contents: read }
    steps: [checkout, docker/setup-buildx-action@v3, docker/login-action@v3 (ghcr), 
            docker/build-push-action@v6 (api; cache-from/to type=gha), docker/build-push-action@v6 (caddy+static bundles)]
  deploy-staging: { needs: build-images, if: main, environment: staging, steps: [ssh: write .env, compose pull, run --rm migrate, up -d, curl /readyz] }
  deploy-prod:    { needs: build-images, if: tag, environment: production,  steps: [same + pre-migration pg_dump] }
```

Notes: Playwright browser binaries are cached by version key; `--with-deps` only on cache miss. E2E in PR = `@smoke` subset (login, book auto room, book manual + approve, cancel, private masking, a11y scan) ≈ 2–3 min. Full e2e + k6 run on `main` against staging.

Dockerfile (api): multi-stage `node:22-bookworm-slim`, `pnpm deploy --filter api --prod /out`, non-root `node` user, `HEALTHCHECK CMD wget -qO- localhost:3000/healthz`. Use `@node-rs/argon2` (prebuilt, no node-gyp). If `sharp` is used for room photos it has prebuilds for bookworm too. Caddy image: multi-stage builds both SPAs and `COPY`s `dist/` into `caddy:2` with `Caddyfile` — one image carries both front-ends.

### 2.3 Migration strategy

- Drizzle schema in `packages/db`; `drizzle-kit generate` → SQL files committed in `packages/db/migrations`; **SQL is the artifact**, reviewed in PR. Hand-written SQL allowed for what Drizzle can't express (EXCLUDE constraint, triggers, grants) — same folder, same runner.
- **Forward-only.** No down migrations. Mistake = new migration. Rollback of the *app* is always possible because of the compatibility rules below; rollback of the *schema* = restore the pre-deploy dump (§7.2), accepted because DB is MBs and deploys happen outside 08:30–17:30.
- Run as an explicit deploy step (`docker compose run --rm migrate`) **before** `up -d` of the new API, as `rf_owner`. Never on API boot (hidden DDL on restart is how you get surprises at 09:00).
- Each migration starts with `SET lock_timeout = '5s'; SET statement_timeout = '60s';` — fail fast rather than block the live API.
- Backward-compatible rules (old API version may run for ~10 s against new schema, and must run for hours if we roll back):
  1. Add columns nullable or with DEFAULT; backfill; NOT NULL in the *next* release.
  2. Never rename/drop a column or table in the same release that stops using it (expand → migrate code → contract next release).
  3. Status/enum values: use `text` + `CHECK` constraint (or lookup table), not PG enums — adding a value is `DROP CONSTRAINT; ADD CONSTRAINT` and is transactional. v1 data model (`work/v1-sections/data.html`) has `status`/`privacy`/`role` fields — keep them text+CHECK.
  4. New NOT NULL FK? Add nullable, backfill, then constrain.
  5. Indexes: plain `CREATE INDEX` is fine (tables are thousands of rows). Ceiling: switch to `CONCURRENTLY` (needs a no-transaction migration file) when a table passes ~1M rows — won't happen here.
  6. Data migrations that touch `audit_logs` are forbidden (immutability, §4.6).
- `migrations-check` job proves: (a) schema ↔ SQL in sync, (b) fresh DB migrates, (c) last release's DB + seed migrates to HEAD.

---

## 3. Deploy options & recommendation

Prices USD/month, approximate, **verify** at decision time. Region matters: pick **Singapore** (~30–40 ms from Bangkok) or AWS `ap-southeast-7` (Bangkok) if in-country data residency is wanted.

| Option | What runs where | Monthly cost | Ops burden | Verdict |
|---|---|---|---|---|
| **(a) Single VM + docker compose + Caddy** | 1 VM (2 vCPU / 4 GB): Caddy (TLS + static SPAs), api (+pg-boss), Postgres 16, staging stack on same box. Backups → Cloudflare R2 (10 GB free) or Backblaze B2. | VM $12–24 (DigitalOcean SGP 2 GB $12 / 4 GB $24; AWS Lightsail SGP 2 GB $12; AWS EC2 t4g.small Bangkok ≈ $12 on-demand, less reserved; Hetzner SGP ≈ €8–15 — verify) + backups ≈ $0–1 + email $0 (company relay) → **≈ $12–25** | You patch the OS (unattended-upgrades), own backups (scripted, drilled). ~1 h/month. | **Recommended** |
| (b) Render / Railway / Fly | Render (Singapore): web service $7 (api), Postgres Basic 256 MB $6 → 1 GB $19, two static sites free. Railway: ~$5 hobby + usage ≈ $10–20 incl. Postgres volume. Fly: machines ≈ $5–10 + Fly Postgres (unmanaged by their own admission) ≈ $5–15. | **≈ $15–40** | Managed Postgres with PITR/backups (Render), no SSH, git-push deploys. Cron/worker = same container since pg-boss is in-process. | Fallback if **nobody on the team wants to SSH into a box**. Render > Railway > Fly for this team (Render has managed PG + Singapore). |
| (c) Vercel (webs) + Railway/Neon (api/db) | Vercel Pro $20/seat (Hobby forbids commercial use), Railway api $5–10, Neon Postgres free → $19, 3 dashboards, CORS + cross-site cookies (`SameSite=None`, two origins) | **≈ $25–50+** | Lowest, but the cookie/CORS surface is the one thing we wanted to avoid; also pg-boss needs a long-running process (not Vercel). | Not recommended |

**Recommendation: (a).** Reasons specific to this company: 80 users × 3 rooms is a toy load for one small VM; prod + staging fit on the same box; a single `docker compose up -d` is the entire runtime; no per-seat SaaS fees; PII (mobile numbers) stays on one server the company controls; Caddy makes TLS a zero-step. The cost of (a) is discipline — backups drilled (§7.3), unattended-upgrades on, SSH keys only — all of which are in the runbook. If the team fails the "someone is comfortable with SSH + docker" test, take Render.

### 3.1 VM bootstrap (`infra/scripts/bootstrap.sh`, run once)

Ubuntu 24.04 LTS → create `deploy` user (sudo, SSH key only, password login off) → `ufw allow 22,80,443; ufw enable` → install Docker CE + compose plugin → `unattended-upgrades` (security) → `fail2ban` (sshd jail) → install `age`, `rclone` → `mkdir -p /srv/reserveflow/{prod,staging}` → docker log rotation (`/etc/docker/daemon.json`: json-file, `max-size 10m`, `max-file 5`) → install backup cron (§4.10). Postgres port is **never published** to the host (compose-internal only); devs reach it via `ssh -L` when needed.

### 3.2 Domain / TLS / Caddyfile

- DNS: `reserve.<company>.co.th` A → VM; `staging.reserve.<company>.co.th` A → VM. Cloudflare DNS-only (grey cloud) or the company's existing DNS. Caddy gets Let's Encrypt certs via HTTP-01 (port 80 must be reachable). If the company wants the tool reachable **only on VPN/office network**, use Caddy DNS-01 (Cloudflare module) or `tls internal` + company CA — decide in Week 1 (open question for the doc).
- Caddy also sets security headers for the static apps (API sets its own via helmet). HSTS is not on by default in Caddy → set explicitly.

```caddyfile
{$DOMAIN} {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    Permissions-Policy "camera=(self), geolocation=(), microphone=()"   # camera: QR scanner page
    Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.ingest.sentry.io; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    -Server
  }
  handle_path /api/* { reverse_proxy api:3000 }
  handle /admin/*   { root * /srv/admin; try_files {path} /admin/index.html; file_server }
  handle            { root * /srv/web;   try_files {path} /index.html;        file_server }
}
{$STAGING_DOMAIN} { ... same, upstream rf-staging-api:3000; handle /mail/* { basicauth {...}; reverse_proxy rf-staging-mailpit:8025 } }
```

`style-src 'unsafe-inline'` only if the chosen UI kit needs it; otherwise drop it. Cookie is `__Host-` so no `Domain`; paths `/admin` and `/` share it.

### 3.3 Jobs / cron placement

Decision: **pg-boss runs inside the API process** (`WORKER_ENABLED=true`), no separate worker container, no Redis.

- Job volume: ~40 bookings/day → a few hundred emails/day, one sweeper tick/minute, one reminder tick/5 min, daily cleanups. A worker container would idle 99.9 % of the time and double the deploy surface.
- Auto-release: `boss.schedule('auto-release-sweep', '* * * * *', null, { tz: 'UTC' })` → handler runs one idempotent SQL: `UPDATE bookings SET status='AUTO_RELEASED', released_at=now() WHERE status='CONFIRMED' AND checked_in_at IS NULL AND start_at + settings.auto_release_grace <= now() RETURNING id` → for each row: audit insert + `boss.send('email', …)` in the **same transaction** (`fromDrizzle(tx, sql)` adapter, so no email without state change and vice versa). A sweeper is self-healing (no per-booking delayed job to cancel on reschedule/cancel) and trivially idempotent on retry — v1 TC-QR-006 passes by construction.
- Reminders: same pattern, `*/5 * * * *`, `WHERE reminder_sent_at IS NULL AND start_at BETWEEN now()+X AND now()+X+5min`.
- Email queue: `createQueue('email', { retryLimit: 8, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deadLetter: 'email-dlq' })`; `notifications` row per (booking_id, type, revision) with a unique index → the handler upserts provider message id, so a retried job never double-sends.
- Graceful shutdown: SIGTERM → stop HTTP listener → `boss.stop({ graceful: true, timeout: 25_000 })` → close pool; compose `stop_grace_period: 30s`.
- pg-boss options: `schema: 'pgboss'`, `migrate: true` (schema owned by `rf_app`, see §4.11), `supervise: true`, `archiveCompletedAfterSeconds: 86400`, `deleteAfterDays: 7`.
- Ceiling/upgrade path (document in code): if job CPU (e.g. .ics rendering, CSV import of 1 000 users) ever shows in API p95, start a second container from the same image with `WORKER_ENABLED=true` and set it `false` on the API — zero code change.

---

## 4. Security checklist (app-specific, each item = decision + test hook)

| # | Area | Decision | Verified by |
|---|---|---|---|
| 4.1 | **Session cookies** | Server-side sessions in Postgres `sessions(id_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent, remember)`; cookie `__Host-sid=<256-bit base64url>`; `HttpOnly; Secure; SameSite=Lax; Path=/`; idle 12 h, "Remember me" = 30 d sliding, absolute max 30 d; new session id on login (fixation), all sessions of a user deleted on password change / deactivation / role change; logout deletes row; expired rows purged daily by pg-boss. Session lookup joins `users.status='ACTIVE'` so deactivation is immediate. No JWT. | TC-AUTH-009 |
| 4.2 | **CSRF** | SameSite=Lax + API accepts only `Content-Type: application/json` for mutating routes + **Origin/Sec-Fetch-Site check** on every non-GET (reject if `Origin` present and ≠ `PUBLIC_BASE_URL`). No CSRF tokens. (Fastify: 6-line `onRequest` hook; Hono: built-in `csrf()`.) | TC-SEC-021 |
| 4.3 | **Passwords** | NIST 800-63B: min 10, max 128 chars, no composition rules, reject if contains employee_code/email local-part, reject top-10k common list (`packages/shared/common-passwords.txt`). **argon2id** via `@node-rs/argon2`, m=64 MiB, t=3, p=1 (OWASP ≥ m=19 MiB,t=2); rehash on login if params changed. Admin-provisioned accounts get an **invite link** (random token, hash stored, 48 h, single use) to set their own password — admins never see or email passwords. Password reset = same token flow, 30 min. Login identifier = employee_code **or** email + password; mobile is not a credential (see v1 Q-09). | TC-AUTH-009 |
| 4.4 | **Rate limiting** | Login: 5 failures / 15 min per account → 15 min soft lock, 30 req/min per IP; generic error text; dummy argon2 verify on unknown user (no timing/enumeration). Also limit `/auth/forgot`, `/auth/invite/:token`, `/checkin/:token` (10/min/IP), `POST /bookings` (60/min/user). In-memory store (`@fastify/rate-limit` / `hono-rate-limiter`). `// ponytail: in-memory; single API instance. Move to a PG table if we ever run 2 replicas.` | TC-RATE-024 |
| 4.5 | **RBAC at API** | Roles `EMPLOYEE`, `ADMIN`, `FACILITY` (read-only schedule). One prefix-level guard for `/api/admin/*` (ADMIN) and `/api/facility/*`; resource-level rule in the booking service: owner or ADMIN for PATCH/cancel; attendees/owner/ADMIN for reading private details. Admin SPA is UI only — every admin capability exists only as an admin route. Non-visible resources return **404** (not 403) to avoid enumeration. | TC-RBAC-010 (table: every route × role → expected status) |
| 4.6 | **Private-meeting masking** | Masking happens in the **query/serializer**, not the client: calendar/availability/search return `title: 'Busy'`, no description/attendees/special_request for non-privileged viewers; `.ics` and emails go only to owner + attendees; audit rows store masked `before/after` for non-admin readers; log lines never include titles. Tests call the API directly as another employee, as FACILITY, unauthenticated, and via every endpoint that can leak (calendar, search, booking detail, approvals list, reports, audit, ICS download). | TC-PRV-004 (+ TC-PRV-004b direct API per endpoint) |
| 4.7 | **Audit log immutability** | `audit_logs(id, at, actor_id, actor_role, action, entity, entity_id, reason, before jsonb, after jsonb, ip, request_id)`; written **inside the same transaction** as the mutation; `rf_app` has `INSERT, SELECT` only (REVOKE UPDATE/DELETE); plus `CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs … RAISE EXCEPTION` so even `rf_owner` can't slip (migrations touching it are forbidden). Retention: forever (tiny). | TC-AUD-016 (UPDATE/DELETE as app role → permission denied) |
| 4.8 | **Idempotency-Key** | Required on `POST /bookings`, `POST /admin/bookings/:id/approve|reject`, `POST /bookings/:id/cancel`. Table `idempotency_keys(user_id, key, request_hash, status_code, response jsonb, created_at)` PK `(user_id, key)`. Flow: `INSERT … ON CONFLICT DO NOTHING` → if conflict: same hash → replay stored response; different hash → 422; row exists but no response yet → 409 "in progress". Purged after 24 h. Double-click/retry never creates two bookings. | TC-IDEM-011 |
| 4.9 | **Input validation** | zod schemas in `packages/shared` shared by forms and API; API parses with `.strict()` (unknown keys rejected); uuids for ids; time rules validated in app **and** enforced by DB: `CHECK (end_at > start_at)`, `CHECK (end_at - start_at >= interval '60 min')`, slot alignment via `CHECK (extract(minute from start_at) IN (0,30))` (if 30-min increment is confirmed, v1 Q-11), business-hours/holiday/advance-window checks in the service (they depend on `settings`), attendees ≤ 50 valid emails, `title ≤ 200`, `special_request ≤ 1000`, calendar range ≤ 62 days per request. React escapes output; email templates escape; no raw HTML from users anywhere. | TC-VAL-012 |
| 4.10 | **Backups** | Host cron, `infra/scripts/backup.sh`: every **6 h** `docker exec rf-prod-postgres pg_dump -Fc -U postgres reserveflow \| age -r $BACKUP_AGE_RECIPIENT > rf-$(date -u +%FT%H%M).dump.age` → `rclone copy` to R2/B2 bucket (versioned, separate credentials with write-only where supported) → `curl $HEALTHCHECKS_URL`. Retention: 6-hourly for 7 d, daily 30 d, monthly 12 m (`rclone delete --min-age`). Pre-deploy dump by the deploy job. RPO 6 h / RTO ≤ 30 min, drilled (§7.3). **PITR option**: not at launch. If the business asks for RPO < 1 h, add WAL-G/pgBackRest archiving to the same bucket (≈ half a day of work) — or it comes free with Render managed Postgres. | TC-BK-022 (restore drill) |
| 4.11 | **Least-privilege DB** | Roles: `postgres` (superuser, admin only), `rf_owner` (owns schema `public`, runs migrations, `DATABASE_URL_MIGRATE`), `rf_app` (runtime: `USAGE` on schema, `SELECT/INSERT/UPDATE/DELETE` on tables via `ALTER DEFAULT PRIVILEGES`, **no DDL**, no UPDATE/DELETE on `audit_logs`, no DELETE on `bookings` (cancel = status change, v1 rule 6)). pg-boss: `rf_owner` creates schema `pgboss` and `ALTER SCHEMA pgboss OWNER TO rf_app` so pg-boss can self-migrate inside its own schema only. Created by `infra/db/init/01-roles.sql`. Connection pool max 10. `statement_timeout=10s` on `rf_app` role. | TC-AUD-016, integration setup |
| 4.12 | **Log redaction & PII** | pino `redact: ['req.headers.cookie','req.headers.authorization','res.headers["set-cookie"]','*.password','*.mobile','*.token','*.email']`; bodies never logged; booking titles never logged (ids only). Mobile numbers: stored E.164, shown masked (`08x-xxx-1234`) except to ADMIN and self, never in emails/QR/logs/exports; purpose documented (PDPA): contact only. User **removal** = soft delete + anonymize name/email/mobile after 90 days (bookings keep `creator_id` pointing at an anonymized row; reports unaffected). Room photos: admin upload only, magic-byte check (`file-type`), resize with sharp, ≤ 5 MB, served from `/uploads/` with `nosniff`. | TC-USR-017, TC-SEC-021 |
| 4.13 | **QR check-in threat model** | Two modes (BRIEF: admin-at-room + QR self check-in). **Mode A (admin scans employee's QR)**: QR encodes `https://reserve…/c/<token>`; token = random 256-bit, SHA-256 stored in `checkins`, bound to booking, valid only in window [start−15 min, start+15 min] (v1 Q-16), **single-use**, regenerated on reschedule, voided on cancel; scanner must be an ADMIN/FACILITY session (`POST /api/admin/checkin {token}`); audit who/when/IP. **Mode B (employee scans static room QR)**: room QR encodes `…/checkin?room=<id>`; requires the employee's own session; server picks *that user's* booking in *that room* within the window. Threats: *replay* → single-use + window + status check; *photo of the room QR from home* → accepted residual risk at MVP (it only preserves your own booking; logged with IP; optional `CHECKIN_ALLOWED_CIDRS` office-IP allowlist toggle in settings, 5 lines); *token brute force* → 256-bit + rate limit 4.4; *QR leak in email* → token is only in the employee's booking page/email, low impact. No PII in any QR. Admin manual check-in (no QR) always available with reason. | TC-CHK-019 |
| 4.14 | **Email domain auth** | Send through the **company's own mail system** as an internal tool should: Google Workspace SMTP relay or Microsoft 365 (connector / High Volume Email; plain SMTP AUTH is being retired — confirm with IT in Week 1). Then SPF/DKIM/DMARC are *already* the company's; only ask IT to allow `reserve@company.co.th` as sender. Fallback if IT says no: Postmark (~$15/mo, 10k) on subdomain `mail.reserve.<company>.co.th` with its DKIM CNAMEs, SPF `include:spf.mtasv.net`, DMARC `p=none` → `p=quarantine` after 2 weeks of clean reports, bounce webhook marks addresses. Either way: verify with a mail-tester score ≥ 9 and a send to Gmail + Outlook before go-live; log provider message ids in `notifications` so delivery rate (v1 Q-19) is measurable. | TC-EMAIL-014, release gate |
| 4.15 | **Admin actions require reason** | Reject, admin-cancel, admin reschedule (incl. drag-and-drop), business-hours override booking, deactivate/delete user, role change, approval-mode change, holiday add that affects existing bookings. `reason` zod `min(5).max(500)`, stored in `audit_logs.reason`, shown in the affected user's email. | TC-AUD-016, TC-DND-023 |
| 4.16 | **Headers** | Caddy (static) per §3.2; API `@fastify/helmet`/hono `secureHeaders` with the same CSP (API serves no HTML, so CSP `default-src 'none'`), `X-Frame-Options DENY`, no `X-Powered-By`. Playwright test asserts the header set on `/`, `/admin/`, `/api/healthz`. | TC-SEC-021 |
| 4.17 | **Dependency & image scanning** | `pnpm install --frozen-lockfile`; `pnpm audit --prod --audit-level=critical` blocking, `high` warn; Dependabot weekly (npm grouped minor/patch, docker, github-actions); Trivy action on built images (warn). Lockfile changes reviewed. | CI |
| 4.18 | **Errors & misc** | No stack traces to clients; error body `{ code, message, requestId }`; 500s → Sentry. Timing-safe compares for tokens. Uploads dir not executable. Container: non-root, `read_only: true` + tmpfs `/tmp`, `security_opt: no-new-privileges`. API only reachable via Caddy (no published port). Caddy admin API stays on localhost. | TC-SEC-021 |

Booking-integrity reminder (not "security" but the same trust boundary): `btree_gist` EXCLUDE on `(room_id WITH =, slot WITH &&) WHERE status IN ('CONFIRMED','CHECKED_IN')` is the last word; the API maps SQLSTATE `23P01` → 409 `SLOT_TAKEN`. Approve = `UPDATE … WHERE id=? AND status='PENDING_APPROVAL'` inside a tx; losers get 409 and stay PENDING (admin sees them as "conflicts with approved"). Pessimistic `SELECT … FOR UPDATE` on the room row is unnecessary — the constraint serialises.

---

## 5. Test strategy

### 5.1 Layers & tooling

| Layer | Tool | Runs | Against | What |
|---|---|---|---|---|
| Unit | Vitest (`packages/shared`, `apps/api` domain) | every PR, < 30 s | pure functions | slot rules (60 min min, 30-min increments, 08:30–17:30, ≤ 30 d ahead, holidays, Bangkok ↔ UTC), status state machine, masking function, utilization formula, `.ics` builder (stable UID, METHOD REQUEST/CANCEL, SEQUENCE bump), password policy, idempotency hash, CSV import parser/validator |
| Integration | Vitest + **real Postgres** (local: compose `postgres` on 5432 with a `reserveflow_test` DB; CI: service container). `// ponytail: no testcontainers; one DATABASE_URL, TRUNCATE … CASCADE between tests, files run serially (fileParallelism: false)`. Fastify `app.inject()` / Hono `app.request()` — full stack minus sockets. | every PR, ~1–2 min | migrated schema, rf_app role | everything with DB semantics: create/overlap/adjacent, pending overlap allowed in manual rooms, approve race, cancel releases slot, edit = re-check + reapproval (v1 Q-13), masking per role, RBAC matrix, idempotency replay, audit rows + immutability, sessions, rate limits, check-in window/replay, sweeper idempotency, email job enqueued (Mailpit assert) |
| Concurrency | Node script (`undici` fetch, `Promise.all`) inside the integration suite **and** as a standalone `pnpm test:race` against a real HTTP server (CI main + staging) | every PR (inject) + main (HTTP) | real Postgres | §5.2 |
| E2E | Playwright (`apps/e2e`), chromium; `@smoke` subset on PR; full on main vs staging | PR 2–3 min / main 8 min | built api + `vite preview` (PR) / staging URL (main) | critical journeys §5.3 |
| Accessibility | `@axe-core/playwright` in the same E2E run | PR | each key page × 2 apps | §5.4 |
| Email | Mailpit REST (`GET /api/v1/search?query=to:…`, `/api/v1/message/:id`) from integration + E2E | PR | Mailpit | recipients, Thai subject, `.ics` attachment present/valid, UID stable across update, METHOD:CANCEL on cancel, no private title to non-attendees |
| Jobs | integration tests call handlers directly (no pg-boss clock); one test starts pg-boss for real and asserts a scheduled job runs | PR | Postgres | §5.5 |
| Performance | k6 (`infra/k6/calendar.js`) | main nightly vs staging seeded with 3 yrs × 3 rooms (~20k bookings) | staging | §5.6 |
| Security | Playwright header/cookie assertions + `pnpm audit` + Trivy | PR / CI | | TC-SEC-021 |
| Migrations | `migrations-check` job | PR | | TC-MIG-025 |

### 5.2 The concurrency tests (must pass 100 % — release gate)

```ts
// apps/api/test/race/book-same-slot.test.ts  (TC-CON-001)
const N = 100, slot = nextWeekday('13:00','14:00'), users = await seedUsers(10), room = await seedRoom({ approval: 'AUTO' })
const statuses = await Promise.all(Array.from({ length: N }, (_, i) =>
  api.post('/api/bookings', { cookie: users[i % 10].cookie, 'idempotency-key': randomUUID() },
           { roomId: room.id, startAt: slot.start, endAt: slot.end, title: `race ${i}` }).then(r => r.status)))
const tally = Object.groupBy(statuses, s => s)
expect(tally[201]?.length).toBe(1)
expect(tally[409]?.length).toBe(N - 1)
expect(await db.count(bookings, and(eq(bookings.roomId, room.id), inArray(bookings.status, ['CONFIRMED','CHECKED_IN'])))).toBe(1)
expect((await api.get(`/api/calendar?from=…&to=…`)).body.items.filter(i => i.roomId === room.id)).toHaveLength(1)
```

Variants in the same file:
- **Approve race (TC-APR-003)**: manual room, 5 overlapping PENDING requests (must all be accepted as 202/201 PENDING — constraint excludes PENDING), then `Promise.all` of 5 approvals by two admin sessions → exactly one `CONFIRMED`, four `409 CONFLICTS_WITH_APPROVED` and still `PENDING` (or auto-`REJECTED` if the policy decision says so — one assertion flips); exactly one confirmation email job, four none.
- **Approve vs cancel race**: owner cancels while admin approves → end state is either CANCELLED or CONFIRMED, never both events emailed; audit shows the order.
- **Cancel-then-rebook race**: A cancels while B books the same slot 100× in parallel → at most one CONFIRMED at any time; final: B confirmed iff A's cancel committed first.
- **Idempotent double-click**: same user, same key, 20 parallel → 1 booking, 20 × identical 201 body (or 409-in-progress that settles to 201 on retry).
- **Adjacent slots**: `[13:00,14:00)` and `[14:00,15:00)` both succeed (half-open range).
- Run with `app.inject` in PR (exercises DB concurrency because each handler awaits the pool) and with real HTTP (`undici`, keep-alive, 100 sockets) on main.

### 5.3 Playwright critical journeys (`@smoke` marked *)

1. *Login (employee) → wrong password ×5 → lockout message generic; correct login → lands on Room Search. Session persists on reload; logout clears.
2. *Search (date, 13:00–14:00, 10 people, projector) → room list filtered (FR-001/002/011) → Room detail → occupied slot shown red & unselectable → book auto-approve room → confirmation page → Mailpit shows Thai confirmation email with `.ics`.
3. *Manual room: book → "Under review" → admin login (admin app) → Approvals inbox shows conflict group → Approve one with reason → employee email "approved"; the other → Reject with reason → email "rejected" (FR-005/006/009).
4. *Cancel from My Bookings → second browser context immediately sees slot free (FR-008/US-005).
5. *Private meeting: user A books with Private → user B calendar shows "Busy", B opens booking URL → 404 (US-007).
6. Edit time → re-check conflict → reapproval if manual room (Q-13).
7. Admin drag-and-drop reschedule on calendar → reason modal → conflict preview; keyboard alternative (select event → "Move…" dialog) (NFR Usability, TC-DND-023).
8. Check-in: (a) admin scans → open `/c/<token>` in admin session → CHECKED_IN; (b) employee self check-in page with `?room=`; (c) expired token → error. Auto-release end-to-end: seed booking 16 min ago → trigger sweeper via test endpoint (`POST /api/test/run-job`, only mounted when `NODE_ENV=test`) → status AUTO_RELEASED + email.
9. Admin: add room with features/photo/approval mode; rooms appear in search. Users: CSV import dry-run report → import → invite emails in Mailpit → invitee sets password via link → can log in; deactivate user → their session dead on next request.
10. Reports: utilization page renders bars for 3 rooms for a seeded month; numbers match a SQL oracle (TC-RPT-018).
11. Facility role: daily schedule read-only, private titles masked, no edit controls, admin routes 404.

### 5.4 Accessibility

`AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag22aa']).analyze()` on: login, search, room detail/booking form, my bookings, check-in, admin approvals, admin calendar, rooms, users (+CSV modal), settings/holidays, reports. Fail on `serious`/`critical`. Plus: keyboard-only complete booking (tab order, focus visible, dialog focus trap), 200 % zoom (`page.emulateMedia` + viewport 640×900) no horizontal scroll and no clipped slot list, status never colour-only (icon/text next to red slots), Thai text at 200 % readable (font fallback test screenshot), `prefers-reduced-motion` honoured on drag-and-drop animations. (TC-A11Y-008)

### 5.5 Job tests

- `auto-release-sweep` handler run twice on the same data → one status change, one audit row, one email job (unique `(booking_id,type,revision)` proves it); checked-in booking untouched; booking at start+14 min untouched; booking at start+15 min released; timezone: booking created in Bangkok afternoon crosses nothing weird (UTC storage).
- Handler throws after the UPDATE inside the tx → nothing persisted, pg-boss retries, second run succeeds exactly once.
- Email handler: provider error → job fails → retried with backoff → after `retryLimit` lands in `email-dlq` → Sentry event + `notifications.status='FAILED'`; success stores `provider_message_id`; re-run on a `SENT` row is a no-op.
- Reminder sweep, session purge, idempotency purge: one test each (rows before/after).
- Real pg-boss boot test: `boss.start()` with `schema: 'pgboss_test'`, schedule `* * * * *`, advance by calling `boss.send` manually, assert `work()` handler invoked; then `boss.stop()`.

### 5.6 Performance (calendar p95 ≤ 2 s, NFR)

Budget split: API ≤ 500 ms p95 for `GET /api/calendar?from=<Mon>&to=<Sun>` (3 rooms × 7 days), render ≤ 1 s, network ≤ 0.5 s. k6: 20 VUs, 60 s, mix 80 % week view / 20 % month view, `thresholds: { 'http_req_duration{name:calendar}': ['p(95)<500'], http_req_failed: ['rate<0.01'] }`. Dataset: seed 3 years × 3 rooms × ~8/day ≈ 20k bookings + 10k cancelled. Also an integration test that runs `EXPLAIN (ANALYZE, FORMAT JSON)` on the calendar query and asserts index use on `(room_id, start_at)` and no seq scan on `bookings`. Front-end: Playwright `performance.now()` around calendar navigation on staging with the seeded dataset, assert < 2 s (informational, not blocking).

### 5.7 FR/NFR → test ID mapping (extends v1 TC-CON-001…TC-A11Y-008)

| Test ID | Covers | Layer | Description |
|---|---|---|---|
| TC-CON-001 | FR-003, NFR-Concurrency, US-002 | integration + race | 100 parallel POST same slot → exactly 1 × 201 |
| TC-AVL-002 | FR-001, FR-002, FR-008 | integration + e2e | availability reflects create/edit/cancel/approve immediately |
| TC-APR-003 | FR-005, FR-006, US-004 | integration + race | conflict group approve race → 1 CONFIRMED |
| TC-PRV-004 | NFR-Security, US-007 | integration + e2e | masking per role, every endpoint, direct API |
| TC-CAN-005 | FR-008, US-005 | integration + e2e | cancel releases slot, audit complete |
| TC-QR-006 | FR-010, US-006 | job test | auto-release once even on retry |
| TC-PERF-007 | NFR-Performance | k6 + EXPLAIN | calendar p95 ≤ 2 s (API ≤ 500 ms) |
| TC-A11Y-008 | NFR-Accessibility | axe + Playwright | keyboard, zoom 200 %, contrast, non-colour status |
| **TC-AUTH-009** | Login/slides "must login", Q-08/Q-09 | integration + e2e | password policy, argon2id, lockout, session lifecycle, invite/reset tokens |
| **TC-RBAC-010** | admin scope (company.txt), facility role | integration (table-driven) | every route × {anon, EMPLOYEE, FACILITY, ADMIN, deactivated} → expected status |
| **TC-IDEM-011** | FR-003 (double submit), v1 security baseline | integration + race | Idempotency-Key replay / mismatch / in-progress |
| **TC-VAL-012** | business rules (08:30–17:30, ≥ 60 min, ≤ 1 month, increments, holidays) | unit + integration | API + DB CHECK reject; admin override path |
| **TC-EDIT-013** | FR-008, Q-13 | integration + e2e | reschedule = re-check + reapproval; title edit no reapproval; `.ics` SEQUENCE bump |
| **TC-EMAIL-014** | FR-007, FR-009, NFR-Reliability, US-003 | integration + Mailpit + job | templates, `.ics` REQUEST/CANCEL, retry/backoff, DLQ, delivery metrics recorded |
| **TC-AUD-016** | v1 audit baseline, FR-006 reasons | integration | audit row per mutation in same tx; UPDATE/DELETE denied; reason required on admin actions |
| **TC-USR-017** | admin user management (BRIEF deliverable 2) | integration + e2e | CSV dry-run/import/upsert, invite flow, deactivate kills sessions, delete anonymizes PII |
| **TC-RPT-018** | FR-012, US-008 | unit + e2e | utilization formula vs SQL oracle; holidays/closed hours excluded from denominator |
| **TC-CHK-019** | FR-010 (both modes) | integration + e2e | token window, single-use, wrong room, regenerated on reschedule, admin manual check-in with reason |
| **TC-JOB-020** | FR-009/FR-010 infra | job | sweeper/reminder/purges idempotent; graceful stop; pg-boss boot |
| **TC-SEC-021** | v1 security baseline | Playwright + CI | cookie flags, CSP/HSTS headers, Origin check, no stack traces, audit/Trivy clean |
| **TC-BK-022** | release gate | manual drill (runbook §7.3) | restore latest dump to staging ≤ 30 min, counts match |
| **TC-DND-023** | NFR-Usability | e2e | admin drag-and-drop + keyboard alternative + reason + conflict rollback |
| **TC-RATE-024** | security | integration | login/checkin/forgot rate limits, generic messages |
| **TC-MIG-025** | CI gate | CI | schema↔SQL sync, fresh migrate, migrate from last tag |
| **TC-OPS-026** | §6 | integration + smoke | `/healthz` 200, `/readyz` 503 when DB down, request-id echo, redaction |

RTM for the doc: FR-001→002/007/008; FR-002→002/012; FR-003→001/011; FR-004→012/004; FR-005→003; FR-006→003/016; FR-007→014/013; FR-008→005/013/002; FR-009→014/020; FR-010→006/019/020; FR-011→002 (filters); FR-012→018; NFR-Concurrency→001/003/011; NFR-Performance→007; NFR-Security→004/010/021/009; NFR-Usability→023; NFR-Reliability→014/020; NFR-Accessibility→008. (Fixes v1 Q-04: the sample RTM mapped FR-001→Login and FR-003→Create Item.)

---

## 6. Observability

Phase 1 (launch) — enough for 80 users, three SaaS free tiers, one extra container = zero:

- **Logs**: pino JSON to stdout (Fastify's built-in logger / Hono + pino), docker json-file with rotation, read via `docker compose logs -f api` / `docker logs --since`. Fields: `time, level, reqId, method, route, status, durMs, userId, role, err` — never titles, emails, mobiles, cookies (redact list §4.12). Audit-relevant events (`booking.created`, `booking.conflict`, `approval.decided`, `email.sent/failed`, `job.auto_release`) are logged at `info` with ids and a `result` field so grep/`jq` answers "how many 409s today" until there is a metrics stack.
- **Request id**: accept `X-Request-Id` from Caddy (`request_id` placeholder) or generate UUIDv7; echo in response header, in every log line, in error bodies, in `audit_logs.request_id`, as Sentry tag. Front-ends show `requestId` in the error toast ("แจ้ง IT พร้อมรหัสนี้").
- **Sentry** (free tier): `@sentry/node` in API (errors + tracing sample 0.2 → p95 per route in Performance; alert rule "calendar p95 > 1 s over 10 min"), `@sentry/react` in both SPAs (errors; replay off or `maskAllText` for privacy), release = git sha, sourcemaps uploaded in CI. **Sentry Cron Monitors** for `auto-release-sweep` (expect check-in every minute, grace 2 min) and the host backup cron (daily) — job-lag alert for free.
- **Uptime**: external check (Better Stack / UptimeRobot free, 1–5 min) on `https://reserve…/api/readyz` and `/` (expect 200 + `<title>ReserveFlow`), alert to the team's LINE/email.
- **Health endpoints**: `GET /api/healthz` → 200 `{ok:true}` (liveness, no deps); `GET /api/readyz` → `SELECT 1` with 1 s timeout + `boss.started` → 200 or 503 `{db:false}`; compose `healthcheck` uses `/readyz`; Caddy returns 502 page if api is down (custom static "กำลังปรับปรุงระบบ" via `handle_errors`).
- **Host**: provider's free VM alerts (CPU > 80 %, disk > 80 %); `df` check inside backup script (fail heartbeat if < 2 GB free).
- **Business/ops metrics from the DB** (no metrics stack needed): an admin "System" tab or weekly SQL: booking conflict rate (count of `booking.conflict` log lines per day — log-only, no attempts table); approval SLA (`approved_at - created_at` p50/p95), email delivery rate (`notifications` SENT/FAILED/BOUNCED per day — v1 Q-19 denominator = accepted, non-suppressed), no-show / auto-release rate, pending-approval age, failed logins per account. These are product KPIs (v1 §07 post-release list) and live in Reports.

Alerts that actually page (Phase 1): site down (uptime), error spike (Sentry: > 10 events/5 min), cron monitor missed (sweeper stopped = auto-release broken), email DLQ non-empty (Sentry `captureMessage` from the job + admin banner), backup heartbeat missed, disk > 80 %.

Phase 2 (only if Phase 1 proves insufficient): `prom-client` `/metrics` on the API (http histogram by route, `booking_create_total{result}`, `email_total{result}`, pg-boss queue depth/oldest job age) + Grafana Cloud free tier with one Alloy container scraping metrics and shipping docker logs (searchable logs, dashboards, alerting in one place). Ceiling stated; ~half a day to add.

---

## 7. Release gates, runbook, day-2

### 7.1 Release gates (go-live and each prod release)

1. All required CI checks green on the tagged sha; `pnpm audit` no critical; Trivy no critical in images.
2. Concurrency suite (TC-CON-001, TC-APR-003, TC-IDEM-011 race variants) 100 % pass, run against staging via real HTTP.
3. Migration review checklist ticked in PR (backward-compatible rules §2.3); `migrations-check` green; staging migrated from previous prod dump without error.
4. UAT sign-off on Must FRs (001–006, 008, 009) by admin + 2 employees on staging with Mailpit; Should/Could features explicitly marked in/out.
5. Backup restore drill done in the last 30 days (first one before go-live); rollback rehearsed on staging in the last 30 days.
6. Email: domain auth verified (mail-tester ≥ 9 or IT confirmation for relay), test mails received in Gmail + Outlook + company inbox with `.ics` opening in Google/Outlook/Apple.
7. Sentry + uptime + cron monitors configured for prod; alert recipients confirmed.
8. Runbook (this section) + Admin manual + Employee quick guide (Thai) published; first ADMIN account created via CLI; rooms, business hours, Thai public holidays for the current year, users CSV loaded; go-live announcement drafted.
9. Security sign-off: TC-SEC-021, TC-RBAC-010, TC-PRV-004 green; manual 30-min poke (cookie flags in devtools, `/admin` as employee → 404, direct API calls with another user's ids).

### 7.2 Runbook

**Deploy (prod)** — tag `vX.Y.Z` → approve the `production` environment in GitHub → job does: `ssh deploy@vm` → write `.env` → `docker compose -p rf-prod -f compose.prod.yml pull` → `docker exec rf-prod-postgres pg_dump -Fc … > /srv/backups/pre-vX.Y.Z.dump` → `docker compose run --rm migrate` (fails → stop, nothing else changed) → `IMAGE_TAG=<sha> docker compose up -d api caddy` (≈ 5–10 s API blip; acceptable — deploy window = outside 08:30–17:30 or lunch) → `curl -f https://…/api/readyz` → Playwright smoke `@prod-safe` (login page renders, `/api/rooms` returns 3) → post "deployed vX.Y.Z" in team chat. Manual fallback: same commands from `infra/scripts/deploy.sh`.

**Rollback** — (1) App only: `IMAGE_TAG=<previous sha> docker compose up -d api caddy` (1 min; safe because migrations are backward-compatible). (2) Schema too (only if a migration is itself wrong): stop api → `pg_restore --clean --if-exists -d reserveflow /srv/backups/pre-vX.Y.Z.dump` → start previous image → announce that bookings made in the window were lost (email log in Mailpit/provider tells who to contact). Decision rule: prefer fix-forward within 30 min; restore only for data corruption.

**Restore-from-backup drill (quarterly; first before go-live)** — on the VM: `rclone copy r2:rf-backups/<latest> .` → `age -d -i ~/.age/key.txt` → `docker compose -p rf-staging exec -T postgres pg_restore --clean --if-exists -U postgres -d reserveflow` → run `infra/db/scrub-staging.sql` (mobile/email anonymize) → open staging, log in, compare `SELECT count(*) FROM bookings` with prod → record time-to-restore in `docs/ops/drills.md`. Target ≤ 30 min. Also once a year restore on a fresh VM from the repo + bucket only (DR proof).

**Rotate secrets** — DB app password: `ALTER ROLE rf_app PASSWORD '…'` → update `PROD_ENV_FILE` → redeploy (10 s reconnect). SMTP credential: create new in Workspace/M365/Postmark → update → deploy → revoke old. Backup `age` key: generate new, update cron env, keep old private key in the team password manager labelled with date range (old dumps need it). SSH deploy key: add new to `authorized_keys` → update GH secret → remove old. GHCR uses `GITHUB_TOKEN` (nothing to rotate). Cadence: on any departure, else yearly.

**Incidents (short)** — API down: `docker compose ps`, `logs --tail 200 api`, `up -d api`; DB down/disk full: check `df`, prune old docker images (`docker system prune -af --filter until=168h` is in weekly cron), restart postgres; email outage: jobs retry 8× with backoff, DLQ alert → fix creds → `boss.resume`/re-send from admin "Notifications" page; TLS: Caddy renews itself — if port 80 got blocked, `ufw status`; lost admin password: `pnpm --filter api cli reset-password <employee_code>` on the VM (`docker compose run --rm api node dist/cli.js …`).

### 7.3 Day-2 checklist

- **Add a room**: Admin → Rooms → New (name, floor, capacity, features + qty, approval mode, photo, active) → optional per-room hours (default = global 08:30–17:30) → "Print room QR" (static `?room=` QR for self check-in, A5 PDF) → test-book it in staging first if it has manual approval → announce. Rooms are never deleted, only deactivated (history/report integrity).
- **Onboard users via CSV**: template `employee_code,full_name,email,mobile,department_code,role` (UTF-8 with BOM so Thai opens in Excel) → Admin → Users → Import → **dry-run** report (duplicates, invalid email/mobile, unknown department, role not in set) → confirm → rows upserted by `employee_code`, new users get invite email (set password, 48 h; "Resend invite" button), existing users updated; result CSV downloadable. Offboarding: Deactivate (immediate: sessions killed, future bookings listed → admin cancels with reason or reassigns owner) → Delete after 90 days = anonymize (PDPA). Role change requires reason.
- **Holiday calendar**: Admin → Settings → Holidays: add date + name (or import next year's Thai public holidays CSV each December; BOT list is the reference) → effect: slots not selectable, utilization denominator excludes, existing CONFIRMED bookings on that date shown in a "needs review" list → admin cancels/reschedules with reason (emails go out). Business-hours changes apply to new bookings only (v1 FR-005 note) and are audited.
- **Weekly (15 min)**: Sentry issues triage; Dependabot PRs merged (CI green); check backup heartbeat dashboard; glance at pending-approval age and email failures in Reports; `docker system df` on VM.
- **Monthly**: read DMARC aggregate report (if Postmark path); review audit anomalies (failed logins per account, admin cancels); confirm disk < 70 %; review auto-release/no-show rate with admins (tune 15-min grace in Settings if needed).
- **Quarterly**: restore drill (§7.2); rotate nothing unless departure; Ubuntu `apt full-upgrade` + reboot window (announce); Playwright full suite against prod-safe subset after VM reboot.
- **Yearly**: holidays import, review user list with HR (CSV diff), DR restore on fresh VM, revisit sizing (`docker stats`) and whether Phase-2 observability is warranted.

---

## Open points for the v2 doc (need a decision, not research)

1. Reachability: public HTTPS vs VPN/office-only (affects Caddy cert mode and whether QR self check-in IP allowlist is even needed).
2. Company mail system (Google Workspace vs Microsoft 365) → relay setup vs Postmark fallback (§4.14).
3. Region / data residency preference (Singapore vs AWS Bangkok) — same architecture either way.
4. Approve-race policy for losers (stay PENDING vs auto-REJECT) — flips one assertion in TC-APR-003 and one email template.
5. Who holds the `age` backup key and the production GitHub environment approval (needs ≥ 2 named people).
