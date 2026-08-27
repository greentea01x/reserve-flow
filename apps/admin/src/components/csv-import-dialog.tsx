import { type RefObject, useId, useState } from 'react';
import { ApiClientError } from '../api/client';
import { useImportUsers } from '../api/mutations';
import type { ImportAction, ImportResult } from '../api/types';
import { COPY, errorMessage, IMPORT_ACTION_LABELS } from '../lib/i18n';
import { AdminTable, InlineAlert } from './table';

/**
 * §4.5 — three steps, and the dry run is mandatory: there is no path from the file picker
 * straight to a commit. Partial failure is NORMAL here. One bad row is that row's ERROR,
 * never the file's, so `นำเข้าจริง` stays enabled when error rows exist; only a bad header,
 * an oversized file, or the last-admin barrier fails the whole thing.
 *
 * No Idempotency-Key: the import upserts on employee_code and is idempotent by construction.
 */

const SAMPLE_CSV = [
  'employee_code,full_name,email,mobile,department_code,role',
  'E101,สมชาย ใจดี,somchai@example.com,0812345678,IT,EMPLOYEE',
  'E102,สมหญิง รักงาน,somying@example.com,,HR,',
].join('\n');

// A BOM so Excel opens the Thai names as UTF-8 rather than as mojibake.
const SAMPLE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${SAMPLE_CSV}`)}`;

const ACTION_TONES: Record<ImportAction, string> = {
  CREATE: 'bg-g1 text-g7',
  UPDATE: 'bg-n1 text-ink2',
  SKIP: 'bg-n0 text-muted',
  ERROR: 'bg-r1 text-r7',
};

/** Whole-file failures get their own Thai string; everything else falls back to the table. */
const importErrorMessage = (error: unknown): string => {
  if (error instanceof ApiClientError) {
    if (error.status === 413) {
      return COPY.csvImport.tooLarge;
    }
    if (error.status === 415) {
      return COPY.csvImport.badType;
    }
    const details = error.envelope.details;
    if (
      error.status === 400 &&
      typeof details === 'object' &&
      details !== null &&
      'expected' in details
    ) {
      return COPY.csvImport.headerError;
    }
  }
  return errorMessage(error);
};

const buttonClass =
  'inline-flex min-h-10 items-center justify-center rounded-[11px] px-3.5 text-sm font-bold';
const secondaryClass = `${buttonClass} border border-line bg-white text-ink2 hover:bg-g0`;
const primaryClass = `${buttonClass} bg-g7 text-white disabled:opacity-60`;

export interface CsvImportDialogProps {
  ref: RefObject<HTMLDialogElement | null>;
  /** §4.3: with a single active admin, any demotion in the file rejects the whole file. */
  activeAdmins: number;
  /** Refetch the list when the dialog closes after a real import. */
  onClose: () => void;
}

