import { describe, it, expect, afterEach } from 'vitest';
import { applyBaseTheme } from '../src/context/ThemeManager';
import { CURATED_FONTS, fontStackFor } from '../src/design-system/themes/ThemeProvider';

afterEach(() => document.documentElement.removeAttribute('data-base-theme'));

describe('Navy base theme (THE-6)', () => {
  it('sets data-base-theme="navy" and clears it again for Classic', () => {
    applyBaseTheme('navy');
    expect(document.documentElement.getAttribute('data-base-theme')).toBe('navy');
    applyBaseTheme('classic');
    expect(document.documentElement.hasAttribute('data-base-theme')).toBe(false);
  });

  it('offers Plus Jakarta Sans in the curated font list', () => {
    expect(CURATED_FONTS).toContain('Plus Jakarta Sans');
  });
});

describe('fontStackFor', () => {
  it('maps a curated label to a full stack with fallbacks', () => {
    expect(fontStackFor('Plus Jakarta Sans')).toMatch(/^'Plus Jakarta Sans', .*sans-serif$/);
  });

  it('maps "System Default" to a real system stack instead of an unknown font name', () => {
    const stack = fontStackFor('System Default')!;
    expect(stack).not.toContain('System Default');
    expect(stack).toMatch(/sans-serif$/);
  });

  it('passes unknown labels through and leaves empty values unset', () => {
    expect(fontStackFor('Georgia')).toBe('Georgia');
    expect(fontStackFor(undefined)).toBeUndefined();
  });
});

import { resolvePersona, getPermissionsFromRole } from '../src/context/ContextManager';

describe('role normalisation (THE-11)', () => {
  it('maps JWT display-name roles to the same persona as login snake_case roles', () => {
    expect(resolvePersona('Customer')).toBe('customer');
    expect(resolvePersona('Tenant Owner')).toBe('tenant');
    expect(resolvePersona('tenant_owner')).toBe('tenant');
    expect(resolvePersona('Super Admin')).toBe('system');
    expect(resolvePersona('Business Owner')).toBe('business');
    expect(getPermissionsFromRole('Business Owner')).toEqual(getPermissionsFromRole('business_owner'));
  });
});
