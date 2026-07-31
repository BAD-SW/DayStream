import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiClient, contextRef, flushInitQueue } from '../src/api/client';

// axios doesn't expose a public API to invoke a registered interceptor directly,
// but the handler functions are reachable via the internal `handlers` array —
// this lets us test the interceptor's scoping logic without a real network call.
function getRequestInterceptor(): (config: any) => any {
  const handlers = (apiClient.interceptors.request as any).handlers;
  return handlers[0].fulfilled;
}

function makeJwt(payload: object): string {
  const b64 = (obj: object) => btoa(JSON.stringify(obj)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('apiClient request interceptor', () => {
  const originalToken = localStorage.getItem('access_token');

  beforeEach(() => {
    contextRef.current = null;
  });

  afterEach(() => {
    if (originalToken) localStorage.setItem('access_token', originalToken);
    else localStorage.removeItem('access_token');
  });

  it('queues requests until the active context is resolved, then dispatches them', async () => {
    contextRef.current = null;
    const interceptor = getRequestInterceptor();
    const pending = interceptor({ params: undefined, headers: {} });

    let resolved = false;
    pending.then(() => { resolved = true; });

    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false);

    contextRef.current = { contextLevel: 'system', tenantId: null, businessId: null, displayName: 'DayStream Platform' };
    flushInitQueue();

    await pending;
    expect(resolved).toBe(true);
  });

  it('attaches business_id as a query param when the active context has one and it is not already set', async () => {
    contextRef.current = { contextLevel: 'business', tenantId: 't1', businessId: 'b1', displayName: 'Biz' };
    const interceptor = getRequestInterceptor();
    const config = await interceptor({ params: undefined, headers: {} });
    expect(config.params.business_id).toBe('b1');
  });

  it('does not overwrite an explicitly provided business_id', async () => {
    contextRef.current = { contextLevel: 'business', tenantId: 't1', businessId: 'b1', displayName: 'Biz' };
    const interceptor = getRequestInterceptor();
    const config = await interceptor({ params: { business_id: 'explicit-id' }, headers: {} });
    expect(config.params.business_id).toBe('explicit-id');
  });

  it('injects X-Context-Tenant-Id when the active tenant differs from the JWT tenant', async () => {
    localStorage.setItem('access_token', makeJwt({ tid: 'jwt-tenant', exp: Math.floor(Date.now() / 1000) + 3600 }));
    contextRef.current = { contextLevel: 'tenant', tenantId: 'other-tenant', businessId: null, displayName: 'Other Org' };
    const interceptor = getRequestInterceptor();
    const config = await interceptor({ params: undefined, headers: {} });
    expect(config.headers['X-Context-Tenant-Id']).toBe('other-tenant');
  });

  it('does not inject X-Context-Tenant-Id when the active tenant matches the JWT tenant', async () => {
    localStorage.setItem('access_token', makeJwt({ tid: 'same-tenant', exp: Math.floor(Date.now() / 1000) + 3600 }));
    contextRef.current = { contextLevel: 'tenant', tenantId: 'same-tenant', businessId: null, displayName: 'My Org' };
    const interceptor = getRequestInterceptor();
    const config = await interceptor({ params: undefined, headers: {} });
    expect(config.headers['X-Context-Tenant-Id']).toBeUndefined();
  });
});
