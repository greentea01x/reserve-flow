# infra

Production does NOT run from this directory. Prod/staging hosting is:

- **Vercel** — serves both SPA dists and rewrite-proxies `/api/*` to Fly (`vercel.json` at the repo root; deploys via the Vercel git integration).
- **Fly.io** — one always-on machine in `sin` running the Hono API, built from `apps/api/Dockerfile` (`fly.toml` prod, `fly.staging.toml` staging; staging serves its own statics, no Vercel).
- **Supabase** — managed Postgres in `ap-southeast-1`; one-time setup in [`supabase/bootstrap.sql`](supabase/bootstrap.sql). There is no Caddy and no prod compose stack.

What lives here:

- `compose.yml` — **local dev only**: postgres + mailpit. Also the restore-drill target (Supabase free allows only 2 projects).
- `db/init/` — role bootstrap for the local compose Postgres.
- `supabase/bootstrap.sql` — one-time bootstrap for each Supabase project (roles, extensions, search_path, timeouts, PostgREST lockdown).

Backups: `.github/workflows/backup.yml` — nightly `pg_dump` → `age` → Cloudflare R2, plus a weekly `SELECT 1` anti-pause ping. Supabase free has no backups and no PITR; that workflow is the backup story.
