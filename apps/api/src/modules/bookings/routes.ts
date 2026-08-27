import { BOOKING_STATUSES } from '@reserveflow/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { type AuthDependencies, createRequireAuth } from '../../auth/middleware.js';
import { schema } from '../../db/index.js';
import { buildCalendarInvite } from '../../email/ics.js';
import { AppError } from '../../lib/errors.js';
import { clientIp, parseBody, readJson } from '../../lib/http.js';
import { createRateLimiter } from '../../lib/rate-limit.js';
import { loadSettings, type Settings } from '../../lib/settings.js';
import { bangkokDateParam, bangkokDateStart, bangkokParts, toBangkokIso } from '../../lib/time.js';
import {
  type BusinessHoursDay,
  earliestSlotStart,
  validateWindow,
  type WindowVerdict,
} from '../../lib/window.js';
import { type BookingRow, toViewerBooking } from './serialize.js';
import {
  type Attendee,
  BOOKING_VIEW_SELECT,
  cancelBooking,
  checkInById,
  createBooking,
  findPriorBookingId,
  isSlotConflict,
  loadBookingHead,
  loadBookingRow,
  replaceAttendees,
  shiftBookingToDemoCheckin,
  slotUnavailableError,
  updateBooking,
} from './service.js';

const DAY_MS = 86_400_000;

const attendeeSchema = z.object({
  email: z.email().max(254),
  name: z.string().min(1).max(120).optional(),
});

const createSchema = z.strictObject({
  room_id: z.uuid(),
  start_at: z.coerce.date(),
  end_at: z.coerce.date(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  is_private: z.boolean().optional(),
  special_request: z.string().max(1000).optional(),
  /** Informational; never blocks over capacity (D-30c). */
  headcount: z.number().int().min(1).optional(),
  attendees: z.array(attendeeSchema).max(50).optional(),
  /** ADMIN only: book on behalf. */
  owner_id: z.uuid().optional(),
});

const patchSchema = z.strictObject({
  version: z.number().int().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  is_private: z.boolean().optional(),
  special_request: z.string().max(1000).nullable().optional(),
  headcount: z.number().int().min(1).nullable().optional(),
  start_at: z.coerce.date().optional(),
  end_at: z.coerce.date().optional(),
  room_id: z.uuid().optional(),
});

const attendeesPutSchema = z.strictObject({
  version: z.number().int().min(1),
  attendees: z.array(attendeeSchema).max(50),
});

const cancelSchema = z.strictObject({
  reason: z.string().min(3).max(1000).optional(),
});

const checkinSchema = z.strictObject({
  note: z.string().max(1000).optional(),
});

const demoCheckinReadySchema = z.strictObject({
  version: z.number().int().min(1),
});

const listSchema = z.object({
  scope: z.enum(['mine', 'attending', 'all']).default('mine'),
  status: z.string().optional(),
  room_id: z.uuid().optional(),
  from: bangkokDateParam.optional(),
  to: bangkokDateParam.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['start_at', '-start_at']).default('start_at'),
  // ADMIN-only filters
  owner_id: z.uuid().optional(),
  department_id: z.uuid().optional(),
  q: z.string().max(200).optional(),
});

/** Lowercase + dedupe by email, first name wins. */
function normalizeAttendees(
  raw: { email: string; name?: string | undefined }[] | undefined,
): Attendee[] {
  const byEmail = new Map<string, Attendee>();
  for (const attendee of raw ?? []) {
    const email = attendee.email.toLowerCase();
    if (!byEmail.has(email)) {
      byEmail.set(email, { email, name: attendee.name ?? null });
    }
  }
  return [...byEmail.values()];
}

function toHoursMap(
  rows: { weekday: number; isOpen: boolean; openTime: string | null; closeTime: string | null }[],
): Map<number, BusinessHoursDay> {
  return new Map(
    rows.map((row) => [
      row.weekday,
      { isOpen: row.isOpen, openTime: row.openTime, closeTime: row.closeTime },
    ]),
  );
}

