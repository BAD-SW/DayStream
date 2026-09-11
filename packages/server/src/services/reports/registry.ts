import { ReportDefinition } from './types';
import { revenueReport } from './definitions/revenue.report';
import { paymentsReceivedReport } from './definitions/payments-received.report';

/**
 * Central registry of report definitions. Adding a new report is a matter of
 * importing its definition and adding it here — no changes to the run/export
 * endpoints or the client runner are required.
 */
const DEFINITIONS: Record<string, ReportDefinition> = {
  [revenueReport.id]: revenueReport,
  [paymentsReceivedReport.id]: paymentsReceivedReport,
};

export function getReportDefinition(id: string): ReportDefinition | null {
  return DEFINITIONS[id] ?? null;
}

export function listReportDefinitions(): ReportDefinition[] {
  return Object.values(DEFINITIONS);
}
