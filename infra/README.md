# infra

Production does NOT run from this directory. Prod/staging hosting is:

- **Fly.io** — one app in `sin` serves the employee SPA at `/`, admin SPA at `/admin/`, Hono API at `/api/`, and in-process jobs from the image built by `apps/api/Dockerfile` (`fly.toml` production, `fly.staging.toml` staging).
- **Supabase** — managed Postgres in `ap-southeast-1`; one-time setup in [`supabase/bootstrap.sql`](supabase/bootstrap.sql). There is no Caddy and no prod compose stack.

What lives here:

- `compose.yml` — **local dev only**: postgres + mailpit. Also the restore-drill target (Supabase free allows only 2 projects).
- `db/init/` — role bootstrap for the local compose Postgres.
- `supabase/bootstrap.sql` — one-time bootstrap for each Supabase project (roles, extensions, search_path, timeouts, PostgREST lockdown).

Backups: `.github/workflows/backup.yml` — nightly `pg_dump` → `age` → Cloudflare R2, plus a weekly `SELECT 1` anti-pause ping. Supabase free has no backups and no PITR; that workflow is the backup story.
