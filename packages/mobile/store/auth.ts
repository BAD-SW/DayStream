import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '@/services/client';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  tenantId: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkStoredTokens: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const res = await apiClient.post('/v1/auth/login', { email, password });
    const { access_token, refresh_token, user } = res.data.data;

    await SecureStore.setItemAsync('access_token', access_token);
    await SecureStore.setItemAsync('refresh_token', refresh_token);

    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('refresh_token');
    set({ user: null, isAuthenticated: false });
  },

  checkStoredTokens: async () => {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) { set({ isLoading: false }); return; }

      // Validate token by fetching profile
      const res = await apiClient.get('/v1/profile');
      set({ user: res.data.data, isAuthenticated: true, isLoading: false });
    } catch {
      await SecureStore.deleteItemAsync('access_token');
      await SecureStore.deleteItemAsync('refresh_token');
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  setUser: (user) => set({ user }),
}));
