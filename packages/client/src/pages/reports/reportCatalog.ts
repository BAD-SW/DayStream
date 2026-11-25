/**
 * Report catalog: the grouped list of reports shown on the Reports landing page.
 * Config-driven (like dashboardGroups.ts) — adding a report is a data change
 * here plus a server-side definition, with no runner or endpoint changes.
 *
 * Entries flagged `comingSoon` render as disabled placeholder tiles: they show
 * the intended report but do not navigate, since no server definition exists yet.
 * The catalog therefore doubles as a roadmap of reports still to be built.
 */

import i18n from '../../i18n';

export interface ReportCatalogEntry {
  /** Must match the server report definition id (see services/reports/registry.ts). */
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Permission required to see this report tile; defaults to reports:read. */
  permission?: string;
  /** Placeholder — no server definition yet; tile is disabled and does not navigate. */
  comingSoon?: boolean;
  /** A position on one date: one 'As of' date (today by default) instead of From and To. */
  asOf?: boolean;
}

export interface ReportCategory {
  id: string;
  label: string;
  accentColor: string;
  accentColorDark: string;
  reports: ReportCatalogEntry[];
}

// The name, description and category label are translated where they are read (a getter), never when
// this module loads, so they follow the language shown. Tenant and system report files import these
// types and read title, description and label as plain strings, which keeps working. Phrases:
// reports.json, catalog.report.<id>.title / .description and catalog.category.<id>.
const text = (key: string): string => i18n.t(key, { ns: 'reports' });

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

export const REPORT_CATALOG: ReportCategory[] = [
  {
    id: 'accounting',
    get label() { return text('catalog.category.accounting'); },
    accentColor: '#6B8F63',
    accentColorDark: '#8FBF86',
    reports: [
      report('revenue', '💰'),
      report('payments-received', '🧾'),
      report('reconciliation', '⚖️'),
      report('outstanding-receivables', '📄', { comingSoon: true }),
      report('tax-summary', '🏛️'),
    ],
  },
  {
    id: 'sales',
    get label() { return text('catalog.category.sales'); },
    accentColor: '#C77B3E',
    accentColorDark: '#E0A468',
    reports: [
      report('sales-by-item', '🛒'),
      report('sales-by-staff', '🧑‍💼'),
      report('discounts-promotions', '🏷️'),
    ],
  },
  {
    id: 'bookings',
    get label() { return text('catalog.category.bookings'); },
    accentColor: '#4A7FB5',
    accentColorDark: '#6FA0D8',
    reports: [
      report('bookings-summary', '📅'),
      report('cancellations-no-shows', '🚫'),
      report('utilization', '📊'),
    ],
  },
  {
    id: 'memberships',
    get label() { return text('catalog.category.memberships'); },
    accentColor: '#8064B0',
    accentColorDark: '#A98AD1',
    reports: [
      report('active-memberships', '🎫'),
      report('new-cancelled-memberships', '🔄'),
      report('membership-recognized-revenue', '💠'),
    ],
  },
  {
    id: 'customers',
    get label() { return text('catalog.category.customers'); },
    accentColor: '#4FA3A5',
    accentColorDark: '#73C4C6',
    reports: [
      report('new-customers', '🧑'),
      report('customer-retention', '📈'),
      report('customer-lifetime-value', '💎'),
      report('gift-cards', '🎁', { permission: 'bookings:read' }),
    ],
  },
  {
    id: 'staff',
    get label() { return text('catalog.category.staff'); },
    accentColor: '#B5654A',
    accentColorDark: '#D8896F',
    reports: [
      report('staff-performance', '👥'),
      report('commissions', '💵'),
      report('payroll-summary', '🧮'),
      report('timesheet', '⏱️'),
      // Spec 51, gap 14
      report('tips', '🙏'),
    ],
  },
  {
    id: 'marketing',
    get label() { return text('catalog.category.marketing'); },
    accentColor: '#C25E8B',
    accentColorDark: '#DE86AC',
    reports: [
      report('campaign-performance', '📣', { comingSoon: true }),
      report('acquisition-by-source', '🧲', { comingSoon: true }),
      report('email-engagement', '📧', { comingSoon: true }),
    ],
  },
  {
    id: 'forecast',
    get label() { return text('catalog.category.forecast'); },
    accentColor: '#7A8B9A',
    accentColorDark: '#9FB0BE',
    reports: [
      report('revenue-forecast', '🔮', { comingSoon: true }),
      report('membership-renewals', '📆', { comingSoon: true }),
      report('cash-flow-projection', '🌊', { comingSoon: true }),
    ],
  },
  {
    // Spec 51, gap 7 (owner, 19 Nov 2026: a category of its own).
    id: 'inventory',
    get label() { return text('catalog.category.inventory'); },
    accentColor: '#8A6E4B',
    accentColorDark: '#B8976D',
    reports: [
      report('inventory-stock-value', '📦', { asOf: true }),
      report('inventory-low-stock', '⚠', { asOf: true }),
      report('inventory-movements', '🔁'),
    ],
  },
];
