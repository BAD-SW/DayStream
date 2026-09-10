/**
 * Report catalog: the grouped list of reports shown on the Reports landing page.
 * Config-driven (like dashboardGroups.ts) — adding a report is a data change
 * here plus a server-side definition, with no runner or endpoint changes.
 */

export interface ReportCatalogEntry {
  /** Must match the server report definition id (see services/reports/registry.ts). */
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Permission required to see this report tile; defaults to reports:read. */
  permission?: string;
}

export interface ReportCategory {
  id: string;
  label: string;
  accentColor: string;
  accentColorDark: string;
  reports: ReportCatalogEntry[];
}

export const REPORT_CATALOG: ReportCategory[] = [
  {
    id: 'accounting',
    label: 'Accounting',
    accentColor: '#6B8F63',
    accentColorDark: '#8FBF86',
    reports: [
      {
        id: 'revenue',
        title: 'Revenue',
        description: 'Posted revenue by transaction, item, and customer',
        icon: '💰',
      },
    ],
  },
];
