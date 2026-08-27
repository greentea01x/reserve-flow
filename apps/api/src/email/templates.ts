import { APP_TZ } from '@reserveflow/shared';

export type TemplateKey =
  | 'booking.confirmed'
  | 'booking.rescheduled'
  | 'booking.cancelled'
  | 'booking.reminder'
  | 'booking.auto_released'
  | 'booking.auto_released_admin'
  | 'account.set_password';

export type BookingEmailData = {
  bookingId: string;
  title: string;
  roomName: string;
  ownerName: string;
  /** Absent from the outbox payload today — the dept fact renders only when present. */
  departmentName?: string;
  startAt: Date;
  endAt: Date;
  headcount: number | null;
  /** settings.checkin_grace_minutes — the number the auto-release copy has to quote. */
  checkInGraceMinutes: number;
  bookingUrl: string;
  /** Admin cancel reason (S-15); shown on booking.cancelled only when present. */
  reason?: string;
};

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

const dayFormat = new Intl.DateTimeFormat('th-TH', { timeZone: APP_TZ, dateStyle: 'full' });
const clockFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: APP_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Booking titles, room names and people's names are user input; they reach the HTML body.
function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (character) => htmlEscapes[character] ?? character);
}

/** "วันพฤหัสบดีที่ 27 สิงหาคม พ.ศ. 2569 เวลา 13:00–14:30 น." — th-TH defaults to the Buddhist era. */
export function formatBookingWhen(startAt: Date, endAt: Date): string {
  return `${dayFormat.format(startAt)} เวลา ${clockFormat.format(startAt)}–${clockFormat.format(endAt)} น.`;
}

function layout(
  heading: string,
  paragraphs: readonly string[],
  cta: { label: string; url: string },
) {
  const body = paragraphs.map((paragraph) => `      <p>${paragraph}</p>`).join('\n');

  return `<!doctype html>
<html lang="th">
  <head><meta charset="utf-8" /><title>${escapeHtml(heading)}</title></head>
  <body style="margin:0;background:#f4f6fb;font-family:'Sarabun','Noto Sans Thai',sans-serif;color:#1f2933">
    <div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;line-height:1.75">
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
${body}
      <p style="margin:24px 0 0">
        <a href="${cta.url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#2f6fed;color:#ffffff;text-decoration:none">${escapeHtml(cta.label)}</a>
      </p>
      <p style="margin-top:24px;font-size:12px;color:#7b8794">อีเมลฉบับนี้ส่งจากระบบจองห้องประชุม ReserveFlow โดยอัตโนมัติ กรุณาอย่าตอบกลับ</p>
    </div>
  </body>
</html>`;
}

function factsLine(data: BookingEmailData): string {
  const parts: string[] = [];
  if (data.departmentName !== undefined) {
    parts.push(`แผนก: ${data.departmentName}`);
  }
  if (data.headcount !== null) {
    parts.push(`ผู้เข้าร่วม ${data.headcount} คน`);
  }
  return parts.join(' · ');
}

function roomTimeHtml(data: BookingEmailData, when: string, timeLabel: string): string {
  const facts = factsLine(data);
  return [
    `<strong>ห้อง:</strong> ${escapeHtml(data.roomName)}<br /><strong>${timeLabel}:</strong> ${escapeHtml(when)}`,
    ...(facts === '' ? [] : [escapeHtml(facts)]),
  ].join('<br />');
}

function confirmed(data: BookingEmailData): RenderedEmail {
  const when = formatBookingWhen(data.startAt, data.endAt);
  const greeting = `เรียน คุณ${data.ownerName}`;
  const lead = `การจองห้องประชุม “${data.title}” ของคุณได้รับการยืนยันแล้ว`;
  const grace = `กรุณาเช็กอินภายใน ${data.checkInGraceMinutes} นาทีหลังเวลาเริ่ม มิฉะนั้นระบบจะปล่อยห้องคืนโดยอัตโนมัติ`;
  const attachment = 'ไฟล์นัดหมาย (.ics) แนบมาพร้อมอีเมลฉบับนี้ เปิดเพื่อเพิ่มลงปฏิทินของคุณ';
  const facts = factsLine(data);

  return {
    subject: `ยืนยันการจอง: ${data.roomName} · ${when}`,
    text: [
      greeting,
      lead,
      `ห้อง: ${data.roomName}`,
      `เวลา: ${when}`,
      ...(facts === '' ? [] : [facts]),
      grace,
      attachment,
      '',
      `ดูรายละเอียดการจอง: ${data.bookingUrl}`,
      '',
    ].join('\n'),
    html: layout(
      'ยืนยันการจองห้องประชุม',
      [
        escapeHtml(greeting),
        escapeHtml(lead),
        roomTimeHtml(data, when, 'เวลา'),
        escapeHtml(grace),
        escapeHtml(attachment),
      ],
      { label: 'ดูรายละเอียดการจอง', url: data.bookingUrl },
    ),
  };
}

