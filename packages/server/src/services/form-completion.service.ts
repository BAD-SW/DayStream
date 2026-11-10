import { createHash, randomBytes, randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { adminPool } from '../db/pool';
import { storage } from './storage.service';
import { storagePaths, pathFromReference } from '../utils/storage-paths';
import { renderFormPdf } from './forms-pdf';
import { createActivity } from './customer-activity.service';
import { sendEmail } from './email.service';
import {
  isSignedForm, validateFormAnswers,
} from '@daystream/shared';
import type { FormDefinition, FormAnswer } from '@daystream/shared';

/**
 * Completing a form (spec 51, gap 1).
 *
 * Three ways, one core: on a device in the business and from an emailed link both use a
 * tokenised request and the public form page; staff may also fill in an UNSIGNED form for the
 * customer. Whichever way, the result is a PDF in the customer's folder plus a submission row
 * (reference, signing facts, SHA-256). The answers are used to draw the PDF and then dropped.
 */

export class FormCompletionError extends Error {
  code: string;
  details?: unknown;
  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'FormCompletionError';
    this.code = code;
    this.details = details;
  }
}

const DEVICE_LINK_MS = 60 * 60 * 1000;            // 1 hour
const EMAIL_LINK_MS = 7 * 24 * 60 * 60 * 1000;    // 7 days
const MAX_SIGNATURE_BYTES = 400 * 1024;
const MAX_TEXT = 5000;

export type RequestChannel = 'device' | 'email';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/* eslint-disable @typescript-eslint/no-explicit-any */
interface FormVersionRow {
  id: string; group_id: string; name: string; language: string | null;
  definition: FormDefinition; version: number;
}

/** The version to show: the wanted language, else the default (no language), else any. */
function pickVersion<T extends { language: string | null }>(versions: T[], language: string | null | undefined): T | null {
  if (versions.length === 0) return null;
  const want = (language ?? '').toLowerCase();
  return versions.find((v) => v.language === want && want !== '')
    ?? versions.find((v) => v.language === null)
    ?? versions[0];
}

async function activeVersions(businessId: string, groupId: string): Promise<FormVersionRow[]> {
  const { rows } = await adminPool.query(
    `SELECT id, group_id, name, language, definition, version
       FROM frm_forms
      WHERE business_id = $1 AND group_id = $2 AND status = 'active' AND is_active = true
      ORDER BY (language IS NOT NULL), language`,
    [businessId, groupId],
  );
  return rows;
}

