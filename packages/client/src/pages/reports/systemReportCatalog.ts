/**
 * System report catalog: the grouped list of platform-wide reports shown on the
 * system-level Reports landing page (system persona). Config-driven, mirroring
 * the business-level reportCatalog.ts — adding a report is a data change here
 * plus wiring its id in the system report runner (SystemReportRunner.tsx).
 *
 * Entries flagged `comingSoon` render as disabled placeholder tiles: they show
 * the intended report but do not navigate. The catalog doubles as a roadmap of
 * platform reports still to be built.
 *
 * The tenant layer will get an equivalent catalog when tenant billing is built.
 */

import type { ReportCategory } from './reportCatalog';

export const SYSTEM_REPORT_CATALOG: ReportCategory[] = [
  {
    id: 'platform-billing',
    label: 'Platform Billing',
    accentColor: '#6B8F63',
    accentColorDark: '#8FBF86',
    reports: [
      {
        id: 'billing-activity',
        title: 'Billing Activity',
        description: 'Platform billing runs, per-tenant charges, and failed charges',
        icon: '🧾',
      },
      {
        id: 'tenant-revenue',
        title: 'Tenant Revenue',
        description: 'Recognized platform revenue by tenant and billing cycle',
        icon: '💰',
        comingSoon: true,
      },
      {
        id: 'outstanding-tenant-charges',
        title: 'Outstanding Charges',
        description: 'Tenant charges awaiting settlement or retry',
        icon: '📄',
        comingSoon: true,
      },
    ],
  },
  {
    id: 'tenants',
    label: 'Tenants',
    accentColor: '#4A7FB5',
    accentColorDark: '#6FA0D8',
    reports: [
      {
        id: 'tenant-growth',
        title: 'Tenant Growth',
        description: 'Tenants onboarded and churned over the period',
        icon: '📈',
        comingSoon: true,
      },
      {
        id: 'tenant-activity',
        title: 'Tenant Activity',
        description: 'Active businesses and usage across tenants',
        icon: '📊',
        comingSoon: true,
      },
    ],
  },
];
