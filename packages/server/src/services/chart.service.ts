import { createHash, randomUUID } from 'crypto';
import { adminPool } from '../db/pool';
import { encrypt, decrypt } from '../utils/encryption';
import { logAuditStrict } from './audit.service';
import { storage } from './storage.service';
import { storagePaths, pathFromReference } from '../utils/storage-paths';
import { renderFormPdf } from './forms-pdf';
import { validateFormAnswers } from '@daystream/shared';
import type { FormDefinition, FormAnswer } from '@daystream/shared';

/**
 * Treatment charting (spec 51, gap 2).
 *
 * A chart is a chart template filled in by a practitioner about a customer, against a booking or
 * on its own. The template as it was and the answers are stored encrypted, so earlier charts can
 * be shown at the next visit. A chart is a draft until a practitioner signs it off; it is then
 * locked, and corrections are added as amendments that never change the original.
 *
 * Every view and change is written to the audit log first with logAuditStrict: if the log entry
 * cannot be written, the action is refused. Access control (clinical roles only) is enforced by
 * the route; every query here is also scoped by business_id.
 */

export class ChartError extends Error {
  code: string;
  details?: unknown;
  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'ChartError';
    this.code = code;
    this.details = details;
  }
}

/** Who is acting, for the audit log. */
export interface ChartActor {
  userId: string;
  tenantId: string;
  /** Whether the user may delete other people's drafts (owner or manager). */
  isManager: boolean;
  ip?: string;
  userAgent?: string;
}

type Answers = Record<string, FormAnswer | undefined>;

