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
  // Customers
  { id: 'customers', phase: 5, icon: '👥', titleKey: 'Customers', descriptionKey: 'Manage customer accounts', path: '/customers', personas: ['business'], permission: 'customers:read' },

  // Appointments
  { id: 'appointments', phase: 7, icon: '📅', titleKey: 'Appointments', descriptionKey: 'Schedule and manage appointments', path: '/bookings', personas: ['business', 'customer'], permission: 'bookings:read' },

  // Schedule
  { id: 'schedule', phase: 7, icon: '🗓️', titleKey: 'Schedule', descriptionKey: 'Staff scheduling and shift management', path: '/schedule', personas: ['business'], permission: 'staff:read' },

  // Accounting
  { id: 'accounting', phase: 11, icon: '📊', titleKey: 'Accounting', descriptionKey: 'Accounts payable and receivables', path: '/accounts', personas: ['business'], permission: 'reports:*' },

  // Reports
  { id: 'reports', phase: 17, icon: '📈', titleKey: 'Reports', descriptionKey: 'Analytics and insights', path: '/reports', personas: ['business'], permission: 'reports:read' },

  // Marketing
  { id: 'marketing', phase: 16, icon: '📣', titleKey: 'Marketing', descriptionKey: 'Campaigns and automation', path: '/marketing', personas: ['business'], permission: 'settings:*' },

  // Offerings
  { id: 'offerings', phase: 28, icon: '🛍️', titleKey: 'Offerings', descriptionKey: 'Services, products, memberships, and promotions', path: '/offers', personas: ['business'], permission: 'services:read' },

  // Business Setup
  { id: 'business', phase: 12, icon: '🏢', titleKey: 'Business Setup', descriptionKey: 'Staff, resources, and locations', path: '/business', personas: ['business'], permission: 'staff:read' },

  // Website
  { id: 'website', phase: 18, icon: '🌐', titleKey: 'Website', descriptionKey: 'Manage your online presence', path: '/website', personas: ['business'], permission: 'settings:*' },

  // Settings
  { id: 'business-settings', phase: 0, icon: '⚙️', titleKey: 'Settings', descriptionKey: 'Business configuration', path: '/settings', personas: ['business'], permission: 'settings:*' },

  // Feature-flagged modules
  { id: 'events', phase: 14, icon: '🎪', titleKey: 'Events', descriptionKey: 'Events and workshops', path: '/events', personas: ['business', 'customer'], featureFlag: 'feature.events' },
  { id: 'community', phase: 22, icon: '🤝', titleKey: 'Community', descriptionKey: 'Community and engagement', path: '/community', personas: ['business', 'customer'], featureFlag: 'feature.community' },

  // Tenant-level modules
  { id: 'tenant-businesses', phase: 0, icon: '🏪', titleKey: 'Businesses', descriptionKey: 'Manage businesses', path: '/admin/businesses', personas: ['tenant'] },
  { id: 'tenant-users', phase: 0, icon: '👤', titleKey: 'Users', descriptionKey: 'Manage tenant users', path: '/admin/tenant-users', personas: ['tenant'] },
  { id: 'tenant-billing', phase: 0, icon: '🧾', titleKey: 'Billing', descriptionKey: 'Billing and invoices', path: '/admin/billing', personas: ['tenant'] },
  { id: 'tenant-reports', phase: 0, icon: '📈', titleKey: 'Reports', descriptionKey: 'Tenant analytics', path: '/admin/reports', personas: ['tenant'] },

  // System-level modules
  { id: 'system-tenants', phase: 0, icon: '🏢', titleKey: 'Tenants', descriptionKey: 'Manage tenants', path: '/admin/tenants', personas: ['system'] },
  { id: 'system-users', phase: 0, icon: '👤', titleKey: 'Users', descriptionKey: 'Manage system and tenant users', path: '/admin/users', personas: ['system'] },
  { id: 'system-config', phase: 0, icon: '⚙️', titleKey: 'Configuration', descriptionKey: 'Platform settings', path: '/admin/config', personas: ['system'] },
  { id: 'system-audit', phase: 0, icon: '🔍', titleKey: 'Audit Log', descriptionKey: 'System activity', path: '/admin/audit-log', personas: ['system'] },
  { id: 'system-query-editor', phase: 24, icon: '🗄️', titleKey: 'Query Editor', descriptionKey: 'Execute database queries', path: '/query-editor', personas: ['system'] },
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
