import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext, canReachBusiness } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import {
  parseFileToGrid, detectHeaderRow, detectColumns, applyMapping,
  repairRows, RepairSummary, canonicalProfiles, realignRowTail, rowFits, ColumnProfile,
  CUSTOMER_FIELDS, PAYMENT_METHOD_FIELDS, FieldDef, ColumnProposal, ReferenceSet,
} from '../services/migration/import-engine';
import { adminPool } from '../db/pool';
import { applySourcePreset, isValidSource } from '../services/migration/import-sources';
import {
  ImportKind, ImportResult, recordRun, listRuns, getRun, DateOrder, detectDateOrder, normalizeRefName,
} from '../services/migration/import-core';
import { runCustomerImport } from '../services/migration/customer-import';
import { runPaymentMethodImport } from '../services/migration/payment-method-import';
import { runAccountBalanceImport } from '../services/migration/account-balance-import';
import { runMembershipImport } from '../services/migration/membership-import';
import { runPackageImport } from '../services/migration/package-import';
import { runAppointmentImport } from '../services/migration/appointment-import';
import { runTransactionImport } from '../services/migration/transaction-import';
import { runNotesImport } from '../services/migration/notes-import';

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
  'customers', 'payment_methods', 'memberships', 'packages', 'appointments', 'account_balances', 'transactions', 'notes',
];

/**
 * The customer's id at the previous payment processor (Requirement 19), offered on every
 * customer-linked import as an exact match key against the id captured by the customer import.
 * A cus_ column is also found by value (detectColumns Pass 1b).
 */
const PROCESSOR_CUSTOMER_ID_FIELD: FieldDef = CUSTOMER_FIELDS.find((f) => f.field === 'processor_customer_id')!;

/** Field definitions per kind that drive auto-detection. Waves 1-3. */
function fieldsForKind(kind: ImportKind): FieldDef[] {
  switch (kind) {
    case 'customers':
      return CUSTOMER_FIELDS;
    case 'payment_methods':
      return PAYMENT_METHOD_FIELDS;
    case 'memberships':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        PROCESSOR_CUSTOMER_ID_FIELD,
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
        PROCESSOR_CUSTOMER_ID_FIELD,
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'package', synonyms: ['package', 'packagename', 'pkg', 'bundle', 'packagepurchased', 'pack'] },
        { field: 'purchase_date', synonyms: ['purchasedate', 'purchasedat', 'datepurchased', 'purchased', 'saledate', 'boughton', 'orderdate', 'date'], valueKinds: ['date'] },
      ];
    case 'appointments':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        PROCESSOR_CUSTOMER_ID_FIELD,
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
        PROCESSOR_CUSTOMER_ID_FIELD,
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
        PROCESSOR_CUSTOMER_ID_FIELD,
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'date', synonyms: ['date', 'transactiondate', 'paymentdate', 'paid', 'paidon'], valueKinds: ['date'] },
        { field: 'amount', synonyms: ['amount', 'total', 'paid', 'value'], valueKinds: ['money'] },
        { field: 'description', synonyms: ['description', 'memo', 'note', 'details', 'item'] },
        { field: 'method', synonyms: ['method', 'paymentmethod', 'paymenttype', 'tender', 'via'] },
        { field: 'reference', synonyms: ['reference', 'ref', 'transactionid', 'receipt', 'receiptnumber', 'invoice', 'invoicenumber'] },
      ];
    case 'notes':
      return [
        { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'oldcustomerid', 'customerid'] },
        PROCESSOR_CUSTOMER_ID_FIELD,
        { field: 'email', synonyms: ['email', 'emailaddress'], valueKinds: ['email'] },
        { field: 'phone', synonyms: ['phone', 'mobile'], valueKinds: ['phone'] },
        { field: 'note', synonyms: ['note', 'notes', 'comment', 'comments', 'remark', 'remarks', 'text', 'body', 'detail', 'details'] },
        { field: 'date', synonyms: ['date', 'notedate', 'createddate', 'created', 'createdon', 'timestamp'], valueKinds: ['date'] },
        { field: 'author', synonyms: ['author', 'createdby', 'staff', 'staffmember', 'user', 'enteredby', 'by'] },
        { field: 'category', synonyms: ['category', 'type', 'notetype', 'kind', 'tag'] },
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

/**
 * Values the business already holds, for recognising columns by value (detectColumns Pass 1c):
 * the legacy customer ids stored by the customer import (every import), and the business's
 * membership plan names (memberships). Read-only; nothing here is written.
 */
