/**
 * T-009 spike — throwaway. Sends the two proof emails through the real Mailpit on
 * 127.0.0.1:1025, reads them back through Mailpit's HTTP API and asserts on the decoded
 * result. Delete once T-040/T-041 land the outbox worker and the real templates.
 *
 * Run: node --env-file=.env --import tsx --conditions=development apps/api/spike/t009-smtp-ics.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildCalendarInvite, type CalendarMethod } from '../src/email/ics.js';
import {
  createMailer,
  type MailerConfig,
  mailAddressFrom,
  mailDomainFrom,
  sendOutboxMessage,
} from '../src/email/mailer.js';
import { type BookingEmailData, renderTemplate } from '../src/email/templates.js';

const mailpit = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
const outputDirectory = process.env.SPIKE_OUT ?? '/tmp/t009';

const from = process.env.MAIL_FROM ?? 'ReserveFlow <no-reply@reserveflow.local>';
const config: MailerConfig = {
  host: process.env.SMTP_HOST ?? '127.0.0.1',
  port: Number(process.env.SMTP_PORT ?? 1025),
  user: process.env.SMTP_USER ?? '',
  pass: process.env.SMTP_PASS ?? '',
  from,
  replyTo: process.env.MAIL_REPLY_TO ?? 'facility@reserveflow.local',
  domain: mailDomainFrom(from),
};

const owner = { name: 'สมชาย ใจดี', email: 'somchai.jaidee@reserveflow.local' };
const attendees = [
  { name: 'ปรียา วงศ์สว่าง', email: 'preeya.wongsawang@reserveflow.local' },
  { name: 'อาทิตย์ ศรีสุข', email: 'arthit.srisuk@reserveflow.local' },
] as const;

const bookingId = '1f3c2b6e-9d47-4a51-9f0a-2b8e7c5d1a04';
const booking: BookingEmailData = {
  bookingId,
  title: 'ประชุมวางแผนงบประมาณไตรมาสที่ 4 (ฝ่ายการเงิน)',
  roomName: 'ห้องประชุมฮอไรซัน ชั้น 12',
  ownerName: owner.name,
  departmentName: 'ฝ่ายการเงินและบัญชี',
  // 2026-08-27 13:00–14:30 Asia/Bangkok, written as the offset the API emits (03 conventions).
  startAt: new Date('2026-08-27T13:00:00+07:00'),
  endAt: new Date('2026-08-27T14:30:00+07:00'),
  headcount: 8,
  checkInGraceMinutes: 15,
  bookingUrl: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/bookings/${bookingId}`,
};

const inviteBase = {
  bookingId,
  summary: `${booking.title} · ${booking.roomName}`,
  description: `ผู้จอง: ${owner.name} (${booking.departmentName})\nผู้เข้าร่วม ${booking.headcount} คน\nรายละเอียด: ${booking.bookingUrl}`,
  location: booking.roomName,
  startAt: booking.startAt,
  endAt: booking.endAt,
  organizer: owner,
  attendees,
  sentBy: mailAddressFrom(config.from),
  url: booking.bookingUrl,
};

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) {
    failures.push(label);
  }
  console.log(`${status}  ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

// ---------------------------------------------------------------- .ics structural validation

const requiredCalendarProperties = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID', 'METHOD'];
const requiredEventProperties = [
  'BEGIN:VEVENT',
  'UID',
  'SEQUENCE',
  'DTSTAMP',
  'DTSTART',
  'DTEND',
  'SUMMARY',
  'ORGANIZER',
  'ATTENDEE',
  'END:VEVENT',
];

function unfold(ics: string): string[] {
  const lines = ics.split('\r\n');
  const unfolded: string[] = [];

  for (const line of lines) {
    if (line === '') {
      continue;
    }
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }
    unfolded.push(line);
  }

  return unfolded;
}

function validateIcs(ics: string, method: CalendarMethod, sequence: number): string[] {
  const problems: string[] = [];

  if (!ics.endsWith('\r\n')) {
    problems.push('file does not end with CRLF');
  }
  if (/(?<!\r)\n/.test(ics) || /\r(?!\n)/.test(ics)) {
    problems.push('found a bare LF or CR (RFC 5545 requires CRLF line breaks)');
  }
  if (ics.includes('�')) {
    problems.push('replacement character present — line folding split a UTF-8 sequence');
  }

  for (const [index, line] of ics.split('\r\n').entries()) {
    const octets = Buffer.byteLength(line, 'utf8');
    if (octets > 75) {
      problems.push(`line ${index + 1} is ${octets} octets (RFC 5545 limit is 75)`);
    }
  }

  const properties = unfold(ics);
  const first = properties.at(0);
  const last = properties.at(-1);
  if (first !== 'BEGIN:VCALENDAR' || last !== 'END:VCALENDAR') {
    problems.push('VCALENDAR is not the outermost component');
  }

  for (const required of [...requiredCalendarProperties, ...requiredEventProperties]) {
    if (!properties.some((property) => property.startsWith(required))) {
      problems.push(`missing required property ${required}`);
    }
  }

  if (!properties.includes(`METHOD:${method}`)) {
    problems.push(`METHOD is not ${method}`);
  }
  if (!properties.includes(`SEQUENCE:${sequence}`)) {
    problems.push(`SEQUENCE is not ${sequence}`);
  }
  if (!properties.includes(`UID:${bookingId}@${config.domain}`)) {
    problems.push('UID is not <booking id>@<domain>');
  }

  for (const property of ['DTSTART', 'DTEND', 'DTSTAMP']) {
    const value = properties
      .find((line) => line.startsWith(`${property}`))
      ?.split(':')
      .at(1);
    if (value === undefined || !/^\d{8}T\d{6}Z$/.test(value)) {
      problems.push(`${property} is not a UTC "Z" DATE-TIME (got ${String(value)})`);
    }
    if (properties.some((line) => line.startsWith(`${property};TZID=`))) {
      problems.push(`${property} carries a TZID parameter`);
    }
  }

  const attendeeLines = properties.filter((line) => line.startsWith('ATTENDEE'));
  if (attendeeLines.length !== attendees.length) {
    problems.push(`expected ${attendees.length} ATTENDEE lines, found ${attendeeLines.length}`);
  }

  // The classic folding bug: a fold placed right after a space must not eat that space.
  const location = properties.find((line) => line.startsWith('LOCATION:'));
  if (location !== `LOCATION:${booking.roomName}`) {
    problems.push(`unfolding did not restore LOCATION (got ${String(location)})`);
  }

  const organizer = properties.find((line) => line.startsWith('ORGANIZER')) ?? '';
  if (!organizer.includes(`mailto:${owner.email}`)) {
    problems.push('ORGANIZER is not the booking owner');
  }
  if (!organizer.includes('SENT-BY=')) {
    problems.push('ORGANIZER has no SENT-BY for the sending address');
  }

  if (method === 'CANCEL' && !properties.includes('STATUS:CANCELLED')) {
    problems.push('CANCEL without STATUS:CANCELLED');
  }

  return problems;
}

// ------------------------------------------------------------------------------ Mailpit API

type MailpitSummary = { ID: string; MessageID: string; Subject: string };
type MailpitAttachment = { PartID: string; FileName: string; ContentType: string };
type MailpitMessage = {
  ID: string;
  MessageID: string;
  Subject: string;
  Text: string;
  HTML: string;
  Attachments: MailpitAttachment[];
  Inline: MailpitAttachment[];
};

async function mailpitJson<T>(path: string): Promise<T> {
  const response = await fetch(`${mailpit}${path}`);
  if (!response.ok) {
    throw new Error(`mailpit ${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

async function mailpitText(path: string): Promise<string> {
  const response = await fetch(`${mailpit}${path}`);
  if (!response.ok) {
    throw new Error(`mailpit ${path} responded ${response.status}`);
  }
  return await response.text();
}

// --------------------------------------------------------------------------------- the spike

mkdirSync(outputDirectory, { recursive: true });

await fetch(`${mailpit}/api/v1/messages`, { method: 'DELETE' });

const transporter = createMailer(config);

// version 3 = the CONFIRMED booking; version 4 = after the sweep flipped it to AUTO_RELEASED.
const requestIcs = buildCalendarInvite(
  { ...inviteBase, version: 3 },
  'REQUEST' satisfies CalendarMethod,
  config.domain,
);
const cancelIcs = buildCalendarInvite(
  { ...inviteBase, version: 4 },
  'CANCEL' satisfies CalendarMethod,
  config.domain,
);

writeFileSync(join(outputDirectory, 'booking-confirmed-REQUEST.ics'), requestIcs);
writeFileSync(join(outputDirectory, 'booking-auto-released-CANCEL.ics'), cancelIcs);

const confirmed = renderTemplate('booking.confirmed', booking);
const released = renderTemplate('booking.auto_released', booking);

const confirmedOutcome = await sendOutboxMessage(transporter, config, {
  notificationId: 4711,
  to: `${owner.name} <${owner.email}>`,
  subject: confirmed.subject,
  text: confirmed.text,
  html: confirmed.html,
  calendar: { method: 'REQUEST', content: requestIcs },
});

const releasedOutcome = await sendOutboxMessage(transporter, config, {
  notificationId: 4823,
  to: `${owner.name} <${owner.email}>`,
  subject: released.subject,
  text: released.text,
  html: released.html,
  calendar: { method: 'CANCEL', content: cancelIcs },
});

// Sending the same outbox row twice must land on the same Message-ID.
const replayOutcome = await sendOutboxMessage(transporter, config, {
  notificationId: 4711,
  to: `${owner.name} <${owner.email}>`,
  subject: confirmed.subject,
  text: confirmed.text,
  html: confirmed.html,
  calendar: { method: 'REQUEST', content: requestIcs },
});

transporter.close();

console.log('\n--- SMTP outcomes ---');
console.log(JSON.stringify({ confirmedOutcome, releasedOutcome, replayOutcome }, null, 2));

check(
  'message id is deterministic per notifications.id',
  confirmedOutcome.messageId === '<notif-4711@reserveflow.local>' &&
    replayOutcome.messageId === confirmedOutcome.messageId,
  confirmedOutcome.messageId,
);
check(
  'relay accepted every recipient',
  confirmedOutcome.accepted.length === 1 && confirmedOutcome.rejected.length === 0,
  confirmedOutcome.response,
);

const { messages } = await mailpitJson<{ messages: MailpitSummary[] }>('/api/v1/messages?limit=50');
check('mailpit stored all three sends', messages.length === 3, `${messages.length} messages`);

const structural = {
  REQUEST: validateIcs(requestIcs, 'REQUEST', 3),
  CANCEL: validateIcs(cancelIcs, 'CANCEL', 4),
};
check(
  'generated REQUEST .ics is structurally valid',
  structural.REQUEST.length === 0,
  structural.REQUEST.join('; '),
);
check(
  'generated CANCEL .ics is structurally valid',
  structural.CANCEL.length === 0,
  structural.CANCEL.join('; '),
);
check(
  'CANCEL keeps the REQUEST UID and raises SEQUENCE',
  unfold(cancelIcs).includes(`UID:${bookingId}@${config.domain}`) &&
    unfold(requestIcs).includes(`UID:${bookingId}@${config.domain}`) &&
    unfold(cancelIcs).includes('SEQUENCE:4') &&
    unfold(requestIcs).includes('SEQUENCE:3'),
);

const evidence: Record<string, unknown> = {};

for (const summary of messages) {
  const message = await mailpitJson<MailpitMessage>(`/api/v1/message/${summary.ID}`);
  const raw = await mailpitText(`/api/v1/message/${summary.ID}/raw`);
  const label = `${message.MessageID} :: ${message.Subject}`;

  const calendarPart = [...message.Attachments, ...message.Inline].find((part) =>
    /calendar|ics/i.test(part.ContentType),
  );
  const roundTripped =
    calendarPart === undefined
      ? ''
      : await mailpitText(`/api/v1/message/${summary.ID}/part/${calendarPart.PartID}`);
  const expectedIcs = message.Subject.startsWith('ยืนยัน') ? requestIcs : cancelIcs;

  check(`[${label}] subject decodes to Thai`, /[฀-๿]/.test(message.Subject));
  check(
    `[${label}] plain-text part decodes to Thai`,
    message.Text.includes('เรียน คุณสมชาย ใจดี') && !message.Text.includes('�'),
  );
  check(
    `[${label}] html part decodes to Thai`,
    message.HTML.includes('ห้องประชุมฮอไรซัน ชั้น 12') && !message.HTML.includes('�'),
  );
  check(
    `[${label}] Thai local time is rendered from the UTC instant`,
    message.Text.includes('13:00–14:30'),
  );
  check(
    `[${label}] .ics survives the MIME round trip byte for byte`,
    roundTripped === expectedIcs,
    calendarPart?.ContentType ?? 'no calendar part found',
  );
  check(
    `[${label}] raw message declares a text/calendar alternative with the method`,
    /Content-Type: text\/calendar; charset=utf-8; method=(REQUEST|CANCEL)/i.test(raw),
  );

  evidence[summary.ID] = {
    messageId: message.MessageID,
    subject: message.Subject,
    contentTypeHeaders: raw
      .split('\r\n')
      .filter((line) =>
        /^(Content-Type|Content-Transfer-Encoding|Message-ID|Subject):/i.test(line),
      ),
    attachments: [...message.Attachments, ...message.Inline],
  };
}

writeFileSync(join(outputDirectory, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);

console.log('\n--- artefacts ---');
console.log(outputDirectory);
console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `FAILED: ${failures.join(' | ')}`}`);
process.exitCode = failures.length === 0 ? 0 : 1;
