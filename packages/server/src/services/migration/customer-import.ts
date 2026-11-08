import { adminPool } from '../../db/pool';
import { findOrCreatePerson } from '../person-identity.service';
import { ImportResult, RowFailure, emptyResult } from './import-core';

/**
 * Customers import (spec 50, Wave 1). Routes each mapped row through the Phase 46
 * Identity Service (source `import`, which already suppresses the welcome email),
 * captures the legacy customer id for later entity matching, and applies tags +
 * notes. Idempotent: a matched existing person is filled-empty, never duplicated.
 *
 * `rows` are field-mapped objects (keys are DayStream field names). `commit=false`
 * is a trial: it validates only and writes nothing.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface MappedRow { [field: string]: string }

// preferred_language is VARCHAR(5) (a locale code such as "en" or "en-US"), but legacy exports
// usually carry the language name ("English"). Convert names to codes; unknown values are dropped
// rather than failing the whole customer.
const LANGUAGE_CODES: Record<string, string> = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', dutch: 'nl',
  russian: 'ru', arabic: 'ar', chinese: 'zh', mandarin: 'zh', cantonese: 'yue', japanese: 'ja', korean: 'ko',
  hindi: 'hi', bengali: 'bn', turkish: 'tr', polish: 'pl', swedish: 'sv', norwegian: 'no', danish: 'da',
  finnish: 'fi', greek: 'el', czech: 'cs', hungarian: 'hu', romanian: 'ro', ukrainian: 'uk', hebrew: 'he',
  thai: 'th', vietnamese: 'vi', indonesian: 'id', malay: 'ms', tagalog: 'tl', catalan: 'ca', basque: 'eu',
  galician: 'gl',
};

// The languages DayStream's language dropdown offers (CustomerCreate / CustomerDetail).
const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'de']);

/**
 * Resolve a legacy language value ("English", "es", "en-US") to a supported base code.
 * Returns `code: null` for blank or unsupported values; `unsupported` is true when a value was
 * given but couldn't be resolved, so the caller can warn instead of silently dropping it.
 */
export function normalizeLanguage(raw: string | undefined): { code: string | null; unsupported: boolean } {
  const v = (raw || '').trim();
  if (!v) return { code: null, unsupported: false };
  const lower = v.toLowerCase().replace('_', '-');
  const code = LANGUAGE_CODES[lower] ?? lower.split('-')[0];
  return SUPPORTED_LANGUAGES.has(code) ? { code, unsupported: false } : { code: null, unsupported: true };
}

function validateRow(r: MappedRow, rowNum: number): RowFailure[] {
  const failures: RowFailure[] = [];
  const first = (r.first_name || '').trim();
  const email = (r.email || '').trim();
  const phone = (r.phone || '').trim();
  if (!first) failures.push({ row: rowNum, field: 'first_name', message: 'First name is required' });
  if (!email && !phone) failures.push({ row: rowNum, field: 'email', message: 'An email or a phone number is required' });
  if (email && !EMAIL_RE.test(email)) failures.push({ row: rowNum, field: 'email', message: `"${email}" is not a valid email address` });
  if (r.date_of_birth && isNaN(new Date(r.date_of_birth).getTime())) {
    failures.push({ row: rowNum, field: 'date_of_birth', message: `"${r.date_of_birth}" is not a valid date` });
  }
  return failures;
}

