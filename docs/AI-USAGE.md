# AI Usage Disclosure Log

This file provides a factual, privacy-safe record of AI-assisted work in this
repository. It summarizes outcomes and verification; it is not a transcript and
does not contain hidden prompts or private reasoning.

New sessions are added below this introduction, newest first. An ongoing
conversation updates its existing entry instead of creating duplicates.

## Entry template

```markdown
## YYYY-MM-DDTHH:mm:ss+07:00 — Short task title

- Session ID: `YYYY-MM-DD-HHMM-short-slug`
- AI: provider/product; model if known, otherwise `not exposed`
- User request: concise summary
- Decisions and actions: concise factual bullets
- Code/documentation changes: exact paths, or `None`
- Data/external-state changes: details, or `None`
- Verification: command/check and result, or `Not run`
- AI/tools/sources: subagents, tools, services, and external references
- Human review / limitations: remaining review needs and attribution boundaries
```

---

## 2026-08-27T21:58:20+07:00 — Fresh repository initialization

- Session ID: `2026-08-27-2158-import-fresh-repo`
- AI: OpenAI Codex; GPT-5 model family, exact model identifier not exposed.
- User request: Copy the supplied `reserve-flow-main` project into the
  `reserve-flow` workspace without its prior Git history, initialize a new
  repository under the user's identity, and create the first commit. The user
  then asked to verify that no source-account username remained and to use
  `greentea01x` for future GitHub repository ownership references. The user
  subsequently asked to split the imported project into several clear,
  buildable commits, then requested a deep legacy-identity audit before pushing
  `main` to `https://github.com/greentea01x/reserve-flow.git`. After HTTPS
  credentials were unavailable, the user configured GitHub SSH access and
  requested another push attempt. The same conversation then asked why active
  Vercel deployment instructions remained, clarified that the employee site,
  admin site, and API all deploy only on Fly.io, and supplied
  `https://reserveflow-api.fly.dev` as the canonical production origin. After
  seeing the failing deploy check, the user asked to disable deploy CI for now.
- Decisions and actions:
  - Treated the supplied local directory as the canonical source after GitHub
    authentication prevented cloning the linked repository.
  - Copied the project contents without Git metadata so the new repository has
    an independent history on a `main` branch.
  - Used the configured Git author `Winothai Thatthong
    <Winothai.tha@student.mahidol.edu>` for the initial commit.
  - Searched project files, documentation, disclosure logs, hidden project
    files, remotes, and Git history; no source-account username reference was
    present, so no replacement was required.
  - Replaced the single root commit with six dependency-ordered commits:
    workspace/shared packages, API/database, employee web, admin web,
    operations/infrastructure, and documentation/governance.
  - Kept a temporary backup ref during the rewrite and validated commits from
    isolated Git archives so uncommitted later layers could not affect builds.
  - Re-audited the final working tree, every reachable commit snapshot,
    author/committer metadata, ref names, reflogs, local Git configuration, and
    the latest disclosure/commit; no legacy account-handle reference remained.
  - Confirmed the requested GitHub repository contained no refs before adding
    it as `origin`. The first HTTPS push failed before creating a remote ref;
    after GitHub identified the new SSH key as `greentea01x`, changed `origin`
    to `git@github.com:greentea01x/reserve-flow.git` and performed a normal
    first push of `main`.
  - Confirmed the imported hybrid configuration was not a runtime requirement:
    the existing Docker image already bundles both SPA builds and Hono already
    serves employee `/`, admin `/admin/`, and API `/api/` routes.
  - Consolidated the production definition on one always-on Fly app at the
    user-supplied canonical origin. Removed the split-platform configuration and
    build script, made the deploy workflow verify all three route families, and
    rewrote the production runbook and active architecture/operations sources.
  - Preserved the superseded hybrid decision as explicitly historical D-31 and
    added D-33 as the current Fly-only decision instead of rewriting decision
    history. Archived research/review material and prior disclosure entries
    were likewise left factual and append-only.
  - Corrected two invalid documentation-builder package pins discovered during
    regeneration, ignored the documented local virtual environment, and rebuilt
    the published HTML and three affected SVG diagrams from canonical sources.
  - Kept normal lint/typecheck/test/build CI on PRs and pushes, but changed the
    production deploy workflow to `workflow_dispatch` only. Updated the runbook
    and canonical specification so deployment is explicitly manual for now.
