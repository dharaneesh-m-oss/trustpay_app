/**
 * Theme provider and hook.
 *
 * The app follows the device setting by default and lets the user override it.
 * The override is persisted, because a preference that resets on every launch
 * is not a preference.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import {
  ColorScheme,
  elevation,
  motion,
  radius,
  schemes,
  spacing,
  typography,
} from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

type Theme = {
  colors: ColorScheme;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: typeof elevation;
  motion: typeof motion;
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const STORAGE_KEY = 'trustpay.theme-preference';

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // A missing preference is not an error — fall back to the system scheme.
      });
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  // TrustPay is light-only. The dark identity was dropped at the user's
  // request, so `isDark` is always false and the system scheme is ignored;
  // `preference` is still stored so the setting can be restored later without
  // a migration.
  const isDark = false;

  const value = useMemo<Theme>(
    () => ({
      colors: isDark ? schemes.dark : schemes.light,
      spacing,
      radius,
      typography,
      elevation,
      motion,
      isDark,
      preference,
      setPreference,
    }),
    [isDark, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used inside a ThemeProvider.');
  }
  return theme;
}

export * from './tokens';
