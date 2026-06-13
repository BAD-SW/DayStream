import { Persona } from '@daystream/shared';

export interface ModuleDefinition {
  id: string;
  phase: number;
  icon: string;
  titleKey: string;
  descriptionKey: string;
  path: string;
  personas: Persona[];
  permission?: string;
  featureFlag?: string;
}

/**
 * Module registry — defines all available modules (Phases 5–22).
 * Each module specifies which personas can see it and what permission is needed.
 */
export const MODULE_REGISTRY: ModuleDefinition[] = [
  // Phase 5: Customer Management
  { id: 'customers', phase: 5, icon: '👥', titleKey: 'modules.customers', descriptionKey: 'modules.customers_desc', path: '/customers', personas: ['business'], permission: 'customers:read' },

  // Phase 6: Service Management
  { id: 'services', phase: 6, icon: '💼', titleKey: 'modules.services', descriptionKey: 'modules.services_desc', path: '/services', personas: ['business'], permission: 'services:read' },

  // Phase 7: Booking Engine
  { id: 'bookings', phase: 7, icon: '📅', titleKey: 'modules.bookings', descriptionKey: 'modules.bookings_desc', path: '/bookings', personas: ['business', 'customer'], permission: 'bookings:read' },

  // Phase 8: Membership Engine
  { id: 'memberships', phase: 8, icon: '🏷️', titleKey: 'modules.memberships', descriptionKey: 'modules.memberships_desc', path: '/memberships', personas: ['business', 'customer'], featureFlag: 'feature.memberships' },

  // Phase 9: Pricing Engine
  { id: 'pricing', phase: 9, icon: '💰', titleKey: 'modules.pricing', descriptionKey: 'modules.pricing_desc', path: '/pricing', personas: ['business'], permission: 'services:*' },

  // Phase 10: Payment Platform
  { id: 'payments', phase: 10, icon: '💳', titleKey: 'modules.payments', descriptionKey: 'modules.payments_desc', path: '/payments', personas: ['business', 'customer'] },

  // Phase 11: Accounts Payable
  { id: 'accounts', phase: 11, icon: '📊', titleKey: 'modules.accounts', descriptionKey: 'modules.accounts_desc', path: '/accounts', personas: ['business'], permission: 'reports:*' },

  // Phase 12: Staff Management
  { id: 'staff', phase: 12, icon: '👔', titleKey: 'modules.staff', descriptionKey: 'modules.staff_desc', path: '/staff', personas: ['business'], permission: 'staff:read' },

  // Phase 13: Resource Management
  { id: 'resources', phase: 13, icon: '🏢', titleKey: 'modules.resources', descriptionKey: 'modules.resources_desc', path: '/resources', personas: ['business'], permission: 'services:*' },

  // Phase 14: Events & Workshops
  { id: 'events', phase: 14, icon: '🎪', titleKey: 'modules.events', descriptionKey: 'modules.events_desc', path: '/events', personas: ['business', 'customer'], featureFlag: 'feature.events' },

  // Phase 15: Check-in System
  { id: 'checkin', phase: 15, icon: '✅', titleKey: 'modules.checkin', descriptionKey: 'modules.checkin_desc', path: '/checkin', personas: ['business'] },

  // Phase 16: Marketing Automation
  { id: 'marketing', phase: 16, icon: '📣', titleKey: 'modules.marketing', descriptionKey: 'modules.marketing_desc', path: '/marketing', personas: ['business'], permission: 'settings:*' },

  // Phase 17: Reporting & Analytics
  { id: 'reports', phase: 17, icon: '📈', titleKey: 'modules.reports', descriptionKey: 'modules.reports_desc', path: '/reports', personas: ['business', 'tenant'], permission: 'reports:read' },

  // Phase 18: Website & CMS
  { id: 'website', phase: 18, icon: '🌐', titleKey: 'modules.website', descriptionKey: 'modules.website_desc', path: '/website', personas: ['business'], permission: 'settings:*' },

  // Phase 20: Integrations
  { id: 'integrations', phase: 20, icon: '🔗', titleKey: 'modules.integrations', descriptionKey: 'modules.integrations_desc', path: '/integrations', personas: ['business'], permission: 'settings:*' },

  // Phase 22: Community Engagement
  { id: 'community', phase: 22, icon: '🤝', titleKey: 'modules.community', descriptionKey: 'modules.community_desc', path: '/community', personas: ['business', 'customer'], featureFlag: 'feature.community' },

  // Tenant-level modules
  { id: 'tenant-businesses', phase: 0, icon: '🏪', titleKey: 'modules.businesses', descriptionKey: 'modules.businesses_desc', path: '/admin/businesses', personas: ['tenant'] },
  { id: 'tenant-billing', phase: 0, icon: '🧾', titleKey: 'modules.billing', descriptionKey: 'modules.billing_desc', path: '/admin/billing', personas: ['tenant'] },
  { id: 'tenant-reports', phase: 0, icon: '📈', titleKey: 'modules.tenant_reports', descriptionKey: 'modules.tenant_reports_desc', path: '/admin/reports', personas: ['tenant'] },

  // System-level modules
  { id: 'system-tenants', phase: 0, icon: '🏢', titleKey: 'modules.tenants', descriptionKey: 'modules.tenants_desc', path: '/admin/tenants', personas: ['system'] },
  { id: 'system-config', phase: 0, icon: '⚙️', titleKey: 'modules.platform_config', descriptionKey: 'modules.platform_config_desc', path: '/admin/config', personas: ['system'] },
  { id: 'system-audit', phase: 0, icon: '🔍', titleKey: 'modules.audit_log', descriptionKey: 'modules.audit_log_desc', path: '/admin/audit', personas: ['system'] },
];

/**
 * Filter modules for a given user context.
 */
export function getVisibleModules(
  persona: Persona,
  userPermissions: string[],
  featureFlags: Record<string, boolean>,
): ModuleDefinition[] {
  return MODULE_REGISTRY.filter((mod) => {
    // Must match persona
    if (!mod.personas.includes(persona)) return false;

    // Must have permission (if specified)
    if (mod.permission) {
      const hasPermission = userPermissions.some((perm) => {
        if (perm === '*:*') return true;
        if (perm === mod.permission) return true;
        const [resource, action] = mod.permission!.split(':');
        if (perm === `${resource}:*`) return true;
        return false;
      });
      if (!hasPermission) return false;
    }

    // Must have feature flag enabled (if specified)
    if (mod.featureFlag && !featureFlags[mod.featureFlag]) return false;

    return true;
  });
}
