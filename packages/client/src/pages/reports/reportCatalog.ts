/**
 * Report catalog: the grouped list of reports shown on the Reports landing page.
 * Config-driven (like dashboardGroups.ts) — adding a report is a data change
 * here plus a server-side definition, with no runner or endpoint changes.
 *
 * Entries flagged `comingSoon` render as disabled placeholder tiles: they show
 * the intended report but do not navigate, since no server definition exists yet.
 * The catalog therefore doubles as a roadmap of reports still to be built.
 */

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
      { id: 'revenue', title: 'Revenue', description: 'Posted revenue by transaction, item, and customer', icon: '💰' },
      { id: 'payments-received', title: 'Payments Received', description: 'Payments and refunds from checkout and recorded entries', icon: '🧾' },
      { id: 'outstanding-invoices', title: 'Outstanding Invoices', description: 'Unpaid and overdue balances', icon: '📄', comingSoon: true },
      { id: 'tax-summary', title: 'Tax Summary', description: 'Sales tax collected by category and rate', icon: '🏛️' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    accentColor: '#C77B3E',
    accentColorDark: '#E0A468',
    reports: [
      { id: 'sales-by-item', title: 'Sales by Item', description: 'Every item sold with quantity, gross, discount, and net', icon: '🛒' },
      { id: 'sales-by-staff', title: 'Sales by Staff', description: 'Sales attributed to each staff member', icon: '🧑‍💼' },
      { id: 'discounts-promotions', title: 'Discounts & Promotions', description: 'Discounted sales and the promotions driving them', icon: '🏷️' },
    ],
  },
  {
    id: 'bookings',
    label: 'Bookings',
    accentColor: '#4A7FB5',
    accentColorDark: '#6FA0D8',
    reports: [
      { id: 'bookings-summary', title: 'Bookings Summary', description: 'Bookings by date with service, staff, status, and price', icon: '📅' },
      { id: 'cancellations-no-shows', title: 'Cancellations & No-Shows', description: 'Missed and cancelled appointments with lost value', icon: '🚫' },
      { id: 'utilization', title: 'Utilization', description: 'Staff and resource utilization vs. scheduled time', icon: '📊' },
    ],
  },
  {
    id: 'memberships',
    label: 'Memberships',
    accentColor: '#8064B0',
    accentColorDark: '#A98AD1',
    reports: [
      { id: 'active-memberships', title: 'Active Memberships', description: 'Current active enrollments', icon: '🎫', comingSoon: true },
      { id: 'new-cancelled-memberships', title: 'New & Cancelled', description: 'Enrollment changes in the period', icon: '🔄', comingSoon: true },
      { id: 'membership-recognized-revenue', title: 'Recognized Revenue', description: 'Membership revenue recognized over time', icon: '💠', comingSoon: true },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    accentColor: '#4FA3A5',
    accentColorDark: '#73C4C6',
    reports: [
      { id: 'new-customers', title: 'New Customers', description: 'Customers acquired in the period', icon: '🧑', comingSoon: true },
      { id: 'customer-retention', title: 'Retention', description: 'Retention and churn over time', icon: '📈', comingSoon: true },
      { id: 'customer-lifetime-value', title: 'Lifetime Value', description: 'Average revenue per customer', icon: '💎', comingSoon: true },
    ],
  },
  {
    id: 'staff',
    label: 'Staff',
    accentColor: '#B5654A',
    accentColorDark: '#D8896F',
    reports: [
      { id: 'staff-performance', title: 'Staff Performance', description: 'Bookings and revenue per staff member', icon: '👥', comingSoon: true },
      { id: 'commissions', title: 'Commissions', description: 'Commission earned by staff', icon: '💵', comingSoon: true },
      { id: 'payroll-summary', title: 'Payroll Summary', description: 'Gross, deductions, and net by period', icon: '🧮', comingSoon: true },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    accentColor: '#C25E8B',
    accentColorDark: '#DE86AC',
    reports: [
      { id: 'campaign-performance', title: 'Campaign Performance', description: 'Sends, opens, and conversions', icon: '📣', comingSoon: true },
      { id: 'acquisition-by-source', title: 'Acquisition by Source', description: 'Where new customers come from', icon: '🧲', comingSoon: true },
      { id: 'email-engagement', title: 'Email Engagement', description: 'Open and click rates over time', icon: '📧', comingSoon: true },
    ],
  },
  {
    id: 'forecast',
    label: 'Forecast',
    accentColor: '#7A8B9A',
    accentColorDark: '#9FB0BE',
    reports: [
      { id: 'revenue-forecast', title: 'Revenue Forecast', description: 'Projected revenue from trends', icon: '🔮', comingSoon: true },
      { id: 'membership-renewals', title: 'Membership Renewals', description: 'Upcoming renewals and expected revenue', icon: '📆', comingSoon: true },
      { id: 'cash-flow-projection', title: 'Cash Flow Projection', description: 'Projected inflows and outflows', icon: '🌊', comingSoon: true },
    ],
  },
];