export const CsvImportDialog = ({ ref, activeAdmins, onClose }: CsvImportDialogProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const importUsers = useImportUsers();
  const fileId = useId();
  const errorsOnlyId = useId();
  const labelId = useId();

  const shown = result ?? preview;
  const rows =
    shown === null
      ? []
      : errorsOnly
        ? shown.rows.filter((row) => row.action === 'ERROR')
        : shown.rows;

  // No dryRun parameter: the step is derived from state here, so no call site can flip the
  // polarity and turn "ตรวจสอบไฟล์" into a commit. Step 1 (no preview yet) always dry-runs.
  const run = () => {
    if (file === null) {
      return;
    }
    const dryRun = preview === null;
    importUsers.mutate(
      { file, dryRun },
      { onSuccess: (data) => (dryRun ? setPreview(data) : setResult(data)) },
    );
  };

  const copyErrors = () => {
    const text = (shown?.rows ?? [])
      .filter((row) => row.action === 'ERROR')
      .map((row) => `${row.line}\t${row.employee_code}\t${row.message ?? ''}`)
      .join('\n');
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };

  const summary = (
    <div className="flex flex-wrap gap-2 text-sm">
      {(
        [
          ['CREATE', COPY.csvImport.summaryCreate, shown?.summary.create ?? 0],
          ['UPDATE', COPY.csvImport.summaryUpdate, shown?.summary.update ?? 0],
          ['SKIP', COPY.csvImport.summarySkip, shown?.summary.skip ?? 0],
          ['ERROR', COPY.csvImport.summaryError, shown?.summary.error ?? 0],
        ] as const
      ).map(([action, label, count]) => (
        <span
          key={action}
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 font-semibold tabular-nums ${
            action === 'ERROR' && count > 0 ? 'bg-r1 text-r7' : 'bg-n0 text-ink2'
          }`}
        >
          {label} {count}
        </span>
      ))}
    </div>
  );

  const table =
    shown === null ? null : (
      <AdminTable
        label={COPY.csvImport.tableLabel}
        columns={[
          COPY.csvImport.colLine,
          COPY.csvImport.colCode,
          COPY.csvImport.colResult,
          COPY.csvImport.colNote,
        ]}
        rows={rows}
        rowKey={(row) => String(row.line)}
        renderRow={(row) => (
          <>
            <td className="px-4 py-2 text-ink2 tabular-nums">{row.line}</td>
            <td className="px-4 py-2 text-ink2">{row.employee_code}</td>
            <td className="px-4 py-2">
              <span
                className={`inline-flex min-h-6 items-center rounded-full px-2.5 font-semibold text-xs ${ACTION_TONES[row.action]}`}
              >
                {IMPORT_ACTION_LABELS[row.action]}
              </span>
            </td>
            <td className="px-4 py-2 text-muted text-xs">{row.message ?? '—'}</td>
          </>
        )}
      />
    );

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      onClose={() => {
        setFile(null);
        setPreview(null);
        setResult(null);
        setErrorsOnly(false);
        setCopied(false);
        importUsers.reset();
        onClose();
      }}
      className="m-auto w-[min(94vw,48rem)] rounded-2xl border border-line bg-white p-5 backdrop:bg-black/40"
    >
      <h2 id={labelId} className="font-bold text-ink text-lg">
        {result === null ? COPY.csvImport.title : COPY.csvImport.resultTitle}
      </h2>

      {preview === null && result === null ? (
        <>
          <label htmlFor={fileId} className="mt-4 block font-semibold text-ink2 text-sm">
            {COPY.csvImport.fileLabel}
          </label>
          <input
            id={fileId}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full rounded-[11px] border border-border-input bg-white px-3 py-2.5 text-ink text-sm"
          />
          <ul className="mt-3 grid gap-1 text-muted text-xs">
            <li>{COPY.csvImport.columnsNote}</li>
            <li>{COPY.csvImport.limitsNote}</li>
          </ul>
          <p className="mt-2 text-ink2 text-sm">{COPY.csvImport.dryRunNote}</p>
          <a
            href={SAMPLE_HREF}
            download="reserveflow-users-sample.csv"
            className="mt-2 inline-block font-semibold text-g7 text-sm underline"
          >
            {COPY.csvImport.sample}
          </a>
        </>
      ) : (
        <div className="mt-4 grid gap-3">
          {summary}
          {result === null && activeAdmins <= 1 ? (
            <p className="rounded-xl border border-y1 bg-y0 px-3.5 py-2.5 text-sm text-y7">
              {COPY.csvImport.lastAdminWarning}
            </p>
          ) : null}
          {(shown?.summary.error ?? 0) > 0 ? (
            <label
              htmlFor={errorsOnlyId}
              className="inline-flex items-center gap-2 font-semibold text-ink2 text-sm"
            >
              <input
                id={errorsOnlyId}
                type="checkbox"
                checked={errorsOnly}
                onChange={(event) => setErrorsOnly(event.target.checked)}
                className="size-4"
              />
              {COPY.csvImport.errorsOnly}
            </label>
          ) : null}
          <div className="max-h-72 overflow-y-auto">{table}</div>
          {result === null ? (
            <>
              {shown !== null && shown.summary.error > 0 ? (
                <p className="text-r7 text-sm">
                  {shown.summary.error} {COPY.csvImport.errorsSkippedSuffix}
                </p>
              ) : null}
              <p className="text-muted text-sm">{COPY.csvImport.notCommittedNote}</p>
            </>
          ) : (
            <p className="text-muted text-sm">{COPY.csvImport.resultNote}</p>
          )}
        </div>
      )}

      {/* The result is where the admin's focus is NOT after a long import — announce it. */}
      <div aria-live="polite" className="mt-3 grid gap-2">
        {importUsers.isError ? (
          <InlineAlert message={importErrorMessage(importUsers.error)} />
        ) : null}
        {result !== null ? (
          <p role="status" className="font-semibold text-g7 text-sm tabular-nums">
            {COPY.csvImport.resultTitle} · {COPY.csvImport.summaryCreate} {result.summary.create} ·{' '}
            {COPY.csvImport.summaryUpdate} {result.summary.update} · {COPY.csvImport.summarySkip}{' '}
            {result.summary.skip} · {COPY.csvImport.summaryError} {result.summary.error}
          </p>
        ) : null}
        {copied ? (
          <p role="status" className="text-muted text-xs">
            {COPY.csvImport.copied}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {result !== null && result.summary.error > 0 ? (
          <button type="button" onClick={copyErrors} className={`${secondaryClass} mr-auto`}>
            {COPY.csvImport.copyErrors}
          </button>
        ) : null}
        {result === null ? (
          <>
            <button
              type="button"
              onClick={() => (preview === null ? ref.current?.close() : setPreview(null))}
              className={secondaryClass}
            >
              {preview === null ? COPY.csvImport.cancel : COPY.csvImport.back}
            </button>
            <button
              type="button"
              disabled={file === null || importUsers.isPending}
              onClick={run}
              className={primaryClass}
            >
              {importUsers.isPending
                ? preview === null
                  ? COPY.csvImport.validating
                  : COPY.csvImport.committing
                : preview === null
                  ? COPY.csvImport.validate
                  : COPY.csvImport.commit}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => ref.current?.close()} className={primaryClass}>
            {COPY.csvImport.close}
          </button>
        )}
      </div>
    </dialog>
  );
};
