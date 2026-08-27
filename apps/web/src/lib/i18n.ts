// The single Thai string table. UI translates error codes here — never show raw server messages.
import type { ErrorCode } from '@reserveflow/shared';
import { ApiClientError } from '../api/client';
import type { AvailabilityReason } from '../api/types';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  SLOT_UNAVAILABLE: 'ช่วงเวลานี้ไม่ว่างแล้ว (มีคนจองก่อนเมื่อสักครู่)',
  VERSION_CONFLICT: 'มีผู้อื่นแก้ไขการจองนี้แล้ว',
  INVALID_STATUS_TRANSITION: 'สถานะการจองไม่อนุญาตให้ทำรายการนี้',
  OUTSIDE_BUSINESS_HOURS: 'อยู่นอกเวลาทำการ',
  MIN_DURATION: 'ระยะเวลาจองสั้นกว่าขั้นต่ำ',
  MAX_DURATION: 'ระยะเวลาจองยาวเกินกำหนด',
  SLOT_INCREMENT: 'เวลาเริ่มและสิ้นสุดต้องตรงตามช่วงเวลาที่กำหนด',
  IN_PAST: 'ไม่สามารถจองเวลาย้อนหลังได้',
  MAX_ADVANCE: 'จองล่วงหน้าเกินระยะเวลาที่กำหนด',
  CHECKIN_WINDOW_CLOSED: 'ยังไม่ถึงเวลาเช็กอิน หรือเลยเวลาเช็กอินแล้ว',
  NO_BOOKING_IN_WINDOW: 'ไม่มีการจองของคุณในห้องนี้ในขณะนี้',
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
  LAST_ADMIN: 'ไม่สามารถทำรายการได้ เพราะเป็น Admin คนสุดท้าย',
  USER_HAS_HISTORY: 'ไม่สามารถลบผู้ใช้ที่มีประวัติการใช้งาน',
  CANNOT_MODIFY_SELF: 'ไม่สามารถแก้ไขบัญชีของตนเองจากหน้านี้ได้',
  TOKEN_EXPIRED: 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่จาก Admin',
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

/** 409 SLOT_UNAVAILABLE, templated with the room + the requested range. */
export const slotUnavailableMessage = (roomName: string, range: string): string =>
  `ห้อง ${roomName} ไม่ว่างแล้วในช่วง ${range} (มีคนจองก่อนเมื่อสักครู่)`;

/** 422 CHECKIN_WINDOW_CLOSED, templated with the window from details. */
export const checkinWindowMessage = (range: string): string => `ยังไม่ถึงเวลาเช็กอิน · เช็กอินได้ ${range}`;

/** CB-03: shown next to a reschedule 409 — the booking never moved. */
export const keepsOldSlotMessage = (oldSlot: string): string => `การจองยังคงเวลาเดิม ${oldSlot}`;

export const STATUS_LABELS = {
  CONFIRMED: 'จองแล้ว',
  CHECKED_IN: 'เช็กอินแล้ว',
  COMPLETED: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิกแล้ว',
  AUTO_RELEASED: 'ไม่ได้เช็กอิน',
} as const;

/** E2: why a room fails the searched window — shown collapsed, never hidden (UX-04). */
export const AVAILABILITY_REASONS: Record<AvailabilityReason, string> = {
  BUSY: 'ไม่ว่าง',
  CLOSED: 'ปิดทำการ',
  HOLIDAY: 'วันหยุด',
  CAPACITY: 'ความจุไม่พอ',
  MISSING_FEATURE: 'ไม่มีอุปกรณ์ที่ต้องการ',
};

export const TIMELINE_LABELS = {
  CREATED: 'สร้างเมื่อ',
  RESCHEDULED: 'เลื่อนเวลา',
  CHECKED_IN: 'เช็กอิน',
  CANCELLED: 'ยกเลิก',
  AUTO_RELEASED: 'ไม่ได้เช็กอิน',
  COMPLETED: 'เสร็จสิ้น',
} as const;

