// The single Thai string table for the admin app. UI translates error codes here —
// never show raw server messages (envelope.message is for logs). Strings shared with the
// employee app are copied verbatim: one product, one string.
import type { ErrorCode } from '@reserveflow/shared';
import { ApiClientError } from '../api/client';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  SLOT_UNAVAILABLE: 'ช่วงเวลานี้ไม่ว่างแล้ว (มีคนจองก่อนเมื่อสักครู่)',
  VERSION_CONFLICT: 'มีผู้อื่นแก้ไขการจองนี้แล้ว',
  INVALID_STATUS_TRANSITION: 'รายการนี้อยู่ในสถานะที่ทำรายการไม่ได้แล้ว',
  OUTSIDE_BUSINESS_HOURS: 'อยู่นอกเวลาทำการ',
  MIN_DURATION: 'ระยะเวลาจองสั้นกว่าขั้นต่ำ',
  MAX_DURATION: 'ระยะเวลาจองยาวเกินกำหนด',
  SLOT_INCREMENT: 'เวลาเริ่มและสิ้นสุดต้องตรงตามช่วงเวลาที่กำหนด',
  IN_PAST: 'ไม่สามารถจองเวลาย้อนหลังได้',
  MAX_ADVANCE: 'จองล่วงหน้าเกินระยะเวลาที่กำหนด',
  CHECKIN_WINDOW_CLOSED: 'ยังไม่ถึงเวลาเช็กอิน หรือเลยเวลาเช็กอินแล้ว',
  NO_BOOKING_IN_WINDOW: 'ไม่มีการจองในห้องนี้ในขณะนี้',
  IDEMPOTENCY_KEY_REQUIRED: 'คำขอไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
  ROOM_INACTIVE: 'ห้องนี้ปิดใช้งานอยู่',
  REASON_REQUIRED: 'กรุณาระบุเหตุผล',
  FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  FORBIDDEN_PRIVATE: 'การประชุมนี้เป็นแบบส่วนตัว',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบ',
  INVALID_CREDENTIALS: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง',
  ACCOUNT_DISABLED: 'บัญชีถูกปิดใช้งาน ติดต่อ Admin',
  ACCOUNT_LOCKED: 'เข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่',
  NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ',
  VALIDATION_FAILED: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  LAST_ADMIN: 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน',
  USER_HAS_HISTORY: 'ผู้ใช้นี้มีประวัติการใช้งาน ให้ปิดการใช้งานแทนการลบ',
  CANNOT_MODIFY_SELF: 'ไม่สามารถแก้ไขสิทธิ์หรือสถานะของบัญชีตัวเองได้',
  TOKEN_EXPIRED: 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่',
  RATE_LIMITED: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่',
  INTERNAL: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** ACCOUNT_LOCKED with minutes remaining from details.locked_until. */
const accountLockedMessage = (details: unknown): string => {
  const lockedUntil = asRecord(details).locked_until;
  if (typeof lockedUntil === 'string') {
    const minutes = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000));
    return `เข้าสู่ระบบผิดหลายครั้ง กรุณารอ ${minutes} นาที`;
  }
  return ERROR_MESSAGES.ACCOUNT_LOCKED;
};

/** RATE_LIMITED with seconds from details.retry_after_seconds. */
const rateLimitedMessage = (details: unknown): string => {
  const seconds = asRecord(details).retry_after_seconds;
  if (typeof seconds === 'number') {
    return `ทำรายการบ่อยเกินไป กรุณารออีก ${seconds} วินาที`;
  }
  return ERROR_MESSAGES.RATE_LIMITED;
};

/** One error → one Thai message. Falls back to a generic message for non-API errors. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof ApiClientError) {
    const { code, details } = error.envelope;
    if (code === 'ACCOUNT_LOCKED') {
      return accountLockedMessage(details);
    }
    if (code === 'RATE_LIMITED') {
      return rateLimitedMessage(details);
    }
    return ERROR_MESSAGES[code];
  }
  return 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง';
};

/** 422 CHECKIN_WINDOW_CLOSED renders the window the server reported, not a guess. */
export const checkinWindowMessage = (range: string): string => `เช็กอินได้ในช่วง ${range} เท่านั้น`;

/** Exactly 5 statuses. PENDING_APPROVAL / EXPIRED / REJECTED do not exist (CB-01). */
export const STATUS_LABELS = {
  CONFIRMED: 'ยืนยันแล้ว',
  CHECKED_IN: 'เช็กอินแล้ว',
  COMPLETED: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิกแล้ว',
  AUTO_RELEASED: 'ปล่อยอัตโนมัติ',
} as const;

/** GET /bookings/:id `history[]` events. */
export const TIMELINE_LABELS = {
  CREATED: 'สร้างเมื่อ',
  RESCHEDULED: 'เลื่อนเวลา',
  CHECKED_IN: 'เช็กอิน',
  CANCELLED: 'ยกเลิก',
  AUTO_RELEASED: 'ปล่อยอัตโนมัติ',
  COMPLETED: 'เสร็จสิ้น',
} as const;

