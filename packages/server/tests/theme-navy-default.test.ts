import { describe, it, expect } from 'vitest';
import { adminPool } from '../src/db/pool';
import { resolveForBusiness, resolveSystemDefault } from '../src/services/theme.service';

// THE-12 (David, 2026-11-05): Navy is the default look; a scope that chose Classic or Bold
// Business keeps it.
describe('Navy as the default theme', () => {
  it('a business with no theme of its own, under a tenant and platform with none, gets Navy', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [biz] } = await client.query('SELECT id, tenant_id FROM sys_businesses LIMIT 1');
      await client.query("UPDATE sys_configuration_definitions SET default_value = '' WHERE key IN ('theme.system_active_theme_id', 'theme.system_active_built_in_theme')");
      await client.query('UPDATE sys_tenants SET active_custom_theme_id = NULL, active_built_in_theme = NULL WHERE id = $1', [biz.tenant_id]);
      await client.query('UPDATE sys_businesses SET active_custom_theme_id = NULL, active_built_in_theme = NULL WHERE id = $1', [biz.id]);

      expect(await resolveSystemDefault(client as any)).toMatchObject({ base_theme: 'navy', source: 'default' });
      expect(await resolveForBusiness(biz.id, client as any)).toMatchObject({ base_theme: 'navy' });

      await client.query("UPDATE sys_businesses SET active_built_in_theme = 'classic' WHERE id = $1", [biz.id]);
      expect(await resolveForBusiness(biz.id, client as any)).toMatchObject({ base_theme: 'classic', source: 'business' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('the platform setting is Navy after migration 166', async () => {
    const { rows } = await adminPool.query("SELECT default_value FROM sys_configuration_definitions WHERE key = 'theme.system_active_built_in_theme'");
    expect(rows[0]?.default_value).toBe('navy');
  });
});
