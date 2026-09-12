import { ReportDefinition } from './types';
import { revenueReport } from './definitions/revenue.report';
import { paymentsReceivedReport } from './definitions/payments-received.report';
import { taxSummaryReport } from './definitions/tax-summary.report';
import { salesByItemReport } from './definitions/sales-by-item.report';
import { salesByStaffReport } from './definitions/sales-by-staff.report';

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
};

export function getReportDefinition(id: string): ReportDefinition | null {
  return DEFINITIONS[id] ?? null;
}

export function listReportDefinitions(): ReportDefinition[] {
  return Object.values(DEFINITIONS);
}
