import axios from 'axios';
import { ActiveContext } from '@daystream/shared';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// --- Context Switcher integration ---
//
// `contextRef` is a plain module-level object (not a React ref) so this interceptor
// can read the active context without a hook. It is `null` until ContextManager has
// resolved the active context for the current session; while null, outbound requests
// are queued rather than dispatched with missing scope identifiers (Requirement 7.5).
export const contextRef: { current: ActiveContext | null } = { current: null };

const MAX_QUEUED_REQUESTS = 20;
let initQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

/** Called by ContextManager once the active context has been resolved. */
export function flushInitQueue(): void {
  const queued = initQueue;
  initQueue = [];
  queued.forEach(({ resolve }) => resolve());
}

function waitForContextInit(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (initQueue.length >= MAX_QUEUED_REQUESTS) {
      reject(Object.assign(new Error('Context initialisation timed out'), { code: 'CONTEXT_INIT_TIMEOUT' }));
      return;
    }
    initQueue.push({ resolve, reject });
  });
}

function decodeJwtTenantId(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.tid || null;
  } catch {
    return null;
  }
}

// Request interceptor: attach access token + active context scope identifiers
apiClient.interceptors.request.use(async (config) => {
  if (contextRef.current === null) {
    await waitForContextInit();
  }

  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const ctx = contextRef.current;
  if (ctx) {
    if (ctx.businessId) {
      if (!config.params) config.params = {};
      if (config.params.business_id === undefined) {
        config.params.business_id = ctx.businessId;
      }
    }
    if (ctx.tenantId && token) {
      const jwtTenantId = decodeJwtTenantId(token);
      if (jwtTenantId && ctx.tenantId !== jwtTenantId) {
        config.headers['X-Context-Tenant-Id'] = ctx.tenantId;
      }
    }
  }

  return config;
});

// Response interceptor: handle 401, attempt token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const res = await axios.post('/api/v1/auth/refresh', { refresh_token: refreshToken });
        const { access_token, refresh_token: newRefresh } = res.data.data;

        localStorage.setItem('access_token', access_token);
        localStorage.setItem('refresh_token', newRefresh);

        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return apiClient(originalRequest);
      } catch {
        // Refresh failed — redirect to login
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
