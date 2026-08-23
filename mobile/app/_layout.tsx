/**
 * Root layout.
 *
 * Owns the providers and the one piece of global routing logic: where an
 * unauthenticated user is allowed to be. Doing this in a single effect keeps
 * every screen free of its own "am I signed in?" check.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError, initBaseUrl } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { ThemeProvider, useTheme } from '@/theme';

import { SplashScreen } from './splash';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Money changes because someone else acted, so a stale balance is worse
      // than a refetch. Short staleness, refetch when the app regains focus.
      staleTime: 15_000,
      retry: (failureCount, error) => {
        // Never retry something the user must fix — a wrong password, a
        // forbidden action, a validation failure.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

function RootNavigator() {
  const { colors, isDark } = useTheme();
  const { isAuthenticated, isRestoring, restore } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    // The backend address is a stored setting, and every request below depends
    // on it — including the token refresh inside restore(). Load it first.
    initBaseUrl().finally(() => restore());
  }, [restore]);

  useEffect(() => {
    if (isRestoring || !splashDone) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isPublic = inAuthGroup || segments[0] === 'server';

    if (!isAuthenticated && !isPublic) {
      router.replace('/(auth)/welcome');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)/home');
    }
  }, [isAuthenticated, isRestoring, splashDone, segments, router]);

  if (!splashDone || isRestoring) {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="project/[id]"
          options={{ presentation: 'card' }}
        />
        <Stack.Screen name="milestone/[id]" />
        <Stack.Screen
          name="wallet/add-money"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="wallet/withdraw"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="wallet/cards" />
        <Stack.Screen name="project/create" />
        <Stack.Screen name="cancellation/[id]" />
        <Stack.Screen name="dispute/[id]" />
        <Stack.Screen name="trust-score" />
        <Stack.Screen name="assistant" />
        <Stack.Screen name="server" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <RootNavigator />
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
