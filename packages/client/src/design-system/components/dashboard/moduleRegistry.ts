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
  { id: 'customers', phase: 5, icon: '👥', titleKey: 'Customers', descriptionKey: 'Manage customer accounts', path: '/customers', personas: ['business'], permission: 'customers:read' },

  // Phase 6: Service Management
  { id: 'services', phase: 6, icon: '💼', titleKey: 'Services', descriptionKey: 'Manage service offerings', path: '/services', personas: ['business'], permission: 'services:read' },

  // Phase 7: Booking Engine
  { id: 'bookings', phase: 7, icon: '📅', titleKey: 'Bookings', descriptionKey: 'Schedule and manage bookings', path: '/bookings', personas: ['business', 'customer'], permission: 'bookings:read' },

  // Phase 8: Membership Engine
  { id: 'memberships', phase: 8, icon: '🏷️', titleKey: 'Memberships', descriptionKey: 'Manage memberships and subscriptions', path: '/memberships', personas: ['business', 'customer'], featureFlag: 'feature.memberships' },

  // Phase 9: Pricing Engine
  { id: 'pricing', phase: 9, icon: '💰', titleKey: 'Pricing', descriptionKey: 'Configure pricing and packages', path: '/pricing', personas: ['business'], permission: 'services:*' },

  // Phase 10: Payment Platform
  { id: 'payments', phase: 10, icon: '💳', titleKey: 'Payments', descriptionKey: 'Process and track payments', path: '/payments', personas: ['business', 'customer'] },

  // Phase 11: Accounts Payable
  { id: 'accounts', phase: 11, icon: '📊', titleKey: 'Accounts', descriptionKey: 'Financial accounts and payables', path: '/accounts', personas: ['business'], permission: 'reports:*' },

  // Phase 12: Staff Management
  { id: 'staff', phase: 12, icon: '👔', titleKey: 'Staff', descriptionKey: 'Manage team and schedules', path: '/staff', personas: ['business'], permission: 'staff:read' },

  // Phase 13: Resource Management
  { id: 'resources', phase: 13, icon: '🏢', titleKey: 'Resources', descriptionKey: 'Rooms, equipment, and facilities', path: '/resources', personas: ['business'], permission: 'services:*' },

  // Phase 14: Events & Workshops
  { id: 'events', phase: 14, icon: '🎪', titleKey: 'Events', descriptionKey: 'Events and workshops', path: '/events', personas: ['business', 'customer'], featureFlag: 'feature.events' },

  // Phase 15: Check-in System
  { id: 'checkin', phase: 15, icon: '✅', titleKey: 'Check-in', descriptionKey: 'Customer check-in and attendance', path: '/checkin', personas: ['business'] },

  // Phase 16: Marketing Automation
  { id: 'marketing', phase: 16, icon: '📣', titleKey: 'Marketing', descriptionKey: 'Campaigns and automation', path: '/marketing', personas: ['business'], permission: 'settings:*' },

  // Phase 17: Reporting & Analytics
  { id: 'reports', phase: 17, icon: '📈', titleKey: 'Reports', descriptionKey: 'Analytics and insights', path: '/reports', personas: ['business', 'tenant'], permission: 'reports:read' },

  // Phase 18: Website & CMS
  { id: 'website', phase: 18, icon: '🌐', titleKey: 'Website', descriptionKey: 'Manage your online presence', path: '/website', personas: ['business'], permission: 'settings:*' },

  // Phase 20: Integrations
  { id: 'integrations', phase: 20, icon: '🔗', titleKey: 'Integrations', descriptionKey: 'Third-party connections', path: '/integrations', personas: ['business'], permission: 'settings:*' },

  // Phase 22: Community Engagement
  { id: 'community', phase: 22, icon: '🤝', titleKey: 'Community', descriptionKey: 'Community and engagement', path: '/community', personas: ['business', 'customer'], featureFlag: 'feature.community' },

  // Tenant-level modules
  { id: 'tenant-businesses', phase: 0, icon: '🏪', titleKey: 'Businesses', descriptionKey: 'Manage businesses', path: '/admin/businesses', personas: ['tenant'] },
  { id: 'tenant-billing', phase: 0, icon: '🧾', titleKey: 'Billing', descriptionKey: 'Billing and invoices', path: '/admin/billing', personas: ['tenant'] },
  { id: 'tenant-reports', phase: 0, icon: '📈', titleKey: 'Reports', descriptionKey: 'Tenant analytics', path: '/admin/reports', personas: ['tenant'] },

  // System-level modules
  { id: 'system-tenants', phase: 0, icon: '🏢', titleKey: 'Tenants', descriptionKey: 'Manage tenants', path: '/admin/tenants', personas: ['system'] },
  { id: 'system-config', phase: 0, icon: '⚙️', titleKey: 'Configuration', descriptionKey: 'Platform settings', path: '/admin/config', personas: ['system'] },
  { id: 'system-audit', phase: 0, icon: '🔍', titleKey: 'Audit Log', descriptionKey: 'System activity', path: '/admin/audit-log', personas: ['system'] },
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
