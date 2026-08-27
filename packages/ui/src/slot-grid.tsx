/** biome-ignore-all lint/a11y/useSemanticElements: A11Y-05 mandates the APG grid
 * pattern (role=grid/row/gridcell on divs) — an interactive picker, not a data table. */
/** biome-ignore-all lint/a11y/useFocusableInteractive: roving tabindex — exactly one
 * gridcell carries tabindex=0; rows and header cells stay out of the tab order. */
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';

export interface SlotGridColumn {
  key: string;
  label: string;
  sublabel?: string;
}

/** Display times for one row, e.g. start "08:30" end "09:00". */
export interface SlotGridRow {
  start: string;
  end: string;
}

export type SlotGridCellState =
  | { kind: 'free'; disabled?: boolean }
  | {
      kind: 'busy';
      label?: string;
      /** Optional second line, e.g. the booking owner's display name. */
      secondaryLabel?: string;
      mine?: boolean;
      blockStart?: boolean;
      /**
       * Whether `onActivateBusy` fires for this cell. Defaults to `mine` — the employee
       * board only opens one's own bookings. An admin board opens every booking, so it
       * sets this true while leaving `mine` (a colour flag) alone.
       */
      activatable?: boolean;
    }
  | { kind: 'past'; label?: string }
  | { kind: 'closed'; label?: string };

export interface SlotGridSelection {
  columnKey: string;
  startRow: number;
  /** Exclusive. */
  endRow: number;
}

export interface SlotGridProps {
  /** Accessible name for the grid, which is also its own scroll container. */
  label: string;
  columns: SlotGridColumn[];
  rows: SlotGridRow[];
  getCell: (columnKey: string, rowIndex: number) => SlotGridCellState;
  /** Selectable mode (booking pickers): a contiguous run of rows in one column. */
  selection?: SlotGridSelection | null;
  onSelectionChange?: (selection: SlotGridSelection | null) => void;
  /** Click-through mode (read-only boards): Enter/Space/click on a free cell. */
  onActivateCell?: (columnKey: string, rowIndex: number) => void;
  /** Enter/Space/click on one's own busy cell (E9: own bookings link to their detail). */
  onActivateBusy?: (columnKey: string, rowIndex: number) => void;
  /** Rows a fresh pick snaps to (min duration ÷ increment). Default 1. */
  minRows?: number;
  /** Max rows per selection (max duration ÷ increment). Default unlimited. */
  maxRows?: number | null;
}

const CELL_CLASS = {
  free: 'cursor-pointer border-line bg-white hover:bg-g0',
  /** Read-only board: a free cell is still "ว่าง", it just is not a click target. */
  freeStatic: 'border-line bg-white',
  freeDisabled: 'border-line bg-bg text-muted',
  busy: 'border-r2 bg-r1 text-r7',
  busyOpen: 'cursor-pointer hover:bg-r2',
  mine: 'border-g2 bg-g1 text-g7',
  mineOpen: 'cursor-pointer hover:bg-g2',
  past: 'border-line bg-n1 text-ink2',
  closed: 'border-line bg-n0 text-muted',
  selected: 'border-2 border-g7 bg-g1 font-semibold text-g7',
};

/**
 * A11Y-05 APG grid: role=grid/row/gridcell, roving tabindex, ←→ column, ↑↓ time,
 * Home/End row ends, Ctrl+Home/End grid ends, Enter/Space select, Shift+↑↓ extend,
 * Esc clear, aria-live announces the selection. Pair every usage with native
 * <select> fallbacks on the page — the grid is never the only path.
 */
