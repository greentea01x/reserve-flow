import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../api/client';
import type { RoomFeature } from '../api/types';
import {
  featureListChanged,
  invalidFields,
  photoErrorMessage,
  saveErrorMessage,
} from './room-form';

const apiError = (status: number, code: string, details?: unknown) =>
  new ApiClientError(status, {
    // biome-ignore lint/suspicious/noExplicitAny: test fixture, the code union is not the point
    code: code as any,
    message: 'server text nobody should ever see',
    request_id: 'req_1',
    ...(details !== undefined ? { details } : {}),
  });

const feature = (key: string): RoomFeature => ({ key, name: key, icon: null, quantity: 1 });

describe('invalidFields', () => {
  it('reads the unique-violation shape (409, details.field)', () => {
    expect([...invalidFields(apiError(409, 'VALIDATION_FAILED', { field: 'code' }))]).toEqual([
      'code',
    ]);
  });

  it('reads the zod shape (400, details is a ZodIssue[])', () => {
    const error = apiError(400, 'VALIDATION_FAILED', [
      { path: ['capacity'], message: 'too big', code: 'too_big' },
      { path: ['name'], message: 'required', code: 'invalid_type' },
    ]);
    expect([...invalidFields(error)].sort()).toEqual(['capacity', 'name']);
  });

  it('is empty for details it cannot read, and for non-API errors', () => {
    expect(invalidFields(apiError(500, 'INTERNAL')).size).toBe(0);
    expect(invalidFields(apiError(400, 'VALIDATION_FAILED', [{ message: 'x' }])).size).toBe(0);
    expect(invalidFields(new Error('offline')).size).toBe(0);
  });
});

describe('saveErrorMessage', () => {
  it('names the duplicated column on a 409', () => {
    expect(saveErrorMessage(apiError(409, 'VALIDATION_FAILED', { field: 'code' }))).toContain(
      '(code)',
    );
  });

  it('does not claim "already exists" for a 400 that merely names fields', () => {
    const message = saveErrorMessage(
      apiError(400, 'VALIDATION_FAILED', [{ path: ['capacity'], message: 'too big' }]),
    );
    expect(message).toBe('ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
  });

  it('never leaks the server message', () => {
    expect(saveErrorMessage(apiError(500, 'INTERNAL'))).not.toContain('server text');
  });
});

describe('photoErrorMessage', () => {
  it('separates 413 from 415 even though both carry VALIDATION_FAILED', () => {
    expect(photoErrorMessage(apiError(413, 'VALIDATION_FAILED'))).toBe('ไฟล์ใหญ่เกินกำหนด');
    expect(photoErrorMessage(apiError(415, 'VALIDATION_FAILED'))).toBe('ชนิดไฟล์ไม่รองรับ');
    expect(photoErrorMessage(apiError(400, 'VALIDATION_FAILED'))).toBe(
      'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
    );
  });
});

describe('featureListChanged', () => {
  const saved = [feature('projector'), feature('whiteboard')];

  it('is false when the same keys come back in a different order', () => {
    expect(featureListChanged(['whiteboard', 'projector'], saved)).toBe(false);
  });

  it('is true on an add, a remove, and a swap', () => {
    expect(featureListChanged(['projector', 'whiteboard', 'tv'], saved)).toBe(true);
    expect(featureListChanged(['projector'], saved)).toBe(true);
    // Same length, different membership — the length check alone would miss this.
    expect(featureListChanged(['projector', 'tv'], saved)).toBe(true);
  });

  it('handles the empty cases', () => {
    expect(featureListChanged([], [])).toBe(false);
    expect(featureListChanged([], saved)).toBe(true);
    expect(featureListChanged(['tv'], [])).toBe(true);
  });
});
