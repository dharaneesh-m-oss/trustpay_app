/**
 * Balance lock state.
 *
 * Unlocked is a deliberately fragile state: it expires on a timer, and it is
 * dropped the moment the app leaves the foreground. A balance that stays
 * revealed after you put the phone down is not locked in any meaningful sense.
 */

import { AppState, AppStateStatus } from 'react-native';
import { create } from 'zustand';

import {
  authenticateBiometric,
  describeCapability,
  hasPin,
  type LockCapability,
} from '@/lib/balance-lock';

/** How long a successful unlock lasts. */
const UNLOCK_TTL_MS = 60_000;

type UnlockOutcome =
  | { status: 'unlocked' }
  | { status: 'needs-pin' }
  | { status: 'needs-pin-setup' }
  | { status: 'cancelled' };

type BalanceLockState = {
  unlocked: boolean;
  capability: LockCapability | null;
  /** True while a biometric prompt is on screen, so the UI can show progress. */
  checking: boolean;

  refreshCapability: () => Promise<LockCapability>;
  /** Try biometrics; tell the caller if it needs to fall back to a PIN. */
  requestUnlock: () => Promise<UnlockOutcome>;
  /** Called after a PIN was verified, or a biometric prompt succeeded. */
  markUnlocked: () => void;
  lock: () => void;
};

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

export const useBalanceLock = create<BalanceLockState>((set, get) => ({
  unlocked: false,
  capability: null,
  checking: false,

  async refreshCapability() {
    const capability = await describeCapability();
    set({ capability });
    return capability;
  },

  async requestUnlock() {
    if (get().unlocked) return { status: 'unlocked' };

    set({ checking: true });
    try {
      const capability = get().capability ?? (await get().refreshCapability());

      if (capability.biometricsAvailable) {
        const result = await authenticateBiometric();
        if (result.ok) {
          get().markUnlocked();
          return { status: 'unlocked' };
        }
        // "Cancelled" on the biometric sheet usually means the person tapped
        // "Use PIN instead", so offer the PIN rather than treating it as a
        // refusal — unless there is no PIN yet, in which case set one up.
        if (result.reason === 'cancelled' || result.reason === 'unavailable') {
          return {
            status: (await hasPin()) ? 'needs-pin' : 'needs-pin-setup',
          };
        }
        return { status: 'cancelled' };
      }

      return { status: (await hasPin()) ? 'needs-pin' : 'needs-pin-setup' };
    } finally {
      set({ checking: false });
    }
  },

  markUnlocked() {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      useBalanceLock.setState({ unlocked: false });
    }, UNLOCK_TTL_MS);

    set({ unlocked: true });
  },

  lock() {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    set({ unlocked: false });
  },
}));

/**
 * Re-lock whenever the app is not in the foreground.
 *
 * Registered once at module load rather than in a component, so it holds even
 * while no balance screen is mounted.
 */
AppState.addEventListener('change', (status: AppStateStatus) => {
  if (status !== 'active') {
    useBalanceLock.getState().lock();
  }
});
