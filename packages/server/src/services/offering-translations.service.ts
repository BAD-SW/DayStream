import { TRANSLATABLE_FIELDS } from '@daystream/shared';
import type { TranslatableEntity, TranslatableField, TranslationFields } from '@daystream/shared';
import { adminPool } from '../db/pool';
import { msg } from '../i18n';
import { getBusinessLanguages } from './business-languages.service';
import { translateTexts } from './machine-translation.service';

/**
 * A business's translations of its offerings (Phase 44, requirement 9): services, products,
 * memberships, packages, service options and add-ons, per language. The default-language text stays in
 * the record; a translation keeps the text it was made from (`source`), so it shows as out of date when
 * that text changes.
 */

export class TranslationError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'INVALID_LANGUAGE') {
    super(message);
    this.name = 'TranslationError';
  }
}

/** Where each kind of record lives, and how it belongs to a business. */
const SOURCES: Record<TranslatableEntity, { table: string; business: string }> = {
  service: { table: 'svc_services', business: 'r.business_id' },
  product: { table: 'prd_merchandise', business: 'r.business_id' },
  membership: { table: 'mbr_plans', business: 'r.business_id' },
  package: { table: 'pkg_packages', business: 'r.business_id' },
  service_option: { table: 'svc_variants', business: '(SELECT s.business_id FROM svc_services s WHERE s.id = r.service_id)' },
  addon: { table: 'svc_addons', business: 'r.business_id' },
};

const fieldsOf = (entity: TranslatableEntity) => TRANSLATABLE_FIELDS[entity] as readonly TranslatableField[];

const clean = (entity: TranslatableEntity, value: unknown): TranslationFields => {
  const out: TranslationFields = {};
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  for (const f of fieldsOf(entity)) out[f] = typeof v[f] === 'string' ? (v[f] as string).trim() : '';
  return out;
};

const sameText = (entity: TranslatableEntity, a: TranslationFields, b: TranslationFields) =>
  fieldsOf(entity).every((f) => (a[f] ?? '') === (b[f] ?? ''));

/** The record's default-language text, and its tenant, when it belongs to the business. */
async function original(entity: TranslatableEntity, entityId: string, businessId: string): Promise<{ fields: TranslationFields; tenantId: string }> {
  const src = SOURCES[entity];
  const cols = fieldsOf(entity).map((f) => `r.${f}`).join(', ');
  const { rows } = await adminPool.query(
    `SELECT ${cols}, b.tenant_id FROM ${src.table} r JOIN sys_businesses b ON b.id = ${src.business}
      WHERE r.id = $1 AND b.id = $2`,
    [entityId, businessId],
  );
  if (!rows[0]) throw new TranslationError(msg('errors:translation.notFound'), 'NOT_FOUND');
  return { fields: clean(entity, rows[0]), tenantId: rows[0].tenant_id };
}

export interface TranslationRow {
  language: string;
  fields: TranslationFields;
  translatedBy: 'machine' | 'person' | null;
  outOfDate: boolean;
  updatedAt: string | null;
}

export interface TranslationTable {
  entityType: TranslatableEntity;
  fields: readonly TranslatableField[];
  defaultLanguage: string;
  original: TranslationFields;
  rows: TranslationRow[];
}

/** The table: the default-language text, and a row for each of the business's other languages. */
export async function getTranslationTable(entity: TranslatableEntity, entityId: string, businessId: string): Promise<TranslationTable> {
  const { fields } = await original(entity, entityId, businessId);
  const langs = await getBusinessLanguages(businessId);
  if (!langs) throw new TranslationError(msg('errors:translation.notFound'), 'NOT_FOUND');
  const { rows } = await adminPool.query(
    `SELECT language, fields, source, translated_by, updated_at FROM cat_translations
      WHERE entity_type = $1 AND entity_id = $2 AND business_id = $3 AND status = 'active'`,
    [entity, entityId, businessId],
  );
  const saved = new Map(rows.map((r) => [r.language as string, r]));
  return {
    entityType: entity,
    fields: fieldsOf(entity),
    defaultLanguage: langs.defaultLanguage,
    original: fields,
    rows: langs.languages.filter((l) => l !== langs.defaultLanguage).map((language) => {
      const r = saved.get(language);
      return {
        language,
        fields: clean(entity, r?.fields),
        translatedBy: r ? r.translated_by : null,
        outOfDate: !!r && !sameText(entity, clean(entity, r.source), fields),
        updatedAt: r ? new Date(r.updated_at).toISOString() : null,
      };
    }),
  };
}

async function checkLanguage(businessId: string, language: string): Promise<string> {
  const langs = await getBusinessLanguages(businessId);
  if (!langs || language === langs.defaultLanguage || !(langs.languages as string[]).includes(language)) {
    throw new TranslationError(msg('errors:translation.invalidLanguage'), 'INVALID_LANGUAGE');
  }
  return langs.defaultLanguage;
}

