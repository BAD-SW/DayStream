import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import {
  parseFileToGrid, detectHeaderRow, detectColumns, applyMapping,
  repairRows, RepairSummary,
  CUSTOMER_FIELDS, FieldDef, ColumnProposal,
} from '../services/migration/import-engine';
import {
  ImportKind, ImportResult, recordRun, listRuns, getRun,
} from '../services/migration/import-core';
import { runCustomerImport } from '../services/migration/customer-import';
import { runPaymentMethodImport } from '../services/migration/payment-method-import';
import { runAccountBalanceImport } from '../services/migration/account-balance-import';
import { runMembershipImport } from '../services/migration/membership-import';
import { runPackageImport } from '../services/migration/package-import';
import { runAppointmentImport } from '../services/migration/appointment-import';
import { runTransactionImport } from '../services/migration/transaction-import';

/**
 * Data migration import routes (spec 50, Waves 1-3). One shape across entity kinds:
 *   POST /v1/import/:kind/analyze   (file → header/column detection + proposed mapping)
 *   POST /v1/import/:kind/trial     (writes nothing → full assessment + records a trial run)
 *   POST /v1/import/:kind/commit    (writes → result + records a committed run)
 *   GET  /v1/import/runs            (recent runs, all kinds, trial + committed)
 *   GET  /v1/import/runs/:id        (one run)
 *
 * Gated `settings:*` (owner/manager-level — reception/staff hold `customers:*` but
 * not `settings:*`), so bulk import is not an everyday action (Requirement 14.8).
 * Business-scoped; a tenant owner acting for a business passes its business_id.
 */

export const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

importRouter.use(authenticate);
importRouter.use(tenantContext);

// Kinds with a handler. Full locked order: customers → payment_methods → memberships →
// packages → appointments → account_balances → transactions (spec 50 §Sequence).
const SUPPORTED_KINDS: ImportKind[] = [
  'customers', 'payment_methods', 'memberships', 'packages', 'appointments', 'account_balances', 'transactions',
];

/** Field definitions per kind that drive auto-detection. Waves 1-3. */
function fieldsForKind(kind: ImportKind): FieldDef[] {
  switch (kind) {
    case 'customers':
      return CUSTOMER_FIELDS;
    case 'payment_methods':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        { field: 'stripe_customer_id', synonyms: ['stripecustomerid', 'providercustomerid', 'customerref', 'newcustomerid'] },
        { field: 'payment_method_token', synonyms: ['paymentmethodtoken', 'token', 'paymentmethodid', 'newtoken', 'pm'] },
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'brand', synonyms: ['brand', 'cardbrand'] },
        { field: 'last4', synonyms: ['last4', 'lastfour', 'cardlast4'] },
        { field: 'exp_month', synonyms: ['expmonth', 'expirymonth'] },
        { field: 'exp_year', synonyms: ['expyear', 'expiryyear'] },
        { field: 'is_default', synonyms: ['isdefault', 'default'] },
      ];
    case 'memberships':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'plan', synonyms: ['plan', 'planname', 'membership', 'membershipplan', 'membershiplevel', 'membershipname', 'level', 'tier'] },
        { field: 'next_billing_date', synonyms: ['nextbillingdate', 'nextbilling', 'nextpayment', 'nextpaymentdate', 'nextcharge', 'nextchargedate', 'renewaldate', 'renewal', 'billingdate'], valueKinds: ['date'] },
        { field: 'status', synonyms: ['status', 'membershipstatus', 'state'] },
        { field: 'start_date', synonyms: ['startdate', 'start', 'joindate', 'joined', 'membersince', 'since', 'begindate'] },
      ];
    case 'packages':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'package', synonyms: ['package', 'packagename', 'pkg', 'bundle', 'packagepurchased', 'pack'] },
        { field: 'purchase_date', synonyms: ['purchasedate', 'purchasedat', 'datepurchased', 'purchased', 'saledate', 'boughton', 'orderdate', 'date'], valueKinds: ['date'] },
      ];
    case 'appointments':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'service', synonyms: ['service', 'servicename', 'treatment', 'session', 'appointmenttype', 'type'] },
        { field: 'staff', synonyms: ['staff', 'staffmember', 'provider', 'therapist', 'trainer', 'practitioner', 'employee', 'with'] },
        { field: 'date', synonyms: ['date', 'appointmentdate', 'bookingdate', 'startdate', 'day'], valueKinds: ['date'] },
        { field: 'time', synonyms: ['time', 'starttime', 'appointmenttime', 'startat', 'at'] },
        { field: 'duration', synonyms: ['duration', 'minutes', 'length', 'mins'] },
        { field: 'status', synonyms: ['status', 'bookingstatus', 'state', 'outcome'] },
      ];
    case 'account_balances':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'type', synonyms: ['type', 'kind', 'balancetype'] },
        { field: 'amount', synonyms: ['amount', 'balance', 'total'], valueKinds: ['money'] },
        { field: 'amount_paid', synonyms: ['amountpaid', 'paid'], valueKinds: ['money'] },
        { field: 'description', synonyms: ['description', 'reason', 'memo', 'note'] },
        { field: 'issue_date', synonyms: ['issuedate', 'date', 'invoicedate'], valueKinds: ['date'] },
        { field: 'due_date', synonyms: ['duedate', 'due'], valueKinds: ['date'] },
      ];
    case 'transactions':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'date', synonyms: ['date', 'transactiondate', 'paymentdate', 'paid', 'paidon'], valueKinds: ['date'] },
        { field: 'amount', synonyms: ['amount', 'total', 'paid', 'value'], valueKinds: ['money'] },
        { field: 'description', synonyms: ['description', 'memo', 'note', 'details', 'item'] },
        { field: 'method', synonyms: ['method', 'paymentmethod', 'paymenttype', 'tender', 'via'] },
        { field: 'reference', synonyms: ['reference', 'ref', 'transactionid', 'receipt', 'receiptnumber', 'invoice', 'invoicenumber'] },
      ];
    default:
      return [];
  }
}

