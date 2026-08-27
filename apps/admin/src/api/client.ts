import type { ErrorEnvelope } from '@reserveflow/shared';

const isErrorEnvelope = (value: unknown): value is ErrorEnvelope => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.request_id === 'string'
  );
};

export class ApiClientError extends Error {
  readonly envelope: ErrorEnvelope;
  readonly status: number;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.envelope = envelope;
  }
}

export interface ApiRequestInit extends RequestInit {
  /** JSON body; sets content-type and stringifies. */
  json?: unknown;
  /** Sets the Idempotency-Key header (booking creates). */
  idempotencyKey?: string;
}

export interface ApiResult<T> {
  data: T;
  /** For ETag / Location header capture. */
  response: Response;
}

/** Same-origin fetch through the vite proxy — never call :3000 directly (CSRF). */
export const apiRequest = async <T>(
  input: string,
  init?: ApiRequestInit,
): Promise<ApiResult<T>> => {
  const { json, idempotencyKey, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  headers.set('accept', 'application/json');
  if (json !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (idempotencyKey !== undefined) {
    headers.set('idempotency-key', idempotencyKey);
  }

  const response = await fetch(input, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    headers,
  });
  const isJson = response.headers.get('content-type')?.includes('application/json');

  if (!response.ok) {
    const errorBody: unknown = isJson ? await response.json() : null;
    if (isErrorEnvelope(errorBody)) {
      throw new ApiClientError(response.status, errorBody);
    }

    throw new Error(`API request failed with status ${response.status}`);
  }

  const data = (isJson ? await response.json() : null) as T;
  return { data, response };
};

export const apiFetch = async <T>(input: string, init?: ApiRequestInit): Promise<T> =>
  (await apiRequest<T>(input, init)).data;
