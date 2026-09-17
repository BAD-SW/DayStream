import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActiveContext, SwitchableContext, ContextSwitchAuditEntry, ContextLevel } from '@daystream/shared';
import { useAuth } from './AuthContext';
import { apiClient, contextRef, flushInitQueue } from '../api/client';

const STORAGE_KEY = 'ds_active_context';
const PLATFORM_DISPLAY_NAME = 'DayStream Platform';

export type Persona = 'system' | 'tenant' | 'business' | 'customer';

interface MinimalUser {
  role: string;
  tenant_id?: string;
  business_id?: string;
}

/** Resolves the coarse persona bucket from a raw role string, including legacy display-format role names. */
export function resolvePersona(role: string): Persona {
  if (role === 'system_admin' || role === 'system_support' || role === 'Super Admin') return 'system';
  if (role === 'tenant_owner' || role === 'tenant_manager') return 'tenant';
  if (role === 'customer') return 'customer';
  return 'business';
}

/** Client-side permission approximation by role, mirroring server-assigned role permissions. */
export function getPermissionsFromRole(role: string): string[] {
  switch (role) {
    case 'system_admin': case 'system_support': case 'Super Admin': return ['*:*'];
    case 'tenant_owner': return ['*:*'];
    case 'tenant_manager': return ['reports:read', 'settings:*'];
    case 'business_owner': return ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'];
    case 'business_manager': case 'manager': return ['services:read', 'bookings:*', 'staff:read', 'reports:read', 'customers:*'];
    case 'business_staff': return ['bookings:read', 'bookings:update', 'customers:read'];
    case 'customer': return ['bookings:read', 'bookings:create'];
    default: return ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'];
  }
}

function personaDefaultContext(user: MinimalUser | null): ActiveContext {
  if (!user) {
    return { contextLevel: 'system', tenantId: null, businessId: null, displayName: PLATFORM_DISPLAY_NAME };
  }
  const persona = resolvePersona(user.role);
  if (persona === 'system') {
    return { contextLevel: 'system', tenantId: null, businessId: null, displayName: PLATFORM_DISPLAY_NAME };
  }
  if (persona === 'tenant') {
    return { contextLevel: 'tenant', tenantId: user.tenant_id ?? null, businessId: null, displayName: '' };
  }
  // business or customer persona
  return { contextLevel: 'business', tenantId: user.tenant_id ?? null, businessId: user.business_id ?? null, displayName: '' };
}

function readStoredContext(): ActiveContext | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!['system', 'tenant', 'business'].includes(parsed.contextLevel)) return null;
    return parsed as ActiveContext;
  } catch {
    return null;
  }
}

function persistContext(ctx: ActiveContext): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    // Private browsing / quota exceeded — non-fatal, context just won't survive a refresh
  }
}

