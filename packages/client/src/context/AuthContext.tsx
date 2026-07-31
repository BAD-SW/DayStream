import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiClient } from '../api/client';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  tenant_id?: string;
  business_id?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  featureFlags: Record<string, boolean>;
  login: (tenantId: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});

  // Load feature flags
  async function loadFeatureFlags() {
    try {
      const res = await apiClient.get('/v1/admin/feature-flags');
      setFeatureFlags(res.data.data || {});
    } catch {
      // Flags are non-critical — silently fail
    }
  }

  // On mount, check if we have a stored token and try to use it
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          setUser({
            id: payload.sub,
            email: '',
            first_name: '',
            last_name: '',
            role: payload.role || '',
            tenant_id: payload.tid || undefined,
            business_id: localStorage.getItem('business_id') || undefined,
          });
          loadFeatureFlags();
        } else {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('business_id');
        }
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('business_id');
      }
    }
    setIsLoading(false);
  }, []);

  async function login(tenantId: string, email: string, password: string) {
    const res = await apiClient.post('/v1/auth/login', {
      tenant_id: tenantId,
      email,
      password,
    });

    const { access_token, refresh_token, user: userData } = res.data.data;
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
    if (userData.business_id) {
      localStorage.setItem('business_id', userData.business_id);
      // Fetch and store business currency
      try {
        const bizRes = await apiClient.get('/v1/admin/businesses');
        const biz = bizRes.data.data?.find((b: any) => b.id === userData.business_id);
        if (biz?.currency) localStorage.setItem('business_currency', biz.currency);
      } catch { /* non-critical */ }
    }
    setUser(userData);
    await loadFeatureFlags();
  }

  function logout() {
    const refreshToken = localStorage.getItem('refresh_token');
    if (refreshToken) {
      apiClient.post('/v1/auth/logout', { refresh_token: refreshToken }).catch(() => {});
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('business_id');
    localStorage.removeItem('business_currency');
    sessionStorage.removeItem('redirectAfterLogin');
    setUser(null);
    setFeatureFlags({});
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, featureFlags, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
