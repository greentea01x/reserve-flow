import { describe, expect, it } from 'vitest';

import { buildCalendarInvite, type CalendarInvite } from '../src/email/ics.js';
import { mailAddressFrom, mailDomainFrom, outboxMessageId } from '../src/email/mailer.js';
import { type BookingEmailData, renderTemplate } from '../src/email/templates.js';

const bookingId = '1f3c2b6e-9d47-4a51-9f0a-2b8e7c5d1a04';
const domain = 'reserveflow.local';

const invite: CalendarInvite = {
  bookingId,
  version: 3,
  summary: 'ประชุมวางแผนงบประมาณไตรมาสที่ 4 · ห้องประชุมฮอไรซัน ชั้น 12',
  description: 'ผู้จอง: สมชาย ใจดี',
  location: 'ห้องประชุมฮอไรซัน ชั้น 12',
  // 13:00–14:30 Asia/Bangkok.
  startAt: new Date('2026-08-27T13:00:00+07:00'),
  endAt: new Date('2026-08-27T14:30:00+07:00'),
  organizer: { name: 'สมชาย ใจดี', email: 'somchai.jaidee@reserveflow.local' },
  attendees: [
    { name: 'ปรียา วงศ์สว่าง', email: 'preeya.wongsawang@reserveflow.local' },
    { name: 'อาทิตย์ ศรีสุข', email: 'arthit.srisuk@reserveflow.local' },
  ],
  sentBy: 'no-reply@reserveflow.local',
  url: 'http://localhost:5173/bookings/1f3c2b6e-9d47-4a51-9f0a-2b8e7c5d1a04',
};

const booking: BookingEmailData = {
  bookingId,
  title: 'ประชุม <วางแผน> "งบประมาณ"',
  roomName: 'ห้องประชุมฮอไรซัน ชั้น 12',
  ownerName: 'สมชาย ใจดี',
  departmentName: 'ฝ่ายการเงินและบัญชี',
  startAt: invite.startAt,
  endAt: invite.endAt,
  headcount: 8,
  checkInGraceMinutes: 15,
  bookingUrl: invite.url,
};

/** RFC 5545 §3.1 unfolding: drop the CRLF and exactly one leading whitespace octet. */
function unfold(ics: string): string[] {
  const properties: string[] = [];

  for (const line of ics.split('\r\n')) {
    const previous = properties.length - 1;
    if (line === '') {
      continue;
    }
    if ((line.startsWith(' ') || line.startsWith('\t')) && previous >= 0) {
      properties[previous] = `${properties[previous] ?? ''}${line.slice(1)}`;
      continue;
    }
    properties.push(line);
  }

  return properties;
}

const request = buildCalendarInvite(invite, 'REQUEST', domain);
const cancel = buildCalendarInvite({ ...invite, version: 4 }, 'CANCEL', domain);

describe('calendar invite', () => {
  it('emits DTSTART/DTEND as UTC "Z" instants, never a TZID or a +07:00 offset', () => {
    const properties = unfold(request);

    expect(properties).toContain('DTSTART:20260827T060000Z');
    expect(properties).toContain('DTEND:20260827T073000Z');
    expect(request).not.toContain('TZID');
    expect(request).not.toContain('+07:00');
  });

  it('keeps a stable UID and takes SEQUENCE from the booking version', () => {
    expect(unfold(request)).toContain(`UID:${bookingId}@${domain}`);
    expect(unfold(request)).toContain('SEQUENCE:3');
    expect(unfold(cancel)).toContain(`UID:${bookingId}@${domain}`);
    expect(unfold(cancel)).toContain('SEQUENCE:4');
  });

  it('makes the owner the ORGANIZER and sends on their behalf', () => {
    const organizer = unfold(request).find((line) => line.startsWith('ORGANIZER'));

    expect(organizer).toContain('mailto:somchai.jaidee@reserveflow.local');
    expect(organizer).toContain('SENT-BY="mailto:no-reply@reserveflow.local"');
    expect(unfold(request).filter((line) => line.startsWith('ATTENDEE'))).toHaveLength(2);
  });

  it('cancels with METHOD:CANCEL and STATUS:CANCELLED so clients remove the event', () => {
    expect(unfold(cancel)).toContain('METHOD:CANCEL');
    expect(unfold(cancel)).toContain('STATUS:CANCELLED');
    expect(unfold(request)).toContain('METHOD:REQUEST');
    expect(unfold(request)).toContain('STATUS:CONFIRMED');
  });

  it('folds Thai text without splitting a UTF-8 sequence or losing a space', () => {
    for (const ics of [request, cancel]) {
      expect(ics.endsWith('\r\n')).toBe(true);
      expect(ics).not.toContain('�');
      expect(/(?<!\r)\n/.test(ics)).toBe(false);

      for (const line of ics.split('\r\n')) {
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      }

      expect(unfold(ics)).toContain(`LOCATION:${invite.location}`);
      expect(unfold(ics)).toContain(`SUMMARY:${invite.summary}`);
    }
  });
});

describe('thai templates', () => {
  it('renders booking.confirmed in Bangkok local time', () => {
    const email = renderTemplate('booking.confirmed', booking);

    expect(email.subject).toContain('ยืนยันการจอง');
    expect(email.text).toContain('13:00–14:30');
    expect(email.text).toContain('เรียน คุณสมชาย ใจดี');
    expect(email.html).toContain('ห้องประชุมฮอไรซัน ชั้น 12');
  });

  it('tells the owner in booking.auto_released why the room went back', () => {
    const email = renderTemplate('booking.auto_released', booking);

    expect(email.subject).toContain('ยกเลิกอัตโนมัติ');
    expect(email.text).toContain('15 นาที');
  });

  it('renders account.set_password with the set-password link as the only CTA', () => {
    const email = renderTemplate('account.set_password', {
      ...booking,
      bookingUrl: 'http://localhost:5173/set-password?token=abc',
    });

    expect(email.subject).toContain('ตั้งรหัสผ่าน');
    expect(email.text).toContain('เรียน คุณสมชาย ใจดี');
    expect(email.text).toContain('/set-password?token=abc');
    expect(email.html).toContain('/set-password?token=abc');
    // Account mail carries no booking facts.
    expect(email.text).not.toContain('ห้องประชุมฮอไรซัน');
  });

  it('escapes user-supplied text before it reaches the html body', () => {
    const email = renderTemplate('booking.confirmed', booking);

    expect(email.html).toContain('&lt;วางแผน&gt;');
    expect(email.html).not.toContain('<วางแผน>');
  });
});

describe('outbox message id', () => {
  it('is derived from the notification row so a retry reuses it', () => {
    expect(outboxMessageId(4711, domain)).toBe('<notif-4711@reserveflow.local>');
    expect(outboxMessageId(4711, domain)).toBe(outboxMessageId('4711', domain));
  });

  it('takes its domain from MAIL_FROM so a relay swap cannot desync it', () => {
    expect(mailDomainFrom('ReserveFlow <no-reply@ReserveFlow.local>')).toBe('reserveflow.local');
    expect(mailDomainFrom('no-reply@reserveflow.local')).toBe('reserveflow.local');
    expect(mailAddressFrom('ReserveFlow <no-reply@reserveflow.local>')).toBe(
      'no-reply@reserveflow.local',
    );
    expect(() => mailDomainFrom('ReserveFlow')).toThrow();
  });
});
