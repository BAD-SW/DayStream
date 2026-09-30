import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BUILT_IN_TOKENS, BUILT_IN_THEME_LIST_ITEMS, CONFIGURABLE_TOKEN_KEYS,
  isBuiltInThemeId, stripDefaultTokens,
} from '../src/services/themeTokens';
import { adminPool } from '../src/db/pool';

const NAVY_CSS = fs.readFileSync(
  path.resolve(__dirname, '../../client/src/design-system/themes/navy.css'),
  'utf8',
);

function cssValue(prop: string): string | undefined {
  const match = NAVY_CSS.match(new RegExp(`\\s${prop}:\\s*([^;]+);`));
  return match?.[1].trim();
}

describe('Navy built-in theme (THE-6)', () => {
  it('is recognised as a built-in theme id and listed in the gallery', () => {
    expect(isBuiltInThemeId('navy')).toBe(true);
    expect(BUILT_IN_THEME_LIST_ITEMS.find((t) => t.id === 'navy')?.base_theme).toBe('navy');
  });

  it('defines every configurable token', () => {
    for (const key of CONFIGURABLE_TOKEN_KEYS) {
      expect(BUILT_IN_TOKENS.navy[key], key).toBeTruthy();
    }
  });

  it('keeps colour tokens in sync with navy.css (resolved deltas fall through to the CSS)', () => {
    const colorKeys = CONFIGURABLE_TOKEN_KEYS.filter((k) => k.startsWith('--color-'));
    for (const key of colorKeys) {
      expect(cssValue(key)?.toUpperCase(), key).toBe(BUILT_IN_TOKENS.navy[key].toUpperCase());
    }
    expect(cssValue('--font-family')).toContain(`'${BUILT_IN_TOKENS.navy['--font-family']}'`);
  });

  it('strips tokens equal to the Navy defaults when saving a Navy-based theme', () => {
    const delta = stripDefaultTokens('navy', { '--color-primary': '#0F1F5C', '--color-secondary': '#123456' });
    expect(delta).toEqual({ '--color-secondary': '#123456' });
  });

  it('is accepted by the base-theme CHECK constraints (migration 111)', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [tenant] } = await client.query('SELECT id FROM sys_tenants LIMIT 1');
      await client.query(
        `INSERT INTO cfg_themes (tenant_id, name, base_theme, scope) VALUES ($1, 'navy-constraint-test', 'navy', 'tenant')`,
        [tenant.id],
      );
      await client.query('UPDATE sys_tenants SET active_built_in_theme = $1 WHERE id = $2', ['navy', tenant.id]);
      await expect(
        client.query('UPDATE sys_tenants SET active_built_in_theme = $1 WHERE id = $2', ['teal', tenant.id]),
      ).rejects.toThrow(/sys_tenants_active_built_in_theme_check/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