async function loadCustomer(businessId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.preferred_language,
            b.tenant_id, b.name AS business_name, b.timezone
       FROM cus_customers c JOIN sys_businesses b ON b.id = c.business_id
      WHERE c.id = $1 AND c.business_id = $2`,
    [customerId, businessId],
  );
  if (!rows[0]) throw new FormCompletionError('Customer not found', 'NOT_FOUND');
  return rows[0] as {
    id: string; first_name: string; last_name: string; email: string | null; preferred_language: string | null;
    tenant_id: string; business_name: string; timezone: string | null;
  };
}

// ---------------------------------------------------------------------------
// Requests (secure link or device session)
// ---------------------------------------------------------------------------

export interface CreatedRequest {
  requestId: string;
  channel: RequestChannel;
  /** The page to open. Only returned for a device session; an emailed link is not shown to staff. */
  url: string | null;
  expiresAt: string;
  emailedTo: string | null;
}

const EMAIL_TEXT: Record<string, { subject: (form: string, biz: string) => string; intro: (first: string, biz: string, form: string) => string; button: string; valid: string }> = {
  en: { subject: (f, b) => `${f} - ${b}`, intro: (n, b, f) => `Hi ${n}, ${b} asks you to complete "${f}" before your visit.`, button: 'Complete the form', valid: 'This link works once and expires in 7 days.' },
  es: { subject: (f, b) => `${f} - ${b}`, intro: (n, b, f) => `Hola ${n}, ${b} te pide completar "${f}" antes de tu visita.`, button: 'Completar el formulario', valid: 'Este enlace funciona una vez y caduca en 7 días.' },
  fr: { subject: (f, b) => `${f} - ${b}`, intro: (n, b, f) => `Bonjour ${n}, ${b} vous demande de remplir « ${f} » avant votre visite.`, button: 'Remplir le formulaire', valid: 'Ce lien ne fonctionne qu\'une fois et expire dans 7 jours.' },
  de: { subject: (f, b) => `${f} - ${b}`, intro: (n, b, f) => `Hallo ${n}, ${b} bittet Sie, „${f}“ vor Ihrem Besuch auszufüllen.`, button: 'Formular ausfüllen', valid: 'Dieser Link funktioniert einmal und läuft in 7 Tagen ab.' },
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] as string));

export async function createRequest(input: {
  businessId: string; customerId: string; groupId: string; channel: RequestChannel;
  bookingId?: string | null; createdBy: string | null;
}): Promise<CreatedRequest> {
  const customer = await loadCustomer(input.businessId, input.customerId);
  const versions = await activeVersions(input.businessId, input.groupId);
  if (versions.length === 0) throw new FormCompletionError('That form is not available.', 'NO_ACTIVE_FORM');
  if (input.channel === 'email' && !customer.email) {
    throw new FormCompletionError('This customer has no email address.', 'NO_EMAIL');
  }

  // A newer request replaces any earlier open one for the same form.
  await adminPool.query(
    `UPDATE frm_requests SET status = 'cancelled'
      WHERE customer_id = $1 AND group_id = $2 AND status = 'pending'`,
    [input.customerId, input.groupId],
  );

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (input.channel === 'device' ? DEVICE_LINK_MS : EMAIL_LINK_MS));
  const { rows } = await adminPool.query(
    `INSERT INTO frm_requests (tenant_id, business_id, customer_id, group_id, booking_id, channel, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [customer.tenant_id, input.businessId, input.customerId, input.groupId, input.bookingId ?? null,
      input.channel, hashToken(token), expiresAt, input.createdBy],
  );

  const baseUrl = (process.env.CLIENT_URL || 'http://localhost:4000').replace(/\/$/, '');
  const url = `${baseUrl}/forms/${token}`;

  if (input.channel === 'email' && customer.email) {
    const lang = (customer.preferred_language ?? 'en').slice(0, 2);
    const chosen = pickVersion(versions, lang) as FormVersionRow;
    const t = EMAIL_TEXT[lang] ?? EMAIL_TEXT.en;
    const first = customer.first_name || '';
    try {
      await sendEmail({
        to: customer.email,
        from: customer.business_name,
        subject: t.subject(chosen.name, customer.business_name),
        text: `${t.intro(first, customer.business_name, chosen.name)}\n\n${url}\n\n${t.valid}`,
        html: `<p>${escapeHtml(t.intro(first, customer.business_name, chosen.name))}</p>`
          + `<p><a href="${url}">${escapeHtml(t.button)}</a></p><p style="color:#666;font-size:12px">${escapeHtml(t.valid)}</p>`,
      });
    } catch (e) {
      // Nothing was sent, so the link is useless: cancel it and tell staff.
      await adminPool.query(`UPDATE frm_requests SET status = 'cancelled' WHERE id = $1`, [rows[0].id]);
      throw new FormCompletionError('The email could not be sent. Try again, or use a device instead.', 'EMAIL_FAILED', (e as Error).message);
    }
  }

  return {
    requestId: rows[0].id,
    channel: input.channel,
    url: input.channel === 'device' ? url : null,
    expiresAt: expiresAt.toISOString(),
    emailedTo: input.channel === 'email' ? customer.email : null,
  };
}

// ---------------------------------------------------------------------------
// The public page
// ---------------------------------------------------------------------------

export interface PublicForm {
  channel: RequestChannel;
  expiresAt: string;
  business: { name: string; logoUrl: string | null; primaryColor: string | null };
  customerFirstName: string;
  initialLanguage: string | null;
  versions: { language: string | null; name: string; definition: FormDefinition }[];
}

const INVALID_LINK = 'This link is no longer valid. Ask the business for a new one.';