export function SlotGrid({
  label,
  columns,
  rows,
  getCell,
  selection = null,
  onSelectionChange,
  onActivateCell,
  onActivateBusy,
  minRows = 1,
  maxRows = null,
}: SlotGridProps) {
  const [focusPos, setFocusPos] = useState<[number, number]>([0, 0]);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const [announcement, setAnnouncement] = useState('');
  const hadSelection = useRef(false);

  const selectable = onSelectionChange !== undefined;
  const columnCount = columns.length;
  const rowCount = rows.length;

  // Clamp the roving cell when the axes shrink (date/view change).
  useEffect(() => {
    setFocusPos(([c, r]) => {
      const clamped: [number, number] = [
        Math.min(c, Math.max(0, columnCount - 1)),
        Math.min(r, Math.max(0, rowCount - 1)),
      ];
      return clamped[0] === c && clamped[1] === r ? [c, r] : clamped;
    });
  }, [columnCount, rowCount]);

  // Announce selection changes, wherever they come from (grid or the paired selects).
  useEffect(() => {
    const column = selection ? columns.find((col) => col.key === selection.columnKey) : undefined;
    const startRow = selection ? rows[selection.startRow] : undefined;
    const endRow = selection ? rows[selection.endRow - 1] : undefined;
    if (selection && column && startRow && endRow) {
      setAnnouncement(`เลือก ${column.label} ${startRow.start}–${endRow.end}`);
      hadSelection.current = true;
    } else if (hadSelection.current) {
      setAnnouncement('ยกเลิกการเลือกแล้ว');
      hadSelection.current = false;
    }
  }, [selection, columns, rows]);

  if (columnCount === 0 || rowCount === 0) {
    return null;
  }

  const gridTemplate = {
    gridTemplateColumns: `3.25rem repeat(${columnCount}, minmax(7.5rem, 1fr))`,
  };

  const isFree = (columnKey: string, row: number): boolean => {
    const cell = getCell(columnKey, row);
    return cell.kind === 'free' && !cell.disabled;
  };

  const spanFree = (columnKey: string, from: number, to: number): boolean => {
    for (let row = from; row < to; row += 1) {
      if (!isFree(columnKey, row)) {
        return false;
      }
    }
    return true;
  };

  const focusCell = (c: number, r: number) => {
    setFocusPos([c, r]);
    cellRefs.current.get(`${c}:${r}`)?.focus();
  };

  /** Tap-first-then-last (UX-07): first pick snaps to minRows, a later pick in the
   * same column moves the end time. */
  const pick = (c: number, r: number) => {
    const column = columns[c];
    if (!column || !onSelectionChange || !isFree(column.key, r)) {
      return;
    }
    if (
      selection &&
      selection.columnKey === column.key &&
      // Moving the end time never shrinks below min duration — a shorter pick re-anchors.
      r + 1 - selection.startRow >= minRows &&
      (maxRows === null || r - selection.startRow < maxRows) &&
      spanFree(column.key, selection.startRow, r + 1)
    ) {
      onSelectionChange({ ...selection, endRow: r + 1 });
      return;
    }
    let end = r + 1;
    while (
      end - r < minRows &&
      end < rowCount &&
      (maxRows === null || end - r < maxRows) &&
      isFree(column.key, end)
    ) {
      end += 1;
    }
    onSelectionChange({ columnKey: column.key, startRow: r, endRow: end });
  };

  const resize = (delta: 1 | -1) => {
    const [c] = focusPos;
    const column = columns[c];
    if (!selection || !onSelectionChange || !column || selection.columnKey !== column.key) {
      return;
    }
    if (delta === 1) {
      const next = selection.endRow;
      if (
        next < rowCount &&
        (maxRows === null || selection.endRow - selection.startRow < maxRows) &&
        isFree(column.key, next)
      ) {
        onSelectionChange({ ...selection, endRow: next + 1 });
        focusCell(c, next);
      }
      return;
    }
    if (selection.endRow - selection.startRow > minRows) {
      onSelectionChange({ ...selection, endRow: selection.endRow - 1 });
      focusCell(c, selection.endRow - 2);
    }
  };

  const busyOpens = (cell: SlotGridCellState): boolean =>
    cell.kind === 'busy' &&
    onActivateBusy !== undefined &&
    (cell.activatable ?? cell.mine === true);

  const activate = (c: number, r: number) => {
    const column = columns[c];
    if (!column) {
      return;
    }
    const cell = getCell(column.key, r);
    if (busyOpens(cell)) {
      onActivateBusy?.(column.key, r);
      return;
    }
    if (selectable) {
      pick(c, r);
      return;
    }
    if (onActivateCell && isFree(column.key, r)) {
      onActivateCell(column.key, r);
    }
  };

  const onKeyDown = (event: KeyboardEvent, c: number, r: number) => {
    const last: [number, number] = [columnCount - 1, rowCount - 1];
    const handlers: Record<string, () => void> = {
      ArrowRight: () => focusCell(Math.min(c + 1, last[0]), r),
      ArrowLeft: () => focusCell(Math.max(c - 1, 0), r),
      ArrowDown: () => (event.shiftKey ? resize(1) : focusCell(c, Math.min(r + 1, last[1]))),
      ArrowUp: () => (event.shiftKey ? resize(-1) : focusCell(c, Math.max(r - 1, 0))),
      Home: () => (event.ctrlKey ? focusCell(0, 0) : focusCell(0, r)),
      End: () => (event.ctrlKey ? focusCell(last[0], last[1]) : focusCell(last[0], r)),
      Enter: () => activate(c, r),
      ' ': () => activate(c, r),
      Escape: () => onSelectionChange?.(null),
    };
    const handler = handlers[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  };

  const renderCell = (column: SlotGridColumn, c: number, r: number) => {
    const row = rows[r];
    if (!row) {
      return null;
    }
    const cell = getCell(column.key, r);
    const selected =
      selection !== null &&
      selection.columnKey === column.key &&
      r >= selection.startRow &&
      r < selection.endRow;

    let className = selectable || onActivateCell ? CELL_CLASS.free : CELL_CLASS.freeStatic;
    let stateText = 'ว่าง';
    let content: ReactNode = null;
    if (selected) {
      className = CELL_CLASS.selected;
      stateText = 'เลือกอยู่';
      content = <span aria-hidden="true">✓</span>;
    } else if (cell.kind === 'busy') {
      className = cell.mine ? CELL_CLASS.mine : CELL_CLASS.busy;
      if (busyOpens(cell)) {
        className += ` ${cell.mine ? CELL_CLASS.mineOpen : CELL_CLASS.busyOpen}`;
      }
      const busyLabel = cell.label ?? 'ไม่ว่าง';
      const busyState = cell.mine
        ? `การจองของฉัน ${busyLabel}`
        : busyLabel === 'ไม่ว่าง'
          ? busyLabel
          : `ไม่ว่าง ${busyLabel}`;
      stateText = cell.secondaryLabel ? `${busyState} ${cell.secondaryLabel}` : busyState;
      content = cell.blockStart ? (
        <span className="block w-full min-w-0 max-w-full px-1 text-center leading-tight">
          <span className="flex w-full min-w-0 items-center justify-center gap-1">
            {cell.mine ? null : <span aria-hidden="true">✕</span>}
            <span className={`min-w-0 truncate ${cell.mine || cell.label ? '' : 'line-through'}`}>
              {busyLabel}
            </span>
          </span>
          {cell.secondaryLabel ? (
            <span className="mt-0.5 block truncate text-xs font-medium">{cell.secondaryLabel}</span>
          ) : null}
        </span>
      ) : null;
    } else if (cell.kind === 'past') {
      className = CELL_CLASS.past;
      stateText = cell.label ?? 'เวลาผ่านแล้ว';
    } else if (cell.kind === 'closed') {
      className = CELL_CLASS.closed;
      stateText = cell.label ?? 'ปิด';
      content = cell.label ? <span className="truncate px-1 text-xs">{cell.label}</span> : null;
    } else if (cell.disabled) {
      className = CELL_CLASS.freeDisabled;
      stateText = 'จองไม่ได้';
    }

    const isFocusCell = focusPos[0] === c && focusPos[1] === r;
    return (
      <div
        key={column.key}
        role="gridcell"
        aria-label={`${column.label} ${row.start}–${row.end} ${stateText}`}
        aria-selected={selectable ? selected : undefined}
        aria-disabled={
          busyOpens(cell) || (cell.kind === 'free' && !cell.disabled) ? undefined : true
        }
        tabIndex={isFocusCell ? 0 : -1}
        ref={(node) => {
          if (node) {
            cellRefs.current.set(`${c}:${r}`, node);
          } else {
            cellRefs.current.delete(`${c}:${r}`);
          }
        }}
        onKeyDown={(event) => onKeyDown(event, c, r)}
        onClick={() => {
          setFocusPos([c, r]);
          activate(c, r);
        }}
        className={`m-px flex min-h-11 items-center justify-center rounded-md border text-sm ${className}`}
      >
        {content}
      </div>
    );
  };

  return (
    <div>
      <div role="grid" aria-label={label} className="overflow-x-auto">
        <div role="row" className="grid" style={gridTemplate}>
          <div role="columnheader" aria-label="เวลา" className="text-xs text-muted" />
          {columns.map((column) => (
            <div key={column.key} role="columnheader" className="px-1 py-1.5 text-center">
              <span className="block truncate text-sm font-bold text-ink">{column.label}</span>
              {column.sublabel ? (
                <span className="block truncate text-xs font-normal text-muted">
                  {column.sublabel}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={row.start} role="row" className="grid" style={gridTemplate}>
            <div
              role="rowheader"
              className="flex items-center justify-end pr-2 text-xs text-muted tabular-nums"
            >
              {row.start}
            </div>
            {columns.map((column, c) => renderCell(column, c, r))}
          </div>
        ))}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
