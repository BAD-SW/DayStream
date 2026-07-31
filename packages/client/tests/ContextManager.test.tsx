import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ContextProvider, useContextManager } from '../src/context/ContextManager';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockUser: any = null;
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: false,
    isAuthenticated: !!mockUser,
    featureFlags: {},
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const apiGet = vi.fn();
vi.mock('../src/api/client', () => ({
  apiClient: { get: (...args: any[]) => apiGet(...args) },
  contextRef: { current: null },
  flushInitQueue: vi.fn(),
}));

function TestConsumer() {
  const ctx = useContextManager();
  return (
    <div>
      <span data-testid="level">{ctx.activeContext.contextLevel}</span>
      <span data-testid="business-id">{ctx.activeContext.businessId ?? ''}</span>
      <span data-testid="accessible-count">{ctx.accessibleContexts.length}</span>
      <button onClick={() => { ctx.switchContext({ id: 'unlisted', type: 'business', displayName: 'Nope' }).catch(() => {}); }}>
        switch-invalid
      </button>
      <button onClick={() => { ctx.switchContext({ id: 'biz1', type: 'business', displayName: 'Test Biz', parentId: 't1' }).catch(() => {}); }}>
        switch-valid
      </button>
    </div>
  );
}

describe('ContextProvider', () => {
  beforeEach(() => {
    apiGet.mockReset();
    mockNavigate.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    // Note: __ds_context_audit is bound once at module load to the real internal audit
    // array, so it's read (not reset) here — tests assert on the *delta* in its length.
  });

  it('business persona always has an empty accessible contexts list, and never calls the tenants/businesses endpoints', async () => {
    mockUser = { id: 'u1', role: 'business_owner', tenant_id: 't1', business_id: 'b1' };
    render(<ContextProvider><TestConsumer /></ContextProvider>);

    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('business'));
    expect(screen.getByTestId('accessible-count').textContent).toBe('0');
    expect(apiGet).not.toHaveBeenCalledWith('/v1/admin/tenants');
    expect(apiGet).not.toHaveBeenCalledWith('/v1/admin/businesses');
  });

  it('rejects a switch to a target not in the accessible contexts list, leaving activeContext unchanged', async () => {
    mockUser = { id: 'u1', role: 'business_owner', tenant_id: 't1', business_id: 'b1' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ContextProvider><TestConsumer /></ContextProvider>);

    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('business'));
    await act(async () => {
      screen.getByText('switch-invalid').click();
    });

    expect(screen.getByTestId('level').textContent).toBe('business');
    expect(screen.getByTestId('business-id').textContent).toBe('b1');
    expect(warnSpy).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('persists a successful switch to sessionStorage, records an audit entry, and leaves the JWT untouched', async () => {
    mockUser = { id: 'u1', role: 'tenant_owner', tenant_id: 't1' };
    localStorage.setItem('access_token', 'unchanged-token');

    apiGet.mockImplementation((url: string) => {
      if (url === '/v1/admin/my-context') {
        return Promise.resolve({ data: { data: { tenant: { id: 't1', name: 'Transcend Health' }, business: null } } });
      }
      if (url === '/v1/admin/businesses') {
        return Promise.resolve({ data: { data: [{ id: 'biz1', name: 'Test Biz' }] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    render(<ContextProvider><TestConsumer /></ContextProvider>);

    await waitFor(() => expect(screen.getByTestId('accessible-count').textContent).toBe('1'));

    const tokenBefore = localStorage.getItem('access_token');
    const auditLengthBefore = (window as any).__ds_context_audit.length;

    await act(async () => {
      screen.getByText('switch-valid').click();
    });

    await waitFor(() => expect(screen.getByTestId('business-id').textContent).toBe('biz1'));
    expect(screen.getByTestId('level').textContent).toBe('business');

    const stored = JSON.parse(sessionStorage.getItem('ds_active_context') || 'null');
    expect(stored).toMatchObject({ contextLevel: 'business', businessId: 'biz1', tenantId: 't1', displayName: 'Test Biz' });

    expect((window as any).__ds_context_audit.length).toBe(auditLengthBefore + 1);
    expect(localStorage.getItem('access_token')).toBe(tokenBefore);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });
});
