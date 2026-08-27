import { and, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { type AuthDependencies, createRequireAuth } from '../../auth/middleware.js';
import { schema } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';
import { loadSettings } from '../../lib/settings.js';
import { bangkokDateParam, bangkokDateStart, bangkokParts, toBangkokIso } from '../../lib/time.js';
import {
  type BusinessHoursDay,
  earliestSlotStart,
  occupancyRange,
  validateWindow,
} from '../../lib/window.js';
import { type BookingRow, toCalendarBooking } from '../bookings/serialize.js';
import { loadRoomFeatures, parseFeatureKeys } from '../rooms/routes.js';

const { businessHours, holidays, rooms } = schema;

const DAY_MS = 86_400_000;

const availabilityQuerySchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
  headcount: z.coerce.number().int().min(1).optional(),
  features: z.string().optional(),
});

const calendarQuerySchema = z.object({
  from: bangkokDateParam,
  to: bangkokDateParam,
  room_id: z.uuid().optional(),
});

/** Occupancy facts per active room: busy = any CONFIRMED/CHECKED_IN overlap on the requested
 * range widened by settings.buffer_minutes (occupancyRange — the same range the create probe
 * uses), busy_until = when the room frees up, buffer included. */
const ROOM_FACTS_SQL = `
  SELECT r.id, r.code, r.name, r.floor, r.capacity, busy.busy_until
    FROM rooms r
    LEFT JOIN LATERAL (
      SELECT max(upper(b.slot)) AS busy_until
        FROM bookings b
       WHERE b.room_id = r.id
         AND b.status IN ('CONFIRMED','CHECKED_IN')
         AND b.slot && tstzrange($1::timestamptz, $2::timestamptz, '[)')
    ) busy ON true
   WHERE r.active
   ORDER BY r.capacity, r.name`;

type RoomFactsRow = {
  id: string;
  code: string;
  name: string;
  floor: string | null;
  capacity: number;
  busy_until: Date | null;
};

/** One query per calendar request; SQL returns facts, toViewerBooking() picks the level. */
const CALENDAR_BOOKINGS_SQL = `
  SELECT b.id, b.room_id, b.start_at, b.end_at, b.status, b.is_private, b.title,
         b.description, b.special_request, b.headcount, b.version, b.owner_id,
         b.checked_in_at, b.checkin_method, b.created_at, b.updated_at,
         u.full_name AS owner_full_name,
         d.id AS department_id, d.code AS department_code, d.name AS department_name,
         (SELECT count(*)::int FROM booking_attendees a WHERE a.booking_id = b.id)
           AS attendee_count,
         EXISTS (SELECT 1 FROM booking_attendees a
                  WHERE a.booking_id = b.id AND a.email = $3) AS viewer_is_attendee,
         (SELECT coalesce(json_agg(json_build_object('email', a.email, 'name', a.name)
                                   ORDER BY a.email), '[]'::json)
            FROM booking_attendees a WHERE a.booking_id = b.id) AS attendees
    FROM bookings b
    JOIN users u ON u.id = b.owner_id
    LEFT JOIN departments d ON d.id = u.department_id
   WHERE b.status IN ('CONFIRMED','CHECKED_IN','COMPLETED')
     AND b.start_at >= $1::timestamptz - interval '12 hours'
     AND b.start_at < $2::timestamptz
     AND b.end_at > $1::timestamptz
     AND ($4::uuid IS NULL OR b.room_id = $4::uuid)
   ORDER BY b.start_at, b.id`;

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

