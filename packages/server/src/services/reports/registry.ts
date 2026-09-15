import { ReportDefinition } from './types';
import { revenueReport } from './definitions/revenue.report';
import { paymentsReceivedReport } from './definitions/payments-received.report';
import { taxSummaryReport } from './definitions/tax-summary.report';
import { salesByItemReport } from './definitions/sales-by-item.report';
import { salesByStaffReport } from './definitions/sales-by-staff.report';
import { discountsPromotionsReport } from './definitions/discounts-promotions.report';
import { bookingsSummaryReport } from './definitions/bookings-summary.report';
import { cancellationsNoShowsReport } from './definitions/cancellations-no-shows.report';
import { utilizationReport } from './definitions/utilization.report';
import { activeMembershipsReport } from './definitions/active-memberships.report';
import { newCancelledMembershipsReport } from './definitions/new-cancelled-memberships.report';
import { membershipRecognizedRevenueReport } from './definitions/membership-recognized-revenue.report';

/**
 * Central registry of report definitions. Adding a new report is a matter of
 * importing its definition and adding it here — no changes to the run/export
 * endpoints or the client runner are required.
 */
const DEFINITIONS: Record<string, ReportDefinition> = {
  [revenueReport.id]: revenueReport,
  [paymentsReceivedReport.id]: paymentsReceivedReport,
  [taxSummaryReport.id]: taxSummaryReport,
  [salesByItemReport.id]: salesByItemReport,
  [salesByStaffReport.id]: salesByStaffReport,
  [discountsPromotionsReport.id]: discountsPromotionsReport,
  [bookingsSummaryReport.id]: bookingsSummaryReport,
  [cancellationsNoShowsReport.id]: cancellationsNoShowsReport,
  [utilizationReport.id]: utilizationReport,
  [activeMembershipsReport.id]: activeMembershipsReport,
  [newCancelledMembershipsReport.id]: newCancelledMembershipsReport,
  [membershipRecognizedRevenueReport.id]: membershipRecognizedRevenueReport,
};

export function getReportDefinition(id: string): ReportDefinition | null {
  return DEFINITIONS[id] ?? null;
}

export function listReportDefinitions(): ReportDefinition[] {
  return Object.values(DEFINITIONS);
}
