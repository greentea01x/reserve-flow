# Database initialization

`pnpm db:initialize` installs the canonical ReserveFlow starting dataset into a migrated, empty
database:

- Horizon Room, Summit Room, and Grove Room only;
- capacity 20, one microphone, and one projector in every room;
- 80 synthetic employees (`AU-002`–`AU-081`) with deterministic mixed departments and job titles;
- one administrator (`AU-001`);
- eight departments, weekday business hours, and the required booking settings.

The script is a one-shot bootstrap command. It is not run by the API, migrations, or deployment
startup. It never truncates tables or deletes user/booking/history rows; it may replace the
room-feature associations for the three canonical rooms so their equipment exactly matches the
manifest. If a database contains an unknown user, room, department, booking, session,
notification, audit entry, or other operational history, the command stops before writing. An
immediate rerun on the untouched canonical dataset is idempotent and preserves existing password
hashes.

## Prepare a target

Create a new database, run every migration, and keep the API and worker stopped until
initialization finishes. For a remote database, set an independent environment marker and reconnect
so the setting is visible:

```sql
ALTER DATABASE your_database SET reserveflow.environment = 'staging';
-- Use 'production' for the eventual production target.
```

A loopback development database may omit the marker. Remote targets must match
`INITIALIZE_ENVIRONMENT` exactly. Use a direct or session-pooled PostgreSQL connection on port 5432;
the transaction pooler on 6543 is refused.

Configure these values in the root `.env`:

```dotenv
INITIALIZE_DATABASE_URL=postgresql://...
INITIALIZE_ENVIRONMENT=development
INITIALIZE_CONFIRM=initialize:your_database
INITIALIZE_ALLOW_PRODUCTION=false
INITIALIZE_ADMIN_PASSWORD=use-a-strong-admin-password
INITIALIZE_EMPLOYEE_PASSWORD=use-a-different-demo-password
BETTER_AUTH_SECRET=at-least-32-characters
```

Then run:

```bash
pnpm db:initialize --apply
```

The initializer requires both `--apply` and the confirmation value containing the exact database
name. A production-like hostname, database name, `NODE_ENV`, or `INITIALIZE_ENVIRONMENT` also
requires `INITIALIZE_ALLOW_PRODUCTION=true`.

## Verify without changing the initialized data

Do not use booking, rescheduling, check-in, cancellation, or administrator mutation flows in the
browser as a post-initialization smoke test. Those flows write real demo records. Keep integration
and future end-to-end test URLs separate from the initialized application database, and never point
`TEST_DATABASE_URL` or `TEST_DATABASE_URL_APP` at this target.

The employee and administrator unit suites, type checks, lint checks, and production builds do not
need a database and are safe to run with test database variables explicitly unset:

```bash
env -u TEST_DATABASE_URL -u TEST_DATABASE_URL_APP pnpm --filter @reserveflow/web test
env -u TEST_DATABASE_URL -u TEST_DATABASE_URL_APP pnpm --filter @reserveflow/admin test
pnpm --filter @reserveflow/web typecheck
pnpm --filter @reserveflow/admin typecheck
```

Verify the initialized database itself with read-only queries for the expected counts and room
equipment. Immediately after initialization there must be 81 users, 81 credential accounts, three
rooms, and zero bookings, attendees, sessions, notifications, and audit rows.

The 80 canonical employee accounts intentionally start with the configured employee bootstrap
password. Before exposing real employee identities, issue individual credentials through an
approved identity/account workflow and rotate the administrator bootstrap credential. The current
employee web hides invite/reset landing pages, so do not rely on emailed setup links until that flow
is restored or replaced. Passwords, hashes, and connection URLs are never printed by the command.

## Starting over locally

Create another empty local database and point the application at it after initialization. Do not
drop or truncate the previous database through this command; retaining it makes rollback explicit
and recoverable.