/**
 * Audit-log `action` → Thai. Shared by the A5 change log and A12.
 * Keys are the strings the server actually emits (note `booking.reschedule`, no `d`).
 * Unknown actions fall back to the raw code — the audit log outlives the UI's knowledge of it.
 */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login': 'เข้าสู่ระบบ',
  'auth.login_failed': 'เข้าสู่ระบบไม่สำเร็จ',
  'booking.create': 'สร้างการจอง',
  'booking.update': 'แก้ไขการจอง',
  'booking.reschedule': 'เลื่อนเวลา',
  'booking.cancel': 'ยกเลิกการจอง',
  'booking.checkin': 'เช็กอิน',
  'booking.auto_release': 'ปล่อยอัตโนมัติ',
  'booking.complete': 'ปิดรายการอัตโนมัติ',
  'user.create': 'สร้างผู้ใช้',
  'user.update': 'แก้ไขผู้ใช้',
  'user.role_change': 'เปลี่ยนบทบาท',
  'user.disable': 'ปิดใช้งานบัญชี',
  'user.enable': 'เปิดใช้งานบัญชี',
  'user.invite_resend': 'ส่งลิงก์ตั้งรหัสผ่านอีกครั้ง',
  'user.reset_password': 'ส่งลิงก์รีเซ็ตรหัสผ่าน',
  'user.delete': 'ลบผู้ใช้',
  'room.create': 'สร้างห้อง',
  'room.update': 'แก้ไขห้อง',
  'room.features_update': 'แก้ไขอุปกรณ์ในห้อง',
  'room.photo_update': 'เปลี่ยนรูปห้อง',
  'room.photo_delete': 'ลบรูปห้อง',
  'department.create': 'สร้างแผนก',
  'department.update': 'แก้ไขแผนก',
  'settings.update': 'แก้ไขการตั้งค่า',
  'settings.business_hours_update': 'แก้ไขเวลาทำการ',
  'settings.holidays_update': 'แก้ไขวันหยุด',
  'notification.retry': 'ส่งอีเมลใหม่',
};

export const auditActionLabel = (action: string): string => AUDIT_ACTION_LABELS[action] ?? action;

/** A12's `การกระทำ` select is built from the map above, so it can never list a dead action. */
export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS);

/**
 * A12's `ประเภทรายการ` select. `department` and `notification` are included because the
 * server emits rows with them — a select that omits them makes those rows unreachable.
 */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  booking: 'การจอง',
  user: 'ผู้ใช้',
  room: 'ห้อง',
  department: 'แผนก',
  settings: 'ตั้งค่า',
  auth: 'การเข้าสู่ระบบ',
  notification: 'อีเมลแจ้งเตือน',
};

/** All 7 real outbox template keys. Unknown keys fall back to the raw string. */
const TEMPLATE_LABELS: Record<string, string> = {
  'booking.confirmed': 'ยืนยันการจอง',
  'booking.rescheduled': 'เลื่อนเวลาการจอง',
  'booking.cancelled': 'ยกเลิกการจอง',
  'booking.reminder': 'เตือนก่อนประชุม',
  'booking.auto_released': 'ปล่อยห้องอัตโนมัติ',
  'booking.auto_released_admin': 'ปล่อยห้องอัตโนมัติ (แจ้ง Admin)',
  'account.set_password': 'ลิงก์ตั้งรหัสผ่าน',
};

export const templateLabel = (key: string): string => TEMPLATE_LABELS[key] ?? key;

/** A8/A9 user status. Icon + text, never colour alone. */
export const USER_STATUS_LABELS = {
  ACTIVE: 'ใช้งานอยู่',
  INVITED: 'รอตั้งรหัสผ่าน',
  DISABLED: 'ปิดใช้งาน',
} as const;

/** §1.3: the mockup's Admin line said "อนุมัติ", which CB-01 deleted. */
export const ROLE_LABELS = {
  EMPLOYEE: 'Employee',
  ADMIN: 'Admin',
  FACILITY: 'Facility (อ่านอย่างเดียว)',
} as const;

export const ROLE_OPTION_HINTS = {
  EMPLOYEE: 'Employee — จองห้อง ดูการจองของตัวเอง',
  ADMIN: 'Admin — จัดการห้อง ผู้ใช้ ตั้งค่า และรายงาน · ยกเลิกการจองของผู้อื่นได้พร้อมเหตุผล',
  FACILITY: 'Facility — ดูตารางรายวัน (อ่านอย่างเดียว)',
} as const;

/** §4.5: COINED — the spec has no Thai for the four CSV row outcomes. */
export const IMPORT_ACTION_LABELS = {
  CREATE: 'สร้างใหม่',
  UPDATE: 'อัปเดต',
  SKIP: 'ข้าม',
  ERROR: 'ผิดพลาด',
} as const;

/** Outbox status chips. SKIPPED exists — superseded invites land there. */
export const OUTBOX_STATUS_LABELS = {
  FAILED: 'ส่งไม่สำเร็จ',
  PENDING: 'รอส่ง',
  SENT: 'ส่งแล้ว',
  SKIPPED: 'ข้ามการส่ง',
} as const;

/** ISO weekday 1..7, Monday first — the order A10's เวลาทำการ rows and A11's heatmap use. */
export const WEEKDAY_NAMES = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'] as const;

/** Buddhist-era month heading, e.g. "สิงหาคม 2569". */
const THAI_MONTHS_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

export const thaiMonthYear = (date: string): string => {
  const [year = 0, month = 1] = date.split('-').map(Number);
  return `${THAI_MONTHS_FULL[month - 1] ?? ''} ${year + 543}`;
};