function parseKind(raw: string, res: Response): ImportKind | null {
  if ((SUPPORTED_KINDS as string[]).includes(raw)) return raw as ImportKind;
  error(res, `Unsupported or not-yet-available import kind: ${raw}`, 'VALIDATION_ERROR', 400);
  return null;
}

/**
 * Turn an uploaded file + optional explicit mapping into mapped rows, FIRST realigning rows
 * whose values don't fit the column profiles (Wave 4 — spec 50 §15.3). Repaired rows are mapped
 * normally; rows that can't be unambiguously realigned are dropped from the import set and
 * reported as `structure` failures keyed to their original 1-based source row number.
 */
function buildRows(
  buffer: Buffer, fileName: string, fields: FieldDef[],
  explicitMapping: Record<number, string> | null, explicitHasHeader: boolean | null,
): {
  rows: Array<Record<string, string>>;
  hasHeader: boolean;
  proposals: ColumnProposal[];
  repair: RepairSummary;
} {
  const { grid } = parseFileToGrid(buffer, fileName);
  const hasHeader = explicitHasHeader !== null ? explicitHasHeader : detectHeaderRow(grid, fields).hasHeader;
  const proposals = detectColumns(grid, hasHeader, fields);
  const mapping: Record<number, string> = explicitMapping ?? {};
  if (!explicitMapping) {
    for (const p of proposals) if (p.field) mapping[p.index] = p.field;
  }

  // Realign the DATA rows (header excluded). The engine derives the canonical structure from the
  // MAJORITY row shape, so a cluster of shifted rows can't pollute alignment detection.
  const dataGrid = hasHeader ? grid.slice(1) : grid;
  const width = Math.max(...grid.map((r) => r.length), 0);
  const repair = repairRows(dataGrid, width);

  // Map only the rows that aligned (ok or repaired); unresolved rows become structure failures.
  const unresolvedRowNums = new Set(repair.failures.map((f) => f.row)); // 1-based data-row index
  const alignedGrid = repair.rows.filter((_, i) => !unresolvedRowNums.has(i + 1));
  // Rebuild a grid the mapper understands (prepend a header placeholder when hasHeader).
  const mapGrid = hasHeader ? [grid[0] ?? [], ...alignedGrid] : alignedGrid;
  const rows = applyMapping(mapGrid, hasHeader, mapping);
  return { rows, hasHeader, proposals, repair };
}

/** Parse the optional mapping/hasHeader fields that ride alongside the upload. */
function readMappingFromBody(req: Request): { mapping: Record<number, string> | null; hasHeader: boolean | null } {
  let mapping: Record<number, string> | null = null;
  let hasHeader: boolean | null = null;
  const rawMapping = (req.body?.mapping ?? '').toString();
  if (rawMapping) {
    try {
      const parsed = JSON.parse(rawMapping);
      mapping = {};
      for (const [k, v] of Object.entries(parsed)) if (v) mapping[Number(k)] = String(v);
    } catch { mapping = null; }
  }
  const rawHeader = (req.body?.has_header ?? '').toString();
  if (rawHeader === 'true') hasHeader = true;
  else if (rawHeader === 'false') hasHeader = false;
  return { mapping, hasHeader };
}

