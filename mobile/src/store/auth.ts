/**
 * Authentication state.
 *
 * Holds the signed-in user and nothing else about them — no balances, no
 * project data. Those live in TanStack Query, where they can be refetched and
 * invalidated. Caching money in a global store is how a UI ends up confidently
 * showing a number that stopped being true.
 */

import { create } from 'zustand';

import { api, setSessionExpiredHandler } from '@/lib/api';
import { tokenStorage } from '@/lib/storage';

export type User = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: 'USER' | 'ADMIN' | 'SUPPORT';
  status: string;
  created_at: string;
};

type AuthState = {
  user: User | null;
  /** True until the stored session has been checked on launch. */
  isRestoring: boolean;
  isAuthenticated: boolean;

  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: {
    full_name: string;
    email: string;
    password: string;
    phone?: string;
  }) => Promise<void>;
  signOut: (allSessions?: boolean) => Promise<void>;
  setUser: (user: User) => void;
};

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  isRestoring: true,
  isAuthenticated: false,

  async restore() {
    const token = await tokenStorage.getAccessToken();
    if (!token) {
      set({ isRestoring: false, isAuthenticated: false, user: null });
      return;
    }

    try {
      const { data } = await api.get<User>('/users/me');
      set({ user: data, isAuthenticated: true, isRestoring: false });
    } catch {
      // The stored token is dead and refresh did not save it.
      await tokenStorage.clear();
      set({ user: null, isAuthenticated: false, isRestoring: false });
    }
  },

  async signIn(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    await tokenStorage.setTokens(data.access_token, data.refresh_token);
    set({ user: data.user, isAuthenticated: true });
  },

  async register(input) {
    await api.post('/users/register', input);
    // Registering signs you straight in; making someone type the password they
    // just chose is friction with no security benefit.
    await get().signIn(input.email, input.password);
  },

  async signOut(allSessions = false) {
    const refreshToken = await tokenStorage.getRefreshToken();
    try {
      await api.post('/auth/logout', {
        refresh_token: refreshToken,
        all_sessions: allSessions,
      });
    } catch {
      // Even if the call fails, the local session must go.
    }
    await tokenStorage.clear();
    set({ user: null, isAuthenticated: false });
  },

  setUser(user) {
    set({ user });
  },
}));

// When a refresh finally fails, drop the session so the router sends the user
// to sign-in rather than leaving them on a screen that can no longer load.
setSessionExpiredHandler(() => {
  useAuth.setState({ user: null, isAuthenticated: false });
});
