/**
 * Tenant report catalog: the grouped list of tenant-wide reports shown on the
 * tenant-level Reports hub (tenant persona). Config-driven, mirroring the system
 * systemReportCatalog.ts one level down — adding a report is a data change here
 * plus wiring its id in the tenant report runner (TenantReportRunner.tsx).
 *
 * Entries flagged `comingSoon` render as disabled placeholder tiles — a roadmap
 * of tenant reports still to be built.
 */

import type { ReportCategory } from './reportCatalog';

export const TENANT_REPORT_CATALOG: ReportCategory[] = [
  {
    id: 'business-billing',
    label: 'Business Billing',
    accentColor: '#6B8F63',
    accentColorDark: '#8FBF86',
    reports: [
      {
        id: 'billing-activity',
        title: 'Billing Activity',
        description: 'Business billing runs, per-business charges, and failed charges',
        icon: '🧾',
      },
      {
        id: 'business-revenue',
        title: 'Business Revenue',
        description: 'Recognized billing revenue by business and cycle',
        icon: '💰',
        comingSoon: true,
      },
      {
        id: 'outstanding-business-charges',
        title: 'Outstanding Charges',
        description: 'Business charges awaiting settlement or retry',
        icon: '📄',
        comingSoon: true,
      },
    ],
  },
  {
    id: 'businesses',
    label: 'Businesses',
    accentColor: '#4A7FB5',
    accentColorDark: '#6FA0D8',
    reports: [
      {
        id: 'business-growth',
        title: 'Business Growth',
        description: 'Businesses onboarded and churned over the period',
        icon: '📈',
        comingSoon: true,
      },
    ],
  },
];