- Code/documentation changes: Imported the supplied project unchanged for the
  fresh repository, then updated `.env.example`, `.github/workflows/deploy.yml`,
  `.gitignore`, `CHANGELOG.md`, `README.md`, `package.json`, `fly.toml`,
  `fly.staging.toml`, `infra/README.md`, `apps/api/Dockerfile`, comments in
  `apps/api/src/{app.ts,env.ts}`, `docs/DEPLOY.md`, canonical files under
  `docs/spec/`, generated `docs/ReserveFlow_Spec*.html`, and this disclosure.
  Deleted `vercel.json` and removed the obsolete `build:vercel` script.
- Data/external-state changes: Initialized a new local Git repository in
  `reserve-flow`, then rewrote its single initial commit into six commits on
  `main`. Configured the final `origin` as
  `git@github.com:greentea01x/reserve-flow.git`, pushed the six dependency-ordered
  commits followed by this disclosure update, and enabled upstream tracking.
  Installed GitHub CLI 2.98.0 through Homebrew while resolving authentication;
  its incomplete web device flow was canceled, and the push used SSH instead.
  The Fly-only cleanup and the separate manual-deploy commit were pushed to
  `origin/main`. Because the pushed workflow revision has no `push` trigger, the
  publication did not request a production deployment; future deployments
  require an explicit Actions `Run workflow` action. Read-only HTTP checks were
  made against the existing Fly deployment; no deployment, database, or other
  external state was created or changed. Temporary build dependencies were
  installed in the ignored documentation virtual environment and `/private/tmp`
  only.
- Verification: Checksum-aware copy comparison matched all source file contents
  except this intentionally updated disclosure file. The destination contained
  393 files before Git metadata; no file exceeded 20 MB, and a targeted scan
  found no GitHub token, AWS access-key, or private-key pattern. Git's staged
  whitespace check reported six pre-existing trailing-whitespace/EOF issues in
  supplied research, review, and spike documents; they were preserved to keep
  the import faithful. Final commit author and clean-worktree checks passed.
  A case-insensitive scan of the working tree (including hidden project/Git
  text), every reachable commit snapshot, commit messages, author/committer
  metadata, refs, reflogs, remotes, and local Git configuration confirmed no old
  source-account username reference remains. `origin` points only to
  `git@github.com:greentea01x/reserve-flow.git`.
  Frozen installs and `pnpm build` passed independently for every commit under
  temporary Node 24.20.0 and the repository-pinned pnpm 10.27.0. The admin build
  retained its existing chunk-size warning; no build failed. The rewritten
  final tree matched the pre-split tree except for this updated disclosure.
  The target repository was empty before the push, the push succeeded without
  force, and the remote `main` ref matched the final local `main` commit.
  The Fly-only change passed `pnpm biome check .`, `pnpm typecheck`, and
  `pnpm build` under Node 24.20.0/pnpm 10.27.0; the existing admin chunk-size
  warning remained non-fatal. The deploy workflow parsed as YAML. The spec
  builder completed with no balance, duplicate-ID, leftover, or external-ref
  issues, and `build.py --selftest` passed after headless-Chrome Mermaid render.
  Live read-only checks returned 200 for `/`, `/admin/`, and `/api/readyz` at
  `https://reserveflow-api.fly.dev`. Application tests were not rerun because
  runtime behavior was unchanged; the edits to application files are comments.
  The revised workflow parsed as YAML with `workflow_dispatch` as its only
  deploy trigger; the regenerated spec reported `CHECK CLEAN`, and the remote
  `main` ref matched the final local commit after publication.
- AI/tools/sources: OpenAI Codex coordinating agent; shell, rsync, Git, and the
  user-supplied local project directory; Node 24.20.0, pnpm 10.27.0, TypeScript,
  Vite, Turborepo, Python/Markdown, Mermaid, and headless Chrome for builds;
  GitHub for the empty-repository check and earlier final push; Homebrew and
  GitHub CLI 2.98.0 for the attempted HTTPS web authentication, OpenSSH for the
  successful publication, and `curl` for read-only Fly route checks. Earlier
  GitHub HTTPS and SSH source-clone attempts failed authentication and did not
  change remote state. No subagents were used.
- Human review / limitations: `origin/main` now contains the dependency-ordered
  history and this publication disclosure under the `greentea01x` repository.
  Commit authorship records who created this new history; it does not imply sole
  authorship of the copied application contents. Active production configuration
  and canonical documentation now describe Fly.io only; remaining Vercel text is
  limited to the explicitly superseded D-31 decision, third-party optional-peer
  metadata in `pnpm-lock.yaml`, and factual archived research/review/disclosure
  history. The live public routes are reachable, but authenticated browser smoke,
  production secrets/CA validation, SMTP delivery, and restore drill remain
  go-live gates. Production deployment is intentionally manual-only until the
  repository owner restores a push trigger after its secrets and gates are
  ready.