function rescheduled(data: BookingEmailData): RenderedEmail {
  const when = formatBookingWhen(data.startAt, data.endAt);
  const greeting = `เรียน คุณ${data.ownerName}`;
  const lead = `การจองห้องประชุม “${data.title}” ถูกเปลี่ยนเวลา รายละเอียดใหม่ดังนี้`;
  const attachment = 'ไฟล์นัดหมาย (.ics) ฉบับปรับปรุงแนบมาพร้อมอีเมลฉบับนี้ เปิดเพื่ออัปเดตปฏิทินของคุณ';

  return {
    subject: `เปลี่ยนเวลาการจอง: ${data.roomName} · ${when}`,
    text: [
      greeting,
      lead,
      `ห้อง: ${data.roomName}`,
      `เวลาใหม่: ${when}`,
      attachment,
      '',
      `ดูรายละเอียดการจอง: ${data.bookingUrl}`,
      '',
    ].join('\n'),
    html: layout(
      'เปลี่ยนเวลาการจองห้องประชุม',
      [
        escapeHtml(greeting),
        escapeHtml(lead),
        roomTimeHtml(data, when, 'เวลาใหม่'),
        escapeHtml(attachment),
      ],
      { label: 'ดูรายละเอียดการจอง', url: data.bookingUrl },
    ),
  };
}

function cancelled(data: BookingEmailData): RenderedEmail {
  const when = formatBookingWhen(data.startAt, data.endAt);
  const greeting = `เรียน คุณ${data.ownerName}`;
  const lead = `การจองห้องประชุม “${data.title}” ถูกยกเลิกแล้ว`;
  const reason = data.reason === undefined ? undefined : `เหตุผล: ${data.reason}`;
  const removed = 'ระบบได้ส่งคำสั่งลบนัดหมายนี้ออกจากปฏิทินของคุณแล้ว';

  return {
    subject: `ยกเลิกการจอง: ${data.roomName} · ${when}`,
    text: [
      greeting,
      lead,
      `ห้อง: ${data.roomName}`,
      `เวลาเดิม: ${when}`,
      ...(reason === undefined ? [] : [reason]),
      removed,
      '',
      `จองห้องใหม่: ${data.bookingUrl}`,
      '',
    ].join('\n'),
    html: layout(
      'ยกเลิกการจองห้องประชุม',
      [
        escapeHtml(greeting),
        escapeHtml(lead),
        `<strong>ห้อง:</strong> ${escapeHtml(data.roomName)}<br /><strong>เวลาเดิม:</strong> ${escapeHtml(when)}`,
        ...(reason === undefined ? [] : [escapeHtml(reason)]),
        escapeHtml(removed),
      ],
      { label: 'จองห้องใหม่', url: data.bookingUrl },
    ),
  };
}

function reminder(data: BookingEmailData): RenderedEmail {
  const when = formatBookingWhen(data.startAt, data.endAt);
  const greeting = `เรียน คุณ${data.ownerName}`;
  const lead = `การจองห้องประชุม “${data.title}” ของคุณกำลังจะเริ่ม`;
  const grace = `อย่าลืมเช็กอินภายใน ${data.checkInGraceMinutes} นาทีหลังเวลาเริ่ม มิฉะนั้นระบบจะปล่อยห้องคืนโดยอัตโนมัติ`;

  return {
    subject: `เตือนการจอง: ${data.roomName} · ${when}`,
    text: [
      greeting,
      lead,
      `ห้อง: ${data.roomName}`,
      `เวลา: ${when}`,
      grace,
      '',
      `เปิดหน้าการจองเพื่อเช็กอิน: ${data.bookingUrl}`,
      '',
    ].join('\n'),
    html: layout(
      'เตือนการจองห้องประชุม',
      [escapeHtml(greeting), escapeHtml(lead), roomTimeHtml(data, when, 'เวลา'), escapeHtml(grace)],
      { label: 'เปิดหน้าการจองเพื่อเช็กอิน', url: data.bookingUrl },
    ),
  };
}

