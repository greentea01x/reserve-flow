// Pure helpers behind A7. Kept out of the route file so they can be exercised directly.
import { ApiClientError } from '../api/client';
import type { RoomFeature } from '../api/types';
import { COPY, errorMessage } from './i18n';

/**
 * Which inputs the server rejected. A 409 unique violation puts the offending column in
 * `details.field`; a 400 zod failure puts it in `details[i].path[0]`. Either shape ends up
 * binding the message to that input via aria-invalid.
 */
export const invalidFields = (error: unknown): Set<string> => {
  const fields = new Set<string>();
  if (!(error instanceof ApiClientError)) {
    return fields;
  }
  const { details } = error.envelope;
  if (Array.isArray(details)) {
    for (const issue of details) {
      const path = (issue as { path?: unknown[] }).path;
      if (Array.isArray(path) && typeof path[0] === 'string') {
        fields.add(path[0]);
      }
    }
  } else if (typeof details === 'object' && details !== null) {
    const field = (details as { field?: unknown }).field;
    if (typeof field === 'string') {
      fields.add(field);
    }
  }
  return fields;
};

/** A duplicate `code` names the field; everything else falls back to the error table. */
export const saveErrorMessage = (error: unknown): string => {
  const fields = invalidFields(error);
  if (
    error instanceof ApiClientError &&
    error.status === 409 &&
    !Array.isArray(error.envelope.details) &&
    fields.size > 0
  ) {
    return `${COPY.roomForm.duplicatePrefix} (${[...fields].join(', ')})`;
  }
  return errorMessage(error);
};

/** Uploads answer 413 / 415 with distinct statuses under one VALIDATION_FAILED code. */
export const photoErrorMessage = (error: unknown): string => {
  if (error instanceof ApiClientError) {
    if (error.status === 413) {
      return COPY.roomForm.photoTooLarge;
    }
    if (error.status === 415) {
      return COPY.roomForm.photoBadType;
    }
  }
  return errorMessage(error);
};

/**
 * Features are a SEPARATE PUT from the room PATCH, so the form only fires it when the
 * selection actually moved. Order is irrelevant — the endpoint replaces the whole list.
 */
export const featureListChanged = (selected: string[], saved: RoomFeature[]): boolean =>
  selected.length !== saved.length ||
  selected.some((key) => !saved.some((feature) => feature.key === key));