## 2026-08-26T14:50:47+07:00 — Deploy diagnosis, demo reset, and final spec

- Session ID: `2026-08-26-1450-deploy-secret-diagnosis`
- AI: OpenAI Codex; exact model identifier not exposed to the repository.
- User request: Diagnose the linked failed GitHub Actions deploy while keeping
  automatic deployment enabled during Fly.io/Supabase setup; then temporarily
  hide employee-web email features and reinitialize the local canonical demo
  database without running data-polluting end-to-end tests. The user then asked
  to give every local demo account the same short presenter password. The same
  conversation later requested that the product specification be updated as
  the final-version, as-built reference, with the deployment stack and
  architecture—particularly Fly.io—shown explicitly.
- Decisions and actions:
  - Identified the migration step as the exact failing boundary: both database
    URL variables expanded to empty before Drizzle started.
  - Confirmed that neither repository scope nor the `production` environment
    currently contains Actions secrets or variables, so the failure is
    deployment configuration rather than migration code.
  - Kept the existing migrate-before-Fly architecture and did not gate, disable,
    or move the deploy workflow after the user's clarification.
  - Interpreted “web app” as the employee application (`apps/web`) and retained
    the separate administrator application's required email management UI.
  - Removed employee-visible email addresses, attendee-email create/edit/detail
    surfaces and counts, and email-delivery promises while retaining stored
    emails, attendee records, API contracts, outbox behavior, and dormant UI
    components for future restoration.
  - Confirmed the active target was the loopback Docker database before any
    write, stopped only the local API, created and verified a database-level
    backup, recreated and migrated `reserveflow`, ran the guarded initializer,
    and restarted the API.
  - Avoided browser mutation flows, repository-wide tests, integration tests,
    and future end-to-end tests against the initialized target. Corrected the
    documented initializer invocation and added a non-mutating verification
    section.
  - Kept the application's 10-character password policy unchanged and applied
    the explicitly requested short password only to the local canonical demo
    credential hashes. Reset failed-login counters so prior demo attempts could
    not leave an account temporarily locked.
  - Audited the specification against the current employee/admin routes,
    serializers, transaction services, database initializer, CI workflows and
    deployment files instead of preserving planned abstractions as delivered
    behavior.
  - Made the Markdown sections the canonical as-built source and regenerated
    both standalone HTML outputs. Corrected Better Auth exceptions, response
    shapes, error details, visibility/RBAC, lock behavior, client-side slot and
    validation ownership, final three-room/account data, and current UI gaps.
  - Distinguished repository configuration from verified external deployment
    state. Marked verified TLS provisioning, unique employee onboarding,
    Vercel static security headers, authenticated topology smoke, restore drill,
    PDPA/day-2 procedures and administrator recovery as go-live gaps rather
    than claiming absent artifacts were ready.
  - Promoted the deployment design into an explicit inventory and request-flow
    diagram: 3-tier modular monolith, Vercel for both SPAs and the API proxy,
    Fly.io for the API/jobs, Supabase PostgreSQL, GitHub Actions, encrypted R2
    backups, operator-selected SMTP, health checks and the local Compose stack.
    Corrected stale VM/Caddy diagram sources, the backup data-flow direction,
    unverified staging claims and provider-specific assertions.
- Code/documentation changes:
  - Updated employee UI in `apps/web/src/routes/profile.tsx`,
    `apps/web/src/routes/booking-new.tsx`,
    `apps/web/src/routes/booking-detail.tsx`,
    `apps/web/src/routes/bookings.tsx`, and
    `apps/web/src/components/edit-panel.tsx`.
  - Updated employee copy and regression coverage in
    `apps/web/src/lib/i18n.ts` and `apps/web/src/lib/i18n.test.ts`.
  - Corrected initialization guidance in `docs/DATABASE-INITIALIZATION.md` and
    `docs/DEPLOY.md`; recorded the outcomes in `CHANGELOG.md` and this log.
  - Updated all canonical specification sources in
    `docs/spec/sections/00-overview.md` through
    `docs/spec/sections/11-appendix.md`, the generator in
    `docs/spec/build/build.py`, its Mermaid renderer and new pinned Python
    dependencies in `docs/spec/build/requirements.txt`, plus generated
    `docs/ReserveFlow_Spec.html`,
    `docs/ReserveFlow_Spec.artifact.html`, canonical diagram sources in
    `docs/spec/diagrams/src/{deployment,system-context}.mmd`, and cached diagram
    SVGs including `deployment.svg`, `system-context.svg` and
    `production-deployment.svg`.
  - Aligned supporting entry points and runbooks in `README.md`,
    `docs/README.md`, `docs/UI-HANDOFF.md`,
    `docs/DATABASE-INITIALIZATION.md`, and `docs/DEPLOY.md`.