export const COPY = {
  brand: 'ReserveFlow',
  company: 'บริษัทอุ๊ยรวยไม่จำกัด',
  login: {
    headline: 'ระบบจองห้องประชุม',
    sub: 'เช็กห้องว่างและจองได้ทันที',
    formTitle: 'Employee Login',
    formSub: 'เข้าสู่ระบบ ReserveFlow สำหรับพนักงาน',
    identifier: 'EMPLOYEE ID (รหัสพนักงาน)',
    identifierPlaceholder: 'Enter your ID',
    password: 'PASSWORD (รหัสผ่าน)',
    passwordPlaceholder: 'Enter your password',
    showPassword: 'แสดงรหัสผ่าน',
    hidePassword: 'ซ่อนรหัสผ่าน',
    rememberMe: 'Remember me',
    submit: 'เข้าสู่ระบบ',
    submitting: 'กำลังเข้าสู่ระบบ…',
    footer: 'ยังไม่มีบัญชี? ติดต่อ Admin เพื่อสร้างบัญชี (ไม่มีการลงทะเบียนเอง)',
  },
  nav: {
    rooms: 'ค้นหาห้อง',
    bookings: 'การจองของฉัน',
    calendar: 'ตารางเวลาห้องทั้งหมด',
    profile: 'โปรไฟล์',
    modeHeading: 'โหมดการใช้งาน',
    modeLabel: 'สลับโหมดการใช้งาน',
    employeeMode: 'ผู้ใช้',
    adminMode: 'แอดมิน',
    switchToEmployee: 'สลับไปโหมดผู้ใช้',
    switchToAdmin: 'สลับไปโหมดแอดมิน',
    signOut: 'ออกจากระบบ',
  },
  quickSearch: {
    title: 'ค้นหาห้องว่าง',
    dateLabel: 'วันที่',
    headcountLabel: 'ผู้เข้าร่วม (คน)',
    featuresLabel: 'อุปกรณ์',
    submit: 'ค้นหา',
    closedDay: 'วันที่เลือกปิดทำการ',
  },
  rooms: {
    title: 'ห้องที่พร้อมจอง',
    promptSearch: 'เลือกห้องที่เหมาะกับทีม หรือระบุวันและเวลาเพื่อเช็กห้องว่าง',
    allRoomsTitle: 'ห้องประชุม 3 ห้อง',
    readyBadge: 'พร้อมจอง',
    filtersActive: 'ใช้ตัวกรองแล้ว',
    availableBadge: 'ว่าง',
    busyBadge: 'ไม่ว่าง',
    busyAgainPrefix: 'ว่างอีกครั้ง',
    choose: 'เลือกห้อง',
    viewTimes: 'ดูเวลาว่าง',
    showHidden: 'แสดงทั้งหมด',
    hideHidden: 'ซ่อนห้องที่ไม่ตรงเงื่อนไข',
    hiddenPrefix: 'ซ่อน',
    hiddenSuffix: 'ห้อง',
    noneAvailable: 'ไม่มีห้องว่างในช่วงเวลานี้',
    people: 'คน',
  },
  roomDetail: {
    autoApprove: 'Auto-approve',
    pickDate: 'เลือกวันที่',
    gridLabel: 'เลือกเวลา',
    hoursPrefix: 'เวลาทำการ',
    minDurationPrefix: 'จองขั้นต่ำ',
    maxAdvancePrefix: 'จองล่วงหน้าได้ถึง',
    capacity: 'ความจุ',
    features: 'อุปกรณ์',
    floor: 'ชั้น',
    closedDay: 'วันที่เลือกปิดทำการ',
  },
  profile: {
    title: 'โปรไฟล์',
    changePasswordTitle: 'เปลี่ยนรหัสผ่าน',
    currentPassword: 'รหัสผ่านเดิม',
    newPassword: 'รหัสผ่านใหม่',
    newPasswordHint: 'อย่างน้อย 10 ตัวอักษร',
    revokeNote: 'เมื่อเปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นจะถูกออกจากระบบ',
    submit: 'เปลี่ยนรหัสผ่าน',
    pending: 'กำลังบันทึก…',
    success: 'เปลี่ยนรหัสผ่านแล้ว · อุปกรณ์อื่นถูกออกจากระบบ',
    tooShort: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 10 ตัวอักษร',
    failed: 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาตรวจสอบรหัสผ่านเดิม',
    fontSizeTitle: 'ขนาดตัวอักษร',
  },
  edit: {
    title: 'แก้ไขการจอง',
    save: 'บันทึกการแก้ไข',
    pending: 'กำลังบันทึก…',
    close: 'ปิด',
    saved: 'บันทึกการแก้ไขแล้ว',
  },
  states: {
    loading: 'กำลังโหลด…',
    retry: 'ลองใหม่',
    notFoundTitle: 'ไม่พบหน้าที่ต้องการ',
    backHome: 'กลับไปค้นหาห้อง',
    errorTitle: 'เกิดข้อผิดพลาด',
  },
  calendar: {
    title: 'ตารางเวลา',
    gridLabel: 'ตารางการจองห้องประชุม',
    today: 'วันนี้',
    prev: 'ก่อนหน้า',
    next: 'ถัดไป',
    dayView: 'วัน',
    weekView: 'สัปดาห์',
    allRooms: 'ทุกห้อง',
    roomLabel: 'ห้อง',
    startLabel: 'เวลาเริ่ม',
    endLabel: 'เวลาสิ้นสุด',
    selectedPrefix: 'เลือกแล้ว:',
    noSelection: 'แตะช่องว่างในตารางหรือเลือกเวลาเพื่อเริ่มจอง',
    proceed: 'ดำเนินการจอง',
    closedDay: 'ปิดทำการ',
    holidayPrefix: 'วันหยุด',
    closedShort: 'ปิด',
    legendFree: 'ว่าง',
    legendBusy: 'ไม่ว่าง',
    legendMine: 'การจองของฉัน',
    legendSelected: 'เลือกแล้ว',
    legendClosed: 'ปิด',
    legendPast: 'เวลาผ่านแล้ว',
    busyMasked: 'ไม่ว่าง',
    bookerPrefix: 'ผู้จอง',
    dayListTitle: 'รายการจองของวันนี้',
    noBookingsInRange: 'ไม่มีการจองในช่วงนี้',
  },
  bookingForm: {
    title: 'รายละเอียดการจอง',
    sub: 'ตรวจสอบข้อมูลก่อนยืนยัน',
    formTitle: 'ข้อมูลการประชุม',
    meetingTitle: 'หัวข้อการประชุม',
    description: 'รายละเอียด',
    attendees: 'ผู้เข้าร่วม',
    attendeesPlaceholder: 'เพิ่มอีเมลแล้วกด Enter',
    attendeeInvalid: 'อีเมลไม่ถูกต้อง',
    attendeeRemove: 'ลบ',
    privateTitle: 'ประชุมส่วนตัว',
    privateHint: "ผู้อื่นเห็นเพียง 'ไม่ว่าง' — ผู้จัด ผู้เข้าร่วม และ Admin ยังเห็นรายละเอียด",
    specialRequest: 'ความต้องการพิเศษ',
    specialRequestPlaceholder: 'เช่น เตรียมน้ำดื่ม 10 ที่นั่ง / สาย HDMI เพิ่ม',
    headcount: 'จำนวนผู้เข้าร่วม (คน)',
    overCapacity: 'เกินความจุห้อง — บันทึกได้ แต่โปรดพิจารณาห้องที่ใหญ่กว่า',
    submit: 'ยืนยันการจอง',
    submitting: 'กำลังยืนยัน…',
    titleRequired: 'กรุณาระบุหัวข้อการประชุม',
    conflictCheckNote: 'Conflict Check: ตรวจห้องอีกครั้งเมื่อกดยืนยัน',
    pickAnotherTime: 'เลือกเวลาอื่น',
    alternativesTitle: 'ดูห้องอื่นที่ว่าง',
    dateRow: 'วันที่',
    timeRow: 'เวลา',
    durationRow: 'ระยะเวลา',
    capacityRow: 'ความจุ',
    featuresRow: 'อุปกรณ์',
    people: 'คน',
    backToCalendar: 'แก้ไขเวลา',
  },
  bookingDetail: {
    created: 'จองสำเร็จ',
    privateBadge: 'ส่วนตัว',
    busyTitle: 'ไม่ว่าง',
    owner: 'ผู้จอง',
    attendees: 'ผู้เข้าร่วม',
    headcount: 'จำนวนผู้เข้าร่วม',
    specialRequest: 'ความต้องการพิเศษ',
    description: 'รายละเอียด',
    backToList: 'การจองของฉัน',
    people: 'คน',
    floorPrefix: 'ชั้น',
    edit: 'แก้ไข',
    reschedule: 'เลื่อนเวลา',
    cancel: 'ยกเลิกการจอง',
    checkIn: 'เช็กอิน',
    checkingIn: 'กำลังเช็กอิน…',
    ics: 'ดาวน์โหลด .ics',
    timeline: 'ประวัติการจอง',
    cancelledByPrefix: 'ยกเลิกโดย',
    checkinCountdownSuffix: 'นาที ก่อนหมดเวลาเช็กอิน',
  },
  bookings: {
    title: 'การจองของฉัน',
    sub: 'ติดตาม แก้ไข หรือยกเลิก',
    newBooking: 'จองห้อง',
    tabUpcoming: 'กำลังจะถึง',
    tabHistory: 'ประวัติ',
    filterAll: 'ทั้งหมด',
    filterLabel: 'กรองตามสถานะ',
    colMeeting: 'การประชุม',
    colWhen: 'วันและเวลา',
    colRoom: 'ห้อง',
    colStatus: 'สถานะ',
    colActions: 'จัดการ',
    detail: 'ดูรายละเอียด',
    checkIn: 'เช็กอิน',
    checkInHint: 'ปุ่มเช็กอินจะแสดงก่อนเริ่ม 15 นาที หรือสแกน QR ที่หน้าห้อง',
    emptyUpcoming: 'ยังไม่มีการจองที่กำลังจะถึง',
    emptyHistory: 'ยังไม่มีประวัติการจอง',
    emptyCta: 'จองห้อง',
    prevPage: 'หน้าก่อนหน้า',
    nextPage: 'หน้าถัดไป',
    pagePrefix: 'หน้า',
    attendeesSuffix: 'คน',
  },
  cancelDialog: {
    title: 'ยกเลิกการจองนี้?',
    consequences: 'คืน slot ทันที · กู้คืนไม่ได้',
    reasonLabel: 'เหตุผล (ไม่บังคับ)',
    reasonTooShort: 'เหตุผลต้องยาวอย่างน้อย 3 ตัวอักษร',
    confirm: 'ยืนยันยกเลิกการจอง',
    keep: 'กลับ',
    pending: 'กำลังยกเลิก…',
  },
  reschedule: {
    title: 'เลื่อนเวลา',
    currentSlot: 'เวลาเดิม',
    dateLabel: 'วันที่',
    confirm: 'ยืนยันเวลาใหม่',
    pending: 'กำลังบันทึก…',
    reload: 'โหลดข้อมูลล่าสุด',
    close: 'ปิด',
    closedDay: 'วันที่เลือกปิดทำการ',
    gridLabel: 'เลือกเวลาใหม่',
  },
  datePicker: {
    openCalendar: 'เปิดปฏิทิน',
    dialogTitle: 'เลือกวันที่',
    closeCalendar: 'ปิดปฏิทิน',
    loading: 'กำลังโหลดปฏิทิน…',
  },
  checkin: {
    activate: 'เปิดใช้งานการจอง',
    landingHint: 'กดปุ่มด้านล่างเพื่อเช็กอินการจองของคุณในห้องนี้',
    checking: 'กำลังเช็กอิน…',
    successBadge: 'เช็กอินสำเร็จ',
    successHeadline: 'เปิดใช้งานการจองแล้ว · กำลังปลดล็อกประตู',
    statusLine: 'สถานะ CHECKED_IN',
    failBadge: 'เช็กอินไม่สำเร็จ',
    unknownRoom: 'ไม่พบห้องนี้ในระบบ',
    myBookings: 'ดูการจองของฉัน',
    retry: 'ลองใหม่',
  },
} as const;
