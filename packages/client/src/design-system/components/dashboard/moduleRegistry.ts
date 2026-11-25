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
  // People (Phase 46): leads and customers are one list. The id and path stay 'customers'.
  { id: 'customers', phase: 5, icon: '👥', titleKey: 'modules.customers.title', descriptionKey: 'modules.customers.description', path: '/customers', personas: ['business'], permission: 'customers:read' },

  // Appointments
  { id: 'appointments', phase: 7, icon: '📅', titleKey: 'modules.appointments.title', descriptionKey: 'modules.appointments.description', path: '/bookings', personas: ['business', 'customer'], permission: 'bookings:read' },

  // Schedule
  { id: 'schedule', phase: 7, icon: '🗓️', titleKey: 'modules.schedule.title', descriptionKey: 'modules.schedule.description', path: '/schedule', personas: ['business'], permission: 'staff:read' },

  // Time Clock — shared screen; visible to EVERY business user (no permission gate)
  // since it's a walk-up terminal and each punch is authorized by the employee's
  // own PIN rather than by the logged-in session. No single seeded permission is
  // held by owner, manager, AND staff alike, so leaving it ungated is what makes
  // it reachable by all of them.
  { id: 'clock', phase: 12, icon: '⏱️', titleKey: 'modules.clock.title', descriptionKey: 'modules.clock.description', path: '/clock', personas: ['business'] },

  // Timesheets — manager/owner view of clock records, corrections, and PINs.
  { id: 'timesheets', phase: 12, icon: '🕗', titleKey: 'modules.timesheets.title', descriptionKey: 'modules.timesheets.description', path: '/clock/admin', personas: ['business'], permission: 'staff:read' },

  // My Hours — read-only self-service; any business user sees their OWN clock
  // records. Ungated for the same reason as Time Clock: no single seeded
  // permission is held by owner, manager, AND staff alike, and the data is
  // self-scoped server-side so there's nothing to over-expose.
  { id: 'my-hours', phase: 12, icon: '⏲️', titleKey: 'modules.my-hours.title', descriptionKey: 'modules.my-hours.description', path: '/clock/mine', personas: ['business'] },

  // Accounting
  { id: 'accounting', phase: 11, icon: '📊', titleKey: 'modules.accounting.title', descriptionKey: 'modules.accounting.description', path: '/accounting', personas: ['business'], permission: 'reports:*' },

  // Reports
  { id: 'reports', phase: 17, icon: '📈', titleKey: 'modules.reports.title', descriptionKey: 'modules.reports.description', path: '/reports', personas: ['business'], permission: 'reports:read' },

  // Marketing
  // Inbox (THE-18): owners, managers and front desk; customers write from "Messages".
  { id: 'inbox', phase: 47, icon: '💬', titleKey: 'modules.inbox.title', descriptionKey: 'modules.inbox.description', path: '/inbox', personas: ['business'], permission: 'inbox:read' },
  { id: 'messages', phase: 47, icon: '💬', titleKey: 'modules.messages.title', descriptionKey: 'modules.messages.description', path: '/messages', personas: ['customer'] },
  { id: 'marketing', phase: 16, icon: '📣', titleKey: 'modules.marketing.title', descriptionKey: 'modules.marketing.description', path: '/marketing', personas: ['business'], permission: 'marketing:read' },

  // Offerings
  { id: 'offerings', phase: 28, icon: '🛍️', titleKey: 'modules.offerings.title', descriptionKey: 'modules.offerings.description', path: '/offers', personas: ['business'], permission: 'services:read' },

  // Business Setup
  { id: 'business', phase: 12, icon: '🏢', titleKey: 'modules.business.title', descriptionKey: 'modules.business.description', path: '/business', personas: ['business'], permission: 'staff:read' },

  // Website
  { id: 'website', phase: 18, icon: '🌐', titleKey: 'modules.website.title', descriptionKey: 'modules.website.description', path: '/cms', personas: ['business'], permission: 'cms:read' },

  // Settings
  { id: 'business-settings', phase: 0, icon: '⚙️', titleKey: 'modules.business-settings.title', descriptionKey: 'modules.business-settings.description', path: '/settings', personas: ['business'], permission: 'settings:*' },

  // Feature-flagged modules
  { id: 'events', phase: 14, icon: '🎪', titleKey: 'modules.events.title', descriptionKey: 'modules.events.description', path: '/events', personas: ['business', 'customer'], featureFlag: 'feature.events' },
  { id: 'community', phase: 22, icon: '🤝', titleKey: 'modules.community.title', descriptionKey: 'modules.community.description', path: '/community', personas: ['business', 'customer'], featureFlag: 'feature.community' },

  // Tenant-level modules
  { id: 'tenant-businesses', phase: 0, icon: '🏪', titleKey: 'modules.tenant-businesses.title', descriptionKey: 'modules.tenant-businesses.description', path: '/admin/businesses', personas: ['tenant'] },
  { id: 'tenant-prospects', phase: 0, icon: '🎯', titleKey: 'modules.tenant-prospects.title', descriptionKey: 'modules.tenant-prospects.description', path: '/admin/prospects', personas: ['tenant'] },
  { id: 'tenant-users', phase: 0, icon: '👤', titleKey: 'modules.tenant-users.title', descriptionKey: 'modules.tenant-users.description', path: '/admin/tenant-users', personas: ['tenant'] },
  { id: 'tenant-billing', phase: 0, icon: '🧾', titleKey: 'modules.tenant-billing.title', descriptionKey: 'modules.tenant-billing.description', path: '/admin/billing', personas: ['tenant'] },
  { id: 'tenant-reports', phase: 0, icon: '📈', titleKey: 'modules.tenant-reports.title', descriptionKey: 'modules.tenant-reports.description', path: '/admin/tenant-reports', personas: ['tenant'] },
  { id: 'tenant-processes', phase: 0, icon: '⚡', titleKey: 'modules.tenant-processes.title', descriptionKey: 'modules.tenant-processes.description', path: '/admin/tenant-processes', personas: ['tenant'] },
  { id: 'tenant-settings', phase: 0, icon: '⚙️', titleKey: 'modules.tenant-settings.title', descriptionKey: 'modules.tenant-settings.description', path: '/admin/tenant-settings', personas: ['tenant'] },

  // System-level modules
  { id: 'system-tenants', phase: 0, icon: '🏢', titleKey: 'modules.system-tenants.title', descriptionKey: 'modules.system-tenants.description', path: '/admin/tenants', personas: ['system'] },
  { id: 'system-coverage', phase: 0, icon: '🗺️', titleKey: 'modules.system-coverage.title', descriptionKey: 'modules.system-coverage.description', path: '/admin/coverage-map', personas: ['system'] },
  { id: 'system-prospect-categories', phase: 0, icon: '🏷️', titleKey: 'modules.system-prospect-categories.title', descriptionKey: 'modules.system-prospect-categories.description', path: '/admin/prospect-categories', personas: ['system'] },
  { id: 'system-reports', phase: 0, icon: '📈', titleKey: 'modules.system-reports.title', descriptionKey: 'modules.system-reports.description', path: '/admin/system-reports', personas: ['system'] },
  { id: 'system-users', phase: 0, icon: '👤', titleKey: 'modules.system-users.title', descriptionKey: 'modules.system-users.description', path: '/admin/users', personas: ['system'] },
  { id: 'system-config', phase: 0, icon: '⚙️', titleKey: 'modules.system-config.title', descriptionKey: 'modules.system-config.description', path: '/admin/config', personas: ['system'] },
  { id: 'system-processes', phase: 0, icon: '⚡', titleKey: 'modules.system-processes.title', descriptionKey: 'modules.system-processes.description', path: '/admin/processes', personas: ['system'] },
  { id: 'system-audit', phase: 0, icon: '🔍', titleKey: 'modules.system-audit.title', descriptionKey: 'modules.system-audit.description', path: '/admin/audit-log', personas: ['system'] },
  { id: 'system-query-editor', phase: 24, icon: '🗄️', titleKey: 'modules.system-query-editor.title', descriptionKey: 'modules.system-query-editor.description', path: '/query-editor', personas: ['system'] },
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
    contextLevel === 'business' ? [persona === 'customer' ? 'customer' : 'business'] :
    [persona];

  return MODULE_REGISTRY.filter((mod) => {
    // Must match the context-appropriate persona bucket
    if (!mod.personas.some((p) => effectivePersonas.includes(p))) return false;

    // Must have permission (if specified)
    if (mod.permission) {
      const hasPermission = userPermissions.some((perm) => {
        if (perm === '*:*') return true;
        if (perm === mod.permission) return true;
        const [resource] = mod.permission!.split(':');
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

// Business screens that belong to a module but live outside its path.
const EXTRA_MODULE_PATHS: Array<{ path: string; permission: string }> = [
  { path: '/payroll', permission: 'reports:*' },
  { path: '/payments', permission: 'reports:*' },
  { path: '/gift-cards', permission: 'bookings:*' },
  { path: '/integrations', permission: 'settings:*' },
];

function permissionGranted(userPermissions: string[], needed: string): boolean {
  const [resource] = needed.split(':');
  return userPermissions.some((perm) => perm === '*:*' || perm === needed || perm === `${resource}:*`);
}

/**
 * Whether a user may open a business screen by its address. The menu already hides the
 * modules a role cannot use; this stops the same screens being opened by typing the address,
 * where they would only show an empty shell of refused requests. A path no module claims is
 * allowed (the server decides).
 */
export function mayOpenBusinessPath(pathname: string, userPermissions: string[]): boolean {
  const candidates = [
    ...MODULE_REGISTRY.filter((m) => m.personas.includes('business') && m.permission).map((m) => ({ path: m.path, permission: m.permission! })),
    ...EXTRA_MODULE_PATHS,
  ].filter((m) => pathname === m.path || pathname.startsWith(`${m.path}/`));
  if (candidates.length === 0) return true;
  // The most specific module decides (/clock/admin before /clock).
  const owner = candidates.sort((a, b) => b.path.length - a.path.length)[0];
  return permissionGranted(userPermissions, owner.permission);
}