// POST /v1/import/:kind/analyze — detect header + columns, propose a mapping.
importRouter.post('/:kind/analyze', requirePermission('settings:*'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    const kind = parseKind(req.params.kind, res); if (!kind) return;
    if (!req.file) { error(res, 'A file is required', 'VALIDATION_ERROR', 400); return; }
    const { grid } = parseFileToGrid(req.file.buffer, req.file.originalname);
    if (grid.length === 0) { error(res, 'The file is empty', 'VALIDATION_ERROR', 400); return; }
    const header = detectHeaderRow(grid, fieldsForKind(kind));
    const proposals = detectColumns(grid, header.hasHeader, fieldsForKind(kind));
    const sampleStart = header.hasHeader ? 1 : 0;
    const sampleRows = grid.slice(sampleStart, sampleStart + 5);

    // Preview row-alignment repair so the owner sees up front how many rows will be auto-corrected
    // or flagged (Wave 4 — spec 50 §15.4). Nothing is written; this is detection only.
    const dataGrid = grid.slice(sampleStart);
    const width = Math.max(...grid.map((r) => r.length), 0);
    const repair = repairRows(dataGrid, width);

    success(res, {
      hasHeader: header.hasHeader,
      columns: proposals.map((p) => p.column),
      proposedMapping: proposals,
      sampleRows,
      width,
      repair: {
        repaired: repair.repaired,
        unresolved: repair.unresolved,
        samples: repair.samples,
        failures: repair.failures,
      },
      // Per-row aligned data + bucket for the three-tab staging UI (Stage B, spec 50 §15.4).
      rows: repair.perRow,
    });
  } catch (e: any) {
    console.error('Import analyze failed', e?.message || e);
    error(res, 'Failed to analyze the file', 'INTERNAL_ERROR', 500);
  }
});

async function dispatch(
  kind: ImportKind, businessId: string, tenantId: string, userId: string,
  rows: Array<Record<string, string>>, commit: boolean,
): Promise<ImportResult> {
  switch (kind) {
    case 'customers': return runCustomerImport({ businessId, tenantId, userId, rows, commit });
    case 'payment_methods': return runPaymentMethodImport({ businessId, tenantId, userId, rows, commit });
    case 'memberships': return runMembershipImport({ businessId, tenantId, userId, rows, commit });
    case 'packages': return runPackageImport({ businessId, tenantId, userId, rows, commit });
    case 'appointments': return runAppointmentImport({ businessId, tenantId, userId, rows, commit });
    case 'account_balances': return runAccountBalanceImport({ businessId, tenantId, userId, rows, commit });
    case 'transactions': return runTransactionImport({ businessId, tenantId, userId, rows, commit });
    default: throw new Error(`No handler for kind ${kind}`);
  }
}

// POST /v1/import/:kind/trial and /commit — run the import (writes nothing on trial).
async function runEndpoint(req: Request, res: Response, commit: boolean): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const kind = parseKind(req.params.kind, res); if (!kind) return;
  const businessId = (req.body?.business_id || '').toString();
  if (!businessId) { error(res, 'business_id is required', 'VALIDATION_ERROR', 400); return; }
  if (!req.file) { error(res, 'A file is required', 'VALIDATION_ERROR', 400); return; }

  const { mapping, hasHeader } = readMappingFromBody(req);
  const { rows, repair } = buildRows(req.file.buffer, req.file.originalname, fieldsForKind(kind), mapping, hasHeader);

  const result = await dispatch(kind, businessId, authReq.tenantId!, authReq.user.sub, rows, commit);

  // Fold row-alignment outcomes into the result: rows we couldn't realign are structure
  // failures (never imported); repaired rows imported, but the owner should review them. The
  // entity importer counted only the aligned rows it received, so add the structure failures on
  // top and expose the repair summary for the before/after review (Wave 4 — spec 50 §15.4).
  for (const f of repair.failures) {
    result.failures.push({ row: f.row, field: 'structure', message: f.reason });
  }
  result.failed += repair.failures.length;
  result.total += repair.failures.length;
  const withRepair = { ...result, repair: { repaired: repair.repaired, unresolved: repair.unresolved, samples: repair.samples } };

  const recorded = await recordRun({
    tenantId: authReq.tenantId!, businessId, entity: kind,
    fileName: req.file.originalname, isTrial: !commit, performedBy: authReq.user.sub, result,
  });
  success(res, { ...recorded, repair: withRepair.repair });
}