/** Soft CLOSED/HOLIDAY verdicts become 422 OUTSIDE_BUSINESS_HOURS on booking writes. */
function assertWindowOk(verdict: WindowVerdict): void {
  if (verdict.ok) {
    return;
  }
  if (verdict.kind === 'HARD') {
    throw verdict.error;
  }
  if (verdict.kind === 'HOLIDAY') {
    throw new AppError('OUTSIDE_BUSINESS_HOURS', 'The day is a holiday', {
      details: { reason: 'HOLIDAY', holiday_name: verdict.holidayName },
    });
  }
  throw new AppError('OUTSIDE_BUSINESS_HOURS', 'The window is outside business hours', {
    details: {
      reason: verdict.reason,
      ...(verdict.openTime === undefined ? {} : { open_time: verdict.openTime }),
      ...(verdict.closeTime === undefined ? {} : { close_time: verdict.closeTime }),
    },
  });
}

const historyEventByAction: Record<string, string> = {
  'booking.create': 'CREATED',
  'booking.reschedule': 'RESCHEDULED',
  'booking.demo_shift': 'RESCHEDULED',
  'booking.checkin': 'CHECKED_IN',
  'booking.cancel': 'CANCELLED',
  'booking.auto_release': 'AUTO_RELEASED',
  'booking.complete': 'COMPLETED',
};

