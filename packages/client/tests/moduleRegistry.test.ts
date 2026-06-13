import { describe, it, expect } from 'vitest';
import { getVisibleModules, MODULE_REGISTRY } from '../src/design-system/components/dashboard/moduleRegistry';

describe('Module Registry', () => {
  describe('getVisibleModules', () => {
    it('filters by persona — business user sees business modules', () => {
      const modules = getVisibleModules('business', ['*:*'], {});
      expect(modules.some(m => m.id === 'customers')).toBe(true);
      expect(modules.some(m => m.id === 'services')).toBe(true);
      expect(modules.some(m => m.id === 'system-tenants')).toBe(false);
      expect(modules.some(m => m.id === 'tenant-businesses')).toBe(false);
    });

    it('filters by persona — system user sees system modules', () => {
      const modules = getVisibleModules('system', ['*:*'], {});
      expect(modules.some(m => m.id === 'system-tenants')).toBe(true);
      expect(modules.some(m => m.id === 'system-config')).toBe(true);
      expect(modules.some(m => m.id === 'customers')).toBe(false);
    });

    it('filters by persona — tenant user sees tenant modules', () => {
      const modules = getVisibleModules('tenant', ['*:*'], {});
      expect(modules.some(m => m.id === 'tenant-businesses')).toBe(true);
      expect(modules.some(m => m.id === 'customers')).toBe(false);
    });

    it('filters by persona — customer sees customer modules', () => {
      const modules = getVisibleModules('customer', ['bookings:read'], { 'feature.memberships': true });
      expect(modules.some(m => m.id === 'bookings')).toBe(true);
      expect(modules.some(m => m.id === 'memberships')).toBe(true);
      expect(modules.some(m => m.id === 'staff')).toBe(false);
    });

    it('hides modules when user lacks permission', () => {
      const modules = getVisibleModules('business', ['bookings:read'], {});
      expect(modules.some(m => m.id === 'bookings')).toBe(true);
      expect(modules.some(m => m.id === 'customers')).toBe(false); // requires customers:read
      expect(modules.some(m => m.id === 'staff')).toBe(false); // requires staff:read
    });

    it('hides modules when feature flag is disabled', () => {
      const modules = getVisibleModules('business', ['*:*'], { 'feature.memberships': false });
      expect(modules.some(m => m.id === 'memberships')).toBe(false);
    });

    it('shows modules when feature flag is enabled', () => {
      const modules = getVisibleModules('business', ['*:*'], { 'feature.memberships': true });
      expect(modules.some(m => m.id === 'memberships')).toBe(true);
    });

    it('wildcard permission grants access to all permission-gated modules', () => {
      const modules = getVisibleModules('business', ['*:*'], { 'feature.memberships': true, 'feature.events': true, 'feature.community': true });
      // With wildcard, all business modules with permissions should show
      expect(modules.some(m => m.id === 'customers')).toBe(true);
      expect(modules.some(m => m.id === 'services')).toBe(true);
      expect(modules.some(m => m.id === 'staff')).toBe(true);
      expect(modules.some(m => m.id === 'reports')).toBe(true);
    });
  });
});