function clearStoredContext(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function buildContextFromTarget(target: SwitchableContext, prev: ActiveContext): ActiveContext {
  if (target.type === 'system') {
    return { contextLevel: 'system', tenantId: null, businessId: null, displayName: PLATFORM_DISPLAY_NAME };
  }
  if (target.type === 'tenant') {
    return { contextLevel: 'tenant', tenantId: target.id, businessId: null, displayName: target.displayName, logoUrl: target.logoUrl };
  }
  return {
    contextLevel: 'business',
    tenantId: target.parentId ?? prev.tenantId,
    businessId: target.id,
    displayName: target.displayName,
    logoUrl: target.logoUrl,
    // The tenant name isn't carried on a business SwitchableContext entry — reuse whatever
    // we already knew from the level we were switching from (tenant level names itself;
    // business level already carries the same parent tenant forward).
    tenantDisplayName: prev.contextLevel === 'tenant' ? prev.displayName : prev.tenantDisplayName,
  };
}

// Module-level audit trail, capped at 100 entries; exposed for debugging in development.
const contextSwitchAuditLog: ContextSwitchAuditEntry[] = [];
if (typeof window !== 'undefined' && (import.meta as any).env?.DEV) {
  (window as any).__ds_context_audit = contextSwitchAuditLog;
}
function recordAuditEntry(userId: string, previousContext: ActiveContext, newContext: ActiveContext): void {
  contextSwitchAuditLog.push({ timestamp: new Date().toISOString(), userId, previousContext, newContext });
  if (contextSwitchAuditLog.length > 100) contextSwitchAuditLog.shift();
}

/**
 * Fetches the caller's own tenant/business display names (and business logo/theme info). Used
 * to label the initial default context (before any switch has occurred) and to fill in the
 * breadcrumb's tenant-name segment, which isn't otherwise carried on a business-level
 * SwitchableContext entry.
 *
 * logoUrl is read from `data.business.logo_url` — the server's `/v1/admin/my-context` response
 * already includes it (see packages/server/src/routes/admin.ts), it just wasn't being consumed
 * here. Without it, a business/customer persona's ActiveContext never gets a logoUrl on initial
 * load (buildContextFromTarget only runs on an explicit switch, a path business/customer users
 * can't reach — the switcher is non-interactive for them), so an uploaded business logo had no
 * way to reach the header at all.
 */
async function fetchContextNames(ctx: ActiveContext): Promise<{ tenantName?: string; businessName?: string; primaryColor?: string; logoUrl?: string }> {
  if (ctx.contextLevel === 'system') return {};
  try {
    const params = ctx.businessId ? { business_id: ctx.businessId } : undefined;
    const res = await apiClient.get('/v1/admin/my-context', { params });
    const data = res.data.data;
    return {
      tenantName: data.tenant?.name,
      businessName: data.business?.name,
      primaryColor: data.business?.primary_color || undefined,
      logoUrl: data.business?.logo_url || undefined,
    };
  } catch {
    return {};
  }
}

async function fetchAccessibleContexts(persona: Persona, ctx: ActiveContext): Promise<SwitchableContext[]> {
  if (persona === 'business' || persona === 'customer') return [];

  if (persona === 'tenant') {
    const res = await apiClient.get('/v1/admin/businesses');
    return (res.data.data || []).map((b: any): SwitchableContext => ({
      id: b.id,
      type: 'business',
      displayName: b.name,
      parentId: ctx.tenantId ?? undefined,
    }));
  }

  // system persona
  const tenantsRes = await apiClient.get('/v1/admin/tenants');
  const tenants: SwitchableContext[] = (tenantsRes.data.data || []).map((t: any): SwitchableContext => ({
    id: t.id,
    type: 'tenant',
    displayName: t.name,
  }));

  if (ctx.tenantId) {
    const bizRes = await apiClient.get('/v1/admin/businesses');
    const businesses: SwitchableContext[] = (bizRes.data.data || []).map((b: any): SwitchableContext => ({
      id: b.id,
      type: 'business',
      displayName: b.name,
      parentId: ctx.tenantId ?? undefined,
    }));
    return [...tenants, ...businesses];
  }

  return tenants;
}

interface ContextManagerState {
  activeContext: ActiveContext;
  accessibleContexts: SwitchableContext[];
  accessibleContextsError: boolean;
  isSwitching: boolean;
  isInitialising: boolean;
  persona: Persona;
  switchContext: (target: SwitchableContext) => Promise<void>;
  resetToPersonaDefault: () => void;
}

const ContextManagerContext = createContext<ContextManagerState | undefined>(undefined);

export function ContextProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const persona = resolvePersona(user?.role || '');
  const [activeContext, setActiveContext] = useState<ActiveContext>(() => personaDefaultContext(user));
  const [accessibleContexts, setAccessibleContexts] = useState<SwitchableContext[]>([]);
  const [accessibleContextsError, setAccessibleContextsError] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isInitialising, setIsInitialising] = useState(true);
  const initedForUserId = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Logged out / never logged in — clear any persisted context, unblock any queued requests.
      clearStoredContext();
      const empty: ActiveContext = { contextLevel: 'system', tenantId: null, businessId: null, displayName: PLATFORM_DISPLAY_NAME };
      setActiveContext(empty);
      contextRef.current = empty;
      flushInitQueue();
      setIsInitialising(false);
      initedForUserId.current = null;
      return;
    }

    if (initedForUserId.current === user.id) return;
    initedForUserId.current = user.id;

    let cancelled = false;

    async function init() {
      const defaultCtx = personaDefaultContext(user);
      const stored = readStoredContext();

      // Resolve scope identifiers synchronously first so requests are never queued
      // waiting on network round-trips that aren't required to determine tenant/business ids.
      const optimistic = stored && stored.contextLevel !== 'system' ? stored : defaultCtx;
      setActiveContext(optimistic);
      contextRef.current = optimistic;
      flushInitQueue();
      setIsInitialising(false);

      // Background refinement: validate any stored context against the real accessible list,
      // and fill in the human-readable display name.
      try {
        let resolved = defaultCtx;

        if (stored && stored.contextLevel !== defaultCtx.contextLevel) {
          // A prior switch is recorded — validate it before trusting it.
          if (persona === 'system' && stored.contextLevel === 'tenant' && stored.tenantId) {
            const tenants = await fetchAccessibleContexts('system', { ...defaultCtx });
            const match = tenants.find((t) => t.type === 'tenant' && t.id === stored.tenantId);
            if (match) resolved = { ...stored, displayName: match.displayName };
          } else if (persona === 'system' && stored.contextLevel === 'business' && stored.tenantId && stored.businessId) {
            const withTenant = { ...defaultCtx, tenantId: stored.tenantId };
            contextRef.current = withTenant; // scope the lookup to the stored tenant
            const businesses = await fetchAccessibleContexts('system', withTenant);
            const match = businesses.find((b) => b.type === 'business' && b.id === stored.businessId);
            if (match) resolved = { ...stored, displayName: match.displayName };
          } else if (persona === 'tenant' && stored.contextLevel === 'business' && stored.businessId) {
            const businesses = await fetchAccessibleContexts('tenant', defaultCtx);
            const match = businesses.find((b) => b.type === 'business' && b.id === stored.businessId);
            if (match) resolved = { ...stored, displayName: match.displayName };
          }
          // Anything else (mismatched persona/level combination) discards the stored value.
        } else if (stored) {
          resolved = stored;
        }

        // Also re-fetch when logoUrl is missing, not just when displayName/tenantDisplayName are —
        // a context cached in sessionStorage from before logoUrl was plumbed through here would
        // otherwise never pick up a business's uploaded logo without a full sessionStorage clear.
        if (resolved.contextLevel !== 'system' && (!resolved.displayName || !resolved.tenantDisplayName || !resolved.logoUrl)) {
          const { tenantName, businessName, logoUrl } = await fetchContextNames(resolved);
          const fallbackName = resolved.contextLevel === 'business' ? 'Business' : 'Organization';
          resolved = {
            ...resolved,
            displayName: resolved.displayName || (resolved.contextLevel === 'business' ? businessName : tenantName) || fallbackName,
            tenantDisplayName: resolved.tenantDisplayName || tenantName,
            logoUrl: resolved.logoUrl || logoUrl,
          };
        }

        if (cancelled) return;
        setActiveContext(resolved);
        contextRef.current = resolved;
        persistContext(resolved);

        const accessible = await fetchAccessibleContexts(persona, resolved);
        if (cancelled) return;
        setAccessibleContexts(accessible);
        setAccessibleContextsError(false);
      } catch {
        if (cancelled) return;
        setAccessibleContextsError(true);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [authLoading, user, persona]);

  async function switchContext(target: SwitchableContext): Promise<void> {
    const isHomeReturn = target.type === 'system' && persona === 'system';
    const isListed = accessibleContexts.some((c) => c.type === target.type && c.id === target.id);

    if (!isHomeReturn && !isListed) {
      // eslint-disable-next-line no-console
      console.warn(`[ContextManager] WARN: attempted switch to unlisted target ${target.id}`);
      return Promise.reject(new Error('INVALID_CONTEXT_TARGET'));
    }

    const prev = activeContext;
    setIsSwitching(true);
    try {
      const next = buildContextFromTarget(target, prev);
      setActiveContext(next);
      contextRef.current = next;
      persistContext(next);
      if (user) recordAuditEntry(user.id, prev, next);

      const accessible = await fetchAccessibleContexts(persona, next);
      setAccessibleContexts(accessible);
      setAccessibleContextsError(false);

      navigate('/dashboard');
    } catch (err) {
      setActiveContext(prev);
      contextRef.current = prev;
      persistContext(prev);
      throw err;
    } finally {
      setIsSwitching(false);
    }
  }

  function resetToPersonaDefault(): void {
    const def = personaDefaultContext(user);
    setActiveContext(def);
    contextRef.current = def;
    persistContext(def);
  }

  const value: ContextManagerState = {
    activeContext,
    accessibleContexts,
    accessibleContextsError,
    isSwitching,
    isInitialising,
    persona,
    switchContext,
    resetToPersonaDefault,
  };

  return (
    <ContextManagerContext.Provider value={value}>
      {children}
    </ContextManagerContext.Provider>
  );
}

export function useContextManager(): ContextManagerState {
  const ctx = useContext(ContextManagerContext);
  if (!ctx) throw new Error('useContextManager must be used within a ContextProvider');
  return ctx;
}

export type { ActiveContext, SwitchableContext, ContextLevel };
