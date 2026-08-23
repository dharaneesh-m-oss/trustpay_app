/**
 * Token storage.
 *
 * On a device, tokens go in the OS keystore via expo-secure-store. On web
 * there is no keystore, so they fall back to localStorage — which is why the
 * web build is for development and demonstration, not for production use.
 * Saying that plainly here is better than pretending the two are equivalent.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_KEY = 'trustpay.access_token';
const REFRESH_KEY = 'trustpay.refresh_token';

const isWeb = Platform.OS === 'web';

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** Generic secure storage, used by the balance lock as well as the tokens. */
export const secureSet = setItem;
export const secureGet = getItem;
export const secureRemove = removeItem;

export const tokenStorage = {
  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      setItem(ACCESS_KEY, accessToken),
      setItem(REFRESH_KEY, refreshToken),
    ]);
  },

  getAccessToken(): Promise<string | null> {
    return getItem(ACCESS_KEY);
  },

  getRefreshToken(): Promise<string | null> {
    return getItem(REFRESH_KEY);
  },

  async clear(): Promise<void> {
    await Promise.all([removeItem(ACCESS_KEY), removeItem(REFRESH_KEY)]);
  },
};