async function openRequest(client: PoolClient | typeof adminPool, token: string, lock: boolean) {
  const { rows } = await client.query(
    `SELECT r.id, r.tenant_id, r.business_id, r.customer_id, r.group_id, r.booking_id, r.channel, r.status, r.expires_at
       FROM frm_requests r WHERE r.token_hash = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [hashToken(token)],
  );
  const r = rows[0];
  if (!r || r.status !== 'pending') throw new FormCompletionError(INVALID_LINK, 'INVALID_LINK');
  if (new Date(r.expires_at).getTime() < Date.now()) {
    await client.query(`UPDATE frm_requests SET status = 'expired' WHERE id = $1`, [r.id]);
    throw new FormCompletionError(INVALID_LINK, 'INVALID_LINK');
  }
  return r as {
    id: string; tenant_id: string; business_id: string; customer_id: string; group_id: string;
    booking_id: string | null; channel: RequestChannel; status: string; expires_at: string;
  };
}

export async function getPublicForm(token: string): Promise<PublicForm> {
  const r = await openRequest(adminPool, token, false);
  const customer = await loadCustomer(r.business_id, r.customer_id);
  const versions = await activeVersions(r.business_id, r.group_id);
  if (versions.length === 0) throw new FormCompletionError(INVALID_LINK, 'INVALID_LINK');
  const { rows: biz } = await adminPool.query(
    'SELECT name, logo_url, primary_color FROM sys_businesses WHERE id = $1', [r.business_id],
  );
  const initial = pickVersion(versions, customer.preferred_language);
  return {
    channel: r.channel,
    expiresAt: new Date(r.expires_at).toISOString(),
    business: { name: biz[0].name, logoUrl: biz[0].logo_url ?? null, primaryColor: biz[0].primary_color ?? null },
    customerFirstName: customer.first_name,
    initialLanguage: initial?.language ?? null,
    versions: versions.map((v) => ({ language: v.language, name: v.name, definition: v.definition })),
  };
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

interface Evidence { ip: string | null; userAgent: string | null }

function checkAnswers(def: FormDefinition, raw: unknown): Record<string, FormAnswer | undefined> {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const answers: Record<string, FormAnswer | undefined> = {};
  const known = new Set(def.items.map((i) => i.id));
  for (const [id, v] of Object.entries(input)) {
    if (!known.has(id)) continue;
    if (typeof v === 'string') {
      if (v.length > MAX_TEXT) throw new FormCompletionError('An answer is too long.', 'INVALID_ANSWERS', [{ itemId: id, message: 'Too long.' }]);
      answers[id] = v;
    } else if (typeof v === 'boolean') {
      answers[id] = v;
    } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      answers[id] = v as string[];
    }
  }
  const issues = validateFormAnswers(def, answers);
  if (issues.length > 0) throw new FormCompletionError('Some answers need attention.', 'INVALID_ANSWERS', issues);
  return answers;
}

function decodeSignature(dataUrl: unknown): Buffer {
  const m = typeof dataUrl === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m) throw new FormCompletionError('Please sign the form.', 'SIGNATURE_REQUIRED');
  const png = Buffer.from(m[1], 'base64');
  const isPng = png.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
  if (!isPng || png.length > MAX_SIGNATURE_BYTES) throw new FormCompletionError('Please sign the form again.', 'SIGNATURE_REQUIRED');
  return png;
}

async function loadLogo(logoUrl: string | null): Promise<Buffer | null> {
  const p = pathFromReference(logoUrl);
  if (!p) return null;
  try { return await storage.read(p); } catch { return null; }
}

interface FinalizeInput {
  businessId: string;
  customerId: string;
  form: FormVersionRow;
  answers: Record<string, FormAnswer | undefined>;
  signaturePng: Buffer | null;
  completedVia: 'device' | 'link' | 'staff';
  requestId: string | null;
  bookingId: string | null;
  staffUserId: string | null;
  evidence: Evidence;
}

/**
 * Draws the PDF, stores it and records the submission. Used inside the caller's transaction
 * (when there is one) so the request is marked used atomically. If the database write fails
 * after the file was stored, the file is removed again: a submission never exists without its
 * file, and a file never exists without its submission.
 */
async function finalize(input: FinalizeInput, db: PoolClient | typeof adminPool): Promise<{ id: string; storagePath: string }> {
  const customer = await loadCustomer(input.businessId, input.customerId);
  const { rows: biz } = await adminPool.query(
    'SELECT name, logo_url, primary_color FROM sys_businesses WHERE id = $1', [input.businessId],
  );
  let staffName: string | null = null;
  if (input.staffUserId) {
    const { rows } = await adminPool.query('SELECT first_name, last_name FROM usr_users WHERE id = $1', [input.staffUserId]);
    if (rows[0]) staffName = `${rows[0].first_name} ${rows[0].last_name}`.trim();
  }

  const submissionId = randomUUID();
  const completedAt = new Date();
  const signed = isSignedForm(input.form.definition);
  const pdf = await renderFormPdf({
    businessName: biz[0].name,
    logo: await loadLogo(biz[0].logo_url),
    primaryColor: biz[0].primary_color ?? '#1a1a1a',
    formName: input.form.name,
    formVersion: input.form.version,
    language: input.form.language,
    definition: input.form.definition,
    answers: input.answers,
    customerName: `${customer.first_name} ${customer.last_name}`.trim(),
    signaturePng: input.signaturePng,
    completedAt,
    timezone: customer.timezone || 'UTC',
    ipAddress: input.evidence.ip,
    userAgent: input.evidence.userAgent,
    reference: submissionId,
    completedVia: input.completedVia,
    completedByName: staffName,
  });
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const storagePath = storagePaths.customerForm(customer.tenant_id, input.businessId, input.customerId, submissionId);

  try {
    await storage.save(storagePath, pdf);
  } catch (e) {
    throw new FormCompletionError('The form could not be saved. Please try again.', 'STORAGE_FAILED', (e as Error).message);
  }

  try {
    await db.query(
      `INSERT INTO frm_submissions
         (id, tenant_id, business_id, customer_id, form_id, group_id, form_version, form_name, language,
          request_id, booking_id, completed_via, completed_by_user, signed, signed_at, ip_address, user_agent,
          storage_path, size_bytes, sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [submissionId, customer.tenant_id, input.businessId, input.customerId, input.form.id, input.form.group_id,
        input.form.version, input.form.name, input.form.language, input.requestId, input.bookingId,
        input.completedVia, input.staffUserId, signed, signed ? completedAt : null,
        input.evidence.ip, input.evidence.userAgent?.slice(0, 500) ?? null, storagePath, pdf.length, sha256],
    );
  } catch (e) {
    await storage.delete(storagePath).catch(() => undefined);
    throw e;
  }

  await createActivity({
    customerId: input.customerId,
    businessId: input.businessId,
    activityType: 'form_completed',
    description: `${signed ? 'Signed' : 'Completed'} form "${input.form.name}"`,
    metadata: { submission_id: submissionId, form_name: input.form.name, form_version: input.form.version, via: input.completedVia },
    createdBy: input.staffUserId ?? undefined,
  }).catch(() => undefined);

  return { id: submissionId, storagePath };
}

