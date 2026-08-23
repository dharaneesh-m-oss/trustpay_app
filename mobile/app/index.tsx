import { Redirect } from 'expo-router';
import React from 'react';

import { useAuth } from '@/store/auth';

/**
 * Entry route.
 *
 * The root layout already decides where an unauthenticated user goes; this
 * exists so `/` resolves to something instead of 404ing before that runs.
 */
export default function Index() {
  const isAuthenticated = useAuth((state) => state.isAuthenticated);
  return <Redirect href={isAuthenticated ? '/(tabs)/home' : '/(auth)/welcome'} />;
}