/** Save one language's translation, recording the default-language text it matches now. */
export async function saveTranslation(
  entity: TranslatableEntity, entityId: string, businessId: string, language: string,
  input: { fields: unknown; translatedBy?: 'machine' | 'person' }, userId: string | null,
): Promise<TranslationRow> {
  await checkLanguage(businessId, language);
  const { fields: source, tenantId } = await original(entity, entityId, businessId);
  const fields = clean(entity, input.fields);
  const by = input.translatedBy === 'machine' ? 'machine' : 'person';
  const { rows } = await adminPool.query(
    `INSERT INTO cat_translations (tenant_id, business_id, entity_type, entity_id, language, fields, source, translated_by, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (entity_type, entity_id, language) DO UPDATE
       SET fields = EXCLUDED.fields, source = EXCLUDED.source, translated_by = EXCLUDED.translated_by,
           status = 'active', updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING updated_at`,
    [tenantId, businessId, entity, entityId, language, JSON.stringify(fields), JSON.stringify(source), by, userId],
  );
  return { language, fields, translatedBy: by, outOfDate: false, updatedAt: new Date(rows[0].updated_at).toISOString() };
}

/** Google's translation of the default-language text into a language (not saved: the business reviews it first). */
export async function machineTranslate(entity: TranslatableEntity, entityId: string, businessId: string, language: string): Promise<TranslationFields> {
  const defaultLanguage = await checkLanguage(businessId, language);
  const { fields } = await original(entity, entityId, businessId);
  const keys = fieldsOf(entity);
  const out = await translateTexts(keys.map((f) => fields[f] ?? ''), defaultLanguage, language);
  const result: TranslationFields = {};
  keys.forEach((f, i) => { result[f] = out[i]; });
  return result;
}

// ─── Showing translations to customers (requirement 9.5) ────────────────────

/**
 * Replace the translatable fields of records with their translation in a language, where there is one
 * (keeping the default-language text otherwise). Rows need an `id`; other columns are left as they are.
 */
export async function localizeOfferings<T extends { id?: unknown }>(entity: TranslatableEntity, rows: T[], language: string | null | undefined): Promise<T[]> {
  if (!language || rows.length === 0) return rows;
  const ids = [...new Set(rows.map((r) => r.id).filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return rows;
  const { rows: found } = await adminPool.query(
    `SELECT entity_id, fields FROM cat_translations
      WHERE entity_type = $1 AND language = $2 AND status = 'active' AND entity_id = ANY($3::uuid[])`,
    [entity, language, ids],
  );
  if (found.length === 0) return rows;
  const byId = new Map(found.map((f) => [f.entity_id as string, f.fields as Record<string, string>]));
  return rows.map((row) => {
    const t = typeof row.id === 'string' ? byId.get(row.id) : undefined;
    if (!t) return row;
    const copy: Record<string, unknown> = { ...row };
    for (const f of fieldsOf(entity)) if (typeof t[f] === 'string' && t[f].trim() && f in copy) copy[f] = t[f];
    return copy as T;
  });
}

/**
 * Replace names held in other rows (a booking's service_name, an email's variant_name) with their
 * translation in a language, by the id beside them: one query per kind of record.
 */
export async function localizeNames<T extends Record<string, unknown>>(
  rows: T[], specs: { entity: TranslatableEntity; idKey: string; nameKey: string }[], language: string | null | undefined,
): Promise<T[]> {
  if (!language || rows.length === 0) return rows;
  let out = rows;
  for (const spec of specs) {
    const ids = [...new Set(out.map((r) => r[spec.idKey]).filter((id): id is string => typeof id === 'string'))];
    if (ids.length === 0) continue;
    const { rows: found } = await adminPool.query(
      `SELECT entity_id, fields->>'name' AS name FROM cat_translations
        WHERE entity_type = $1 AND language = $2 AND status = 'active' AND entity_id = ANY($3::uuid[])`,
      [spec.entity, language, ids],
    );
    const names = new Map(found.filter((f) => typeof f.name === 'string' && f.name.trim()).map((f) => [f.entity_id as string, f.name as string]));
    if (names.size === 0) continue;
    out = out.map((r) => {
      const id = r[spec.idKey];
      return typeof id === 'string' && names.has(id) ? { ...r, [spec.nameKey]: names.get(id) } : r;
    });
  }
  return out;
}

/** One record's translated name, or null when there is none in that language. */
export async function translatedName(entity: TranslatableEntity, entityId: string | null | undefined, language: string | null | undefined): Promise<string | null> {
  if (!entityId || !language) return null;
  const { rows } = await adminPool.query(
    `SELECT fields->>'name' AS name FROM cat_translations WHERE entity_type = $1 AND entity_id = $2 AND language = $3 AND status = 'active'`,
    [entity, entityId, language],
  );
  const name = rows[0]?.name;
  return typeof name === 'string' && name.trim() ? name : null;
}