/** The customer submits the form on the public page. */
export async function submitPublic(token: string, body: {
  language?: string | null; answers?: unknown; signature?: unknown;
}, evidence: Evidence): Promise<{ submissionId: string }> {
  const client = await adminPool.connect();
  let storedPath: string | null = null;
  try {
    await client.query('BEGIN');
    const r = await openRequest(client, token, true);

    const versions = await activeVersions(r.business_id, r.group_id);
    const wanted = body.language ? String(body.language).toLowerCase() : null;
    const form = wanted
      ? versions.find((v) => v.language === wanted) ?? null
      : versions.find((v) => v.language === null) ?? versions[0] ?? null;
    if (!form) throw new FormCompletionError(INVALID_LINK, 'INVALID_LINK');

    const answers = checkAnswers(form.definition, body.answers);
    const signaturePng = isSignedForm(form.definition) ? decodeSignature(body.signature) : null;

    const { id, storagePath } = await finalize({
      businessId: r.business_id, customerId: r.customer_id, form, answers, signaturePng,
      completedVia: r.channel === 'device' ? 'device' : 'link', requestId: r.id, bookingId: r.booking_id,
      staffUserId: null, evidence,
    }, client);
    storedPath = storagePath;

    await client.query(`UPDATE frm_requests SET status = 'completed', completed_at = NOW() WHERE id = $1`, [r.id]);
    await client.query('COMMIT');
    return { submissionId: id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    // The record was rolled back, so the file it pointed to must go too.
    if (storedPath) await storage.delete(storedPath).catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Staff fill in an UNSIGNED form for the customer (a signature must be the customer's own). */
export async function completeByStaff(input: {
  businessId: string; customerId: string; groupId: string; language?: string | null;
  answers: unknown; bookingId?: string | null; staffUserId: string;
}, evidence: Evidence): Promise<{ submissionId: string }> {
  await loadCustomer(input.businessId, input.customerId);
  const versions = await activeVersions(input.businessId, input.groupId);
  const form = pickVersion(versions, input.language);
  if (!form) throw new FormCompletionError('That form is not available.', 'NO_ACTIVE_FORM');
  if (isSignedForm(form.definition)) {
    throw new FormCompletionError(
      'A signed form must be signed by the customer. Use a device or send them the link.', 'SIGNED_FORM_STAFF',
    );
  }
  const answers = checkAnswers(form.definition, input.answers);
  const { id } = await finalize({
    businessId: input.businessId, customerId: input.customerId, form, answers, signaturePng: null,
    completedVia: 'staff', requestId: null, bookingId: input.bookingId ?? null,
    staffUserId: input.staffUserId, evidence,
  }, adminPool);
  return { submissionId: id };
}

// ---------------------------------------------------------------------------
// Viewing and sending copies
// ---------------------------------------------------------------------------

export interface SubmissionSummary {
  id: string; groupId: string; formName: string; formVersion: number; language: string | null;
  completedVia: 'device' | 'link' | 'staff'; signed: boolean; signedAt: string | null;
  createdAt: string; sizeBytes: number;
}

export async function listSubmissions(businessId: string, customerId: string): Promise<SubmissionSummary[]> {
  const { rows } = await adminPool.query(
    `SELECT id, group_id, form_name, form_version, language, completed_via, signed, signed_at, created_at, size_bytes
       FROM frm_submissions WHERE business_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
    [businessId, customerId],
  );
  return rows.map((r: any) => ({
    id: r.id, groupId: r.group_id, formName: r.form_name, formVersion: r.form_version, language: r.language,
    completedVia: r.completed_via, signed: r.signed, signedAt: r.signed_at, createdAt: r.created_at, sizeBytes: r.size_bytes,
  }));
}

async function loadSubmission(businessId: string, customerId: string, submissionId: string) {
  const { rows } = await adminPool.query(
    `SELECT id, form_name, storage_path FROM frm_submissions WHERE id = $1 AND business_id = $2 AND customer_id = $3`,
    [submissionId, businessId, customerId],
  );
  if (!rows[0]) throw new FormCompletionError('Form not found', 'NOT_FOUND');
  return rows[0] as { id: string; form_name: string; storage_path: string };
}

export async function getSubmissionFile(businessId: string, customerId: string, submissionId: string): Promise<{ filename: string; data: Buffer }> {
  const s = await loadSubmission(businessId, customerId, submissionId);
  const data = await storage.read(s.storage_path);
  if (!data) throw new FormCompletionError('The file could not be found.', 'FILE_MISSING');
  return { filename: `${s.form_name.replace(/[^\w\- ]+/g, '').trim() || 'form'}.pdf`, data };
}

/** Email the customer a copy of a completed form (no automatic copies; staff do this on request). */
export async function emailSubmissionCopy(
  businessId: string, customerId: string, submissionId: string, sentBy: string,
): Promise<{ sentTo: string }> {
  const customer = await loadCustomer(businessId, customerId);
  if (!customer.email) throw new FormCompletionError('This customer has no email address.', 'NO_EMAIL');
  const file = await getSubmissionFile(businessId, customerId, submissionId);
  const lang = (customer.preferred_language ?? 'en').slice(0, 2);
  const body: Record<string, string> = {
    en: `Hi ${customer.first_name}, here is your copy of "${file.filename.replace(/\.pdf$/, '')}" from ${customer.business_name}.`,
    es: `Hola ${customer.first_name}, adjuntamos tu copia de "${file.filename.replace(/\.pdf$/, '')}" de ${customer.business_name}.`,
    fr: `Bonjour ${customer.first_name}, voici votre copie de « ${file.filename.replace(/\.pdf$/, '')} » de ${customer.business_name}.`,
    de: `Hallo ${customer.first_name}, anbei Ihre Kopie von „${file.filename.replace(/\.pdf$/, '')}“ von ${customer.business_name}.`,
  };
  const text = body[lang] ?? body.en;
  try {
    await sendEmail({
      to: customer.email,
      from: customer.business_name,
      subject: `${file.filename.replace(/\.pdf$/, '')} - ${customer.business_name}`,
      text,
      html: `<p>${escapeHtml(text)}</p>`,
      attachments: [{ filename: file.filename, content: file.data, contentType: 'application/pdf' }],
    });
  } catch (e) {
    throw new FormCompletionError('The email could not be sent.', 'EMAIL_FAILED', (e as Error).message);
  }
  await createActivity({
    customerId,
    businessId,
    activityType: 'form_emailed',
    description: `Emailed a copy of "${file.filename.replace(/\.pdf$/, '')}" to the customer`,
    metadata: { submission_id: submissionId },
    createdBy: sentBy,
  }).catch(() => undefined);
  return { sentTo: customer.email };
}
