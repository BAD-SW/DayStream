import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import {
  parseFileToGrid, detectHeaderRow, detectColumns, applyMapping,
  CUSTOMER_FIELDS, FieldDef, ColumnProposal,
} from '../services/migration/import-engine';
import {
  ImportKind, ImportResult, recordRun, listRuns, getRun,
} from '../services/migration/import-core';
import { runCustomerImport } from '../services/migration/customer-import';
import { runPaymentMethodImport } from '../services/migration/payment-method-import';
import { runAccountBalanceImport } from '../services/migration/account-balance-import';

/**
 * Data migration import routes (spec 50, Wave 1). One shape across entity kinds:
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

const WAVE1_KINDS: ImportKind[] = ['customers', 'payment_methods', 'account_balances'];

/** Field definitions per kind that drive auto-detection. Wave 1 set. */
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
    default:
      return [];
  }
}

function parseKind(raw: string, res: Response): ImportKind | null {
  if ((WAVE1_KINDS as string[]).includes(raw)) return raw as ImportKind;
  error(res, `Unsupported or not-yet-available import kind: ${raw}`, 'VALIDATION_ERROR', 400);
  return null;
}

/** Turn an uploaded file + optional explicit mapping into mapped rows. */
function buildRows(
  buffer: Buffer, fileName: string, fields: FieldDef[],
  explicitMapping: Record<number, string> | null, explicitHasHeader: boolean | null,
): { rows: Array<Record<string, string>>; hasHeader: boolean; proposals: ColumnProposal[] } {
  const { grid } = parseFileToGrid(buffer, fileName);
  const hasHeader = explicitHasHeader !== null ? explicitHasHeader : detectHeaderRow(grid).hasHeader;
  const proposals = detectColumns(grid, hasHeader, fields);
  const mapping: Record<number, string> = explicitMapping ?? {};
  if (!explicitMapping) {
    for (const p of proposals) if (p.field) mapping[p.index] = p.field;
  }
  const rows = applyMapping(grid, hasHeader, mapping);
  return { rows, hasHeader, proposals };
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
    const header = detectHeaderRow(grid);
    const proposals = detectColumns(grid, header.hasHeader, fieldsForKind(kind));
    const sampleStart = header.hasHeader ? 1 : 0;
    const sampleRows = grid.slice(sampleStart, sampleStart + 5);
    success(res, {
      hasHeader: header.hasHeader,
      columns: proposals.map((p) => p.column),
      proposedMapping: proposals,
      sampleRows,
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
    case 'account_balances': return runAccountBalanceImport({ businessId, tenantId, userId, rows, commit });
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
  const { rows } = buildRows(req.file.buffer, req.file.originalname, fieldsForKind(kind), mapping, hasHeader);

  const result = await dispatch(kind, businessId, authReq.tenantId!, authReq.user.sub, rows, commit);
  const recorded = await recordRun({
    tenantId: authReq.tenantId!, businessId, entity: kind,
    fileName: req.file.originalname, isTrial: !commit, performedBy: authReq.user.sub, result,
  });
  success(res, recorded);
}

importRouter.post('/:kind/trial', requirePermission('settings:*'), upload.single('file'), async (req, res) => {
  try { await runEndpoint(req, res, false); }
  catch (e: any) { console.error('Import trial failed', e?.message || e); error(res, 'Failed to run the trial', 'INTERNAL_ERROR', 500); }
});

importRouter.post('/:kind/commit', requirePermission('settings:*'), upload.single('file'), async (req, res) => {
  try { await runEndpoint(req, res, true); }
  catch (e: any) { console.error('Import commit failed', e?.message || e); error(res, 'Failed to run the import', 'INTERNAL_ERROR', 500); }
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
