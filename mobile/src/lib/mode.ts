/**
 * Live or demo.
 *
 * The app can run two ways and the difference is not cosmetic, so it is a
 * declared mode rather than a silent fallback:
 *
 *   - **Live** talks to the deployed TrustPay server. Accounts are real, the
 *     other party is a different person on a different phone, and money moves
 *     through a payment provider.
 *   - **Demo** runs the on-device engine in `src/local`. Nothing leaves the
 *     phone, nothing is authoritative, and the escrow is simulated.
 *
 * Falling back from live to demo automatically would be the worst of both: a
 * user whose network dropped would keep tapping, see balances change, and
 * believe money moved. So a failed request in live mode fails, loudly, and only
 * an explicit choice changes mode.
 *
 * The server address is a stored setting rather than a build-time constant.
 * Baking it in means a new APK every time the deployment moves - which, on a
 * free host with a generated subdomain, is every time it is recreated. The
 * build-time value is only ever a default.
 */

import { secureGet, secureSet } from './storage';

export type AppMode = 'live' | 'demo';

const MODE_KEY = 'trustpay.mode';

/**
 * Where the deployed server lives.
 *
 * Set at build time. When it is absent the build simply has no server to talk
 * to, so demo is the only honest default.
 */
const SERVER_KEY = 'trustpay.server_url';

/** The address this build was compiled with, if any. Only ever a default. */
export const BUILT_IN_API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

/** The address in use this launch: the saved one, else the built-in one. */
let activeServerUrl = BUILT_IN_API_URL;

export function serverUrl(): string {
  return activeServerUrl;
}

export function hasLiveBackend(): boolean {
  return Boolean(activeServerUrl);
}

export function defaultMode(): AppMode {
  return hasLiveBackend() ? 'live' : 'demo';
}

/**
 * Turn what someone typed into a usable base URL.
 *
 * People paste `trustpay-api.onrender.com`, not
 * `https://trustpay-api.onrender.com/api/v1`, and asking for the latter on a
 * phone keyboard invites a typo that looks identical to a dead server. So a
 * bare host is filled out and anything already complete is left alone.
 *
 * Returns null when the input cannot be salvaged.
 */
export function normaliseServerUrl(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  // A hosted API is https. Defaulting to http would send a password in clear
  // text to anyone who mistypes the scheme.
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!url.hostname || !url.hostname.includes('.')) return null;

  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/api/v1')) path = `${path}/api/v1`;

  return `${url.origin}${path}`;
}

/** The /health endpoint, which sits outside the versioned prefix. */
export function healthUrl(base: string): string {
  try {
    return `${new URL(base).origin}/health`;
  } catch {
    return `${base}/health`;
  }
}

export async function loadSavedServerUrl(): Promise<string | null> {
  try {
    return await secureGet(SERVER_KEY);
  } catch {
    return null;
  }
}

export async function saveServerUrl(url: string): Promise<void> {
  activeServerUrl = url;
  await secureSet(SERVER_KEY, url);
}

export async function loadMode(): Promise<AppMode> {
  const saved = await loadSavedServerUrl();
  if (saved) activeServerUrl = saved;

  try {
    const savedMode = await secureGet(MODE_KEY);
    if (savedMode === 'live' && hasLiveBackend()) return 'live';
    if (savedMode === 'demo') return 'demo';
  } catch {
    // An unreadable preference is not worth failing a launch over.
  }
  return defaultMode();
}

export async function saveMode(mode: AppMode): Promise<void> {
  await secureSet(MODE_KEY, mode);
}

export type ProbeResult =
  | { ok: true; status: string; database: string; environment: string }
  | { ok: false; reason: string };

/**
 * Ask a candidate address whether it is actually TrustPay.
 *
 * Checks the response body rather than settling for any HTTP 200: a captive
 * portal, a parked domain or someone else's server will all answer happily, and
 * "connected to the wrong thing" is worse to debug than "connected to nothing".
 *
 * The timeout is generous because a free host that has gone to sleep takes the
 * better part of a minute to answer its first request, and calling that a
 * failure would send someone hunting a problem that fixes itself.
 */
export async function probeServer(
  base: string,
  timeoutMs = 65000,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(healthUrl(base), { signal: controller.signal });
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
    if (body.database && body.database !== 'up') {
      return {
        ok: false,
        reason:
          'TrustPay is running but cannot reach its database, so signing in ' +
          'would fail. Check DATABASE_URL on the host.',
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
        ? 'No answer within a minute. Check the address, and that the server is running.'
        : 'Could not reach that address.',
    };
  } finally {
    clearTimeout(timer);
  }
}