function autoReleasedAdmin(data: BookingEmailData): RenderedEmail {
  const when = formatBookingWhen(data.startAt, data.endAt);
  const lead = `การจองห้องประชุม “${data.title}” ของคุณ${data.ownerName} ถูกปล่อยคืนอัตโนมัติ (NO_SHOW) เนื่องจากไม่มีการเช็กอินภายใน ${data.checkInGraceMinutes} นาทีหลังเวลาเริ่ม`;

  return {
    subject: `[ระบบ] ปล่อยห้องคืนอัตโนมัติ: ${data.roomName} · ${when}`,
    text: [
      'เรียน ผู้ดูแลระบบ',
      lead,
      `ห้อง: ${data.roomName}`,
      `เวลาเดิม: ${when}`,
      '',
      `ดูรายละเอียดการจอง: ${data.bookingUrl}`,
      '',
    ].join('\n'),
    html: layout(
      'ปล่อยห้องคืนอัตโนมัติ',
      [
        'เรียน ผู้ดูแลระบบ',
        escapeHtml(lead),
        `<strong>ห้อง:</strong> ${escapeHtml(data.roomName)}<br /><strong>เวลาเดิม:</strong> ${escapeHtml(when)}`,
      ],
      { label: 'ดูรายละเอียดการจอง', url: data.bookingUrl },
    ),
  };
}

function autoReleased(data: BookingEmailData): RenderedEmail {
  const when = formatBookingWhen(data.startAt, data.endAt);
  const greeting = `เรียน คุณ${data.ownerName}`;
  const lead = `การจองห้องประชุม “${data.title}” ถูกยกเลิกโดยอัตโนมัติ เนื่องจากไม่มีการเช็กอินภายใน ${data.checkInGraceMinutes} นาทีหลังเวลาเริ่ม`;
  const released =
    'ห้องถูกปล่อยคืนให้ผู้อื่นจองได้ทันที และระบบได้ส่งคำสั่งลบนัดหมายนี้ออกจากปฏิทินของคุณและผู้เข้าร่วมทุกคนแล้ว';
  const rebook = 'หากยังต้องการใช้ห้อง กรุณาจองใหม่อีกครั้ง';

  return {
    subject: `ยกเลิกอัตโนมัติ (ไม่ได้เช็กอิน): ${data.roomName} · ${when}`,
    text: [
      greeting,
      lead,
      `ห้อง: ${data.roomName}`,
      `เวลาเดิม: ${when}`,
      released,
      rebook,
      '',
      `จองห้องใหม่: ${data.bookingUrl}`,
      '',
    ].join('\n'),
    html: layout(
      'การจองถูกยกเลิกอัตโนมัติ',
      [
        escapeHtml(greeting),
        escapeHtml(lead),
        `<strong>ห้อง:</strong> ${escapeHtml(data.roomName)}<br /><strong>เวลาเดิม:</strong> ${escapeHtml(when)}`,
        escapeHtml(released),
        escapeHtml(rebook),
      ],
      { label: 'จองห้องใหม่', url: data.bookingUrl },
    ),
  };
}

/**
 * §2.6 ACCOUNT row (invite / admin reset / forgot-password). The drain maps the account
 * payload onto the booking shape: `ownerName` is the recipient's name and `bookingUrl` the
 * single-use /set-password?token= link (invite 7 days, reset/forgot 24 hours); the
 * booking-shaped fields are unused.
 */
function setPassword(data: BookingEmailData): RenderedEmail {
  const greeting = `เรียน คุณ${data.ownerName}`;
  const lead =
    'มีการขอตั้งรหัสผ่านสำหรับบัญชีผู้ใช้ระบบจองห้องประชุม ReserveFlow ของคุณ กรุณากดปุ่มด้านล่างเพื่อตั้งรหัสผ่าน';
  const expiry =
    'ลิงก์นี้ใช้ได้ครั้งเดียวและมีเวลาจำกัด หากหมดอายุแล้ว สามารถขอลิงก์ใหม่ได้จากหน้าเข้าสู่ระบบหรือติดต่อผู้ดูแลระบบ';
  const ignore = 'หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ รหัสผ่านเดิมของคุณยังใช้งานได้ตามปกติ';

  return {
    subject: 'ตั้งรหัสผ่านบัญชี ReserveFlow ของคุณ',
    text: [greeting, lead, expiry, ignore, '', `ตั้งรหัสผ่าน: ${data.bookingUrl}`, ''].join('\n'),
    html: layout(
      'ตั้งรหัสผ่านบัญชีผู้ใช้',
      [escapeHtml(greeting), escapeHtml(lead), escapeHtml(expiry), escapeHtml(ignore)],
      { label: 'ตั้งรหัสผ่าน', url: data.bookingUrl },
    ),
  };
}

const renderers: Record<TemplateKey, (data: BookingEmailData) => RenderedEmail> = {
  'booking.confirmed': confirmed,
  'booking.rescheduled': rescheduled,
  'booking.cancelled': cancelled,
  'booking.reminder': reminder,
  'booking.auto_released': autoReleased,
  'booking.auto_released_admin': autoReleasedAdmin,
  'account.set_password': setPassword,
};

export function hasTemplate(key: string): key is TemplateKey {
  return Object.hasOwn(renderers, key);
}

export function renderTemplate(key: TemplateKey, data: BookingEmailData): RenderedEmail {
  return renderers[key](data);
}
