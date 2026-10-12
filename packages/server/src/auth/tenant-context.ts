import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './middleware';
import { adminPool } from '../db/pool';
import { accountBlockReason } from '../services/auth.service';

const CONTEXT_TENANT_HEADER = 'x-context-tenant-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who a login is, as far as scope goes. Read from usr_users, never from the request. */
interface CallerScope {
  /** 'system' may look into any tenant; 'tenant' into any business of its tenant; 'business' only into its own. */
  level: 'system' | 'tenant' | 'business';
  tenantId: string | null;
  businessId: string | null;
  /** Set when the account may not be used: deactivated, tenant suspended or business archived. */
  blocked: 'inactive' | 'tenant_suspended' | 'business_archived' | null;
}

const SYSTEM_ROLES = ['system_admin', 'system_support', 'super_admin'];
const TENANT_ROLES = ['tenant_owner', 'tenant_manager'];

// A login's level and business change very rarely, and every request asks: remember them briefly.
const SCOPE_TTL_MS = 30_000;
const scopeCache = new Map<string, { scope: CallerScope; at: number }>();
// Which tenant a business belongs to never changes.
const businessTenantCache = new Map<string, string>();

/** Who a login is, as far as scope goes (level, tenant, business). Briefly cached. */
export async function callerScope(userId: string): Promise<CallerScope | null> {
  const hit = scopeCache.get(userId);
  if (hit && Date.now() - hit.at < SCOPE_TTL_MS) return hit.scope;
  const { rows } = await adminPool.query('SELECT id, status, role, persona, tenant_id, business_id FROM usr_users WHERE id = $1', [userId]);
  if (!rows[0]) return null;
  const role = String(rows[0].role || '').toLowerCase();
  const level: CallerScope['level'] =
    SYSTEM_ROLES.includes(role) || rows[0].persona === 'system' ? 'system'
      : TENANT_ROLES.includes(role) || rows[0].persona === 'tenant' ? 'tenant'
        : 'business';
  const scope: CallerScope = { level, tenantId: rows[0].tenant_id, businessId: rows[0].business_id, blocked: await accountBlockReason(rows[0]) };
  scopeCache.set(userId, { scope, at: Date.now() });
  return scope;
}

async function tenantOfBusiness(businessId: string): Promise<string | null> {
  const hit = businessTenantCache.get(businessId);
  if (hit) return hit;
  const { rows } = await adminPool.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);
  if (!rows[0]) return null;
  businessTenantCache.set(businessId, rows[0].tenant_id);
  return rows[0].tenant_id;
}

/** Every business a request names: in the query, in the body, or as /businesses/{id} in the address. */
function namedBusinessIds(req: Request): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && v) ids.add(v); };
  add(req.query.business_id);
  add(req.query.businessId);
  if (req.body && typeof req.body === 'object') { add(req.body.business_id); add(req.body.businessId); }
  const inPath = (req.originalUrl || '').split('?')[0].match(/\/(?:businesses|tenant-billing)\/([0-9a-f-]{36})(?:\/|$)/i);
  if (inPath) add(inPath[1]);
  return [...ids];
}

/**
 * Middleware to enforce tenant and business context.
 * Requires authentication first — extracts tenant_id from JWT.
 * Rejects requests without a valid tenant context.
 *
 * A system user (DayStream's own staff) may narrow the effective tenant scope for this
 * request via the X-Context-Tenant-Id header — e.g. a system admin who has switched the
 * Context Switcher into a specific tenant. The header is ignored for everyone else, so it
 * cannot be used to leave one's own tenant.
 *
 * Business scope: most endpoints take the business they act on from the request
 * (`business_id`). That value is checked here, once, for every router that uses this
 * middleware, because the services behind them query by business id alone:
 * - the business must belong to the caller's tenant (a system user may name any);
 * - a user who works for one business (owner, manager, staff, customer) may only name that
 *   business; tenant-level users may name any business of their tenant.
 * A business that does not exist, or is out of reach, answers 403.
 */
export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.user || !authReq.user.tid) {
    res.status(401).json({ error: 'Tenant context required', code: 'MISSING_TENANT' });
    return;
  }

  (async () => {
    const scope = await callerScope(authReq.user.sub);
    const isSystem = scope?.level === 'system';

    if (scope?.blocked) {
      const messages = {
        inactive: 'This account is no longer active',
        tenant_suspended: 'This organisation\'s account is suspended',
        business_archived: 'This business is no longer active',
      };
      res.status(403).json({ error: messages[scope.blocked], code: `ACCOUNT_${scope.blocked.toUpperCase()}` });
      return;
    }

    const contextTenantHeader = req.headers[CONTEXT_TENANT_HEADER];
    if (isSystem && typeof contextTenantHeader === 'string' && UUID_RE.test(contextTenantHeader)) {
      authReq.tenantId = contextTenantHeader;
    } else {
      authReq.tenantId = authReq.user.tid;
    }

    if (!isSystem) {
      for (const businessId of namedBusinessIds(req)) {
        const tenantId = UUID_RE.test(businessId) ? await tenantOfBusiness(businessId) : null;
        const ownTenant = tenantId !== null && tenantId === authReq.user.tid;
        const ownBusiness = scope?.level !== 'business' || !scope.businessId || scope.businessId === businessId;
        if (!ownTenant || !ownBusiness) {
          res.status(403).json({ error: 'You do not have access to this business', code: 'BUSINESS_FORBIDDEN' });
          return;
        }
      }
    }

    next();
  })().catch(next);
}

/** For tests: forget remembered logins (a test may change a user's business between requests). */
export function clearScopeCache(): void {
  scopeCache.clear();
  businessTenantCache.clear();
}
