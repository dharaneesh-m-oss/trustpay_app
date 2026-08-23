/**
 * Where the backend lives — decided at runtime, not at build time.
 *
 * The API address used to be compiled into the bundle. That meant a new APK
 * every time the development machine changed IP, which happened four times in
 * one afternoon on a single Wi-Fi network, and the only symptom on the phone
 * was "We could not reach TrustPay". A build that dies when DHCP reassigns a
 * lease is not a build anyone can use.
 *
 * So the address is a setting: resolved at startup, editable on the device,
 * stored there. Resolution order, first hit wins:
 *
 *   1. What the user saved in Server settings — an explicit choice always wins.
 *   2. EXPO_PUBLIC_API_URL, if this build was given one.
 *   3. Metro's host — correct by construction while developing.
 *   4. localhost — simulators and web.
 */

import Constants from 'expo-constants';

import { secureGet, secureRemove, secureSet } from './storage';

const OVERRIDE_KEY = 'trustpay.server_url';

/** The port the FastAPI backend listens on. */
export const API_PORT = 8000;

/** The path every route hangs off. */
export const API_PREFIX = '/api/v1';

/**
 * Turn whatever someone typed into a usable base URL.
 *
 * People type "10.0.0.5", not "http://10.0.0.5:8000/api/v1", and asking them
 * for the latter on a phone keyboard invites a typo that looks identical to a
 * dead server. So a bare host is filled out; anything already complete is left
 * alone.
 *
 * Returns null when the input cannot be salvaged.
 */
export function normaliseServerUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (!url.hostname) return null;

  // A host with no port means the default backend port, not port 80.
  if (!url.port && url.protocol === 'http:') {
    url.port = String(API_PORT);
  }

  // Trailing slashes and a missing prefix are the two common near-misses.
  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith(API_PREFIX)) {
    path = `${path}${API_PREFIX}`;
  }

  return `${url.origin}${path}`;
}

/** The origin of a base URL, for hitting /health which sits outside the prefix. */
export function healthUrl(baseUrl: string): string {
  try {
    return `${new URL(baseUrl).origin}/health`;
  } catch {
    return `${baseUrl}/health`;
  }
}

/** The address Metro is serving this bundle from, which is a machine we can reach. */
function metroHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (
      Constants.manifest2 as
        | { extra?: { expoGo?: { debuggerHost?: string } } }
        | null
    )?.extra?.expoGo?.debuggerHost;

  const host = hostUri?.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

/** The build-time default, used until the user saves something of their own. */
export function defaultServerUrl(): string {
  const baked = process.env.EXPO_PUBLIC_API_URL;
  if (baked) return baked;

  const host = metroHost();
  if (host) return `http://${host}:${API_PORT}${API_PREFIX}`;

  return `http://127.0.0.1:${API_PORT}${API_PREFIX}`;
}

/** The saved override, if the user has set one. */
export async function loadSavedServerUrl(): Promise<string | null> {
  try {
    return await secureGet(OVERRIDE_KEY);
  } catch {
    return null;
  }
}

export async function saveServerUrl(url: string): Promise<void> {
  await secureSet(OVERRIDE_KEY, url);
}

export async function clearSavedServerUrl(): Promise<void> {
  await secureRemove(OVERRIDE_KEY);
}

export type ProbeResult =
  | { ok: true; status: string; database: string; environment: string }
  | { ok: false; reason: string };

/**
 * Ask a candidate address whether it is actually TrustPay.
 *
 * This deliberately checks the response body rather than settling for any
 * HTTP 200: a captive portal, a router admin page, or someone else's dev
 * server will all answer happily, and "connected to the wrong thing" is a
 * worse failure to debug than "connected to nothing".
 */
export async function probeServer(
  baseUrl: string,
  timeoutMs = 6000,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(healthUrl(baseUrl), {
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: `The server answered with ${response.status}.` };
    }

    const body = (await response.json()) as {
      status?: string;
      database?: string;
      environment?: string;
    };

    if (!body?.status) {
      return {
        ok: false,
        reason: 'Something answered, but it is not the TrustPay backend.',
      };
    }

    return {
      ok: true,
      status: body.status,
      database: body.database ?? 'unknown',
      environment: body.environment ?? 'unknown',
    };
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    return {
      ok: false,
      reason: aborted
        ? 'No answer within a few seconds. Check the address, and that the phone is on the same Wi-Fi.'
        : 'Could not reach that address.',
    };
  } finally {
    clearTimeout(timer);
  }
}
