# ReserveFlow

ReserveFlow is an internal, Thai-first meeting-room booking system. This repository ships the
employee and administrator web apps, the Hono API, PostgreSQL schema and migrations, booking and
check-in workflows, scheduled jobs, deployment configuration, and the canonical database
initializer.

The employee app supports room search, first-come-first-served booking, room calendars, booking
management, and QR check-in. The administrator app adds oversight, room and user management,
business settings, audit history, and reports. The canonical starting dataset contains Horizon,
Summit, and Grove rooms, 80 employees, and one administrator.

## Prerequisites

- Node.js 24 or newer
- pnpm 10.27.0
- Docker Desktop

Local PostgreSQL and Mailpit run in Docker. The production **target configuration** uses Supabase
PostgreSQL and one Fly.io app serving the employee SPA, admin SPA, API, and background jobs from
`https://reserveflow-api.fly.dev`; external setup and go-live gates are not yet verified. Never
point local commands at that target.

## Start locally

```sh
pnpm install
cp .env.example .env
openssl rand -base64 32
```

Put the generated value in `BETTER_AUTH_SECRET`, choose the three local database passwords, and
fill `DATABASE_URL` with the `rf_app` role and `DATABASE_URL_MIGRATE` with the `rf_owner` role.
Then start PostgreSQL and Mailpit:

```sh
docker compose --env-file .env -f infra/compose.yml up -d --wait
```

On a clean database, create the schema and canonical local data before starting the apps:

```sh
pnpm db:migrate
pnpm db:initialize --apply
```

The initializer needs the guarded values documented in
[`docs/DATABASE-INITIALIZATION.md`](docs/DATABASE-INITIALIZATION.md), including the exact database
confirmation and separate admin/employee bootstrap credentials.

Run every app with `pnpm dev`, or run one shell at a time:

```sh
pnpm --filter @reserveflow/api dev
pnpm --filter @reserveflow/web dev
pnpm --filter @reserveflow/admin dev
```

Open the combined local experience at `http://localhost:5173`; its `/admin/` path proxies the
administrator dev server on port 5174 so both apps share one origin. The API uses port 3000 and
Mailpit's UI uses 8025. Both Vite servers proxy `/api` to the API. In `development`, the API
accepts unsafe requests from configured local/tunnel origins; same-origin browser requests may use
Fetch Metadata when `Origin` is absent. Other environments use the configured public/additional
origin allowlist.

## Product specification

- [`docs/spec/sections/`](docs/spec/sections/) is the source of truth for the final product spec.
- [`docs/spec/BUILD-CONTRACT.md`](docs/spec/BUILD-CONTRACT.md) defines the authoring and build
  contract.
- [`docs/ReserveFlow_Spec.html`](docs/ReserveFlow_Spec.html) is the generated, self-contained
  document; do not edit it by hand.
- [`docs/DATABASE-INITIALIZATION.md`](docs/DATABASE-INITIALIZATION.md) defines the canonical
  one-shot database bootstrap.
- [`docs/UI-HANDOFF.md`](docs/UI-HANDOFF.md) records the as-built employee UI behavior that must
  survive future visual changes.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) is the production deployment runbook.

Create the ignored Python environment once, then regenerate and validate the specification:

```sh
python3 -m venv docs/spec/build/.venv
docs/spec/build/.venv/bin/python -m pip install -r docs/spec/build/requirements.txt
docs/spec/build/.venv/bin/python docs/spec/build/build.py
```

Biome is configured once at the repository root. Direct schema pushes are prohibited outside a
disposable local database; use reviewed migrations and the documented initializer.

## Project records

- [`CHANGELOG.md`](CHANGELOG.md) records notable unreleased product and repository changes.
- [`docs/AI-USAGE.md`](docs/AI-USAGE.md) discloses AI-assisted sessions, affected files, and
  verification without exposing private prompts or credentials.
- [`AGENTS.md`](AGENTS.md) defines the mandatory logging workflow for AI agents.
