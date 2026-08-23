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
export const LIVE_API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

export function hasLiveBackend(): boolean {
  return Boolean(LIVE_API_URL);
}

export function defaultMode(): AppMode {
  return hasLiveBackend() ? 'live' : 'demo';
}

export async function loadMode(): Promise<AppMode> {
  try {
    const saved = await secureGet(MODE_KEY);
    if (saved === 'live' && hasLiveBackend()) return 'live';
    if (saved === 'demo') return 'demo';
  } catch {
    // An unreadable preference is not worth failing a launch over.
  }
  return defaultMode();
}

export async function saveMode(mode: AppMode): Promise<void> {
  await secureSet(MODE_KEY, mode);
}