/**
 * Payment-method words a legacy file may use, keyed by DayStream's accepted-method code
 * (pay_accepted_methods.method). Only the methods the business accepts are offered as matches.
 */
const METHOD_WORDS: Record<string, string[]> = {
  cash: ['cash'],
  card: ['card', 'credit card', 'debit card', 'credit', 'debit', 'visa', 'mastercard', 'master card', 'amex', 'american express', 'discover', 'maestro', 'card payment'],
  bank_transfer: ['bank transfer', 'transfer', 'wire', 'wire transfer', 'bank'],
  check: ['check', 'cheque'],
  gift_card: ['gift card', 'giftcard', 'voucher', 'gift voucher', 'gift certificate'],
  bank_draw: ['direct debit', 'sepa', 'ach', 'bacs', 'bank draw'],
  google_pay: ['google pay', 'gpay'],
  apple_pay: ['apple pay'],
  other: ['other'],
};

/**
 * Values the business already holds, for recognising columns by value (detectColumns Pass 1c).
 * For every import: the legacy and processor customer ids stored by the customer import. Then
 * per import, the setup it refers to: plan names (memberships), package names (packages), service
 * names, staff names and service lengths (appointments), accepted payment methods (transactions),
 * staff names and note categories (notes). Read-only.
 */
async function loadReferenceValues(kind: ImportKind, businessId: string): Promise<ReferenceSet> {
  const refs: ReferenceSet = {};
  const idNorm = (v: string) => v.trim().toLowerCase();
  const nameRef = (names: string[]): ReferenceSet[string] | undefined => {
    const values = new Set(names.map(normalizeRefName).filter(Boolean));
    return values.size ? { values, normalize: normalizeRefName } : undefined;
  };
  const setRef = (field: string, ref: ReferenceSet[string] | undefined) => { if (ref) refs[field] = ref; };
  const q = async <T extends Record<string, unknown>>(sql: string): Promise<T[]> =>
    (await adminPool.query<T>(sql, [businessId])).rows;

  const ids = await q<{ legacy: string | null; processor: string | null }>(
    `SELECT legacy_customer_id AS legacy, processor_customer_id AS processor FROM cus_customers
     WHERE business_id = $1 AND status <> 'merged' AND (legacy_customer_id <> '' OR processor_customer_id <> '')`,
  );
  const legacy = new Set(ids.map((r) => r.legacy).filter((v): v is string => !!v).map(idNorm));
  const processor = new Set(ids.map((r) => r.processor).filter((v): v is string => !!v).map(idNorm));
  if (legacy.size) refs.legacy_customer_id = { values: legacy, normalize: idNorm };
  if (processor.size) refs.processor_customer_id = { values: processor, normalize: idNorm };

  const staffNames = async (withFirstNames: boolean) => {
    const staff = await q<{ first_name: string; last_name: string }>(
      `SELECT sp.first_name, sp.last_name FROM stf_profiles sp JOIN usr_users u ON u.id = sp.user_id
       WHERE u.business_id = $1 AND sp.status = 'active'`,
    );
    return staff.flatMap((s) => [`${s.first_name} ${s.last_name}`, ...(withFirstNames ? [s.first_name] : [])]);
  };

  switch (kind) {
    case 'memberships':
      setRef('plan', nameRef((await q<{ name: string }>('SELECT name FROM mbr_plans WHERE business_id = $1')).map((r) => r.name)));
      break;
    case 'packages':
      // Archived packages are accepted by the import, so they count here too.
      setRef('package', nameRef((await q<{ name: string }>('SELECT name FROM pkg_packages WHERE business_id = $1')).map((r) => r.name)));
      break;
    case 'appointments': {
      setRef('service', nameRef((await q<{ name: string }>(`SELECT name FROM svc_services WHERE business_id = $1 AND status <> 'archived'`)).map((r) => r.name)));
      // The appointment import matches staff by full name, so only full names count.
      setRef('staff', nameRef(await staffNames(false)));
      const durations = await q<{ duration: number }>(
        `SELECT DISTINCT v.duration FROM svc_variants v JOIN svc_services s ON s.id = v.service_id
         WHERE s.business_id = $1 AND v.status = 'active'`,
      );
      if (durations.length) refs.duration = { values: new Set(durations.map((d) => String(d.duration))), normalize: (v) => String(Number(v.trim())) };
      break;
    }
    case 'transactions': {
      const accepted = await q<{ method: string }>('SELECT method FROM pay_accepted_methods WHERE business_id = $1 AND enabled = true');
      const words = accepted.flatMap((a) => [a.method.replace(/_/g, ' '), ...(METHOD_WORDS[a.method] ?? [])]);
      setRef('method', nameRef(words));
      break;
    }
    case 'notes':
      // Author is only kept with the note, so a first name alone counts.
      setRef('author', nameRef(await staffNames(true)));
      setRef('category', nameRef((await q<{ name: string }>('SELECT name FROM cus_note_categories WHERE business_id = $1')).map((r) => r.name)));
      break;
    default:
      break;
  }
  return refs;
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
    // The source system chosen before upload (Requirement 19): its known layout overrides guessing.
    const source = (req.body?.source || 'auto').toString();
    if (!isValidSource(source, kind)) { error(res, `Unknown source system "${source}" for this import`, 'VALIDATION_ERROR', 400); return; }
    // Row 1 is a header when it reads as labels over the data below. The owner can say "it's data"
    // (has_header=false) when that guess is wrong; the file is then re-analyzed with row 1 as data.
    const detected = detectHeaderRow(grid, fieldsForKind(kind));
    const header = req.body?.has_header === 'false' ? { ...detected, hasHeader: false } : detected;
    // Values this business already holds, so columns can be recognised by matching them.
    const businessId = (req.query.business_id || req.body?.business_id || '').toString();
    if (!businessId) { error(res, 'business_id is required', 'VALIDATION_ERROR', 400); return; }
    // A multipart body is parsed after tenantContext, so its business_id was never checked there.
    if (!(await canReachBusiness(req, businessId))) { error(res, 'You do not have access to this business', 'BUSINESS_FORBIDDEN', 403); return; }
    const references = await loadReferenceValues(kind, businessId);
    // The owner picks only the system; which of its file layouts this is gets recognised here.
    const { proposals, layout: sourceLayout } = applySourcePreset(
      detectColumns(grid, header.hasHeader, fieldsForKind(kind), references), grid[0] ?? [], header.hasHeader, source,
    );
    const sampleStart = header.hasHeader ? 1 : 0;
    const sampleRows = grid.slice(sampleStart, sampleStart + 5);

    // Preview row-alignment repair so the owner sees up front how many rows will be auto-corrected
    // or flagged (Wave 4 — spec 50 §15.4). Nothing is written; this is detection only.
    const dataGrid = grid.slice(sampleStart);
    const width = Math.max(...grid.map((r) => r.length), 0);
    const repair = repairRows(dataGrid, width);
    // The canonical column profiles — returned so the client can ask us to re-align a single row
    // (per-cell shift) without re-uploading the file (POST /realign-row).
    const profiles = canonicalProfiles(dataGrid, width).profiles;

    success(res, {
      hasHeader: header.hasHeader,
      // Which of the chosen system's layouts was recognised (null for automatic, or no match).
      sourceLayout,
      // Day-first or month-first, read from every date in the file (one export, one format); null
      // when the file can't tell, so the import uses the business's own order. Sent back on commit.
      dateOrder: detectDateOrder(dataGrid.flat()),
      sourceRecognized: source === 'auto' ? null : sourceLayout !== null,
      columns: proposals.map((p) => p.column),
      proposedMapping: proposals,
      sampleRows,
      width,
      profiles,
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

/**
 * Run one import. `dateOrder` is the whole file's date order from analyze: a file committed in
 * batches must read every batch's dates the same way. Null lets the importer work it out itself
 * (the whole-file endpoints, where it sees every row).
 */
async function dispatch(
  kind: ImportKind, businessId: string, tenantId: string, userId: string,
  rows: Array<Record<string, string>>, commit: boolean, dateOrder: DateOrder | null = null,
): Promise<ImportResult> {
  const args = { businessId, tenantId, userId, rows, commit, dateOrder };
  switch (kind) {
    case 'customers': return runCustomerImport(args);
    case 'payment_methods': return runPaymentMethodImport(args);
    case 'memberships': return runMembershipImport(args);
    case 'packages': return runPackageImport(args);
    case 'appointments': return runAppointmentImport(args);
    case 'account_balances': return runAccountBalanceImport(args);
    case 'transactions': return runTransactionImport(args);
    case 'notes': return runNotesImport(args);
    default: throw new Error(`No handler for kind ${kind}`);
  }
}

// POST /v1/import/:kind/trial and /commit — run the import (writes nothing on trial).
async function runEndpoint(req: Request, res: Response, commit: boolean): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const kind = parseKind(req.params.kind, res); if (!kind) return;
  const businessId = (req.body?.business_id || '').toString();
  if (!businessId) { error(res, 'business_id is required', 'VALIDATION_ERROR', 400); return; }
  // A multipart body is parsed after tenantContext, so its business_id was never checked there.
  if (!(await canReachBusiness(req, businessId))) { error(res, 'You do not have access to this business', 'BUSINESS_FORBIDDEN', 403); return; }
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

  const rawOrder = req.body?.date_order;
  const dateOrder: DateOrder | null = rawOrder === 'dmy' || rawOrder === 'mdy' ? rawOrder : null;
  const result = await dispatch(kind, businessId, authReq.tenantId!, authReq.user.sub, rows, commit, dateOrder);
  // Batched commits ask us not to record a run per batch; the client records ONE summary run at the end.
  if (req.body?.defer_record === true) { success(res, result); return; }
  const recorded = await recordRun({
    tenantId: authReq.tenantId!, businessId, entity: kind,
    fileName: (req.body?.file_name || null), isTrial: !commit, performedBy: authReq.user.sub, result,
  });
  success(res, recorded);
}

// POST /v1/import/:kind/record-run — one summary run for a batched commit (see defer_record above).
importRouter.post('/:kind/record-run', requirePermission('settings:*'), async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const kind = parseKind(req.params.kind, res); if (!kind) return;
    const businessId = (req.body?.business_id || '').toString();
    if (!businessId) { error(res, 'business_id is required', 'VALIDATION_ERROR', 400); return; }
    const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
    const result = { runId: null, total: n(req.body?.total), imported: n(req.body?.imported), matched: n(req.body?.matched), failed: n(req.body?.failed), failures: [], warnings: [] };
    const recorded = await recordRun({
      tenantId: authReq.tenantId!, businessId, entity: kind,
      fileName: (req.body?.file_name || null), isTrial: false, performedBy: authReq.user.sub, result,
    });
    success(res, recorded);
  } catch (e: any) { console.error('Import record-run failed', e?.message || e); error(res, 'Failed to record the import', 'INTERNAL_ERROR', 500); }
});

