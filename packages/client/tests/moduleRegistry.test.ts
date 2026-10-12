import { describe, it, expect } from 'vitest';
import { getVisibleModules, MODULE_REGISTRY } from '../src/design-system/components/dashboard/moduleRegistry';

describe('Module Registry', () => {
  describe('getVisibleModules', () => {
    it('filters by persona — business user sees business modules', () => {
      const modules = getVisibleModules('business', ['*:*'], {});
      expect(modules.some(m => m.id === 'customers')).toBe(true);
      expect(modules.some(m => m.id === 'offerings')).toBe(true);
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
      const modules = getVisibleModules('customer', ['bookings:read'], { 'feature.events': true });
      expect(modules.some(m => m.id === 'appointments')).toBe(true);
      expect(modules.some(m => m.id === 'events')).toBe(true);
      expect(modules.some(m => m.id === 'customers')).toBe(false);
    });

    it('hides modules when user lacks permission', () => {
      const modules = getVisibleModules('business', ['bookings:read'], {});
      expect(modules.some(m => m.id === 'appointments')).toBe(true);
      expect(modules.some(m => m.id === 'customers')).toBe(false); // requires customers:read
      expect(modules.some(m => m.id === 'business')).toBe(false); // requires staff:read
    });

    it('gates Marketing and Website on the permissions their APIs check', () => {
      const settingsOnly = getVisibleModules('business', ['settings:*'], {});
      expect(settingsOnly.some(m => m.id === 'marketing')).toBe(false);
      expect(settingsOnly.some(m => m.id === 'website')).toBe(false);
      const owner = getVisibleModules('business', ['marketing:*', 'cms:*'], {});
      expect(owner.some(m => m.id === 'marketing')).toBe(true);
      expect(owner.some(m => m.id === 'website')).toBe(true);
    });

    it('hides modules when feature flag is disabled', () => {
      const modules = getVisibleModules('business', ['*:*'], { 'feature.events': false });
      expect(modules.some(m => m.id === 'events')).toBe(false);
    });

    it('shows modules when feature flag is enabled', () => {
      const modules = getVisibleModules('business', ['*:*'], { 'feature.events': true });
      expect(modules.some(m => m.id === 'events')).toBe(true);
    });

    it('wildcard permission grants access to all permission-gated modules', () => {
      const modules = getVisibleModules('business', ['*:*'], { 'feature.events': true, 'feature.community': true });
      // With wildcard, all business modules with permissions should show
      expect(modules.some(m => m.id === 'customers')).toBe(true);
      expect(modules.some(m => m.id === 'offerings')).toBe(true);
      expect(modules.some(m => m.id === 'business')).toBe(true);
      expect(modules.some(m => m.id === 'reports')).toBe(true);
    });
  });

  describe('getVisibleModules — Context Switcher contextLevel filtering', () => {
    it('a system-persona user viewing a business context sees business modules, not system modules', () => {
      const modules = getVisibleModules('system', ['*:*'], {}, 'business');
      expect(modules.some(m => m.id === 'customers')).toBe(true);
      expect(modules.some(m => m.id === 'system-tenants')).toBe(false);
      expect(modules.some(m => m.id === 'system-config')).toBe(false);
    });

    it('a system-persona user viewing a tenant context sees tenant modules only', () => {
      const modules = getVisibleModules('system', ['*:*'], {}, 'tenant');
      expect(modules.some(m => m.id === 'tenant-businesses')).toBe(true);
      expect(modules.some(m => m.id === 'system-tenants')).toBe(false);
      expect(modules.some(m => m.id === 'customers')).toBe(false);
    });

    it('a system-persona user viewing a system context sees system modules only', () => {
      const modules = getVisibleModules('system', ['*:*'], {}, 'system');
      expect(modules.some(m => m.id === 'system-tenants')).toBe(true);
      expect(modules.some(m => m.id === 'tenant-businesses')).toBe(false);
      expect(modules.some(m => m.id === 'customers')).toBe(false);
    });

    it('omitting contextLevel preserves the original persona-only behaviour', () => {
      const withContext = getVisibleModules('business', ['*:*'], {});
      const withoutContext = getVisibleModules('business', ['*:*'], {}, undefined);
      expect(withContext).toEqual(withoutContext);
    });

    it('never returns a module the permissions array would not otherwise permit, regardless of contextLevel', () => {
      const modules = getVisibleModules('system', ['bookings:read'], {}, 'business');
      // 'customers' requires customers:read, which this permission set does not grant
      expect(modules.some(m => m.id === 'customers')).toBe(false);
      expect(modules.some(m => m.id === 'appointments')).toBe(true);
    });

    it('a customer in their business context sees customer modules only, never staff ones', () => {
      const modules = getVisibleModules('customer', ['bookings:read', 'bookings:create'], {}, 'business');
      expect(modules.map(m => m.id)).toEqual(['appointments']);
      expect(modules.some(m => m.id === 'clock')).toBe(false);
      expect(modules.some(m => m.id === 'my-hours')).toBe(false);
    });
  });
});