export function createBookingsRouter(
  dependencies: AuthDependencies & {
    publicBaseUrl: string;
    kickOutbox?: (() => void) | undefined;
    demoToolsEnabled?: boolean;
  },
) {
  const { db } = dependencies;
  const pool = db.$client;
  const router = new Hono();
  const requireAuth = createRequireAuth(dependencies);
  /** §5.7 post-commit kick: called only AFTER an outbox-writing tx committed. Best-effort —
   * the 10s notify.send loop backstops a missed kick. */
  const kickOutbox = () => dependencies.kickOutbox?.();
  // Spec §0 per-user write limits. ponytail: the check-in limiter here is a separate
  // instance from the QR route's — worst case 2× the budget; share one if that ever matters.
  const createRateLimit = createRateLimiter(30);
  const checkinRateLimit = createRateLimiter(10);
  const demoShiftRateLimit = createRateLimiter(10);

  /** Full window validation for a prospective slot (§6.3.4 order). */
  async function validateSlot(startAt: Date, endAt: Date, settings: Settings): Promise<void> {
    const [hoursRows, holidayRows] = await Promise.all([
      db.select().from(schema.businessHours),
      db
        .select()
        .from(schema.holidays)
        .where(eq(schema.holidays.day, bangkokParts(startAt).date)),
    ]);
    const now = new Date();
    assertWindowOk(
      validateWindow({
        start: startAt,
        end: endAt,
        now,
        settings,
        hours: toHoursMap(hoursRows),
        holidays: new Map(holidayRows.map((row) => [row.day, row.name])),
        earliestStart: earliestSlotStart(now, settings),
      }),
    );
  }

  async function loadView(bookingId: string, viewerEmail: string): Promise<BookingRow> {
    const row = await loadBookingRow(pool, bookingId, viewerEmail);
    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    return row;
  }

  router.post('/', requireAuth, async (context) => {
    const actor = context.get('actor');
    const idempotencyKey = context.req.header('idempotency-key');
    if (idempotencyKey === undefined || !z.uuid().safeParse(idempotencyKey).success) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (uuid) is required');
    }

    const replay = async (bookingId: string) => {
      context.header('Idempotent-Replayed', 'true');
      return context.json(
        toViewerBooking(await loadView(bookingId, actor.email), { id: actor.id, role: actor.role }),
      );
    };

    // T1 step (0) — "replay returns before touching anything else" (CF-01): a committed
    // prior booking short-circuits BEFORE validation, so time-dependent guards (IN_PAST,
    // ROOM_INACTIVE) can never 4xx a retry of a create that already succeeded.
    const priorId = await findPriorBookingId(pool, actor.id, idempotencyKey);
    if (priorId !== undefined) {
      return replay(priorId);
    }
    createRateLimit(actor.id);

    const body = parseBody(createSchema, await readJson(context));
    const ownerId = body.owner_id ?? actor.id;
    if (ownerId !== actor.id && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', 'Only an admin may book on behalf of someone else');
    }

    try {
      // Fail-fast pre-read; the binding read is the FOR SHARE re-read under the lock (step e).
      const [room] = await db
        .select({ active: schema.rooms.active })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, body.room_id))
        .limit(1);
      if (room === undefined) {
        throw new AppError('NOT_FOUND', 'Room not found');
      }
      if (!room.active) {
        throw new AppError('ROOM_INACTIVE', 'Room is inactive');
      }

      const settings = await loadSettings(db);
      await validateSlot(body.start_at, body.end_at, settings);
    } catch (error) {
      // A concurrent in-flight first request may have committed while we validated: prefer
      // the replay over surfacing a 4xx the original create never saw.
      if (error instanceof AppError && error.code !== 'RATE_LIMITED') {
        const racedId = await findPriorBookingId(pool, actor.id, idempotencyKey);
        if (racedId !== undefined) {
          return replay(racedId);
        }
      }
      throw error;
    }

    // Re-read rather than threaded out of the try above: loadSettings is a 60 s cache hit.
    const settings = await loadSettings(db);
    let result: { id: string; replayed: boolean };
    try {
      result = await createBooking(pool, {
        actorId: actor.id,
        ownerId,
        idempotencyKey,
        roomId: body.room_id,
        startAt: body.start_at,
        endAt: body.end_at,
        title: body.title,
        description: body.description ?? null,
        specialRequest: body.special_request ?? null,
        headcount: body.headcount ?? null,
        isPrivate: body.is_private ?? false,
        attendees: normalizeAttendees(body.attendees),
        bufferMinutes: settings.buffer_minutes,
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
    } catch (error) {
      if (isSlotConflict(error)) {
        throw await slotUnavailableError(pool, {
          roomId: body.room_id,
          startAt: body.start_at,
          endAt: body.end_at,
          isAdmin: actor.role === 'ADMIN',
          bufferMinutes: settings.buffer_minutes,
        });
      }
      throw error;
    }

    const view = toViewerBooking(await loadView(result.id, actor.email), {
      id: actor.id,
      role: actor.role,
    });
    if (result.replayed) {
      context.header('Idempotent-Replayed', 'true');
      return context.json(view);
    }
    kickOutbox(); // the create tx committed with its booking.confirmed rows
    context.header('Location', `/api/v1/bookings/${result.id}`);
    return context.json(view, 201);
  });

  router.get('/', requireAuth, async (context) => {
    const actor = context.get('actor');
    const parsed = listSchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid bookings query', {
        details: parsed.error.issues,
      });
    }
    const query = parsed.data;
    const isAdmin = actor.role === 'ADMIN';
    if (
      !isAdmin &&
      (query.scope === 'all' ||
        query.owner_id !== undefined ||
        query.department_id !== undefined ||
        query.q !== undefined)
    ) {
      throw new AppError('FORBIDDEN', 'This filter requires the ADMIN role');
    }

    const statuses = (query.status ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value !== '');
    for (const status of statuses) {
      if (!(BOOKING_STATUSES as readonly string[]).includes(status)) {
        throw new AppError('VALIDATION_FAILED', `Unknown status: ${status}`);
      }
    }

    const params: unknown[] = [actor.email];
    const conditions: string[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (query.scope === 'mine') {
      conditions.push(`b.owner_id = ${bind(actor.id)}`);
    } else if (query.scope === 'attending') {
      conditions.push(
        'EXISTS (SELECT 1 FROM booking_attendees a WHERE a.booking_id = b.id AND a.email = $1)',
      );
    }
    if (statuses.length > 0) {
      conditions.push(`b.status = ANY(${bind(statuses)}::text[])`);
    }
    if (query.room_id !== undefined) {
      conditions.push(`b.room_id = ${bind(query.room_id)}::uuid`);
    }
    // Default from=today (spec §7) — unless `to` alone was given (the history preset).
    const from = query.from ?? (query.to === undefined ? bangkokParts(new Date()).date : undefined);
    if (from !== undefined) {
      conditions.push(`b.start_at >= ${bind(bangkokDateStart(from).toISOString())}::timestamptz`);
    }
    if (query.to !== undefined) {
      const toEnd = new Date(bangkokDateStart(query.to).getTime() + DAY_MS);
      conditions.push(`b.start_at < ${bind(toEnd.toISOString())}::timestamptz`);
    }
    if (query.owner_id !== undefined) {
      conditions.push(`b.owner_id = ${bind(query.owner_id)}::uuid`);
    }
    if (query.department_id !== undefined) {
      conditions.push(`u.department_id = ${bind(query.department_id)}::uuid`);
    }
    if (query.q !== undefined && query.q.trim() !== '') {
      const like = bind(`%${query.q.trim()}%`);
      conditions.push(
        `(b.title ILIKE ${like} OR u.full_name ILIKE ${like} OR u.employee_code::text ILIKE ${like})`,
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const direction = query.sort === '-start_at' ? 'DESC' : 'ASC';
    const limit = bind(query.page_size);
    const offset = bind((query.page - 1) * query.page_size);
    const queryText = `${BOOKING_VIEW_SELECT.replace('SELECT b.id,', 'SELECT count(*) OVER()::int AS total, b.id,')}
       ${where}
       ORDER BY b.start_at ${direction}, b.id
       LIMIT ${limit} OFFSET ${offset}`;
    const result = await pool.query<BookingRow & { total: number }>(queryText, params);

    // count(*) OVER() vanishes with the rows on a page past the end; re-ask the same query
    // for one row from offset 0 so page.total stays the true count.
    let total = result.rows[0]?.total;
    if (total === undefined && query.page > 1) {
      const probeParams = [...params];
      probeParams[probeParams.length - 2] = 1;
      probeParams[probeParams.length - 1] = 0;
      const probe = await pool.query<{ total: number }>(queryText, probeParams);
      total = probe.rows[0]?.total;
    }

    const viewer = { id: actor.id, role: actor.role };
    return context.json({
      data: result.rows.map((row) => toViewerBooking(row, viewer)),
      page: {
        page: query.page,
        page_size: query.page_size,
        total: total ?? 0,
      },
    });
  });

  router.get('/:id', requireAuth, async (context) => {
    const actor = context.get('actor');
    const bookingId = context.req.param('id');
    if (!z.uuid().safeParse(bookingId).success) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const row = await loadView(bookingId, actor.email);
    const view = toViewerBooking(row, { id: actor.id, role: actor.role });
    if (view.visibility !== 'FULL') {
      // Non-viewers get the masked view, never 403 — ids are already on the calendar.
      return context.json(view);
    }

    const settings = await loadSettings(db);
    const historyRows = await pool.query<{
      action: string;
      created_at: Date;
      actor_id: string | null;
      full_name: string | null;
    }>(
      `SELECT l.action, l.created_at, l.actor_id, u.full_name
         FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
        WHERE l.entity_type = 'booking' AND l.entity_id = $1
        ORDER BY l.created_at, l.id`,
      [bookingId],
    );
    const history = historyRows.rows.flatMap((entry) => {
      const event = historyEventByAction[entry.action];
      return event === undefined
        ? []
        : [
            {
              event,
              at: toBangkokIso(entry.created_at),
              actor:
                entry.actor_id === null ? null : { id: entry.actor_id, full_name: entry.full_name },
            },
          ];
    });

    const now = Date.now();
    const start = row.start_at.getTime();
    const end = row.end_at.getTime();
    const isOwner = row.owner_id === actor.id;
    const isAdmin = actor.role === 'ADMIN';
    const involved = isOwner || row.viewer_is_attendee;
    const confirmed = row.status === 'CONFIRMED';
    const canEdit = confirmed && ((isAdmin && now < end) || (isOwner && now < start));
    const opensAt = start - settings.checkin_open_before_minutes * 60_000;
    const selfClosesAt = Math.min(end, start + settings.checkin_grace_minutes * 60_000);
    const can = {
      edit: canEdit,
      reschedule: canEdit,
      cancel:
        (isOwner && confirmed && now < end) ||
        (isAdmin && (confirmed || row.status === 'CHECKED_IN') && now < end),
      check_in:
        confirmed &&
        (involved ? now >= opensAt && now < selfClosesAt : isAdmin && now >= opensAt && now < end),
    };
    return context.json({ ...view, history, can });
  });

  if (dependencies.demoToolsEnabled === true) {
    router.post('/:id/demo-check-in-ready', requireAuth, async (context) => {
      const actor = context.get('actor');
      demoShiftRateLimit(actor.id);
      const bookingId = context.req.param('id');
      if (!z.uuid().safeParse(bookingId).success) {
        throw new AppError('NOT_FOUND', 'Booking not found');
      }
      const body = parseBody(demoCheckinReadySchema, await readJson(context));
      const settings = await loadSettings(db);

      await shiftBookingToDemoCheckin(pool, {
        actorId: actor.id,
        bookingId,
        expectedVersion: body.version,
        bufferMinutes: settings.buffer_minutes,
        timing: {
          slotIncrementMinutes: settings.slot_increment_minutes,
          openBeforeMinutes: settings.checkin_open_before_minutes,
          graceMinutes: settings.checkin_grace_minutes,
        },
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });

      return context.json(
        toViewerBooking(await loadView(bookingId, actor.email), {
          id: actor.id,
          role: actor.role,
        }),
      );
    });
  }

  router.patch('/:id', requireAuth, async (context) => {
    const actor = context.get('actor');
    const bookingId = context.req.param('id');
    if (!z.uuid().safeParse(bookingId).success) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const body = parseBody(patchSchema, await readJson(context));

    const head = await loadBookingHead(pool, bookingId);
    if (head === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const isAdmin = actor.role === 'ADMIN';
    if (head.owner_id !== actor.id && !isAdmin) {
      throw new AppError('FORBIDDEN', 'Only the owner or an admin may edit this booking');
    }

    const target = {
      roomId: body.room_id ?? head.room_id,
      startAt: body.start_at ?? head.start_at,
      endAt: body.end_at ?? head.end_at,
      title: body.title ?? head.title,
      description: body.description === undefined ? head.description : body.description,
      specialRequest:
        body.special_request === undefined ? head.special_request : body.special_request,
      headcount: body.headcount === undefined ? head.headcount : body.headcount,
      isPrivate: body.is_private ?? head.is_private,
    };
    const slotChanged =
      target.roomId !== head.room_id ||
      target.startAt.getTime() !== head.start_at.getTime() ||
      target.endAt.getTime() !== head.end_at.getTime();

    const settings = await loadSettings(db);
    if (slotChanged) {
      await validateSlot(target.startAt, target.endAt, settings);
    }

    try {
      await updateBooking(pool, {
        actorId: actor.id,
        isAdmin,
        bookingId,
        expectedVersion: body.version,
        target,
        previousRoomId: head.room_id,
        slotChanged,
        bufferMinutes: settings.buffer_minutes,
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
    } catch (error) {
      if (isSlotConflict(error)) {
        // CB-03: the single UPDATE rolled back whole — the row is untouched.
        throw await slotUnavailableError(pool, {
          roomId: target.roomId,
          startAt: target.startAt,
          endAt: target.endAt,
          isAdmin,
          bufferMinutes: settings.buffer_minutes,
        });
      }
      if (error instanceof AppError && error.code === 'VERSION_CONFLICT') {
        const current = toViewerBooking(await loadView(bookingId, actor.email), {
          id: actor.id,
          role: actor.role,
        });
        throw new AppError('VERSION_CONFLICT', error.message, {
          details: { ...(error.details as object), current },
        });
      }
      throw error;
    }
    if (slotChanged) {
      kickOutbox(); // the reschedule tx committed with its booking.rescheduled rows
    }

    return context.json(
      toViewerBooking(await loadView(bookingId, actor.email), { id: actor.id, role: actor.role }),
    );
  });

  // Spec §4: attendees are edited ONLY here — version-guarded replace; diff drives the
  // outbox (.ics REQUEST for added, CANCEL for removed) in the same transaction.
  router.put('/:id/attendees', requireAuth, async (context) => {
    const actor = context.get('actor');
    const bookingId = context.req.param('id');
    if (!z.uuid().safeParse(bookingId).success) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const body = parseBody(attendeesPutSchema, await readJson(context));

    const head = await loadBookingHead(pool, bookingId);
    if (head === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const isAdmin = actor.role === 'ADMIN';
    if (head.owner_id !== actor.id && !isAdmin) {
      throw new AppError('FORBIDDEN', 'Only the owner or an admin may edit attendees');
    }

    try {
      await replaceAttendees(pool, {
        actorId: actor.id,
        isAdmin,
        bookingId,
        expectedVersion: body.version,
        attendees: normalizeAttendees(body.attendees),
        ip: clientIp(context),
        requestId: context.get('requestId'),
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'VERSION_CONFLICT') {
        const current = toViewerBooking(await loadView(bookingId, actor.email), {
          id: actor.id,
          role: actor.role,
        });
        throw new AppError('VERSION_CONFLICT', error.message, {
          details: { ...(error.details as object), current },
        });
      }
      throw error;
    }
    kickOutbox(); // the replace tx committed; its diff may have written outbox rows

    return context.json(
      toViewerBooking(await loadView(bookingId, actor.email), { id: actor.id, role: actor.role }),
    );
  });

  // Spec §3: same generator and payload as the invite email — SEQUENCE = version, stable
  // UID. FULL viewers only; everyone else gets 403 FORBIDDEN_PRIVATE.
  router.get('/:id/ics', requireAuth, async (context) => {
    const actor = context.get('actor');
    const bookingId = context.req.param('id');
    if (!z.uuid().safeParse(bookingId).success) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const row = await loadView(bookingId, actor.email);
    const view = toViewerBooking(row, { id: actor.id, role: actor.role });
    if (view.visibility !== 'FULL') {
      throw new AppError('FORBIDDEN_PRIVATE', 'Only participants may download this invite');
    }

    const room = await pool.query<{ code: string; name: string }>(
      'SELECT code, name FROM rooms WHERE id = $1',
      [row.room_id],
    );
    const roomRow = room.rows[0];
    const host = new URL(dependencies.publicBaseUrl).host;
    const ics = buildCalendarInvite(
      {
        bookingId: row.id,
        version: row.version,
        summary: row.title,
        description: row.description ?? '',
        location: roomRow === undefined ? '' : `${roomRow.name} (${roomRow.code})`,
        startAt: row.start_at,
        endAt: row.end_at,
        organizer: { name: row.owner_full_name, email: row.owner_email ?? '' },
        attendees: row.attendees.map((attendee) => ({
          email: attendee.email,
          name: attendee.name ?? attendee.email,
        })),
        sentBy: `no-reply@${host}`,
        url: `${dependencies.publicBaseUrl}/bookings/${row.id}`,
      },
      row.status === 'CANCELLED' ? 'CANCEL' : 'REQUEST',
      host,
    );
    context.header('Content-Type', 'text/calendar; charset=utf-8');
    return context.body(ics);
  });

  router.post('/:id/cancel', requireAuth, async (context) => {
    const actor = context.get('actor');
    const bookingId = context.req.param('id');
    if (!z.uuid().safeParse(bookingId).success) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const body = parseBody(cancelSchema, await readJson(context));

    const result = await cancelBooking(pool, {
      actorId: actor.id,
      isAdmin: actor.role === 'ADMIN',
      bookingId,
      reason: body.reason ?? null,
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });
    if (!result.already) {
      kickOutbox(); // the cancel tx committed with its booking.cancelled rows
    }

    return context.json(
      toViewerBooking(await loadView(bookingId, actor.email), { id: actor.id, role: actor.role }),
    );
  });

  router.post('/:id/check-in', requireAuth, async (context) => {
    const actor = context.get('actor');
    checkinRateLimit(actor.id);
    const bookingId = context.req.param('id');
    if (!z.uuid().safeParse(bookingId).success) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const body = parseBody(checkinSchema, await readJson(context));

    const head = await loadBookingHead(pool, bookingId);
    if (head === undefined) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    const attendee = await pool.query(
      'SELECT 1 FROM booking_attendees WHERE booking_id = $1 AND email = $2',
      [bookingId, actor.email],
    );
    // 06 §6.3.5: membership beats role — an admin who owns/attends gets the SELF window.
    const involved = head.owner_id === actor.id || (attendee.rowCount ?? 0) > 0;
    if (!involved && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', 'Only the owner, an attendee or an admin may check in');
    }

    const settings = await loadSettings(db);
    const result = await checkInById(pool, {
      actorId: actor.id,
      bookingId,
      method: involved ? 'SELF' : 'ADMIN',
      window: {
        openBeforeMinutes: settings.checkin_open_before_minutes,
        graceMinutes: settings.checkin_grace_minutes,
      },
      note: body.note ?? null,
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });

    return context.json({
      booking: toViewerBooking(await loadView(bookingId, actor.email), {
        id: actor.id,
        role: actor.role,
      }),
      already_checked_in: result.already,
    });
  });

  return router;
}