importRouter.post('/:kind/trial', requirePermission('settings:*'), upload.single('file'), async (req, res) => {
  try { await runEndpoint(req, res, false); }
  catch (e: any) { console.error('Import trial failed', e?.message || e); error(res, 'Failed to run the trial', 'INTERNAL_ERROR', 500); }
});

importRouter.post('/:kind/commit', requirePermission('settings:*'), upload.single('file'), async (req, res) => {
  try { await runEndpoint(req, res, true); }
  catch (e: any) { console.error('Import commit failed', e?.message || e); error(res, 'Failed to run the import', 'INTERNAL_ERROR', 500); }
});

/**
 * POST /v1/import/:kind/commit-rows and /trial-rows — Stage B (three-tab staging). The client has
 * already classified and (for Error rows) hand-aligned the rows in the browser, so here we commit
 * the EXACT cell arrays it sends (the accepted "Mapped" set), not a re-parse of the file. JSON body:
 *   { business_id, mapping: {colIndex: field}, rows: string[][], file_name? }
 * Mapping is applied to each supplied aligned row, then dispatched to the entity importer. Record-
 * level idempotency (Requirement 12) makes repeated commits of overlapping rows report `matched`,
 * never duplicate — which is what lets the owner import the Mapped set in parts.
 */
async function runRowsEndpoint(req: Request, res: Response, commit: boolean): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const kind = parseKind(req.params.kind, res); if (!kind) return;
  const businessId = (req.body?.business_id || '').toString();
  if (!businessId) { error(res, 'business_id is required', 'VALIDATION_ERROR', 400); return; }

  const rawRows = req.body?.rows;
  const rawMapping = req.body?.mapping;
  if (!Array.isArray(rawRows)) { error(res, 'rows[] is required', 'VALIDATION_ERROR', 400); return; }
  if (!rawMapping || typeof rawMapping !== 'object') { error(res, 'mapping is required', 'VALIDATION_ERROR', 400); return; }

  // Map each aligned cell-array to a field-keyed object using the confirmed mapping.
  const mapping: Record<number, string> = {};
  for (const [k, v] of Object.entries(rawMapping)) if (v) mapping[Number(k)] = String(v);
  const rows: Array<Record<string, string>> = (rawRows as unknown[]).map((r) => {
    const cells = Array.isArray(r) ? (r as unknown[]).map((c) => String(c ?? '')) : [];
    const obj: Record<string, string> = {};
    for (const [idxStr, field] of Object.entries(mapping)) obj[field] = (cells[Number(idxStr)] ?? '').trim();
    return obj;
  });

  const result = await dispatch(kind, businessId, authReq.tenantId!, authReq.user.sub, rows, commit);
  const recorded = await recordRun({
    tenantId: authReq.tenantId!, businessId, entity: kind,
    fileName: (req.body?.file_name || null), isTrial: !commit, performedBy: authReq.user.sub, result,
  });
  success(res, recorded);
}

importRouter.post('/:kind/trial-rows', requirePermission('settings:*'), async (req, res) => {
  try { await runRowsEndpoint(req, res, false); }
  catch (e: any) { console.error('Import trial-rows failed', e?.message || e); error(res, 'Failed to run the trial', 'INTERNAL_ERROR', 500); }
});

importRouter.post('/:kind/commit-rows', requirePermission('settings:*'), async (req, res) => {
  try { await runRowsEndpoint(req, res, true); }
  catch (e: any) { console.error('Import commit-rows failed', e?.message || e); error(res, 'Failed to run the import', 'INTERNAL_ERROR', 500); }
});

// GET /v1/import/runs — recent runs for a business.
importRouter.get('/runs', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = (req.query.business_id as string) || '';
    if (!businessId) { error(res, 'business_id is required', 'VALIDATION_ERROR', 400); return; }
    success(res, await listRuns(businessId));
  } catch (e: any) { console.error('List import runs failed', e?.message || e); error(res, 'Failed to list runs', 'INTERNAL_ERROR', 500); }
});

importRouter.get('/runs/:id', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = (req.query.business_id as string) || '';
    if (!businessId) { error(res, 'business_id is required', 'VALIDATION_ERROR', 400); return; }
    const run = await getRun(req.params.id, businessId);
    if (!run) { error(res, 'Run not found', 'NOT_FOUND', 404); return; }
    success(res, run);
  } catch (e: any) { console.error('Get import run failed', e?.message || e); error(res, 'Failed to read run', 'INTERNAL_ERROR', 500); }
});
