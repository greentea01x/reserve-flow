import type { BookingStatus } from '@reserveflow/shared';

interface StatusPresentation {
  icon: string;
  label: string;
  styles: string;
}

const STATUS_PRESENTATION = {
  CONFIRMED: {
    icon: '✓',
    label: 'ยืนยันแล้ว',
    styles: 'border-status-available-text bg-status-available text-status-available-text',
  },
  CHECKED_IN: {
    icon: '●',
    label: 'เช็กอินแล้ว',
    styles: 'border-status-available-text bg-status-available text-status-available-text',
  },
  COMPLETED: {
    icon: '✓',
    label: 'เสร็จสิ้น',
    styles: 'border-status-available-text bg-status-available text-status-available-text',
  },
  CANCELLED: {
    icon: '×',
    label: 'ยกเลิกแล้ว',
    styles: 'border-status-busy-text bg-status-busy text-status-busy-text',
  },
  AUTO_RELEASED: {
    icon: '↺',
    label: 'ปล่อยอัตโนมัติ',
    styles: 'border-status-busy-text bg-status-busy text-status-busy-text',
  },
} as const satisfies Record<BookingStatus, StatusPresentation>;

export interface StatusBadgeProps {
  status: BookingStatus;
  /** Surface-specific copy override; domain/admin terminology remains the default. */
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const presentation = STATUS_PRESENTATION[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-sm font-medium ${presentation.styles}`}
      data-status={status}
    >
      <span aria-hidden="true">{presentation.icon}</span>
      <span>{label ?? presentation.label}</span>
    </span>
  );
}