- Data/external-state changes:
  - GitHub secret and variable names were read without reading values; no
    GitHub secret, workflow, run, deployment, Fly app, or Supabase database was
    created or modified.
  - Preserved the polluted local database as
    `reserveflow_before_reinitialize_20260826_185045` with 109 users, 24 rooms,
    three bookings, and 204 audit rows before replacing `reserveflow`.
  - The active local database now contains exactly 81 credential users (80
    employees and one administrator), eight departments, eight employee job
    titles, and three canonical rooms. Bookings, attendees, sessions,
    notifications, and audit logs are empty.
  - Fresh local-only demo passwords were supplied transiently to the
    initializer and are intentionally not recorded in this repository log.
  - Preserved the clean initialized database as
    `reserveflow_before_password_20260826_185857`, then replaced all 81 local
    credential hashes in one guarded transaction and revoked any sessions.
    The requested raw password is intentionally not recorded here.
  - Five pre-existing `auth.login_failed` audit rows were retained as accurate
    history; they were not created by the password update and were not deleted.
  - A user-requested Git commit records the employee UI, runbook, changelog, and
    disclosure changes and was pushed to `origin/main`. Local database contents,
    backups, and raw credentials were not added to Git.
  - The final-spec update changed repository documentation and generated
    artifacts only; it did not modify a database, deployment, GitHub setting,
    Fly app, Supabase project, Vercel project, email service, or other external
    state.
- Verification:
  - Read the complete failed job log for run `32944223724`, job
    `98101396396`; it failed at `pnpm db:migrate` with both
    `DATABASE_URL_MIGRATE` and `DATABASE_URL` empty.
  - Reproduced the same deterministic failure locally with both variables
    explicitly unset.
  - Confirmed the workflow expects `DATABASE_URL_MIGRATE` and
    `FLY_API_TOKEN`, and that no matching GitHub Actions secrets are configured
    yet at repository or `production`-environment scope.
  - Verified the backup counts before replacement and the initialized database
    afterward: 81 users/accounts, 80 active employees, one active admin, three
    active 20-person rooms each with one microphone and projector, and zero
    operational rows.
  - Employee tests passed 47/47; employee lint, TypeScript typecheck,
    production build, and `git diff --check` passed with test database variables
    explicitly unset where applicable.
  - React Doctor scored 96/100 with one existing large-component warning in
    `apps/web/src/routes/booking-detail.tsx`; no functional error was reported.
  - The restarted local API returned HTTP 200 with `{ "status": "ready" }`.
    No end-to-end, integration, repository-wide, or post-login browser test was
    run, by design, so verification did not add demo records.
  - Verified all 81 newly stored Argon2id hashes against the requested password,
    confirmed 81/81 accounts were updated, cleared all 81 lock counters, and
    confirmed zero remaining locked accounts. No login request was made.
  - Fetched `origin/main`, confirmed the local branch had no divergence before
    committing, and confirmed the push was accepted by the remote.
  - The specification generator self-test passed; a full build rendered both
    HTML outputs and the revised deployment diagrams through headless Chrome,
    then passed balance, duplicate-ID, leftover-token, diagram and
    external-reference checks for all 12 sections. The final `--check` and
    `git diff --check` reruns also passed.
  - No application, integration, database, end-to-end or browser journey was
    run for the specification-only update; behavior was verified by reading the
    current source, tests and configuration without mutating the demo database.
- AI/tools/sources: OpenAI Codex coordinating agent; delegated Codex agents for
  deployment workflow/architecture, employee email UI, initializer safety, and
  test-pollution audits, plus final API-example, cross-section consistency and
  supporting-runbook audits; diagnose, Supabase/Postgres best-practices, Vercel React
  best-practices, and React Doctor skills; GitHub CLI, shell, Git, Docker,
  PostgreSQL/Drizzle, pnpm, Vitest, TypeScript, Biome, React Doctor, repository
  source/tests/configuration, specification builder, local headless diagram
  renderer, runbooks, and the linked GitHub Actions log. No new external source
  or service was used for the final-spec update.
