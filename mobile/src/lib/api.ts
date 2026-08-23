/**
 * API client.
 *
 * Two things matter here beyond plumbing:
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

import {
  defaultServerUrl,
  loadSavedServerUrl,
  saveServerUrl,
} from './server-config';
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

/**
 * Where the API lives.
 *
 * This used to be resolved once, at module load, from a build-time constant.
 * It is now owned by `server-config`, which can change it while the app is
 * running — see the reasoning there. `api.defaults.baseURL` is the single
 * source of truth, so everything below reads it rather than closing over a
 * value captured at import time.
 */
/** The current base URL. Read it through `getBaseUrl()`, never cache it. */
export function getBaseUrl(): string {
  return api.defaults.baseURL ?? defaultServerUrl();
}

/** Point the client at a different backend, for the rest of this launch. */
export function setBaseUrl(url: string): void {
  api.defaults.baseURL = url;
}

/** Point the client at a different backend and remember it across launches. */
export async function persistBaseUrl(url: string): Promise<void> {
  setBaseUrl(url);
  await saveServerUrl(url);
}

/**
 * Restore the saved address, if there is one. Called once during startup,
 * before any query runs.
 */
export async function initBaseUrl(): Promise<string> {
  const saved = await loadSavedServerUrl();
  if (saved) setBaseUrl(saved);
  return getBaseUrl();
}

let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

export const api: AxiosInstance = axios.create({
  baseURL: defaultServerUrl(),
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
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
    // A bare axios call, not `api` — going through the instance would recurse
    // straight back into this interceptor.
    const response = await axios.post(
      `${getBaseUrl()}/auth/refresh`,
      { refresh_token: refreshToken },
      { timeout: 15000 },
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