export const COPY = {
  brand: 'ReserveFlow',
  brandSub: 'ผู้ดูแลระบบ',
  skipLink: 'ข้ามไปยังเนื้อหาหลัก',
  nav: {
    label: 'เมนูผู้ดูแลระบบ',
    collapse: 'ย่อเมนู',
    expand: 'ขยายเมนู',
    // The full 9-item IA, in order. Items whose screen ships in a later slice are kept
    // here so the labels never drift — see components/shell.tsx for what renders today.
    dashboard: 'ภาพรวม',
    calendar: 'ปฏิทินห้อง',
    bookings: 'การจองทั้งหมด',
    rooms: 'ห้องประชุม',
    users: 'ผู้ใช้งาน',
    reports: 'รายงาน',
    settings: 'ตั้งค่า',
    auditLogs: 'บันทึกระบบ',
    emails: 'อีเมลที่ส่งไม่สำเร็จ',
    modeHeading: 'โหมดการใช้งาน',
    modeLabel: 'สลับโหมดการใช้งาน',
    employeeMode: 'ผู้ใช้',
    adminMode: 'แอดมิน',
    switchToEmployee: 'สลับไปโหมดผู้ใช้',
    switchToAdmin: 'สลับไปโหมดแอดมิน',
    employeeApp: 'ไปหน้าพนักงาน',
    signOut: 'ออกจากระบบ',
    signOutFailed: 'ออกจากระบบไม่สำเร็จ · ยังอยู่ในระบบ กรุณาลองใหม่',
    fontSize: 'ขนาดตัวอักษร',
  },
  states: {
    loading: 'กำลังโหลด…',
    retry: 'ลองใหม่',
    errorTitle: 'เกิดข้อผิดพลาด',
    notFoundTitle: 'ไม่พบหน้าที่ต้องการ',
    clearFilters: 'ล้างตัวกรอง',
    noData: 'ยังไม่มีข้อมูลในเดือนนี้',
  },
  pager: {
    prev: 'หน้าก่อนหน้า',
    next: 'หน้าถัดไป',
    pagePrefix: 'หน้า',
    /** "แสดง {from}–{to} จาก {total}" */
    rangePrefix: 'แสดง',
    rangeMiddle: 'จาก',
  },
  dashboard: {
    title: 'ภาพรวม',
    subPrefix: 'ภาพรวมการใช้งาน',
    kpiTodayLabel: 'การประชุมวันนี้',
    kpiTodayCheckedIn: 'เช็กอินแล้ว',
    kpiTodayWaiting: 'รอเช็กอิน',
    kpiUtilizationLabel: 'อัตราการใช้ห้อง',
    kpiUtilizationCaptionSuffix: 'ชั่วโมง',
    kpiCreatedLabel: 'การจองเดือนนี้',
    kpiCreatedCaptionPrefix: 'เฉลี่ย',
    kpiCreatedCaptionSuffix: '/วันทำการ',
    kpiNoShowLabel: 'ไม่มาตามนัด (No-show)',
    kpiNoShowCaptionPrefix: 'ปล่อยอัตโนมัติ',
    kpiNoShowCaptionSuffix: 'รายการ',
    chartTitle: 'ชั่วโมงใช้งาน จันทร์–ศุกร์',
    /** Mon…Fri, matching weekdayUsedHours()'s index order. */
    weekdays: ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'],
    chartEmpty: 'ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟ',
    chartAsTable: 'ดูเป็นตาราง',
    chartColWeekday: 'วัน',
    chartColHours: 'ชั่วโมงใช้งาน',
    tasksTitle: 'รายการที่ต้องดำเนินการ',
    tasksEmpty: 'ไม่มีรายการที่ต้องดำเนินการ',
    taskFailedEmails: 'อีเมลที่ส่งไม่สำเร็จ',
    taskFailedEmailsSub: 'ต้องส่งใหม่',
    taskAutoReleased: 'ปล่อยอัตโนมัติเดือนนี้',
    taskAutoReleasedSub: 'ไม่มีผู้เช็กอินภายในเวลาที่กำหนด',
    taskView: 'ดู',
    roomsTitle: 'สถานะห้องตอนนี้',
    roomFree: 'ว่าง',
    roomInUse: 'กำลังใช้งาน',
    roomBusyUntilPrefix: 'ไม่ว่างถึง',
    roomClosed: 'ปิดปรับปรุง',
  },
  bookings: {
    title: 'การจองทั้งหมด',
    sub: 'ค้นหา ตรวจสอบ ยกเลิก หรือเช็กอินแทนผู้จอง',
    tableLabel: 'ตารางการจอง',
    fromLabel: 'ตั้งแต่วันที่',
    toLabel: 'ถึงวันที่',
    roomLabel: 'ห้อง',
    allRooms: 'ทุกห้อง',
    statusLabel: 'กรองตามสถานะ',
    filterAll: 'ทั้งหมด',
    // GAP: the server's `q` searches title / owner full_name / owner employee_code —
    // NOT email. The blueprint's "อีเมล" is dropped rather than promised and not delivered.
    searchLabel: 'ค้นหาผู้จอง (ชื่อ / รหัสพนักงาน)',
    searchSubmit: 'ค้นหา',
    colMeeting: 'การประชุม',
    colWhen: 'วันและเวลา',
    colRoom: 'ห้อง',
    colOwner: 'ผู้จอง',
    colStatus: 'สถานะ',
    colActions: 'จัดการ',
    detail: 'ดูรายละเอียด',
    privateBadge: 'ส่วนตัว',
    attendeesPrefix: 'ผู้เข้าร่วม',
    attendeesSuffix: 'คน',
    // An unfiltered A4 still carries an implicit from = today (see routes/bookings.tsx),
    // so "ยังไม่มีการจองในระบบ" would be a claim the query never checked.
    emptyNoFilters: 'ไม่มีการจองตั้งแต่วันนี้เป็นต้นไป',
    emptyFiltered: 'ไม่พบการจองที่ตรงกับเงื่อนไข',
  },
  bookingDetail: {
    back: 'การจองทั้งหมด',
    privateBadge: 'ส่วนตัว',
    dateRow: 'วันที่',
    timeRow: 'เวลา',
    roomRow: 'ห้อง',
    owner: 'ผู้จอง',
    attendees: 'ผู้เข้าร่วม',
    headcount: 'จำนวนผู้เข้าร่วม',
    specialRequest: 'ความต้องการพิเศษ',
    description: 'รายละเอียด',
    people: 'คน',
    floorPrefix: 'ชั้น',
    checkedInAt: 'เช็กอินเมื่อ',
    timeline: 'ประวัติการจอง',
    changeLog: 'บันทึกการเปลี่ยนแปลง',
    changeLogEmpty: 'ยังไม่มีบันทึกการเปลี่ยนแปลง',
    changeLogFailed: 'โหลดบันทึกการเปลี่ยนแปลงไม่สำเร็จ',
    systemActor: 'ระบบ',
    reasonPrefix: 'เหตุผล',
    cancelledByAdminPrefix: 'ยกเลิกโดย Admin',
    cancelledByPrefix: 'ยกเลิกโดย',
    // Admin action row — destructive last (§2.3).
    checkIn: 'เช็กอินแทน',
    checkingIn: 'กำลังเช็กอิน…',
    checkedIn: 'เช็กอินแทนผู้จองแล้ว',
    alreadyCheckedIn: 'การจองนี้เช็กอินไปแล้ว',
    ics: 'ดาวน์โหลด .ics',
    cancel: 'ยกเลิกการจอง',
  },
  /** §4.0: one confirmation shape — consequences, optional reason, danger last. */
  confirm: {
    back: 'กลับ',
  },
  /** §4.1 — the only power an admin has over someone else's booking. */
  cancelDialog: {
    title: 'ยกเลิกการจองนี้?',
    ownerPrefix: 'ผู้จอง',
    consequences: ['คืน slot ทันที', 'แจ้งผู้จองและผู้เข้าร่วมทางอีเมลพร้อมเหตุผล', 'กู้คืนไม่ได้'],
    reasonLabel: 'เหตุผล * (ผู้จองจะเห็นข้อความนี้)',
    reasonHelper: 'อย่างน้อย 3 ตัวอักษร',
    confirm: 'ยืนยันยกเลิกการจอง',
    pending: 'กำลังยกเลิก…',
    // Email goes out through the outbox — "กำลังส่ง", never "ส่งแล้ว".
    success: 'ยกเลิกการจองแล้ว · กำลังส่งอีเมลแจ้งผู้จองและผู้เข้าร่วม',
  },
  /** A6 */
  rooms: {
    title: 'ห้องประชุม',
    countSuffix: 'ห้อง',
    subTail: 'ความจุ อุปกรณ์ รูปภาพ และสถานะการเปิดให้จอง',
    // D-02: the mockup's per-room "จ–ศ 08:30–17:30" line is dead; hours are global.
    hoursNote: 'เวลาทำการใช้ร่วมกันทุกห้อง — ไม่มีการตั้งค่าแยกรายห้อง',
    add: '+ เพิ่มห้อง',
    open: '✓ เปิดให้จอง',
    closed: '✕ ปิดปรับปรุง',
    photoAltPrefix: 'รูปห้อง',
    people: 'คน',
    floorPrefix: 'ชั้น',
    edit: 'แก้ไข',
    viewCalendar: 'ดูปฏิทิน',
    qr: 'QR หน้าห้อง',
    reopen: 'เปิดให้จอง',
    reopening: 'กำลังเปิด…',
    reopened: 'เปิดให้จองอีกครั้งแล้ว',
    empty: 'ยังไม่มีห้องประชุมในระบบ',
  },
  /** A7 */
  roomForm: {
    titleNew: 'เพิ่มห้อง',
    titleEditPrefix: 'แก้ไขห้อง',
    summary: 'สรุปข้อมูลห้อง',
    changePhoto: 'เปลี่ยนรูป (JPG/PNG ≤ 5 MB)',
    uploadingPhoto: 'กำลังอัปโหลด…',
    removePhoto: 'ลบรูป',
    photoAfterSave: 'บันทึกห้องก่อน จึงเพิ่มรูปได้',
    photoTooLarge: 'ไฟล์ใหญ่เกินกำหนด',
    photoBadType: 'ชนิดไฟล์ไม่รองรับ',
    factCapacity: 'ความจุ',
    factFloor: 'ชั้น',
    factFeatures: 'อุปกรณ์',
    factFutureBookings: 'การจองล่วงหน้า',
    countSuffix: 'รายการ',
    // D-26, verbatim wording from the screen inventory.
    noteLabel: 'หมายเหตุ:',
    noteBody: 'การแก้ไขห้องมีผลกับคำขอใหม่เท่านั้น — การจองเดิม',
    noteBodyTail: 'รายการไม่ถูกยกเลิก',
    nameLabel: 'ชื่อห้อง *',
    codeLabel: 'รหัสห้อง *',
    codeHelperNew: 'a–z, 0–9 และ - เท่านั้น · ใช้ในลิงก์ QR หน้าห้อง และแก้ไขภายหลังไม่ได้',
    codeHelperEdit: 'รหัสห้องแก้ไขไม่ได้ — ใช้ในลิงก์ QR หน้าห้อง',
    descriptionLabel: 'คำอธิบายสั้น',
    capacityLabel: 'ความจุ (คน) *',
    floorLabel: 'ชั้น',
    locationLabel: 'ตำแหน่ง',
    featuresLabel: 'อุปกรณ์ / คุณสมบัติ',
    featuresHelper: 'ใช้เป็นตัวกรองในการค้นหาห้องของพนักงาน',
    activeLabel: 'เปิดให้จอง',
    activeHelper: 'ปิด = ซ่อนจากการค้นหาและปฏิทินของพนักงาน · การจองเดิมไม่ถูกยกเลิก',
    save: 'บันทึก',
    saving: 'กำลังบันทึก…',
    cancel: 'ยกเลิก',
    savedPrefix: 'บันทึกห้อง',
    createdPrefix: 'เพิ่มห้อง',
    savedSuffix: 'แล้ว',
    // The two writes are not atomic — say which half landed rather than a blanket success.
    featuresFailed: 'บันทึกข้อมูลห้องแล้ว แต่บันทึกอุปกรณ์ไม่สำเร็จ',
    duplicatePrefix: 'ข้อมูลนี้มีอยู่แล้วในระบบ',
    checkingImpact: 'กำลังตรวจสอบการจองที่ได้รับผลกระทบ…',
  },
  /** §4.4 — closing a room never cancels anyone's booking. */
  closeRoomDialog: {
    titlePrefix: 'ปิดห้อง',
    consequences: ['ห้องจะหายจากการค้นหาและปฏิทินของพนักงาน', 'คำขอใหม่ในห้องนี้จะทำไม่ได้จนกว่าจะเปิดอีกครั้ง'],
    keptPrefix: 'การจองเดิม',
    keptSuffix: 'รายการ ไม่ถูกยกเลิก และยังใช้ห้องได้ตามเดิม',
    noneAffected: 'ไม่มีการจองในอนาคตที่ได้รับผลกระทบ',
    listLabel: 'การจองที่ยังอยู่ในห้องนี้',
    confirm: 'ปิดห้อง',
    pending: 'กำลังปิด…',
  },
  /** The printable door sign. */
  roomQr: {
    title: 'QR หน้าห้อง',
    instruction: 'สแกนเพื่อเปิดใช้งานการจองของคุณ',
    codeLabel: 'รหัสห้อง',
    urlLabel: 'หรือเปิดลิงก์',
    print: 'พิมพ์',
    back: 'กลับไปหน้าห้องประชุม',
    qrAltPrefix: 'QR สำหรับเช็กอินห้อง',
  },
  /** A3 — read-only board. No drag & drop, no selection, no booking form (CB-01/Phase 1.1). */
  calendar: {
    title: 'ปฏิทินห้อง',
    gridLabel: 'ตารางการจองห้องประชุม',
    today: 'วันนี้',
    prev: 'ก่อนหน้า',
    next: 'ถัดไป',
    viewLabel: 'มุมมอง',
    dayView: 'รายวัน',
    weekView: 'รายสัปดาห์',
    roomLabel: 'ห้อง',
    allRooms: 'ทุกห้อง',
    closedDay: 'วันนี้ไม่เปิดทำการ',
    closedShort: 'ปิด',
    holidayPrefix: 'วันหยุด',
    readOnly: 'กดช่องที่มีการจองเพื่อดูรายละเอียด · ช่องว่างในกระดานนี้กดไม่ได้',
    legendFree: 'ว่าง',
    legendBusy: 'ไม่ว่าง',
    legendClosed: 'ปิด',
    listTitle: 'รายการในช่วงที่เลือก',
    listEmpty: 'ไม่มีการจองในช่วงนี้',
  },
  /** A8 */
  users: {
    title: 'จัดการผู้ใช้งาน',
    subAccounts: 'บัญชี',
    subTeams: 'ทีม',
    subTail: 'เพิ่ม แก้ไข กำหนดบทบาท หรือปิดใช้งาน (ไม่มีการลบถาวร เพื่อเก็บประวัติ)',
    importCsv: 'นำเข้า CSV',
    add: '+ เพิ่มผู้ใช้',
    roleFilterLabel: 'กรองตามบทบาท',
    statusFilterLabel: 'กรองตามสถานะ',
    filterAll: 'ทั้งหมด',
    departmentLabel: 'ทีม / แผนก',
    allDepartments: 'ทุกทีม',
    searchLabel: 'ค้นหาผู้ใช้',
    searchPlaceholder: 'ค้นหาชื่อ / รหัสพนักงาน / อีเมล',
    searchSubmit: 'ค้นหา',
    tableLabel: 'ตารางผู้ใช้งาน',
    colUser: 'ผู้ใช้',
    colTeam: 'ทีม / แผนก',
    colRole: 'บทบาท',
    colStatus: 'สถานะ',
    colActions: 'จัดการ',
    edit: 'แก้ไข',
    resendInvite: 'ส่งลิงก์อีกครั้ง',
    deactivate: 'ปิดใช้งาน',
    reactivate: 'เปิดใช้งาน',
    // §4.3 — prevention, shown as visible text instead of a disabled control.
    guardSelf: 'ปิดบัญชีตัวเองไม่ได้',
    guardLastAdmin: 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน',
    sortNote: 'เรียงตามชื่อ',
    empty: 'ไม่พบผู้ใช้ที่ตรงกับเงื่อนไข',
    emptyNoFilters: 'ยังไม่มีผู้ใช้ในระบบ',
    // The resend link's real TTL is 7 days; only the RESET link is 24 hours.
    inviteResent: 'ส่งลิงก์ตั้งรหัสผ่านอีกครั้งแล้ว (หมดอายุใน 7 วัน)',
    reactivatedPrefix: 'เปิดใช้งานบัญชี',
    reactivatedSuffix: 'แล้ว',
    reactivateCaveat: 'การจองที่ถูกยกเลิกไปแล้วจะไม่ถูกคืน',
  },
  /** A9 — the Sheet over A8. */
  userSheet: {
    titleNew: 'เพิ่มผู้ใช้',
    titleEditPrefix: 'แก้ไขผู้ใช้',
    close: 'ปิด',
    fullNameLabel: 'ชื่อ-นามสกุล *',
    employeeCodeLabel: 'รหัสพนักงาน *',
    employeeCodeHelper: 'A–Z, 0–9 และ - เท่านั้น · แก้ไขภายหลังไม่ได้',
    mobileLabel: 'เบอร์มือถือ (ไม่บังคับ)',
    mobileHelper: 'ใช้สำหรับติดต่อเท่านั้น · ตัวเลข 10 หลัก ขึ้นต้นด้วย 0',
    emailLabel: 'อีเมล * (ใช้ตั้งรหัสผ่านและรับแจ้งเตือน)',
    emailDomainError: 'อีเมลต้องเป็นโดเมนของบริษัท',
    departmentLabel: 'ทีม / แผนก *',
    roleLabel: 'บทบาท *',
    // POST /admin/users accepts role EMPLOYEE only — say when the field applies rather
    // than silently discarding the choice.
    roleCreateHelper: 'บัญชีใหม่เริ่มต้นเป็น Employee เสมอ · กำหนดบทบาทได้หลังจากสร้างบัญชีแล้ว',
    roleFacilityHelper: 'Facility — ยังไม่เปิดใช้งานในเวอร์ชันนี้',
    roleSelfHelper: 'ไม่สามารถแก้ไขสิทธิ์หรือสถานะของบัญชีตัวเองได้',
    roleLastAdminHelper: 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน',
    activeLabel: 'บัญชีใช้งานอยู่',
    activeHelper: 'ปิด = เข้าสู่ระบบไม่ได้ทันที การจองในอนาคตจะถูกยกเลิกและคืน slot',
    passwordNoteLabel: 'รหัสผ่าน:',
    passwordNoteBody: 'Admin ไม่เห็นและไม่ตั้งรหัสผ่านให้ — ระบบส่งลิงก์ตั้งรหัสผ่านทางอีเมล (หมดอายุ 24 ชม.)',
    passwordNoteConsequence: 'อุปกรณ์ที่ล็อกอินอยู่ทั้งหมดจะถูกออกจากระบบ',
    resetPassword: 'ส่งลิงก์รีเซ็ตรหัสผ่าน',
    resetPasswordPending: 'กำลังส่ง…',
    resetPasswordSent: 'ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว',
    auditPrefix: 'แก้ไขล่าสุด',
    auditBy: 'โดย',
    auditLoginPrefix: 'เข้าสู่ระบบล่าสุด',
    auditNeverLoggedIn: 'ยังไม่เคยเข้าสู่ระบบ',
    auditUnknown: 'ยังไม่มีประวัติการแก้ไข',
    recentBookings: 'การจองล่าสุด',
    save: 'บันทึก',
    saving: 'กำลังบันทึก…',
    cancel: 'ยกเลิก',
    savedPrefix: 'บันทึกผู้ใช้',
    savedSuffix: 'แล้ว',
    duplicatePrefix: 'ข้อมูลนี้มีอยู่แล้วในระบบ',
    dangerTitle: 'ปิดใช้งานบัญชี',
    dangerBodyPrefix: 'ผู้ใช้เข้าสู่ระบบไม่ได้ทันที การจองที่ยังไม่เริ่ม',
    dangerBodyMiddle: 'รายการ',
    dangerBodyTail: 'จะถูกยกเลิกและแจ้งผู้เข้าร่วม · ประวัติการจองและ audit ยังเก็บไว้ · เปิดใช้งานใหม่ได้ทุกเมื่อ',
    dangerTrigger: 'ปิดใช้งานบัญชี…',
    restoreTitle: 'เปิดใช้งานบัญชีอีกครั้ง',
    restoreBody: 'ผู้ใช้จะเข้าสู่ระบบได้ทันที · การจองที่ถูกยกเลิกไปแล้วจะไม่ถูกคืน',
    restoreTrigger: 'เปิดใช้งานบัญชี',
    restorePending: 'กำลังเปิดใช้งาน…',
    deleteTitle: 'ลบบัญชีถาวร',
    deleteBody: 'บัญชีนี้ยังไม่เคยใช้งานและไม่มีประวัติ จึงลบถาวรได้',
    deleteTrigger: 'ลบบัญชีถาวร…',
  },
  /** §4.2 — the cascade must be on screen with real numbers before the admin commits. */
  deactivateDialog: {
    titlePrefix: 'ปิดใช้งานบัญชี',
    consequences: [
      'ผู้ใช้เข้าสู่ระบบไม่ได้ทันที และอุปกรณ์ที่ล็อกอินอยู่จะถูกออกจากระบบ',
      'ประชุมที่เริ่มไปแล้วจะไม่ถูกยกเลิกอัตโนมัติ',
      'ประวัติการจองและบันทึกระบบยังเก็บไว้',
      'เปิดใช้งานใหม่ได้ทุกเมื่อ แต่การจองที่ถูกยกเลิกจะไม่ถูกคืน',
    ],
    checking: 'กำลังตรวจสอบการจองที่จะถูกยกเลิก…',
    affectedPrefix: 'การจองที่ยังไม่เริ่ม',
    affectedSuffix: 'รายการ จะถูกยกเลิกและแจ้งผู้เข้าร่วมทางอีเมล',
    noneAffected: 'ไม่มีการจองในอนาคตที่ได้รับผลกระทบ',
    listLabelPrefix: 'ดูรายการที่จะถูกยกเลิก',
    reasonLabel: 'เหตุผล (ไม่บังคับ)',
    confirm: 'ปิดใช้งานบัญชี',
    pending: 'กำลังปิดใช้งาน…',
    resultPrefix: 'ปิดใช้งานบัญชีแล้ว · ยกเลิกการจอง',
    resultSuffix: 'รายการ',
  },
  /** Reactivation is not the inverse of deactivation and must not read like one. */
  reactivateDialog: {
    titlePrefix: 'เปิดใช้งานบัญชี',
    consequences: ['ผู้ใช้จะเข้าสู่ระบบได้ทันที', 'การจองที่ถูกยกเลิกไปแล้วจะไม่ถูกคืน'],
    confirm: 'เปิดใช้งานบัญชี',
    pending: 'กำลังเปิดใช้งาน…',
  },
  deleteUserDialog: {
    titlePrefix: 'ลบบัญชี',
    consequences: ['ลบถาวร กู้คืนไม่ได้', 'ใช้ได้เฉพาะบัญชีที่ยังไม่มีประวัติการใช้งาน'],
    confirm: 'ลบบัญชีถาวร',
    pending: 'กำลังลบ…',
    deleted: 'ลบบัญชีแล้ว',
  },
  /** §4.5 — three steps; the dry run is mandatory. */
  csvImport: {
    title: 'นำเข้าผู้ใช้จากไฟล์ CSV',
    fileLabel: 'เลือกไฟล์ CSV',
    columnsNote: 'คอลัมน์: employee_code, full_name, email, mobile, department_code, role',
    limitsNote: 'สูงสุด 1,000 แถว · ไม่เกิน 2 MB · เข้ารหัส UTF-8',
    dryRunNote: 'ระบบจะตรวจสอบไฟล์ก่อน ยังไม่บันทึกข้อมูลในขั้นนี้',
    sample: 'ดาวน์โหลดไฟล์ตัวอย่าง',
    validate: 'ตรวจสอบไฟล์',
    validating: 'กำลังตรวจสอบ…',
    cancel: 'ยกเลิก',
    back: 'กลับ',
    close: 'ปิด',
    summaryCreate: 'สร้างใหม่',
    summaryUpdate: 'อัปเดต',
    summarySkip: 'ข้าม',
    summaryError: 'ผิดพลาด',
    errorsOnly: 'แสดงเฉพาะแถวที่ผิดพลาด',
    tableLabel: 'ผลการตรวจสอบไฟล์',
    colLine: 'บรรทัด',
    colCode: 'รหัสพนักงาน',
    colResult: 'ผลลัพธ์',
    colNote: 'หมายเหตุ',
    errorsSkippedPrefix: '',
    errorsSkippedSuffix: 'แถวที่ผิดพลาดจะถูกข้าม แถวที่เหลือจะถูกนำเข้า',
    notCommittedNote: 'ยังไม่มีการบันทึกข้อมูล — กด "นำเข้าจริง" เพื่อยืนยัน',
    commit: 'นำเข้าจริง',
    committing: 'กำลังนำเข้า…',
    resultTitle: 'นำเข้าเสร็จแล้ว',
    resultNote: 'ผู้ใช้ใหม่จะได้รับอีเมลลิงก์ตั้งรหัสผ่าน (หมดอายุ 24 ชม.)',
    copyErrors: 'คัดลอกรายการที่ผิดพลาด',
    copied: 'คัดลอกแล้ว',
    headerError:
      'หัวคอลัมน์ในไฟล์ไม่ถูกต้อง — ต้องมี: employee_code, full_name, email, mobile, department_code, role',
    tooLarge: 'ไฟล์ใหญ่เกินกำหนด',
    badType: 'ชนิดไฟล์ไม่รองรับ',
    // The dry run cannot mark a per-row demotion: it reports actions, not resulting roles.
    // The real run rolls the WHOLE file back with 409 LAST_ADMIN, so warn up front instead.
    lastAdminWarning: 'ขณะนี้มีผู้ดูแลระบบที่ใช้งานอยู่ 1 บัญชี — ไฟล์ที่ลดสิทธิ์บัญชีนั้นจะถูกปฏิเสธทั้งไฟล์',
  },
  /** A10 */
  settings: {
    title: 'ตั้งค่า',
    sub: 'นโยบายการจอง เวลาทำการ และวันหยุด — ใช้ร่วมกันทุกห้อง',
    policyTitle: 'นโยบายการจอง',
    groupNewBadge: 'มีผลกับการจองใหม่',
    groupLiveBadge: 'มีผลทันทีกับการประชุมที่กำลังจะเกิด',
    slotIncrement: 'ช่วงเวลาย่อย (นาที)',
    minDuration: 'ระยะเวลาจองขั้นต่ำ (นาที)',
    maxDuration: 'ระยะเวลาจองสูงสุด (นาที)',
    maxDurationUnlimited: 'เว้นว่าง = ไม่จำกัด',
    buffer: 'เวลาพักระหว่างการประชุม (นาที)',
    maxAdvance: 'จองล่วงหน้าได้ไม่เกิน (วัน)',
    minLead: 'ต้องจองล่วงหน้าอย่างน้อย (นาที)',
    checkinOpenBefore: 'เปิดให้เช็กอินก่อนเริ่ม (นาที)',
    checkinGrace: 'ผ่อนผันเช็กอินหลังเริ่ม (นาที)',
    autoRelease: 'ปล่อยห้องอัตโนมัติเมื่อไม่เช็กอิน',
    reminder: 'ส่งอีเมลเตือนก่อนเริ่ม (นาที)',
    hoursTitle: 'เวลาทำการ',
    hoursHelper: 'ใช้ร่วมกันทุกห้อง — ไม่มีการตั้งค่าแยกรายห้อง',
    hoursOpenSwitch: 'เปิดทำการ',
    hoursOpenTime: 'เวลาเปิด',
    hoursCloseTime: 'เวลาปิด',
    hoursOrderError: 'เวลาเปิดต้องมาก่อนเวลาปิด',
    holidaysTitle: 'วันหยุด',
    holidaysYearLabel: 'ปี',
    holidaysTableLabel: 'ตารางวันหยุด',
    holidaysColDate: 'วันที่',
    holidaysColName: 'ชื่อวันหยุด',
    holidaysColActions: 'จัดการ',
    holidaysRemove: 'ลบ',
    holidaysAdd: 'เพิ่มวันหยุด',
    holidaysEmpty: 'ยังไม่มีวันหยุดในปีนี้',
    holidaysReplaceNote: 'บันทึกจะแทนที่รายการวันหยุดทั้งปีที่เลือก',
    holidaysDuplicate: 'วันที่นี้ถูกเพิ่มไว้แล้ว',
    holidaysOutOfYear: 'วันที่ต้องอยู่ในปีที่เลือก',
    impactChecking: 'กำลังตรวจสอบการจองที่ได้รับผลกระทบ…',
    impactPrefix: 'การจอง',
    impactSuffix: 'รายการจะอยู่นอกเวลาทำการใหม่',
    impactTail: 'การจองเดิมจะไม่ถูกยกเลิก แต่คำขอใหม่ในช่วงนั้นจะทำไม่ได้',
    impactListLabel: 'ดูรายการที่ได้รับผลกระทบ',
    save: 'บันทึกการตั้งค่า',
    saving: 'กำลังบันทึก…',
    saved: 'บันทึกการตั้งค่าแล้ว',
    noChanges: 'ยังไม่มีการเปลี่ยนแปลง',
    conflict: 'มีผู้อื่นแก้ค่าไปแล้ว',
    reload: 'โหลดค่าล่าสุด',
    // The three PUTs are not atomic: name the half that landed, never a blanket success.
    partialHours: 'บันทึกนโยบายแล้ว แต่บันทึกเวลาทำการไม่สำเร็จ',
    partialHolidays: 'บันทึกนโยบายและเวลาทำการแล้ว แต่บันทึกวันหยุดไม่สำเร็จ',
  },
  /** A11 */
  reports: {
    title: 'รายงานการใช้ห้อง',
    subTail: 'นับเฉพาะเวลาทำการ',
    fromLabel: 'ตั้งแต่วันที่',
    toLabel: 'ถึงวันที่',
    roomLabel: 'ห้อง',
    allRooms: 'ทุกห้อง',
    groupByLabel: 'จัดกลุ่ม',
    groupByRoom: 'รายห้อง',
    groupByMonth: 'รายเดือน',
    rangeTooLong: 'เลือกช่วงได้ไม่เกิน 366 วัน',
    rangeInverted: 'ถึงวันที่ต้องไม่มาก่อนวันที่เริ่ม',
    kpiUtilization: 'อัตราการใช้ห้องรวม',
    kpiTopRoom: 'ห้องที่ใช้มากที่สุด',
    kpiPeakHour: 'ช่วงเวลาที่ใช้มากที่สุด',
    kpiAutoReleased: 'ปล่อยอัตโนมัติ',
    kpiAutoReleasedCaptionSuffix: '% ของการจอง',
    hours: 'ชั่วโมง',
    // Required on the page, not in a tooltip: there is no effective-dated history, so
    // editing business hours changes last month's numbers.
    divisorNote:
      'ตัวหาร = ชั่วโมงทำการ × วันเปิดทำการ (ไม่นับวันหยุดและเสาร์–อาทิตย์) — คำนวณด้วยเวลาทำการปัจจุบัน',
    utilizationTitle: 'อัตราการใช้ห้องรายห้อง',
    utilizationTableLabel: 'ตารางอัตราการใช้ห้อง',
    colRoom: 'ห้อง',
    colPeriod: 'เดือน',
    colUsed: 'ชั่วโมงที่ใช้',
    colAvailable: 'ชั่วโมงที่เปิด',
    colUtilization: 'อัตราการใช้',
    outcomesTitle: 'ผลลัพธ์การจอง',
    outcomeCompleted: 'เสร็จสิ้น',
    outcomeCancelledOwner: 'ผู้จองยกเลิก',
    outcomeCancelledAdmin: 'Admin ยกเลิก',
    outcomeAutoReleased: 'ปล่อยอัตโนมัติ',
    outcomeCreated: 'การจองทั้งหมด',
    outcomeItems: 'รายการ',
    heatmapTitle: 'ช่วงเวลาที่มีการใช้งาน (Heatmap)',
    heatmapTableLabel: 'ตารางช่วงเวลาที่มีการใช้งาน',
    heatmapWeekdayCol: 'วัน',
    heatmapCellSuffix: 'ชั่วโมง',
    // The chart IS a table here, so a decorative "ดูเป็นตาราง" disclosure would be noise.
    heatmapNote: 'ทุกช่องแสดงตัวเลขชั่วโมงใช้งาน — ไม่ได้ใช้สีเพียงอย่างเดียวสื่อความหมาย',
    empty: 'ยังไม่มีข้อมูลในช่วงที่เลือก',
  },
  /** A12 */
  auditLogs: {
    title: 'บันทึกระบบ',
    sub: 'บันทึกการเปลี่ยนแปลงทั้งหมด · อ่านอย่างเดียว แก้ไขไม่ได้',
    fromLabel: 'ตั้งแต่วันที่',
    toLabel: 'ถึงวันที่',
    actorLabel: 'ผู้กระทำ',
    actorPlaceholder: 'พิมพ์ชื่อหรือรหัสพนักงาน',
    actorHelper: 'พิมพ์อย่างน้อย 2 ตัวอักษร แล้วเลือกผู้ใช้',
    actorClear: 'ล้างผู้กระทำ',
    actorNoResults: 'ไม่พบผู้ใช้ที่ตรงกับคำค้น',
    entityTypeLabel: 'ประเภทรายการ',
    actionLabel: 'การกระทำ',
    all: 'ทั้งหมด',
    tableLabel: 'ตารางบันทึกระบบ',
    colTime: 'เวลา',
    colActor: 'ผู้กระทำ',
    colAction: 'การกระทำ',
    colEntity: 'รายการ',
    colReason: 'เหตุผล',
    colIp: 'IP',
    systemActor: 'ระบบ',
    viewEntity: 'เปิดรายการ',
    details: 'ดูข้อมูลก่อน/หลัง',
    before: 'ก่อน',
    after: 'หลัง',
    redacted: '—',
    empty: 'ไม่พบบันทึกที่ตรงกับเงื่อนไข',
  },
  /** A13 */
  emails: {
    title: 'อีเมลที่ส่งไม่สำเร็จ',
    sub: 'อีเมลที่ระบบส่งไม่สำเร็จ · กดส่งใหม่ได้',
    statusFilterLabel: 'กรองตามสถานะ',
    all: 'ทั้งหมด',
    tableLabel: 'ตารางอีเมลแจ้งเตือน',
    colTime: 'เวลา',
    colTemplate: 'ประเภท',
    colRecipient: 'ผู้รับ',
    colBooking: 'การจอง',
    colAttempts: 'ครั้งที่พยายาม',
    colActions: 'จัดการ',
    viewBooking: 'ดูการจอง',
    retry: 'ส่งใหม่',
    retrying: 'กำลังส่ง…',
    retried: 'นำอีเมลเข้าคิวส่งใหม่แล้ว',
    emptyFailed: 'ไม่มีอีเมลที่ส่งไม่สำเร็จ',
    empty: 'ไม่พบอีเมลที่ตรงกับเงื่อนไข',
  },
} as const;