- Human review / limitations:
  - Provisioning must finish before the workflow can succeed. The production
    environment needs `DATABASE_URL_MIGRATE` using the Supabase Supavisor
    session pooler on port 5432 and `FLY_API_TOKEN` for `reserveflow-api`.
  - The failed historical run remains failed. After both secrets are present,
    the job still needs a re-run to validate migration, Fly deploy, and
    `/api/readyz` end to end.
  - Administrator email outbox, user provisioning/reset fields, reminder
    setting, and related copy remain visible because the requested “web app” was
    scoped to `apps/web`; hiding those requires a separate decision because
    administrator create/import flows currently require email.
  - The previous local database backups consume PostgreSQL storage and remain
    available for manual rollback. No backup was deleted.
  - Dormant attendee-email UI and API code remains intentionally present but is
    not reachable from the employee interface.
  - The short shared password is appropriate only for this local presentation
    database. Normal password changes and future initializer runs still require
    at least 10 characters; do not reuse the demo credential in production.
  - The as-built audit found unresolved release gaps: production CA/TLS
    provisioning is not wired into workflows, 80 employees still share one
    initializer credential, Vercel static responses lack the documented
    security headers, restore/scrub and PDPA procedures are not implemented,
    authenticated production topology has not been tested, and administrator
    credential recovery plus the employee set-password landing are unfinished.
  - OpenAPI remains intentionally partial, client interfaces are hand-written,
    field-level mapping for most booking 422 responses is absent, and elapsed
    slot styling is not yet consistent across every calendar/time grid.

## 2026-08-26T00:50:41+07:00 — Database initializer and admin mode switch

- Session ID: `2026-08-26-0038-database-initializer`
- AI: OpenAI Codex; exact model identifier not exposed to the repository.
- User request: Remove unused room data, then replace that approach with a
  reusable fresh-database initializer containing only Horizon, Summit, and
  Grove rooms, 80 employees with varied departments/positions, and one
  administrator; the user confirmed that no production environment exists yet
  and then asked to execute the initializer against the active local database.
  The same conversation then requested an administrator-only sidebar control
  for switching between the employee and admin experiences.
- Decisions and actions:
  - Treated “groove” as a typo for the established Grove Room and retained the
    stable `grove` room/QR code.
  - Kept authorization roles unambiguous: all 80 employees use `EMPLOYEE`, and
    `AU-001` is the only `ADMIN`; human positions are stored separately as
    `job_title`.
  - Used deterministic pseudo-random-looking department and job-title mappings
    so every initialization and retry produces the same profiles.
  - Implemented initialization as a guarded one-shot command for a migrated,
    empty or canonical-partial database. It never truncates or deletes data,
    requires `--apply`, an exact database-name confirmation, a dedicated URL,
    and an additional opt-in for production-like targets.
  - Preserved the stricter dedicated `_demo` seed workflow and shared its
    canonical manifest/verification logic with the new initializer.
  - Before replacing active local data, verified the exact loopback database,
    created a database-level backup, and only then recreated, migrated, and
    initialized the original `reserveflow` database name so existing local
    connection configuration remained valid.
  - Implemented the app control as two navigation modes rather than a boolean
    ARIA switch: the current mode is marked with `aria-current`, and the other
    mode uses a plain same-origin anchor because each experience is a separate
    router bundle.
  - Exposed the control only to the exact `ADMIN` role in the employee app,
    placed it above the profile card in the desktop sidebar, and retained a
    compact icon presentation when the admin sidebar is collapsed.
- Code/documentation changes:
  - Added `apps/api/src/db/initialize.ts` and `db:initialize` scripts in
    `apps/api/package.json` and `package.json`; documented its explicit
    environment variables in `.env.example`.
  - Added the `users.job_title` schema field and migration in
    `apps/api/src/db/schema/auth.ts`, `apps/api/src/auth/schema.ts`,
    `apps/api/src/auth/index.ts`, `apps/api/drizzle/0009_users_job_title.sql`,
    and the Drizzle migration metadata.
  - Updated `apps/api/src/db/demo-seed.ts` and `apps/api/src/db/seed.ts` with
    AU account codes, deterministic department/job-title assignments, shared
    initialization support, exact profile verification, and sequential
    preflight queries compatible with future `pg` versions.
  - Expanded `apps/api/test/demo-seed.test.ts` with manifest determinism and
    initializer safety coverage.
  - Added the shared `packages/ui/src/app-mode-switch.tsx` component and export,
    integrated it into `apps/web/src/components/shell.tsx` and
    `apps/admin/src/components/shell.tsx`, and added localized mode labels in
    both apps' `src/lib/i18n.ts` files.
  - Added employee/admin role-gating and destination coverage in
    `apps/web/src/components/app-mode-switch.test.tsx`.
  - Added `docs/DATABASE-INITIALIZATION.md`, updated `docs/DEMO-SEED.md` and
    `docs/README.md`, and recorded the outcome in `CHANGELOG.md` and this log.
