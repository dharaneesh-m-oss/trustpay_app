/**
 * The local engine, wearing an axios adapter.
 *
 * Swapping the adapter rather than rewriting the data layer is what makes this
 * change small. Every screen still calls `api.get('/wallet')`, every TanStack
 * query keeps its key and its invalidation, and the error interceptor keeps
 * turning failures into `ApiError` - none of them can tell that the request
 * never left the device.
 *
 * The engine's faults are therefore shaped exactly like the backend's error
 * envelope, because that envelope is what the interceptor above parses.
 */

import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { ApiFault, handle, type LocalRequest } from './engine';

/** Pull the path and query off whatever axios was given. */
function splitUrl(config: InternalAxiosRequestConfig): {
  path: string;
  query: Record<string, string>;
} {
  const raw = config.url ?? '';
  const [rawPath, rawQuery = ''] = raw.split('?');

  const query: Record<string, string> = {};
  for (const pair of rawQuery.split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    query[decodeURIComponent(key)] = decodeURIComponent(value);
  }

  // axios also carries params separately; both are used in this codebase.
  const params = config.params as Record<string, unknown> | undefined;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query[key] = String(value);
    }
  }

  return { path: rawPath.replace(/^\/+/, ''), query };
}

function parseBody(config: InternalAxiosRequestConfig): Record<string, unknown> {
  const { data } = config;
  if (!data) return {};
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof data === 'object') return data as Record<string, unknown>;
  return {};
}

function bearer(config: InternalAxiosRequestConfig): string | null {
  const header = config.headers?.Authorization ?? config.headers?.authorization;
  if (typeof header !== 'string') return null;
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function respond(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosResponse {
  return {
    data,
    status,
    statusText: String(status),
    headers: {},
    config,
  } as AxiosResponse;
}

export const localAdapter: AxiosAdapter = async (config) => {
  const { path, query } = splitUrl(config);

  const request: LocalRequest = {
    method: (config.method ?? 'get').toUpperCase(),
    path,
    query,
    body: parseBody(config),
    token: bearer(config),
  };

  try {
    const result = await handle(request);
    return respond(config, result.status, result.data);
  } catch (caught) {
    const fault =
      caught instanceof ApiFault
        ? caught
        : new ApiFault(
            500,
            'INTERNAL_ERROR',
            // A thrown Error here is a bug in the local engine, not a network
            // problem, and saying "check your connection" would send someone
            // hunting for a network that is not involved.
            caught instanceof Error
              ? caught.message
              : 'Something went wrong on this device.',
          );

    const response = respond(config, fault.status, {
      error: {
        code: fault.code,
        message: fault.message,
        request_id: null,
        details: fault.details,
      },
    });

    // Shaped like an AxiosError so the existing response interceptor reads it
    // the same way it read a real HTTP failure.
    return Promise.reject(
      Object.assign(new Error(fault.message), {
        isAxiosError: true,
        config,
        response,
        toJSON: () => ({ message: fault.message }),
      }),
    );
  }
};