export async function runCustomerImport(args: {
  businessId: string;
  tenantId: string;
  userId: string;
  rows: MappedRow[];
  commit: boolean;
}): Promise<ImportResult> {
  const { businessId, tenantId, userId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;
  const warnings: RowFailure[] = [];
  result.warnings = warnings;

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const r = rows[i];
    const rowFailures = validateRow(r, rowNum);
    if (rowFailures.length > 0) {
      result.failed += 1;
      result.failures.push(...rowFailures);
      continue;
    }

    if (!commit) {
      // Trial: predict the outcome without writing. A row that would match an
      // existing person (by email/phone) is reported matched; else imported.
      const willMatch = await wouldMatchExisting(businessId, r);
      if (willMatch) result.matched += 1; else result.imported += 1;
      continue;
    }

    const lang = normalizeLanguage(r.preferred_language);
    if (lang.unsupported) {
      warnings.push({
        row: rowNum, field: 'preferred_language',
        message: `Language "${r.preferred_language.trim()}" isn't one DayStream supports (English, Spanish, French, German), so it was left blank`,
      });
    }

    try {
      const res = await findOrCreatePerson({
        businessId,
        tenantId,
        email: r.email || null,
        phone: r.phone || null,
        firstName: r.first_name || null,
        lastName: r.last_name || null,
        dateOfBirth: r.date_of_birth || null,
        gender: r.gender || null,
        preferredLanguage: lang.code,
        country: r.country || null,
        source: 'import',
        sourceDetail: 'data migration',
        actorUserId: userId,
      });

      // Capture the legacy id (fill-empty: never overwrite an existing value) so
      // later entity imports can match on it.
      if ((r.legacy_customer_id || '').trim()) {
        await adminPool.query(
          `UPDATE cus_customers SET legacy_customer_id = $1, updated_at = NOW()
           WHERE id = $2 AND (legacy_customer_id IS NULL OR legacy_customer_id = '')`,
          [r.legacy_customer_id.trim(), res.person.id],
        );
      }

      // Capture the previous processor's customer id (fill-empty) — the exact key the payment-method
      // import matches on. Not a charging reference; see migration 166.
      if ((r.processor_customer_id || '').trim()) {
        await adminPool.query(
          `UPDATE cus_customers SET processor_customer_id = $1, updated_at = NOW()
           WHERE id = $2 AND (processor_customer_id IS NULL OR processor_customer_id = '')`,
          [r.processor_customer_id.trim(), res.person.id],
        );
      }

      if ((r.tags || '').trim()) await applyTags(businessId, res.person.id, r.tags, userId);
      if ((r.notes || '').trim()) await applyNote(businessId, res.person.id, r.notes, userId);
      if ((r.joined || '').trim()) await applyJoinedDate(res.person.id, r.joined);

      if (res.created) result.imported += 1; else result.matched += 1;
    } catch (e: any) {
      result.failed += 1;
      result.failures.push({ row: rowNum, field: 'general', message: e?.message || 'Failed to import row' });
    }
  }

  return result;
}

/** Whether a row would match an existing (non-merged) person by email or phone. */
async function wouldMatchExisting(businessId: string, r: MappedRow): Promise<boolean> {
  const email = (r.email || '').trim().toLowerCase();
  const phone = (r.phone || '').trim();
  if (email) {
    const { rows } = await adminPool.query(
      `SELECT 1 FROM cus_customers WHERE business_id = $1 AND LOWER(email) = $2 AND status <> 'merged' LIMIT 1`,
      [businessId, email],
    );
    if (rows.length > 0) return true;
  }
  if (phone) {
    const { rows } = await adminPool.query(
      `SELECT 1 FROM cus_customers WHERE business_id = $1 AND (phone = $2 OR phone_e164 = $2) AND status <> 'merged' LIMIT 1`,
      [businessId, phone],
    );
    if (rows.length > 0) return true;
  }
  return false;
}

/** Comma/semicolon-separated tag names → find-or-create per business, then assign. */
async function applyTags(businessId: string, customerId: string, tagsField: string, userId: string): Promise<void> {
  const names = tagsField.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  for (const name of names) {
    const { rows } = await adminPool.query(
      `INSERT INTO cus_tags (business_id, name, color) VALUES ($1, $2, '#8A8A8A')
       ON CONFLICT (business_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [businessId, name],
    );
    const tagId = rows[0]?.id;
    if (tagId) {
      await adminPool.query(
        `INSERT INTO cus_customer_tags (customer_id, tag_id, assigned_by)
         VALUES ($1, $2, $3) ON CONFLICT (customer_id, tag_id) DO NOTHING`,
        [customerId, tagId, userId],
      );
    }
  }
}

/**
 * An imported note lands on the customer timeline (`cus_activities`), not
 * `cus_notes`: the notes table requires a valid per-business note category and
 * field-level encryption that an import file can't supply, whereas the timeline
 * is the natural home for carried-over context (consistent with how imported
 * history lands). Marked `imported: true` so it's distinguishable.
 */
async function applyNote(businessId: string, customerId: string, note: string, userId: string): Promise<void> {
  const { createActivity } = await import('../customer-activity.service');
  await createActivity({
    customerId, businessId, activityType: 'note',
    description: note.trim(),
    metadata: { imported: true },
    createdBy: userId,
  }).catch(() => undefined);
}

/** Preserve the legacy join date as the customer's created_at where provided. */
async function applyJoinedDate(customerId: string, joined: string): Promise<void> {
  const d = new Date(joined);
  if (isNaN(d.getTime())) return;
  await adminPool.query(
    `UPDATE cus_customers SET created_at = $1 WHERE id = $2`,
    [d.toISOString(), customerId],
  );
}