- Data/external-state changes:
  - Created a uniquely named isolated local PostgreSQL database, applied all
    migrations, initialized 81 credential accounts and three rooms, ran the
    initializer again, verified exact counts and unchanged credential hashes,
    and then deleted only that disposable verification database.
  - The previous active local database contained test fixtures (35 users, 26
    rooms, 6 bookings, and 3 sessions). It was preserved intact as
    `reserveflow_before_initialize_20260826_005303` before `reserveflow` was
    recreated and initialized.
  - The active local database now contains exactly 81 users, 3 canonical rooms,
    8 departments, 8 employee job titles, and no bookings, sessions, or audit
    rows. The local API development process was restarted after initialization.
  - No production/external database, deployment, or external message was
    touched.
  - Browser validation navigated the existing local AU-001 session between
    `/rooms` and `/admin/` and back; it did not change application data.
  - A user-requested Git commit records the session-attributable initializer,
    schema, documentation, test, and mode-switch changes. Pre-existing local
    proxy/trusted-origin edits remain outside that commit.
- Verification:
  - Focused initializer/seed tests passed: 36/36.
  - The full API unit suite passed 81 tests across nine files; 131
    database-dependent tests were skipped because `TEST_DATABASE_URL` was not
    configured.
  - API lint, TypeScript typecheck, build, `git diff --check`, and Drizzle
    schema-generation drift check passed.
  - Repository-wide typecheck passed. Repository-wide lint was also attempted;
    it stopped on a pre-existing Biome formatting mismatch in
    `packages/shared/test/contracts.test.ts`, while the focused API lint passed.
  - Fresh-database migration and first initialization passed with 3 rooms, 8
    departments, 80 employees, 1 administrator, and 81 canonical credential
    rows. The immediate rerun created zero credentials and preserved all
    password hashes.
  - Active-local verification confirmed each room is active, has capacity 20,
    and has exactly one microphone and one projector. Read-only Argon2 checks
    confirmed the configured administrator and employee credentials match their
    canonical `ADMIN` and `EMPLOYEE` accounts.
  - The restarted API returned HTTP 200 with `{ "status": "ready" }` from
    `/api/readyz` against the initialized database.
  - UI-package, employee-app, and admin-app TypeScript checks and production
    builds passed; focused Biome checks passed.
  - Employee tests passed 46/46 and admin tests passed 36/36, including the new
    non-admin visibility and cross-bundle destination checks.
  - React Doctor completed successfully. Its changed-scope scan reported only
    two pre-existing maintainability warnings in
    `apps/web/src/components/date-picker-field.tsx` and
    `apps/web/src/routes/booking-new.tsx`, with no finding in the mode-switch
    changes.
  - In-app-browser validation confirmed that AU-001 sees the control above the
    profile card, preserves its authenticated session in both directions, and
    retains an accessible employee-mode link when the admin sidebar is
    collapsed.
- AI/tools/sources: OpenAI Codex coordinating agent; delegated Codex agents for
  initializer architecture and safety-test audits, plus an initial room-pruning
  audit and focused employee/admin sidebar audits; Supabase/Postgres
  best-practices, Vercel React best-practices, React Doctor, and in-app browser
  control skills; shell, Git, pnpm, Drizzle, Vitest, TypeScript, Biome, React
  Doctor, and an isolated local PostgreSQL database. No internet source or
  external service was used.