export interface Amendment {
  id: string;
  content: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface ChartSummary {
  id: string;
  customerId: string;
  bookingId: string | null;
  formName: string;
  formVersion: number;
  status: 'draft' | 'signed';
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  signedByName: string | null;
  signedAt: string | null;
  amendmentCount: number;
}

export interface Chart extends ChartSummary {
  definition: FormDefinition;
  answers: Answers;
  amendments: Amendment[];
}

const MAX_ANSWERS_BYTES = 200 * 1024;
const MAX_AMENDMENT = 5000;
const EDIT_AUDIT_WINDOW = '30 minutes';

/* eslint-disable @typescript-eslint/no-explicit-any */
function summary(r: any): ChartSummary {
  return {
    id: r.id,
    customerId: r.customer_id,
    bookingId: r.booking_id,
    formName: r.form_name,
    formVersion: r.form_version,
    status: r.status,
    createdBy: r.created_by,
    createdByName: r.created_by_name || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    signedByName: r.signed_by_name || null,
    signedAt: r.signed_at,
    amendmentCount: Number(r.amendment_count ?? 0),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SELECT_SUMMARY = `
  SELECT ch.id, ch.customer_id, ch.booking_id, ch.form_name, ch.form_version, ch.status,
         ch.created_by, ch.created_at, ch.updated_at, ch.signed_at,
         TRIM(COALESCE(cu.first_name, '') || ' ' || COALESCE(cu.last_name, '')) AS created_by_name,
         TRIM(COALESCE(su.first_name, '') || ' ' || COALESCE(su.last_name, '')) AS signed_by_name,
         (SELECT COUNT(*) FROM chr_amendments a WHERE a.chart_id = ch.id) AS amendment_count
    FROM chr_charts ch
    LEFT JOIN usr_users cu ON cu.id = ch.created_by
    LEFT JOIN usr_users su ON su.id = ch.signed_by`;

async function audit(actor: ChartActor, action: string, chartId: string | null, details: Record<string, unknown>): Promise<void> {
  await logAuditStrict({
    tenantId: actor.tenantId,
    userId: actor.userId,
    action,
    resourceType: 'chr_charts',
    resourceId: chartId ?? undefined,
    details,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}

function parseAnswers(raw: unknown, definition: FormDefinition): Answers {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ChartError('Answers must be an object.', 'INVALID_ANSWERS');
  }
  if (JSON.stringify(raw).length > MAX_ANSWERS_BYTES) throw new ChartError('The chart is too long.', 'INVALID_ANSWERS');
  const ids = new Set(definition.items.map((i) => i.id));
  const out: Answers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(k)) continue; // answers to items the template doesn't have are dropped
    if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v as string[];
    else throw new ChartError('An answer has the wrong type.', 'INVALID_ANSWERS');
  }
  return out;
}

interface ChartRow {
  id: string; tenant_id: string; business_id: string; customer_id: string; booking_id: string | null;
  form_name: string; form_version: number; definition_encrypted: string; answers_encrypted: string;
  status: 'draft' | 'signed'; created_by: string | null; signed_by: string | null; signed_at: Date | null;
  pdf_path: string | null;
}

async function loadRow(businessId: string, id: string): Promise<ChartRow> {
  const { rows } = await adminPool.query<ChartRow>(
    'SELECT * FROM chr_charts WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (!rows[0]) throw new ChartError('Chart not found', 'NOT_FOUND');
  return rows[0];
}

function readDefinition(r: ChartRow): FormDefinition {
  return JSON.parse(decrypt(r.definition_encrypted)) as FormDefinition;
}
function readAnswers(r: ChartRow): Answers {
  return JSON.parse(decrypt(r.answers_encrypted)) as Answers;
}

async function loadAmendments(chartId: string): Promise<Amendment[]> {
  const { rows } = await adminPool.query(
    `SELECT a.id, a.content_encrypted, a.created_by, a.created_at,
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name
       FROM chr_amendments a LEFT JOIN usr_users u ON u.id = a.created_by
      WHERE a.chart_id = $1 ORDER BY a.created_at ASC, a.id ASC`,
    [chartId],
  );
  return rows.map((a) => ({
    id: a.id, content: decrypt(a.content_encrypted), createdBy: a.created_by,
    createdByName: a.name || null, createdAt: a.created_at,
  }));
}

async function ownCustomer(businessId: string, customerId: string): Promise<void> {
  const { rows } = await adminPool.query('SELECT 1 FROM cus_customers WHERE id = $1 AND business_id = $2', [customerId, businessId]);
  if (!rows[0]) throw new ChartError('Customer not found', 'NOT_FOUND');
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A customer's charts, newest first. Listing is itself a view and is audited. */
export async function listCustomerCharts(businessId: string, customerId: string, actor: ChartActor): Promise<ChartSummary[]> {
  await ownCustomer(businessId, customerId);
  await audit(actor, 'chart.viewed', null, { customerId, businessId, scope: 'list' });
  const { rows } = await adminPool.query(
    `${SELECT_SUMMARY} WHERE ch.business_id = $1 AND ch.customer_id = $2 ORDER BY ch.created_at DESC`,
    [businessId, customerId],
  );
  return rows.map(summary);
}

/** The charts made against one booking. */
export async function listBookingCharts(businessId: string, bookingId: string, actor: ChartActor): Promise<ChartSummary[]> {
  await audit(actor, 'chart.viewed', null, { bookingId, businessId, scope: 'booking' });
  const { rows } = await adminPool.query(
    `${SELECT_SUMMARY} WHERE ch.business_id = $1 AND ch.booking_id = $2 ORDER BY ch.created_at DESC`,
    [businessId, bookingId],
  );
  return rows.map(summary);
}

export async function getChart(businessId: string, id: string, actor: ChartActor): Promise<Chart> {
  const row = await loadRow(businessId, id);
  await audit(actor, 'chart.viewed', id, { customerId: row.customer_id, businessId, scope: 'chart' });
  const { rows } = await adminPool.query(`${SELECT_SUMMARY} WHERE ch.id = $1`, [id]);
  return {
    ...summary(rows[0]),
    definition: readDefinition(row),
    answers: readAnswers(row),
    amendments: await loadAmendments(id),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function createChart(
  businessId: string,
  input: { customerId: string; formId: string; bookingId?: string | null },
  actor: ChartActor,
): Promise<Chart> {
  await ownCustomer(businessId, input.customerId);
  const { rows: forms } = await adminPool.query(
    `SELECT id, name, version, definition FROM frm_forms
      WHERE id = $1 AND business_id = $2 AND kind = 'chart' AND status = 'active'`,
    [input.formId, businessId],
  );
  if (!forms[0]) throw new ChartError('Chart template not found', 'NOT_FOUND');
  if (input.bookingId) {
    const { rows } = await adminPool.query(
      'SELECT 1 FROM apt_bookings WHERE id = $1 AND business_id = $2 AND customer_id = $3',
      [input.bookingId, businessId, input.customerId],
    );
    if (!rows[0]) throw new ChartError('Booking not found for this customer', 'NOT_FOUND');
  }

  const id = randomUUID();
  await audit(actor, 'chart.created', id, {
    customerId: input.customerId, bookingId: input.bookingId ?? null, businessId, formName: forms[0].name,
  });
  await adminPool.query(
    `INSERT INTO chr_charts (id, tenant_id, business_id, customer_id, booking_id, form_id, form_name, form_version,
                             definition_encrypted, answers_encrypted, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, actor.tenantId, businessId, input.customerId, input.bookingId ?? null, forms[0].id, forms[0].name,
      forms[0].version, encrypt(JSON.stringify(forms[0].definition)), encrypt('{}'), actor.userId],
  );
  return getChartNoAudit(businessId, id);
}

async function getChartNoAudit(businessId: string, id: string): Promise<Chart> {
  const row = await loadRow(businessId, id);
  const { rows } = await adminPool.query(`${SELECT_SUMMARY} WHERE ch.id = $1`, [id]);
  return { ...summary(rows[0]), definition: readDefinition(row), answers: readAnswers(row), amendments: await loadAmendments(id) };
}

/** Saves a draft's answers. A signed chart can never be changed this way. */
export async function updateChart(businessId: string, id: string, rawAnswers: unknown, actor: ChartActor): Promise<Chart> {
  const row = await loadRow(businessId, id);
  if (row.status !== 'draft') throw new ChartError('A signed chart is locked. Add an amendment instead.', 'LOCKED');
  const answers = parseAnswers(rawAnswers, readDefinition(row));

  // Saving happens as the practitioner types; one audit entry per editing session, not per save.
  const { rows: recent } = await adminPool.query(
    `SELECT 1 FROM usr_audit_log WHERE action = 'chart.updated' AND resource_id = $1 AND user_id = $2
        AND created_at > NOW() - INTERVAL '${EDIT_AUDIT_WINDOW}' LIMIT 1`,
    [id, actor.userId],
  );
  if (!recent[0]) await audit(actor, 'chart.updated', id, { customerId: row.customer_id, businessId });

  const { rowCount } = await adminPool.query(
    `UPDATE chr_charts SET answers_encrypted = $1, updated_at = NOW()
      WHERE id = $2 AND business_id = $3 AND status = 'draft'`,
    [encrypt(JSON.stringify(answers)), id, businessId],
  );
  if (!rowCount) throw new ChartError('A signed chart is locked. Add an amendment instead.', 'LOCKED');
  return getChartNoAudit(businessId, id);
}

/** Drafts only; the author, or an owner or manager, may delete one. */
export async function deleteDraft(businessId: string, id: string, actor: ChartActor): Promise<void> {
  const row = await loadRow(businessId, id);
  if (row.status !== 'draft') throw new ChartError('A signed chart cannot be deleted.', 'LOCKED');
  if (row.created_by !== actor.userId && !actor.isManager) {
    throw new ChartError('Only the author or a manager can delete this draft.', 'FORBIDDEN');
  }
  await audit(actor, 'chart.deleted', id, { customerId: row.customer_id, businessId });
  await adminPool.query(`DELETE FROM chr_charts WHERE id = $1 AND business_id = $2 AND status = 'draft'`, [id, businessId]);
}

async function pdfContext(businessId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT c.first_name, c.last_name, b.name, b.logo_url, b.primary_color, b.timezone
       FROM cus_customers c JOIN sys_businesses b ON b.id = c.business_id
      WHERE c.id = $1 AND c.business_id = $2`,
    [customerId, businessId],
  );
  if (!rows[0]) throw new ChartError('Customer not found', 'NOT_FOUND');
  let logo: Buffer | null = null;
  const p = pathFromReference(rows[0].logo_url);
  if (p) { try { logo = await storage.read(p); } catch { logo = null; } }
  return {
    customerName: `${rows[0].first_name} ${rows[0].last_name}`.trim(),
    businessName: rows[0].name as string,
    primaryColor: (rows[0].primary_color as string | null) ?? '#1a1a1a',
    timezone: (rows[0].timezone as string | null) || 'UTC',
    logo,
  };
}

async function userName(userId: string | null): Promise<string> {
  if (!userId) return 'Unknown';
  const { rows } = await adminPool.query('SELECT first_name, last_name FROM usr_users WHERE id = $1', [userId]);
  return rows[0] ? `${rows[0].first_name} ${rows[0].last_name}`.trim() || 'Unknown' : 'Unknown';
}

async function drawPdf(row: ChartRow, signedAt: Date, practitioner: string, amendments: Amendment[]): Promise<Buffer> {
  const ctx = await pdfContext(row.business_id, row.customer_id);
  return renderFormPdf({
    businessName: ctx.businessName,
    logo: ctx.logo,
    primaryColor: ctx.primaryColor,
    formName: row.form_name,
    formVersion: row.form_version,
    language: null,
    definition: readDefinition(row),
    answers: readAnswers(row),
    customerName: ctx.customerName,
    signaturePng: null,
    completedAt: signedAt,
    timezone: ctx.timezone,
    ipAddress: null,
    userAgent: null,
    reference: row.id,
    completedVia: 'staff',
    completedByName: practitioner,
    chart: {
      practitioner,
      signedAt,
      amendments: amendments.map((a) => ({ at: new Date(a.createdAt), by: a.createdByName ?? 'Unknown', text: a.content })),
    },
  });
}

/** One action: checks the answers, draws and stores the PDF, records who and when, and locks. */
export async function signOff(businessId: string, id: string, actor: ChartActor): Promise<Chart> {
  const row = await loadRow(businessId, id);
  if (row.status !== 'draft') throw new ChartError('This chart is already signed off.', 'LOCKED');
  const issues = validateFormAnswers(readDefinition(row), readAnswers(row));
  if (issues.length > 0) throw new ChartError('Some answers need attention before sign-off.', 'INVALID_ANSWERS', issues);

  await audit(actor, 'chart.signed', id, { customerId: row.customer_id, businessId });

  const signedAt = new Date();
  const pdf = await drawPdf(row, signedAt, await userName(actor.userId), []);
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const path = storagePaths.customerChart(row.tenant_id, businessId, row.customer_id, id);
  try {
    await storage.save(path, pdf);
  } catch (e) {
    throw new ChartError('The chart could not be saved. Please try again.', 'STORAGE_FAILED', (e as Error).message);
  }
  try {
    const { rowCount } = await adminPool.query(
      `UPDATE chr_charts SET status = 'signed', signed_by = $1, signed_at = $2, pdf_path = $3, pdf_sha256 = $4, updated_at = NOW()
        WHERE id = $5 AND business_id = $6 AND status = 'draft'`,
      [actor.userId, signedAt, path, sha256, id, businessId],
    );
    if (!rowCount) { await storage.delete(path).catch(() => undefined); throw new ChartError('This chart is already signed off.', 'LOCKED'); }
  } catch (e) {
    if (!(e instanceof ChartError)) await storage.delete(path).catch(() => undefined);
    throw e;
  }
  return getChartNoAudit(businessId, id);
}

/** A dated note on a signed chart. The original answers are never touched. */
export async function addAmendment(businessId: string, id: string, content: unknown, actor: ChartActor): Promise<Chart> {
  const row = await loadRow(businessId, id);
  if (row.status !== 'signed') throw new ChartError('Only a signed chart takes amendments. Edit the draft instead.', 'NOT_SIGNED');
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) throw new ChartError('Write the amendment first.', 'INVALID_AMENDMENT');
  if (text.length > MAX_AMENDMENT) throw new ChartError('The amendment is too long.', 'INVALID_AMENDMENT');
  const amendmentId = randomUUID();
  await audit(actor, 'chart.amended', id, { customerId: row.customer_id, businessId, amendmentId });
  await adminPool.query(
    `INSERT INTO chr_amendments (id, tenant_id, business_id, chart_id, content_encrypted, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [amendmentId, actor.tenantId, businessId, id, encrypt(text), actor.userId],
  );
  return getChartNoAudit(businessId, id);
}

/**
 * The chart as a PDF. Without amendments it is the file stored at sign-off; with amendments it is
 * drawn again so they are included (the sign-off file itself is never replaced).
 */
export async function getPdf(businessId: string, id: string, actor: ChartActor): Promise<{ data: Buffer; filename: string }> {
  const row = await loadRow(businessId, id);
  if (row.status !== 'signed' || !row.pdf_path || !row.signed_at) throw new ChartError('Only a signed chart has a PDF.', 'NOT_SIGNED');
  await audit(actor, 'chart.pdf_downloaded', id, { customerId: row.customer_id, businessId });
  const amendments = await loadAmendments(id);
  let data: Buffer | null;
  if (amendments.length === 0) data = await storage.read(row.pdf_path);
  else data = await drawPdf(row, row.signed_at, await userName(row.signed_by), amendments);
  if (!data) throw new ChartError('The chart file is missing.', 'NOT_FOUND');
  return { data, filename: `${row.form_name.replace(/[^\w.-]+/g, '_')}.pdf` };
}
