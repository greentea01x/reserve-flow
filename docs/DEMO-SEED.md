# Demo database seed

The employee-flow demo uses a dedicated synthetic database with exactly:

- 3 active rooms: Horizon (floor 4), Summit (floor 5), and Grove (floor 2);
- capacity 20, one projector, and one microphone in every room;
- the original local Stitch room image bytes stored in `rooms.photo`;
- 8 canonical departments and 8 job titles with 10 active employees in each group;
- 80 active `EMPLOYEE` accounts and 1 active `ADMIN` account;
- Monday–Friday 08:30–17:30 business hours, with weekends closed;
- all 10 required settings at their application defaults.

All account emails are under `demo.reserveflow.example`, an RFC 2606 reserved namespace that
cannot deliver to real people. Employee codes are `AU-002` through `AU-081`; the admin code is
`AU-001`. Sign-in uses the employee code and the configured demo password; email remains an
internal account/notification address and mobile is optional profile data.

Department and job-title assignments are pseudo-random-looking but deterministic. Rerunning the
seed therefore preserves the same profile mapping instead of reshuffling people.

## Create the protected target

Create a new database whose name ends in `_demo`, then set a database-level marker while
connected as its owner. Both checks are mandatory; a normal `postgres` database is refused.

```sql
CREATE DATABASE reserveflow_demo;
ALTER DATABASE reserveflow_demo SET reserveflow.environment = 'demo';
```

Reconnect after `ALTER DATABASE` so the setting is visible, migrate that disposable database,
and then set these values in the root `.env`:

```dotenv
DEMO_DATABASE_URL=postgresql://...
DEMO_ADMIN_PASSWORD=at-least-10-characters
DEMO_EMPLOYEE_PASSWORD=at-least-10-characters
BETTER_AUTH_SECRET=at-least-32-characters
```

Run:

```bash
pnpm db:seed:demo
```

Do not point `DEMO_DATABASE_URL` at an existing application database. The command never reads
`DATABASE_URL`, refuses `NODE_ENV=production` and production-like target names, and requires
both an `_demo` database name and the exact database-side marker above. Any unplanned user,
room, or department aborts before writes.

The preflight also requires zero rows in every operational table: bookings, attendees,
sessions, verification/password tokens, notifications, audit logs, and holidays. Existing
accounts are allowed only for an otherwise-planned user and only as that user's single
canonical Better Auth credential row (`local:credential`, Argon2id password, no OAuth data).
This means a database that has ever been used for sign-in or booking is intentionally not
reseedable; create a fresh disposable database instead.

The command takes a non-blocking session advisory lock so two seed runs cannot overlap. Master
data uses batched upserts in short transactions. Credential accounts are created sequentially
through Better Auth because every password invokes the 64 MiB Argon2id policy.

Immediate reruns on the pristine seed are idempotent. Existing planned users are normalized to
the demo profile and active state, but their credential rows and password hashes are never
replaced. A partial user, extra account, or any operational history is treated as an error; use
a fresh database instead of trying to repair it with the seed.

## Local check-in demo tool

The employee app can expose a presenter-only action named `เดโม: ทดลองเช็กอิน`. It moves an
owned, future `CONFIRMED` booking into the live check-in window and then opens the real room QR
landing page. Check-in still happens only after the presenter deliberately presses
`เปิดใช้งานการจอง` on that page.

Enable it only in a disposable local environment:

```dotenv
NODE_ENV=development
DEMO_TOOLS_ENABLED=true
DATABASE_URL=postgresql://...@127.0.0.1:5432/reserveflow
```

Startup rejects the flag outside development or when `DATABASE_URL` is not loopback. The
authenticated session advertises the capability only when the route is mounted, so the
development UI stays hidden when the flag is off. The route is otherwise absent and returns 404;
the production web build also removes the button and endpoint string. The server accepts only the
booking owner and a matching version, preserves duration,
checks room overlap and buffer rules, writes a `booking.demo_shift` audit entry, and does not send
reschedule email. The tool changes the database referenced by `DATABASE_URL`, not
`DEMO_DATABASE_URL`, so never enable it against shared or production-like data.