- Human review / limitations:
  - The initializer intentionally uses one configured password for all 80
    synthetic employees; use the invite/import flow with per-user passwords
    before replacing the fixed demo identities with real people.
  - `job_title` is persisted and verified but is not yet surfaced in employee
    or administrator UI responses; that presentation work was outside this
    database-initialization request.
  - The pre-initialization local database backup remains available for manual
    rollback and consumes local PostgreSQL storage; delete it only after the
    initialized state has been accepted.
  - The employee app's existing sidebar is desktop-only (`md` and wider), so
    the requested left-sidebar control is not added to its mobile bottom
    navigation. The admin sidebar keeps the control in expanded and collapsed
    layouts.
  - Pre-existing uncommitted ngrok trusted-origin and Vite sibling-proxy changes
    in `apps/api/src/server.ts`, `apps/web/vite.config.ts`, and
    `packages/config/src/vite.ts` were preserved and are not attributed to this
    session.

## 2026-08-25T23:39:33+07:00 — Employee booking demo and UX refinements

- Session ID: `2026-08-25-2339-reserveflow-employee-demo`
- AI: OpenAI Codex; exact model identifier not exposed to the repository.
- User request: Apply six Stitch employee-flow screens; constrain the demo to
  three equally equipped 20-person rooms, 80 employees, and one administrator;
  refine employee login, navigation, room search, booking, calendar, and
  rescheduling UX; fix annotated UI issues; establish mandatory changelog and
  AI usage disclosure records; clarify the employee-facing auto-release state;
  add a safe local demo path for exercising the real QR check-in flow; and use
  `จองแล้ว` for the employee-facing confirmed-booking state. The user also
  requested a commit and asked how the AU-001 administrator reaches the admin
  application.
- Decisions and actions:
  - Kept email in the account database but made employee ID plus password the
    employee-facing login method.
  - Used exactly three canonical rooms and preserved their stable IDs/QR codes.
  - Kept all bookings immediately confirmed and represented that behavior with
    a presentation-only `Auto-approve` badge instead of adding a false database
    field.
  - Extended calendar responses with an owner display label only where the
    viewer is authorized, preserving private `BUSY` masking.
  - Replaced native date inputs with one shared Buddhist Era date picker using
    Asia/Bangkok calendar boundaries and Gregorian `YYYY-MM-DD` API values.
  - Kept `AUTO_RELEASED` as the scheduler and audit state for confirmed
    bookings that miss the check-in grace period, but removed it from employee
    quick filters and presented the outcome as `ไม่ได้เช็กอิน`.
  - Added a fail-closed demo booking shift available only when explicitly
    enabled in development with a loopback database. It preserves ownership,
    version, duration, room-lock, buffer, overlap, and audit invariants without
    creating notification email.
  - Advertised the demo capability in the authenticated session response so the
    development UI remains hidden whenever the guarded API route is disabled.
  - Kept the QR landing as the real check-in boundary: the demo action only
    prepares the booking and navigates there; the user must still deliberately
    press `เปิดใช้งานการจอง`.
  - Kept the enum and server state as `CONFIRMED`, but changed employee filters
    and badges to `จองแล้ว`; shared defaults and the admin app retain
    `ยืนยันแล้ว` as domain-oriented terminology.
  - Confirmed that an authenticated AU-001 administrator can open `/admin/`
    with the same session. The employee sidebar currently has no admin link;
    no navigation change was inferred from the read-only question.
- Code/documentation changes:
  - Checkpoint commit `e9d7d7f` (`feat(employee): align Stitch demo experience`)
    updated employee authentication, protected demo seeding, employee routes and
    components, local Stitch assets, UI tokens, specifications, and tests.
  - Calendar owner and elapsed-slot behavior touched
    `apps/api/src/modules/availability/routes.ts`,
    `apps/api/src/modules/bookings/serialize.ts`, employee/admin API types and
    calendar routes, `apps/web/src/lib/slots.ts`,
    `packages/ui/src/slot-grid.tsx`, related tests, OpenAPI, and specifications.
  - Booking time-edit preservation added
    `apps/web/src/lib/booking-flow.ts` and its test, and updated
    `apps/web/src/routes/booking-new.tsx` and
    `apps/web/src/routes/room-detail.tsx`.
  - Date-picker and copy refinements added
    `apps/web/src/components/date-picker-field.tsx`,
    `apps/web/src/lib/date-picker.ts`, their tests, DayPicker dependencies, CSS,
    Thai seed descriptions, and i18n regression coverage.
  - Local check-in demo support updated `.env.example`, API environment/app
    and authenticated-capability wiring, `apps/api/src/auth/routes.ts`,
    `apps/api/src/docs.ts`, `apps/api/src/modules/bookings/routes.ts`,
    `apps/api/src/modules/bookings/service.ts`, focused API tests, employee
    and admin API types, employee booking queries/mutations/routes, employee
    booking status/filter/demo helpers and tests, and the booking-detail status
    presentation.
  - React review moved asynchronous reschedule prefill into an effect in
    `apps/web/src/components/reschedule-panel.tsx` and labelled the cancellation
    dialog in `apps/web/src/routes/booking-detail.tsx`.
  - Employee confirmed-state copy updated `apps/web/src/lib/i18n.ts`, its
    regression test, `apps/web/src/components/booking-status-badge.tsx`, and the
    optional surface-label API in `packages/ui/src/status-badge.tsx`; UI handoff
    and mockup specifications document the employee/admin distinction.
  - Check-in behavior and demo safeguards were documented in
    `docs/DEMO-SEED.md`, `docs/UI-HANDOFF.md`, and
    `docs/spec/sections/10-ui-design-mockups.md`.
  - Session governance added `AGENTS.md`, `CHANGELOG.md`, this disclosure log,
    and documentation links in `README.md` and `docs/README.md`.