importRouter.post('/:kind/trial-rows', requirePermission('settings:*'), async (req, res) => {
  try { await runRowsEndpoint(req, res, false); }
  catch (e: any) { console.error('Import trial-rows failed', e?.message || e); error(res, 'Failed to run the trial', 'INTERNAL_ERROR', 500); }
});

importRouter.post('/:kind/commit-rows', requirePermission('settings:*'), async (req, res) => {
  try { await runRowsEndpoint(req, res, true); }
  catch (e: any) { console.error('Import commit-rows failed', e?.message || e); error(res, 'Failed to run the import', 'INTERNAL_ERROR', 500); }
});

/**
 * POST /v1/import/:kind/realign-row — the engine behind the per-cell shift arrows (spec 50 UI).
 * The user shifts one cell (the hint): the value at `index` belongs to the right (direction
 * 'right') or into the empty slot to its left (direction 'left'). Columns before the shift point
 * stay fixed; the engine intelligently re-positions the REMAINING values by profile-fit. JSON:
 *   { cells: string[], profiles: ColumnProfile[], index: number, direction: 'left'|'right' }
 * Returns { cells, aligned }. Stateless, one row — the profiles came from the analyze response.
 */
importRouter.post('/:kind/realign-row', requirePermission('settings:*'), (req: Request, res: Response) => {
  try {
    const kind = parseKind(req.params.kind, res); if (!kind) return;
    const cells: string[] = Array.isArray(req.body?.cells) ? req.body.cells.map((c: unknown) => String(c ?? '')) : [];
    const profiles: ColumnProfile[] = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
    const index = Number(req.body?.index);
    // 'check' = the user hand-edited a cell: nothing moves, the row is just re-checked.
    if (req.body?.direction === 'check') {
      if (profiles.length === 0) { error(res, 'cells and profiles are required', 'VALIDATION_ERROR', 400); return; }
      success(res, rowFits(cells, profiles));
      return;
    }
    const direction = req.body?.direction === 'left' ? 'left' : 'right';
    if (profiles.length === 0 || !Number.isInteger(index) || index < 0) {
      error(res, 'cells, profiles and a valid index are required', 'VALIDATION_ERROR', 400); return;
    }
    // Right shift: re-fit from the shifted column, forcing its value to move right (leading gap).
    // Left shift: the value moves into the empty slot to its left, so re-fit from index-1.
    const result = direction === 'right'
      ? realignRowTail(cells, profiles, index, true)
      : realignRowTail(cells, profiles, Math.max(0, index - 1), false);
    success(res, result);
  } catch (e: any) {
    console.error('Import realign-row failed', e?.message || e);
    error(res, 'Failed to realign the row', 'INTERNAL_ERROR', 500);
  }
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
