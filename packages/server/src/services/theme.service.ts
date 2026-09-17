import { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;
import {
  BuiltInThemeId, CfgTheme, ThemeListItem, ResolvedTheme,
  CreateThemeDto, UpdateThemeDto, ApplyThemeDto, ThemeScope,
} from '@daystream/shared';
import { AuthenticatedRequest } from '../auth/middleware';
import {
  BUILT_IN_TOKENS, BUILT_IN_THEME_LIST_ITEMS,
  isBuiltInThemeId, stripDefaultTokens, validateTokenKeys,
} from './themeTokens';

export class ThemeServiceError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION' | 'ACTIVE_THEME',
  ) {
    super(message);
    this.name = 'ThemeServiceError';
  }
}

export interface CallerScope {
  userId: string;
  tenantId: string;
  persona: 'system' | 'tenant' | 'business' | 'customer';
  businessId: string | null;
}

/**
 * Resolves the calling user's persona and own business_id from usr_users — the JWT
 * carries only { sub, tid, role, permissions }, not persona/business_id, so this is
 * looked up per write request. System persona is additionally recognised by the
 * platform-wide '*:*' permission (mirrors tenantContext's own check) since some
 * system operator accounts may not carry persona = 'system' in every seed.
 */
export async function getCallerScope(req: AuthenticatedRequest, pool: Queryable): Promise<CallerScope> {
  const { rows } = await pool.query(
    'SELECT persona, business_id FROM usr_users WHERE id = $1 AND tenant_id = $2',
    [req.user.sub, req.tenantId],
  );
  const hasPlatformPermission = (req.user.permissions || []).includes('*:*');
  const persona = hasPlatformPermission ? 'system' : (rows[0]?.persona as CallerScope['persona']) || 'business';
  return {
    userId: req.user.sub,
    tenantId: req.tenantId,
    persona,
    businessId: rows[0]?.business_id ?? null,
  };
}

function mergeTokens(baseTheme: BuiltInThemeId, delta: Record<string, string>): Record<string, string> {
  return { ...BUILT_IN_TOKENS[baseTheme], ...delta };
}

// tenant_id IS NULL identifies a platform-wide scope='system' row (106/107) — those are
// never owned by a single tenant, so every lookup below matches "my tenant OR global".
async function fetchThemeRow(id: string, tenantId: string | null, pool: Queryable): Promise<CfgTheme | null> {
  const { rows } = await pool.query(
    'SELECT * FROM cfg_themes WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) AND deleted_at IS NULL',
    [id, tenantId],
  );
  return rows[0] || null;
}

// IMPORTANT: resolveForBusiness/resolveForTenant/resolveSystemDefault return only the
// DELTA a theme actually overrides — never the full mergeTokens() palette. The client
// applies these as inline style.setProperty() on <html>, which has the highest CSS
// specificity there is; inline-setting all ~29 tokens would permanently freeze the page
// to one fixed look and make the dark/light toggle inert (BUILT_IN_TOKENS['classic'] only
// ever captured the dark values — there's no light variant in this system). Leaving
// untouched tokens out of the response lets them fall through to :root / [data-theme] /
// [data-base-theme] as normal, which is what makes Classic's dark+light toggle and Bold
// Business's fixed light look work correctly. mergeTokens() (the full palette) is still
// used for the gallery preview swatches and the editor's "what would this look like".
const DEFAULT_RESOLVED: ResolvedTheme = { base_theme: 'bold-business', tokens: {}, source: 'default' };

/**
 * System -> Bold Business built-in default. Also the tail of resolveForTenant/resolveForBusiness.
 *
 * Two independent pointers exist at every scope: an explicit *custom* theme
 * (theme.system_active_theme_id) and an explicit *built-in* choice
 * (theme.system_active_built_in_theme). Applying "Classic" only clears the custom
 * pointer — it does NOT by itself select Classic — so the built-in pointer is what
 * records "this scope explicitly wants Classic" as opposed to "this scope has no
 * opinion, keep looking up the chain." Checking custom first, then built-in, then
 * falling through to the parent scope reproduces the full 3-state model at every level.
 */