- Data/external-state changes:
  - The local demo database room descriptions were updated to Thai through the
    audited admin API. Existing bookings and stored account emails were retained.
  - The ignored local `.env` enabled the guarded demo tool. Browser validation
    first exercised the flow with a local Grove Room booking; its final status
    was later observed as cancelled, with that later transition not attributed
    to this verification. Final validation created a local Horizon Room booking,
    moved it from 08:30–09:30 into the current 00:30–01:30 window, and explicitly
    checked it in, leaving it `CHECKED_IN`.
  - No production deployment, production database mutation, or external message
    was performed.
  - The confirmed-state wording change made no data or external-state change.
  - A user-requested Git commit records the session-attributable changes. The
    pre-existing Vite/ngrok development-origin work remains uncommitted.
- Verification:
  - Web and API tests covering authentication, seeding, date conversion,
    calendar privacy/serialization, slot states, booking-flow routing, and UI
    copy passed during the session.
  - Web/API lint, TypeScript typecheck, production builds, `git diff --check`,
    React Doctor, and in-app-browser checks were run. React Doctor changed-scope
    validation scored 84/100 with one remaining maintainability warning for the
    large booking form component and no functional error.
  - Documentation checks confirmed that the required record files and linked
    repository documents exist and contain no trailing whitespace.
  - Browser checks confirmed one plus icon/label, Thai room descriptions,
    `Auto-approve`, and the shared date picker in search, room-detail, and
    reschedule flows.
  - The final web suite passed 43 tests across nine files; web lint, typecheck,
    production build, and production-bundle checks passed. The final API suite
    passed 59 tests across nine files; API lint, typecheck, and build passed.
    A further 131 database-dependent API tests, including the booking
    integration suite, were skipped because `TEST_DATABASE_URL` was not set.
  - In-app-browser validation removed the `ปล่อยอัตโนมัติ` quick-filter chip,
    displayed check-in guidance and the server-advertised development demo
    action, shifted an owned Horizon booking, opened `/check-in/horizon`,
    required the explicit activation press, and displayed the successful
    `CHECKED_IN` result. The production bundle contained neither the demo label
    nor its endpoint string.
- AI/tools/sources: OpenAI Codex coordinating agent; delegated Codex subagents
  for authentication, seed safety, UI copy, database, calendar, and date-picker
  audits, plus auto-release, check-in-flow, demo-time-shift, logging-policy, and
  session-attribution reviews; Stitch MCP design assets; diagnostic, React
  performance, and browser-control skills; shell/Git/package tooling; local
  curl/API and database checks; React Doctor; in-app browser automation;
  official DayPicker documentation; and official OpenAI documentation for
  repository-level `AGENTS.md` guidance.
- Human review / limitations:
  - This is the first disclosure record. It summarizes the current multi-turn
    Codex thread and checkpoint commit from available conversation and Git
    evidence; it does not fabricate separate entries for older sessions.
  - The worktree was already dirty when the logging request began. Existing Vite
    sibling-proxy/allowed-host edits in `apps/web/vite.config.ts` and
    `packages/config/src/vite.ts`, plus the ngrok trusted-origin hunk in
    `apps/api/src/server.ts`, were not attributed to or staged with this work.
  - The destructive booking database integration suite was not run without its
    dedicated `TEST_DATABASE_URL`; the local browser flow covered the requested
    end-to-end happy path against the running development database.
  - Future AI runs will load `AGENTS.md`; the newly created file cannot
    retroactively govern sessions that ended before it existed.
