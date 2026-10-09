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
  { id: 'appointments', phase: 7, icon: '📅', titleKey: 'Bookings/Orders', descriptionKey: 'Appointments and order history', path: '/bookings', personas: ['business', 'customer'], permission: 'bookings:read' },

  // Schedule
  { id: 'schedule', phase: 7, icon: '🗓️', titleKey: 'Schedule', descriptionKey: 'Staff scheduling and shift management', path: '/schedule', personas: ['business'], permission: 'staff:read' },

  // Time Clock — shared screen; visible to EVERY business user (no permission gate)
  // since it's a walk-up terminal and each punch is authorized by the employee's
  // own PIN rather than by the logged-in session. No single seeded permission is
  // held by owner, manager, AND staff alike, so leaving it ungated is what makes
  // it reachable by all of them.
  { id: 'clock', phase: 12, icon: '⏱️', titleKey: 'Time Clock', descriptionKey: 'Clock in, out, and breaks', path: '/clock', personas: ['business'] },

  // Timesheets — manager/owner view of clock records, corrections, and PINs.
  { id: 'timesheets', phase: 12, icon: '🕗', titleKey: 'Timesheets', descriptionKey: 'Review and correct staff clock records', path: '/clock/admin', personas: ['business'], permission: 'staff:read' },

  // My Hours — read-only self-service; any business user sees their OWN clock
  // records. Ungated for the same reason as Time Clock: no single seeded
  // permission is held by owner, manager, AND staff alike, and the data is
  // self-scoped server-side so there's nothing to over-expose.
  { id: 'my-hours', phase: 12, icon: '⏲️', titleKey: 'My Hours', descriptionKey: 'View your own clock entries', path: '/clock/mine', personas: ['business'] },

  // Accounting
  { id: 'accounting', phase: 11, icon: '📊', titleKey: 'Accounting', descriptionKey: 'Accounts payable and receivables', path: '/accounting', personas: ['business'], permission: 'reports:*' },

  // Reports
  { id: 'reports', phase: 17, icon: '📈', titleKey: 'Reports', descriptionKey: 'Analytics and insights', path: '/reports', personas: ['business'], permission: 'reports:read' },

  // Marketing
  { id: 'marketing', phase: 16, icon: '📣', titleKey: 'Marketing', descriptionKey: 'Campaigns and automation', path: '/marketing', personas: ['business'], permission: 'settings:*' },

  // Offerings
  { id: 'offerings', phase: 28, icon: '🛍️', titleKey: 'Offerings', descriptionKey: 'Services, products, memberships, and promotions', path: '/offers', personas: ['business'], permission: 'services:read' },

  // Business Setup
  { id: 'business', phase: 12, icon: '🏢', titleKey: 'Business Setup', descriptionKey: 'Staff, resources, and locations', path: '/business', personas: ['business'], permission: 'staff:read' },

  // Website
  { id: 'website', phase: 18, icon: '🌐', titleKey: 'Website', descriptionKey: 'Manage your online presence', path: '/cms', personas: ['business'], permission: 'settings:*' },

  // Settings
  { id: 'business-settings', phase: 0, icon: '⚙️', titleKey: 'Settings', descriptionKey: 'Business configuration', path: '/settings', personas: ['business'], permission: 'settings:*' },

  // Feature-flagged modules
  { id: 'events', phase: 14, icon: '🎪', titleKey: 'Events', descriptionKey: 'Events and workshops', path: '/events', personas: ['business', 'customer'], featureFlag: 'feature.events' },
  { id: 'community', phase: 22, icon: '🤝', titleKey: 'Community', descriptionKey: 'Community and engagement', path: '/community', personas: ['business', 'customer'], featureFlag: 'feature.community' },

  // Tenant-level modules
  { id: 'tenant-businesses', phase: 0, icon: '🏪', titleKey: 'Businesses', descriptionKey: 'Manage businesses', path: '/admin/businesses', personas: ['tenant'] },
  { id: 'tenant-prospects', phase: 0, icon: '🎯', titleKey: 'Prospects', descriptionKey: 'Find potential businesses', path: '/admin/prospects', personas: ['tenant'] },
  { id: 'tenant-users', phase: 0, icon: '👤', titleKey: 'Users', descriptionKey: 'Manage tenant users', path: '/admin/tenant-users', personas: ['tenant'] },
  { id: 'tenant-billing', phase: 0, icon: '🧾', titleKey: 'Billing', descriptionKey: 'Billing and invoices', path: '/admin/billing', personas: ['tenant'] },
  { id: 'tenant-reports', phase: 0, icon: '📈', titleKey: 'Reports', descriptionKey: 'Tenant analytics', path: '/admin/reports', personas: ['tenant'] },
  { id: 'tenant-settings', phase: 0, icon: '⚙️', titleKey: 'Settings', descriptionKey: 'Tenant configuration', path: '/admin/tenant-settings', personas: ['tenant'] },

  // System-level modules
  { id: 'system-tenants', phase: 0, icon: '🏢', titleKey: 'Tenants', descriptionKey: 'Manage tenants', path: '/admin/tenants', personas: ['system'] },
  { id: 'system-coverage', phase: 0, icon: '🗺️', titleKey: 'Coverage Map', descriptionKey: 'Territory coverage', path: '/admin/coverage-map', personas: ['system'] },
  { id: 'system-prospect-categories', phase: 0, icon: '🏷️', titleKey: 'Prospect Categories', descriptionKey: 'Google Places types', path: '/admin/prospect-categories', personas: ['system'] },
  { id: 'system-reports', phase: 0, icon: '📈', titleKey: 'Reports', descriptionKey: 'Platform-wide reporting', path: '/admin/system-reports', personas: ['system'] },
  { id: 'system-users', phase: 0, icon: '👤', titleKey: 'Users', descriptionKey: 'Manage system and tenant users', path: '/admin/users', personas: ['system'] },
  { id: 'system-config', phase: 0, icon: '⚙️', titleKey: 'Configuration', descriptionKey: 'Platform settings', path: '/admin/config', personas: ['system'] },
  { id: 'system-processes', phase: 0, icon: '⚡', titleKey: 'Processes', descriptionKey: 'Scheduled jobs and background processes', path: '/admin/processes', personas: ['system'] },
  { id: 'system-audit', phase: 0, icon: '🔍', titleKey: 'Audit Log', descriptionKey: 'System activity', path: '/admin/audit-log', personas: ['system'] },
  { id: 'system-query-editor', phase: 24, icon: '🗄️', titleKey: 'Query Editor', descriptionKey: 'Execute database queries', path: '/query-editor', personas: ['system'] },
];

/**
 * Filter modules for a given user context.
 *
 * `contextLevel` (system | tenant | business) comes from the Context Switcher's active
 * context and, when provided, determines the persona bucket used for the module-visibility
 * check instead of the raw JWT persona — e.g. a system-persona user who has switched into a
 * business context sees business-level modules, not system admin modules. Permission checks
 * always run against the caller's real JWT-derived `userPermissions`, so switching context can
 * only narrow what's visible, never grant a module the user's actual permissions don't allow.
 */
export function getVisibleModules(
  persona: Persona,
  userPermissions: string[],
  featureFlags: Record<string, boolean>,
  contextLevel?: 'system' | 'tenant' | 'business',
): ModuleDefinition[] {
  const effectivePersonas: Persona[] =
    contextLevel === 'system' ? ['system'] :
    contextLevel === 'tenant' ? ['tenant'] :
    contextLevel === 'business' ? ['business', 'customer'] :
    [persona];

  return MODULE_REGISTRY.filter((mod) => {
    // Must match the context-appropriate persona bucket
    if (!mod.personas.some((p) => effectivePersonas.includes(p))) return false;

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