export function createAvailabilityRouter(dependencies: AuthDependencies) {
  const { db } = dependencies;
  const router = new Hono();
  const requireAuth = createRequireAuth(dependencies);

  router.get('/availability', requireAuth, async (context) => {
    const parsed = availabilityQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid availability query', {
        details: parsed.error.issues,
      });
    }
    const { start, end, headcount } = parsed.data;
    const wanted = parseFeatureKeys(parsed.data.features);

    const [settings, hoursRows, holidayRows] = await Promise.all([
      loadSettings(db),
      db.select().from(businessHours),
      db
        .select()
        .from(holidays)
        .where(eq(holidays.day, bangkokParts(start).date)),
    ]);
    const now = new Date();
    const verdict = validateWindow({
      start,
      end,
      now,
      settings,
      hours: toHoursMap(hoursRows),
      holidays: new Map(holidayRows.map((row) => [row.day, row.name])),
      // Same refinement as POST /bookings (§2: same validator) — a window the create
      // endpoint rejects as IN_PAST must not render as available here.
      earliestStart: earliestSlotStart(now, settings),
    });
    if (!verdict.ok && verdict.kind === 'HARD') {
      throw verdict.error;
    }
    // Hours are company-wide, so a closed day / holiday closes every room; the endpoint
    // still returns every active room with its verdict — it never silently filters.
    const closedReason = verdict.ok ? undefined : (verdict.kind as 'CLOSED' | 'HOLIDAY');

    const occupancy = occupancyRange(start, end, settings);
    const bufferMs = settings.buffer_minutes * 60_000;
    const [facts, featuresByRoom] = await Promise.all([
      db.$client.query<RoomFactsRow>(ROOM_FACTS_SQL, [
        occupancy.from.toISOString(),
        occupancy.to.toISOString(),
      ]),
      loadRoomFeatures(db),
    ]);

    return context.json({
      start: toBangkokIso(start),
      end: toBangkokIso(end),
      rooms: facts.rows.map((row) => {
        // The room is only bookable again one buffer after the blocking meeting ends.
        const busyUntil =
          row.busy_until === null ? null : new Date(row.busy_until.getTime() + bufferMs);
        const keys = new Set((featuresByRoom.get(row.id) ?? []).map((feature) => feature.key));
        const reasons: ('BUSY' | 'CLOSED' | 'HOLIDAY' | 'CAPACITY' | 'MISSING_FEATURE')[] = [];
        if (closedReason !== undefined) {
          reasons.push(closedReason);
        }
        if (busyUntil !== null) {
          reasons.push('BUSY');
        }
        if (headcount !== undefined && row.capacity < headcount) {
          reasons.push('CAPACITY');
        }
        if (!wanted.every((key) => keys.has(key))) {
          reasons.push('MISSING_FEATURE');
        }
        return {
          room: {
            id: row.id,
            code: row.code,
            name: row.name,
            floor: row.floor,
            capacity: row.capacity,
          },
          available: reasons.length === 0,
          reasons,
          ...(busyUntil === null ? {} : { busy_until: toBangkokIso(busyUntil) }),
        };
      }),
    });
  });

  router.get('/calendar', requireAuth, async (context) => {
    const parsed = calendarQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid calendar query', {
        details: parsed.error.issues,
      });
    }
    const { from, to, room_id: roomId } = parsed.data;
    const fromStart = bangkokDateStart(from);
    const toEnd = new Date(bangkokDateStart(to).getTime() + DAY_MS);
    // No Invalid-Date guard: bangkokDateParam has already proved both are real dates.
    const dayCount = Math.round((toEnd.getTime() - fromStart.getTime()) / DAY_MS);
    if (dayCount < 1 || dayCount > 31) {
      throw new AppError('VALIDATION_FAILED', 'Calendar range must be 1–31 days');
    }

    const roomRows = await db
      .select({
        id: rooms.id,
        code: rooms.code,
        name: rooms.name,
        floor: rooms.floor,
        capacity: rooms.capacity,
      })
      .from(rooms)
      .where(eq(rooms.active, true))
      .orderBy(rooms.capacity, rooms.name);
    const visibleRooms = roomId === undefined ? roomRows : roomRows.filter((r) => r.id === roomId);
    if (roomId !== undefined && visibleRooms.length === 0) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }

    // PROPOSED (§6.4.3 worked example): only the weekday rows occurring in [from, to];
    // the full 7-row set is always available from GET /settings.
    const weekdaysInRange = new Set<number>();
    for (let day = 0; day < dayCount; day++) {
      weekdaysInRange.add(bangkokParts(new Date(fromStart.getTime() + day * DAY_MS)).isoWeekday);
    }

    const actor = context.get('actor');
    const [hoursRows, holidayRows, bookingRows] = await Promise.all([
      db.select().from(businessHours).orderBy(businessHours.weekday),
      db
        .select()
        .from(holidays)
        .where(and(gte(holidays.day, from), lte(holidays.day, to)))
        .orderBy(holidays.day),
      db.$client.query<BookingRow>(CALENDAR_BOOKINGS_SQL, [
        fromStart.toISOString(),
        toEnd.toISOString(),
        actor.email,
        roomId ?? null,
      ]),
    ]);

    const viewer = { id: actor.id, role: actor.role };
    return context.json({
      from,
      to,
      rooms: visibleRooms,
      business_hours: hoursRows
        .filter((row) => weekdaysInRange.has(row.weekday))
        .map((row) => ({
          weekday: row.weekday,
          is_open: row.isOpen,
          open_time: row.openTime,
          close_time: row.closeTime,
        })),
      holidays: holidayRows.map((row) => ({ date: row.day, name: row.name })),
      // Employee/admin calendar cells identify who reserved the room, while private BUSY
      // FACILITY views and all private meeting details remain masked. Keep this display-only
      // field scoped to /calendar; booking detail/list responses retain the stricter shape.
      bookings: bookingRows.rows.map((row) => toCalendarBooking(row, viewer)),
    });
  });

  return router;
}
