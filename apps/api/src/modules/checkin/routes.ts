import { Hono } from 'hono';

import { type AuthDependencies, createRequireAuth } from '../../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { clientIp } from '../../lib/http.js';
import { createRateLimiter } from '../../lib/rate-limit.js';
import { loadSettings } from '../../lib/settings.js';
import { toViewerBooking } from '../bookings/serialize.js';
import { checkInByRoom, loadBookingRow } from '../bookings/service.js';

/**
 * CB-02 QR flow: the printed sign encodes /check-in/<roomCode> — no token, no booking id.
 * The server resolves the booking from scanner identity + room + time window (earliest
 * start on overlap, per 05 T6-QR — flagged 06-prose discrepancy, the SQL wins).
 */
export function createCheckinRouter(dependencies: AuthDependencies) {
  const { db } = dependencies;
  const pool = db.$client;
  const router = new Hono();
  const requireAuth = createRequireAuth(dependencies);
  // Spec §0: check-in 10/min per user.
  const checkinRateLimit = createRateLimiter(10);

  router.post('/rooms/:room_code', requireAuth, async (context) => {
    const actor = context.get('actor');
    checkinRateLimit(actor.id);
    const roomCode = context.req.param('room_code').toLowerCase();

    // Unknown or inactive code → 404 before any SQL on bookings.
    const room = await pool.query<{ id: string }>(
      'SELECT id FROM rooms WHERE code = $1 AND active',
      [roomCode],
    );
    const roomRow = room.rows[0];
    if (roomRow === undefined) {
      throw new AppError('NOT_FOUND', 'Room not found');
    }

    const settings = await loadSettings(db);
    const result = await checkInByRoom(pool, {
      actorId: actor.id,
      actorEmail: actor.email,
      roomId: roomRow.id,
      roomCode,
      window: {
        openBeforeMinutes: settings.checkin_open_before_minutes,
        graceMinutes: settings.checkin_grace_minutes,
      },
      ip: clientIp(context),
      requestId: context.get('requestId'),
    });

    const row = await loadBookingRow(pool, result.bookingId, actor.email);
    if (row === undefined) {
      throw new AppError('INTERNAL', 'Booking vanished after check-in');
    }
    return context.json({
      booking: toViewerBooking(row, { id: actor.id, role: actor.role }),
      already_checked_in: result.already,
    });
  });

  return router;
}
