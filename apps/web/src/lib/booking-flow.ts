import type { SlotGridSelection } from '@reserveflow/ui';

interface EditTimeInput {
  roomId: string;
  date: string;
  start: string;
  end: string;
}

interface SlotRow {
  start: string;
  end: string;
}

/** E4 “แก้ไขเวลา” always returns to the room-specific E3 picker. */
export const editTimeDestination = ({ roomId, date, start, end }: EditTimeInput) => ({
  to: '/rooms/$roomId' as const,
  params: { roomId },
  search: { date, start, end },
});

/** Restore a URL time range only when both boundaries exist on this grid. */
export const selectionFromTimeRange = (
  roomId: string,
  rows: SlotRow[],
  start?: string,
  end?: string,
): SlotGridSelection | null => {
  if (start === undefined || end === undefined) {
    return null;
  }

  const startRow = rows.findIndex((row) => row.start === start);
  const endIndex = rows.findIndex((row) => row.end === end);
  if (startRow < 0 || endIndex < startRow) {
    return null;
  }

  for (let index = startRow; index < endIndex; index += 1) {
    if (rows[index]?.end !== rows[index + 1]?.start) {
      return null;
    }
  }

  return { columnKey: roomId, startRow, endRow: endIndex + 1 };
};