export async function resolveSystemDefault(pool: Queryable): Promise<ResolvedTheme> {
  const { rows: sysRows } = await pool.query(
    "SELECT key, default_value FROM sys_configuration_definitions WHERE key IN ('theme.system_active_theme_id', 'theme.system_active_built_in_theme')",
  );
  const values = Object.fromEntries(sysRows.map((r: any) => [r.key, r.default_value]));
  const systemThemeId = values['theme.system_active_theme_id'];
  if (systemThemeId) {
    // System rows have tenant_id IS NULL (platform-wide) — pass null (not '', which
    // Postgres rejects as an invalid uuid) so fetchThemeRow's "OR tenant_id IS NULL" matches.
    const theme = await fetchThemeRow(systemThemeId, null, pool);
    if (theme) return { base_theme: theme.base_theme, tokens: theme.tokens, source: 'system' };
  }
  const systemBuiltIn = values['theme.system_active_built_in_theme'];
  if (systemBuiltIn && isBuiltInThemeId(systemBuiltIn)) {
    return { base_theme: systemBuiltIn, tokens: {}, source: 'system' };
  }
  return DEFAULT_RESOLVED;
}

/** Tenant -> system -> Bold Business built-in default. */
export async function resolveForTenant(tenantId: string, pool: Queryable): Promise<ResolvedTheme> {
  const { rows: tenantRows } = await pool.query(
    'SELECT active_custom_theme_id, active_built_in_theme FROM sys_tenants WHERE id = $1',
    [tenantId],
  );
  const tenant = tenantRows[0];
  if (tenant?.active_custom_theme_id) {
    const theme = await fetchThemeRow(tenant.active_custom_theme_id, tenantId, pool);
    if (theme) return { base_theme: theme.base_theme, tokens: theme.tokens, source: 'tenant' };
  }
  if (tenant?.active_built_in_theme) {
    return { base_theme: tenant.active_built_in_theme, tokens: {}, source: 'tenant' };
  }
  return resolveSystemDefault(pool);
}

/** Business -> tenant -> system -> Bold Business built-in default. */
export async function resolveForBusiness(businessId: string, pool: Queryable): Promise<ResolvedTheme> {
  const { rows: bizRows } = await pool.query(
    'SELECT active_custom_theme_id, active_built_in_theme, tenant_id FROM sys_businesses WHERE id = $1',
    [businessId],
  );
  const business = bizRows[0];

  if (business?.active_custom_theme_id) {
    const theme = await fetchThemeRow(business.active_custom_theme_id, business.tenant_id, pool);
    if (theme) return { base_theme: theme.base_theme, tokens: theme.tokens, source: 'business' };
  }
  if (business?.active_built_in_theme) {
    return { base_theme: business.active_built_in_theme, tokens: {}, source: 'business' };
  }

  if (business?.tenant_id) return resolveForTenant(business.tenant_id, pool);
  return DEFAULT_RESOLVED;
}

function scopeFilterForCaller(caller: CallerScope): { clause: string; params: any[] } {
  if (caller.persona === 'system') return { clause: '1=1', params: [] };
  if (caller.persona === 'tenant') return { clause: "scope IN ('tenant','system') OR (scope = 'business')", params: [] };
  // business persona: their own business, or their tenant, or system
  return { clause: "(scope = 'business' AND scope_id = $1) OR scope IN ('tenant','system')", params: [caller.businessId] };
}

