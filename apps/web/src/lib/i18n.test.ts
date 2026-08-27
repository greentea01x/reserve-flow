import { describe, expect, it } from 'vitest';
import { COPY, STATUS_LABELS, TIMELINE_LABELS } from './i18n';

describe('employee booking copy', () => {
  it('uses booking language for the employee confirmed state', () => {
    expect(STATUS_LABELS.CONFIRMED).toBe('จองแล้ว');
  });

  it('keeps the new-booking CTA label separate from its plus icon', () => {
    expect(COPY.bookings.newBooking).toBe('จองห้อง');
  });

  it('labels the room booking mode consistently', () => {
    expect(COPY.roomDetail.autoApprove).toBe('Auto-approve');
  });

  it('describes missed check-in as an employee outcome', () => {
    expect(STATUS_LABELS.AUTO_RELEASED).toBe('ไม่ได้เช็กอิน');
    expect(TIMELINE_LABELS.AUTO_RELEASED).toBe('ไม่ได้เช็กอิน');
  });

  it('explains normal check-in entry points', () => {
    expect(COPY.bookings.checkInHint).toContain('ก่อนเริ่ม 15 นาที');
    expect(COPY.bookings.checkInHint).toContain('QR ที่หน้าห้อง');
  });

  it('does not mention email delivery in employee booking feedback', () => {
    expect(COPY.bookingDetail.created).toBe('จองสำเร็จ');
    expect(COPY.edit.saved).not.toContain('อีเมล');
    expect(COPY.cancelDialog.consequences).not.toContain('อีเมล');
  });
});
