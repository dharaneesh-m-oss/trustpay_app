/**
 * The balance lock.
 *
 * Balances stay hidden until the person proves it is them — Face ID or a
 * fingerprint where the device supports it, a PIN where it does not.
 *
 * **What this does and does not protect.** This is a *local* gate. It stops
 * someone who picks up an unlocked phone from reading the balance over your
 * shoulder, and it re-locks when the app goes to the background. It is not an
 * API-level control: the server still returns balances to any request carrying
 * a valid access token. Treating it as more than a display lock would be a
 * mistake, so it is written down here rather than implied.
 *
 * The PIN is never stored. What is stored is a salted SHA-256 digest of it, in
 * the OS keystore, and the comparison is done over digests.
 */

import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

import { secureGet, secureRemove, secureSet } from './storage';

const PIN_HASH_KEY = 'trustpay.balance_pin_hash';
const PIN_SALT_KEY = 'trustpay.balance_pin_salt';

export const PIN_LENGTH = 4;

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export type LockCapability = {
  /** The device has biometric hardware AND something enrolled on it. */
  biometricsAvailable: boolean;
  kind: BiometricKind;
  /** A human label for the button: "Use Face ID", "Use fingerprint". */
  label: string;
  /** The user has already chosen a PIN. */
  pinSet: boolean;
};

/* ────────────────────────────────────────────────────────────── biometrics */

export async function describeCapability(): Promise<LockCapability> {
  const pinSet = await hasPin();

  // Web has no LocalAuthentication; asking would throw rather than return false.
  if (Platform.OS === 'web') {
    return {
      biometricsAvailable: false,
      kind: 'none',
      label: 'Use PIN',
      pinSet,
    };
  }

  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    // Hardware alone is not enough — a phone with a fingerprint reader and no
    // finger enrolled would fail the prompt every time.
    const available = hasHardware && enrolled;

    let kind: BiometricKind = 'none';
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      kind = 'face';
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      kind = 'fingerprint';
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      kind = 'iris';
    }

    const labels: Record<BiometricKind, string> = {
      face: Platform.OS === 'ios' ? 'Use Face ID' : 'Use face unlock',
      fingerprint: Platform.OS === 'ios' ? 'Use Touch ID' : 'Use fingerprint',
      iris: 'Use iris unlock',
      none: 'Use PIN',
    };

    return {
      biometricsAvailable: available,
      kind: available ? kind : 'none',
      label: available ? labels[kind] : 'Use PIN',
      pinSet,
    };
  } catch {
    // A device that refuses to answer is treated as having no biometrics,
    // rather than blocking the balance behind something that cannot run.
    return { biometricsAvailable: false, kind: 'none', label: 'Use PIN', pinSet };
  }
}

export type BiometricResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

export async function authenticateBiometric(): Promise<BiometricResult> {
  if (Platform.OS === 'web') return { ok: false, reason: 'unavailable' };

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Show your TrustPay balance',
      cancelLabel: 'Use PIN instead',
      // Keep the device passcode as a fallback the OS itself handles.
      disableDeviceFallback: false,
    });

    if (result.success) return { ok: true };

    const error = 'error' in result ? result.error : '';
    if (error === 'user_cancel' || error === 'system_cancel' || error === 'app_cancel') {
      return { ok: false, reason: 'cancelled' };
    }
    if (error === 'not_available' || error === 'not_enrolled') {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/* ─────────────────────────────────────────────────────────────────── PIN */

async function digest(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
  );
}

export async function hasPin(): Promise<boolean> {
  return Boolean(await secureGet(PIN_HASH_KEY));
}

export async function setPin(pin: string): Promise<void> {
  if (pin.length !== PIN_LENGTH || !/^\d+$/.test(pin)) {
    throw new Error(`A PIN must be ${PIN_LENGTH} digits.`);
  }

  // A fresh random salt per PIN, so two people choosing 1234 do not share a
  // digest, and so changing the PIN invalidates the old one completely.
  const salt = Array.from(Crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  await secureSet(PIN_SALT_KEY, salt);
  await secureSet(PIN_HASH_KEY, await digest(pin, salt));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [stored, salt] = await Promise.all([
    secureGet(PIN_HASH_KEY),
    secureGet(PIN_SALT_KEY),
  ]);
  if (!stored || !salt) return false;

  const candidate = await digest(pin, salt);

  // Constant-time-ish comparison. The digests are equal length, so this walks
  // every character rather than returning on the first mismatch.
  if (candidate.length !== stored.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ stored.charCodeAt(index);
  }
  return difference === 0;
}

export async function clearPin(): Promise<void> {
  await Promise.all([secureRemove(PIN_HASH_KEY), secureRemove(PIN_SALT_KEY)]);
}
