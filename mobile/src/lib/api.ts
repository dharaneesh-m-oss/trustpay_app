/**
 * API client.
 *
 * TrustPay runs entirely on the device, so this client's requests are served by
 * the local engine in `src/local` rather than sent anywhere. That is done by
 * swapping axios's adapter, which keeps every caller, query key and error path
 * below exactly as it was when a server existed.
 *
 * Two things still matter here beyond plumbing:
 *
 * 1. **Token refresh is serialised.** When an access token expires, several
 *    queries usually fail at once. Without a shared in-flight promise each one
 *    would post its own refresh, and because refresh tokens rotate, the second
 *    request would present an already-consumed token — which the backend
 *    correctly treats as a leak and responds to by killing the whole session.
 *    So the first 401 starts a refresh and every other request waits on it.
 *
 * 2. **Errors are normalised.** The backend always replies with
 *    `{error: {code, message, request_id}}`. The UI should never have to reach
 *    into an axios error shape, and should never show a raw one.
 */

import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';

import { localAdapter } from '@/local/adapter';

import { tokenStorage } from './storage';

export type ApiErrorBody = {
  code: string;
  message: string;
  request_id?: string | null;
  details?: Record<string, unknown>;
};

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string | null;
  details?: Record<string, unknown>;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.status = status;
    this.requestId = body.request_id;
    this.details = body.details;
  }

  /** Field-level messages from a 422, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details?.fields;
    return fields && typeof fields === 'object'
      ? (fields as Record<string, string>)
      : {};
  }
}

let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

export const api: AxiosInstance = axios.create({
  // Nothing is dialled, so the base URL is only a prefix the adapter strips and
  // the timeout never fires. Both are kept so request shapes stay familiar.
  baseURL: '/',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  adapter: localAdapter,
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await tokenStorage.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** The single in-flight refresh, shared by every request that hits a 401. */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) return null;

  try {
    // This goes through `api` so it reaches the local adapter. It cannot
    // recurse: the interceptor below skips retrying the refresh URL itself.
    const response = await api.post(
      '/auth/refresh',
      { refresh_token: refreshToken },
    );
    await tokenStorage.setTokens(
      response.data.access_token,
      response.data.refresh_token,
    );
    return response.data.access_token as string;
  } catch {
    await tokenStorage.clear();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: ApiErrorBody }>) => {
    const status = error.response?.status;
    const original = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };

    const isRefreshCall = original?.url?.includes('/auth/refresh');

    if (status === 401 && original && !original._retried && !isRefreshCall) {
      original._retried = true;

      refreshInFlight = refreshInFlight ?? refreshAccessToken();
      const token = await refreshInFlight;
      refreshInFlight = null;

      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }

      onSessionExpired?.();
    }

    const body = error.response?.data?.error;
    if (body) {
      throw new ApiError(body, status ?? 500);
    }

    // No structured body: the network failed, or something upstream broke.
    throw new ApiError(
      {
        code: error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR',
        message:
          error.code === 'ECONNABORTED'
            ? 'That took too long. Check your connection and try again.'
            : 'We could not reach TrustPay. Check your connection and try again.',
      },
      status ?? 0,
    );
  },
);

/** Idempotency keys for financial mutations (spec section 14). */
export function newIdempotencyKey(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
