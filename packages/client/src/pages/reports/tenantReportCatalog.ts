/**
 * Tenant report catalog: the grouped list of tenant-wide reports shown on the
 * tenant-level Reports hub (tenant persona). Config-driven, mirroring the system
 * systemReportCatalog.ts one level down — adding a report is a data change here
 * plus wiring its id in the tenant report runner (TenantReportRunner.tsx).
 *
 * Entries flagged `comingSoon` render as disabled placeholder tiles — a roadmap
 * of tenant reports still to be built.
 */

import type { ReportCatalogEntry, ReportCategory } from './reportCatalog';
import i18n from '../../i18n';

// The name, description and category label are translated where they are read (a getter), never when
// this module loads, so they follow the language shown. Same shape as reportCatalog.ts. Phrases:
// tenantOps.json, catalog.report.<id>.title / .description and catalog.category.<id>.
const text = (key: string): string => i18n.t(key, { ns: 'tenantOps' });

/** One catalog entry; its title and description come from the translation files by report id. */
function report(id: string, icon: string, extra: Partial<ReportCatalogEntry> = {}): ReportCatalogEntry {
  return {
    ...extra,
    id,
    icon,
    get title() { return text(`catalog.report.${id}.title`); },
    get description() { return text(`catalog.report.${id}.description`); },
  };
}

export const TENANT_REPORT_CATALOG: ReportCategory[] = [
  {
    id: 'business-billing',
    get label() { return text('catalog.category.business-billing'); },
    accentColor: '#6B8F63',
    accentColorDark: '#8FBF86',
    reports: [
      report('billing-activity', '🧾'),
      report('business-revenue', '💰', { comingSoon: true }),
      report('outstanding-business-charges', '📄', { comingSoon: true }),
    ],
  },
  {
    id: 'businesses',
    get label() { return text('catalog.category.businesses'); },
    accentColor: '#4A7FB5',
    accentColorDark: '#6FA0D8',
    reports: [
      report('business-growth', '📈', { comingSoon: true }),
    ],
  },
];
