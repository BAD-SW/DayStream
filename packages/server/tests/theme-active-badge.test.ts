import { describe, it, expect } from 'vitest';
import { adminPool } from '../src/db/pool';
import { listForCaller, resolveForBusiness } from '../src/services/theme.service';

// THE-14: the gallery "Active" badge must follow what resolves for the caller's scope, not a
// custom theme that is merely flagged is_active at another scope.
describe('theme gallery active badge', () => {
  it('marks a business-level built-in as active even under an active custom system theme', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [biz] } = await client.query('SELECT id, tenant_id FROM sys_businesses LIMIT 1');

      const { rows: [sysTheme] } = await client.query(
        `INSERT INTO cfg_themes (tenant_id, name, base_theme, scope, is_active)
         VALUES (NULL, 'badge-test system theme', 'bold-business', 'system', true) RETURNING id`,
      );
      await client.query("UPDATE sys_configuration_definitions SET default_value = $1 WHERE key = 'theme.system_active_theme_id'", [sysTheme.id]);
      await client.query("UPDATE sys_configuration_definitions SET default_value = '' WHERE key = 'theme.system_active_built_in_theme'");
      await client.query('UPDATE sys_tenants SET active_custom_theme_id = NULL, active_built_in_theme = NULL WHERE id = $1', [biz.tenant_id]);
      await client.query('UPDATE sys_businesses SET active_custom_theme_id = NULL, active_built_in_theme = $1 WHERE id = $2', ['navy', biz.id]);

      const resolved = await resolveForBusiness(biz.id, client as any);
      expect(resolved).toMatchObject({ base_theme: 'navy', theme_id: 'navy', source: 'business' });

      const { themes } = await listForCaller(
        { userId: 'test', tenantId: biz.tenant_id, persona: 'business', businessId: biz.id },
        client as any,
      );
      const active = themes.filter((t) => t.is_active).map((t) => t.id);
      expect(active).toEqual(['navy']);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
