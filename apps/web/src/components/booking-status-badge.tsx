import type { BookingStatus } from '@reserveflow/shared';
import { StatusBadge } from '@reserveflow/ui';
import { STATUS_LABELS } from '../lib/i18n';

/** Employee copy stays task-oriented; admin/domain terminology remains unchanged. */
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <StatusBadge status={status} label={STATUS_LABELS[status]} />;
}