export async function listForCaller(caller: CallerScope, pool: Queryable): Promise<{ themes: ThemeListItem[] }> {
  const { clause, params } = scopeFilterForCaller(caller);
  const { rows } = await pool.query(
    `SELECT * FROM cfg_themes WHERE (tenant_id = $${params.length + 1} OR tenant_id IS NULL) AND deleted_at IS NULL AND (${clause}) ORDER BY created_at ASC`,
    [...params, caller.tenantId],
  );

  // "Active" badge reflects what's actually applied at the caller's own scope — business
  // for a business persona, else the tenant/system scope they're managing.
  let resolvedBuiltIn: string | null = null;
  const resolved = caller.businessId
    ? await resolveForBusiness(caller.businessId, pool)
    : caller.persona === 'tenant'
      ? await resolveForTenant(caller.tenantId, pool)
      : caller.persona === 'system'
        ? await resolveSystemDefault(pool)
        : null;
  if (resolved) {
    const activeRow = rows.find((r: any) => r.is_active);
    if (!activeRow) resolvedBuiltIn = resolved.base_theme;
  }

  const builtIns = BUILT_IN_THEME_LIST_ITEMS.map((item) => ({
    ...item,
    is_active: resolvedBuiltIn === item.base_theme,
  }));

  const saved: ThemeListItem[] = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    base_theme: r.base_theme,
    scope: r.scope,
    scope_id: r.scope_id,
    is_built_in: false,
    is_active: r.is_active,
    preview_tokens: mergeTokens(r.base_theme, r.tokens),
  }));

  return { themes: [...builtIns, ...saved] };
}

