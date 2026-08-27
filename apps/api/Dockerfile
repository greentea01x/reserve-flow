# Build context is the REPO ROOT (fly.toml points here):
#   docker build -f apps/api/Dockerfile .
# One Fly image carries the API plus both SPA dists: employee `/`, admin `/admin/`, and
# API `/api/` share one production origin.

FROM node:24-slim AS base
ENV TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@10.27.0
WORKDIR /repo
# Manifests only first, so dependency layers cache across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Production node_modules for the API and its workspace deps only (drops React, Vite, turbo…).
FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile --filter @reserveflow/api...

FROM node:24-slim
ENV NODE_ENV=production PORT=3000
# Supabase project CA for DATABASE_URL sslmode=verify-full. Download it from the Supabase
# dashboard (Database -> SSL) and commit it as infra/supabase/prod-ca.crt; until the file
# exists, Node logs a one-line warning at boot and ignores it.
ENV NODE_EXTRA_CA_CERTS=/app/infra/supabase/prod-ca.crt
WORKDIR /app
# prod-deps kept the /repo layout, so pnpm's relative symlinks stay valid under /app.
COPY --from=prod-deps /repo ./
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY --from=build /repo/apps/admin/dist ./apps/admin/dist
COPY infra/supabase ./infra/supabase
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
USER node
CMD ["node", "apps/api/dist/server.js"]