export async function create(dto: CreateThemeDto, caller: CallerScope, pool: Queryable): Promise<CfgTheme> {
  if (!dto.name?.trim()) throw new ThemeServiceError('Theme name is required', 'VALIDATION');
  if (dto.name.length > 100) throw new ThemeServiceError('Theme name must be 100 characters or fewer', 'VALIDATION');
  if (!isBuiltInThemeId(dto.base_theme)) throw new ThemeServiceError("base_theme must be 'bold-business' or 'classic'", 'VALIDATION');

  const rawTokens = dto.tokens || {};
  const unknownKeys = validateTokenKeys(rawTokens);
  if (unknownKeys.length > 0) throw new ThemeServiceError(`Unknown token key(s): ${unknownKeys.join(', ')}`, 'VALIDATION');
  const tokens = stripDefaultTokens(dto.base_theme, rawTokens);

  // A system-scope row is platform-wide, not owned by the creating admin's own tenant —
  // tenant_id = NULL is how every other query here recognises "global" (see fetchThemeRow).
  const rowTenantId = dto.scope === 'system' ? null : caller.tenantId;

  try {
    const { rows } = await pool.query(
      `INSERT INTO cfg_themes (tenant_id, name, base_theme, tokens, scope, scope_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [rowTenantId, dto.name.trim(), dto.base_theme, JSON.stringify(tokens), dto.scope, dto.scope_id],
    );
    return rows[0];
  } catch (err: any) {
    if (err.code === '23505') throw new ThemeServiceError(`A theme named '${dto.name}' already exists at this scope`, 'CONFLICT');
    throw err;
  }
}

export async function update(id: string, dto: UpdateThemeDto, caller: CallerScope, pool: Queryable): Promise<CfgTheme> {
  if (isBuiltInThemeId(id)) throw new ThemeServiceError('Built-in themes cannot be modified', 'FORBIDDEN');
  const existing = await fetchThemeRow(id, caller.tenantId, pool);
  if (!existing) throw new ThemeServiceError('Theme not found', 'NOT_FOUND');

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (dto.name !== undefined) {
    if (!dto.name.trim()) throw new ThemeServiceError('Theme name is required', 'VALIDATION');
    fields.push(`name = $${idx++}`); values.push(dto.name.trim());
  }
  if (dto.tokens !== undefined) {
    const unknownKeys = validateTokenKeys(dto.tokens);
    if (unknownKeys.length > 0) throw new ThemeServiceError(`Unknown token key(s): ${unknownKeys.join(', ')}`, 'VALIDATION');
    const tokens = stripDefaultTokens(existing.base_theme, dto.tokens);
    fields.push(`tokens = $${idx++}`); values.push(JSON.stringify(tokens));
  }
  if (fields.length === 0) throw new ThemeServiceError('No fields to update', 'VALIDATION');

  fields.push('updated_at = NOW()');
  values.push(id, caller.tenantId);

  try {
    const { rows } = await pool.query(
      `UPDATE cfg_themes SET ${fields.join(', ')} WHERE id = $${idx++} AND (tenant_id = $${idx} OR tenant_id IS NULL) RETURNING *`,
      values,
    );
    return rows[0];
  } catch (err: any) {
    if (err.code === '23505') throw new ThemeServiceError('A theme with this name already exists at this scope', 'CONFLICT');
    throw err;
  }
}

export async function softDelete(id: string, caller: CallerScope, pool: Queryable): Promise<void> {
  if (isBuiltInThemeId(id)) throw new ThemeServiceError('Built-in themes cannot be deleted', 'FORBIDDEN');
  const existing = await fetchThemeRow(id, caller.tenantId, pool);
  if (!existing) throw new ThemeServiceError('Theme not found', 'NOT_FOUND');
  if (existing.is_active) throw new ThemeServiceError('Cannot delete the currently active theme; apply another theme first', 'ACTIVE_THEME');

  await pool.query('UPDATE cfg_themes SET deleted_at = NOW() WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)', [id, caller.tenantId]);
}

export async function applyToScope(themeId: string, dto: ApplyThemeDto, caller: CallerScope, pool: Pool): Promise<ResolvedTheme> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear any previously active custom theme at this exact (scope, scope_id) regardless
    // of what's being applied now — keeps the at-most-one-active invariant even when
    // switching to a built-in (pointerId = null below).
    await client.query(
      `UPDATE cfg_themes SET is_active = false WHERE (tenant_id = $1 OR tenant_id IS NULL) AND scope = $2 AND scope_id IS NOT DISTINCT FROM $3`,
      [caller.tenantId, dto.scope, dto.scope_id],
    );

    if (!isBuiltInThemeId(themeId)) {
      const existing = await fetchThemeRow(themeId, caller.tenantId, client);
      if (!existing) throw new ThemeServiceError('Theme not found', 'NOT_FOUND');
      await client.query('UPDATE cfg_themes SET is_active = true, updated_at = NOW() WHERE id = $1', [themeId]);
    }

    // Exactly one of these two pointers is ever set at a scope: a custom theme id, or
    // an explicit built-in choice — never both, and never "cleared to nothing" by this
    // action (that would mean "inherit", which Apply never does; only Reset would).
    const customPointer = isBuiltInThemeId(themeId) ? null : themeId;
    const builtInPointer = isBuiltInThemeId(themeId) ? themeId : null;
    if (dto.scope === 'business') {
      await client.query(
        'UPDATE sys_businesses SET active_custom_theme_id = $1, active_built_in_theme = $2 WHERE id = $3 AND tenant_id = $4',
        [customPointer, builtInPointer, dto.scope_id, caller.tenantId],
      );
    } else if (dto.scope === 'tenant') {
      await client.query(
        'UPDATE sys_tenants SET active_custom_theme_id = $1, active_built_in_theme = $2 WHERE id = $3',
        [customPointer, builtInPointer, dto.scope_id],
      );
    } else {
      await client.query("UPDATE sys_configuration_definitions SET default_value = $1 WHERE key = 'theme.system_active_theme_id'", [customPointer || '']);
      await client.query("UPDATE sys_configuration_definitions SET default_value = $1 WHERE key = 'theme.system_active_built_in_theme'", [builtInPointer || '']);
    }

    await client.query('COMMIT');

    if (dto.scope === 'business' && dto.scope_id) return resolveForBusiness(dto.scope_id, pool);
    if (dto.scope === 'tenant' && dto.scope_id) return resolveForTenant(dto.scope_id, pool);
    return resolveSystemDefault(pool);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
