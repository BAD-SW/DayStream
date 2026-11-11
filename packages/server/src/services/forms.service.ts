import { randomUUID } from 'crypto';
import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { validateFormDefinition, isSignedForm, isSupportedLanguage, SUPPORTED_LANGUAGES } from '@daystream/shared';
import type { FormDefinition, FormApplies } from '@daystream/shared';

/**
 * Forms, waivers and e-signature (spec 51, gap 1): the forms a business builds.
 *
 * One row per language version; the versions of the same form share a group_id. The default
 * version has no language. "Applies to" and "renew after" belong to the group, so saving them on
 * any version updates them on every version. Saving a version's name or items raises its
 * `version`, so a past signing can always be matched to the wording that was signed.
 *
 * Isolation is application-level (adminPool), scoped by business_id, like the other business tables.
 */

export class FormsError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'FormsError';
    this.code = code;
  }
}

export interface Form {
  id: string;
  tenantId: string;
  businessId: string;
  groupId: string;
  kind: 'form' | 'chart';
  name: string;
  language: string | null;
  definition: FormDefinition;
  version: number;
  applies: FormApplies;
  renewAfterMonths: number | null;
  isActive: boolean;
  status: 'active' | 'archived';
  signed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FormInput {
  kind?: 'form' | 'chart';
  name?: string;
  language?: string | null;
  definition?: FormDefinition;
  applies?: FormApplies;
  renewAfterMonths?: number | null;
  isActive?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): Form {
  const definition = r.definition as FormDefinition;
  return {
    id: r.id,
    tenantId: r.tenant_id,
    businessId: r.business_id,
    groupId: r.group_id,
    kind: r.kind,
    name: r.name,
    language: r.language,
    definition,
    version: r.version,
    applies: r.applies ?? {},
    renewAfterMonths: r.renew_after_months,
    isActive: r.is_active,
    status: r.status,
    signed: isSignedForm(definition),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const COLS = `id, tenant_id, business_id, group_id, kind, name, language, definition, version, applies,
  renew_after_months, is_active, status, created_at, updated_at`;

/** A form's language must be one the app supports; blank means the default version. */
function cleanLanguage(language: string | null | undefined): string | null {
  const v = (language ?? '').trim();
  if (!v) return null;
  if (!isSupportedLanguage(v)) throw new FormsError(`Language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}.`, 'INVALID_LANGUAGE');
  return v;
}

function cleanName(name: string | undefined): string {
  const v = (name ?? '').trim();
  if (!v) throw new FormsError('A form needs a name.', 'INVALID_NAME');
  if (v.length > 200) throw new FormsError('The name is too long.', 'INVALID_NAME');
  return v;
}

function checkDefinition(def: unknown, kind: 'form' | 'chart' = 'form'): FormDefinition {
  const issues = validateFormDefinition(def, kind);
  if (issues.length > 0) throw new FormsError(issues.map((i) => i.message).join(' '), 'INVALID_DEFINITION');
  return def as FormDefinition;
}

function cleanApplies(a: FormApplies | undefined): FormApplies {
  const out: FormApplies = {};
  if (a?.first_visit) out.first_visit = true;
  if (Array.isArray(a?.service_ids) && a.service_ids.length > 0) out.service_ids = [...new Set(a.service_ids)];
  return out;
}

function cleanRenew(months: number | null | undefined): number | null {
  if (months === null || months === undefined) return null;
  if (!Number.isInteger(months) || months < 1 || months > 240) {
    throw new FormsError('Renew after must be a whole number of months.', 'INVALID_RENEWAL');
  }
  return months;
}

/** All of a business's forms (or chart templates) that are not archived, default version first. */
export async function listForms(businessId: string, kind: 'form' | 'chart' = 'form'): Promise<Form[]> {
  const { rows } = await adminPool.query(
    `SELECT ${COLS} FROM frm_forms
      WHERE business_id = $1 AND status = 'active' AND kind = $2
      ORDER BY name ASC, group_id, (language IS NOT NULL), language`,
    [businessId, kind],
  );
  return rows.map(mapRow);
}

export async function getForm(businessId: string, id: string): Promise<Form | null> {
  const { rows } = await adminPool.query(
    `SELECT ${COLS} FROM frm_forms WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface CreateFormInput extends FormInput {
  tenantId: string;
  businessId: string;
  createdBy: string;
}

export async function createForm(input: CreateFormInput): Promise<Form> {
  const name = cleanName(input.name);
  const language = cleanLanguage(input.language);
  const kind = input.kind ?? 'form';
  const definition = checkDefinition(input.definition, kind);
  const { rows } = await adminPool.query(
    `INSERT INTO frm_forms (tenant_id, business_id, group_id, name, language, definition, applies,
                            renew_after_months, is_active, created_by, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COLS}`,
    [
      input.tenantId, input.businessId, randomUUID(), name, language,
      JSON.stringify(definition), JSON.stringify(cleanApplies(input.applies)),
      cleanRenew(input.renewAfterMonths), input.isActive ?? true, input.createdBy, kind,
    ],
  );
  const created = mapRow(rows[0]);
  await audit(input.tenantId, input.createdBy, 'form.create', created);
  return created;
}

export async function updateForm(
  businessId: string, id: string, input: FormInput, userId: string, tenantId: string,
): Promise<Form> {
  const existing = await getForm(businessId, id);
  if (!existing || existing.status === 'archived') throw new FormsError('Form not found', 'NOT_FOUND');

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  let contentChanged = false;
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (name !== existing.name) { set('name', name); contentChanged = true; }
  }
  if (input.definition !== undefined) {
    const definition = checkDefinition(input.definition, existing.kind);
    if (JSON.stringify(definition) !== JSON.stringify(existing.definition)) {
      set('definition', JSON.stringify(definition));
      contentChanged = true;
    }
  }
  if (input.language !== undefined) {
    const language = cleanLanguage(input.language);
    if (language !== existing.language) {
      const { rows: clash } = await adminPool.query(
        `SELECT 1 FROM frm_forms WHERE group_id = $1 AND COALESCE(language, '') = $2 AND id <> $3`,
        [existing.groupId, language ?? '', id],
      );
      if (clash.length > 0) throw new FormsError('This form already has a version in that language.', 'LANGUAGE_EXISTS');
      set('language', language);
    }
  }
  if (input.isActive !== undefined) set('is_active', input.isActive);
  if (contentChanged) { sets.push('version = version + 1'); }

  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    params.push(id, businessId);
    await adminPool.query(
      `UPDATE frm_forms SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND business_id = $${params.length}`,
      params,
    );
  }

  // Group-wide settings apply to every language version.
  if (input.applies !== undefined || input.renewAfterMonths !== undefined) {
    const gSets: string[] = [];
    const gParams: unknown[] = [];
    if (input.applies !== undefined) { gParams.push(JSON.stringify(cleanApplies(input.applies))); gSets.push(`applies = $${gParams.length}`); }
    if (input.renewAfterMonths !== undefined) { gParams.push(cleanRenew(input.renewAfterMonths)); gSets.push(`renew_after_months = $${gParams.length}`); }
    gParams.push(existing.groupId, businessId);
    await adminPool.query(
      `UPDATE frm_forms SET ${gSets.join(', ')}, updated_at = NOW()
        WHERE group_id = $${gParams.length - 1} AND business_id = $${gParams.length}`,
      gParams,
    );
  }

  const updated = (await getForm(businessId, id)) as Form;
  await audit(tenantId, userId, 'form.update', updated);
  return updated;
}

/** Archive (soft delete). Completed submissions keep their PDF and are unaffected. */
export async function archiveForm(businessId: string, id: string, userId: string, tenantId: string): Promise<void> {
  const { rows } = await adminPool.query(
    `UPDATE frm_forms SET status = 'archived', is_active = false, updated_at = NOW()
      WHERE id = $1 AND business_id = $2 AND status = 'active'
      RETURNING ${COLS}`,
    [id, businessId],
  );
  if (!rows[0]) throw new FormsError('Form not found', 'NOT_FOUND');
  await audit(tenantId, userId, 'form.archive', mapRow(rows[0]));
}

/** Copy a form as a new form (its own group). */
export async function duplicateForm(businessId: string, id: string, userId: string, tenantId: string): Promise<Form> {
  const src = await getForm(businessId, id);
  if (!src || src.status === 'archived') throw new FormsError('Form not found', 'NOT_FOUND');
  return createForm({
    tenantId, businessId, createdBy: userId,
    kind: src.kind,
    name: `${src.name} (Copy)`.slice(0, 200),
    language: src.language,
    definition: src.definition,
    applies: src.applies,
    renewAfterMonths: src.renewAfterMonths,
    isActive: false,
  });
}

/** Copy a form into a new language version of the same group, for the business to translate. */
export async function addLanguageVersion(
  businessId: string, id: string, language: string, userId: string, tenantId: string,
): Promise<Form> {
  const src = await getForm(businessId, id);
  if (!src || src.status === 'archived') throw new FormsError('Form not found', 'NOT_FOUND');
  const lang = cleanLanguage(language);
  if (!lang) throw new FormsError('Choose a language for the new version.', 'INVALID_LANGUAGE');

  const { rows: clash } = await adminPool.query(
    `SELECT id, status FROM frm_forms WHERE group_id = $1 AND language = $2`,
    [src.groupId, lang],
  );
  if (clash[0] && clash[0].status === 'active') {
    throw new FormsError('This form already has a version in that language.', 'LANGUAGE_EXISTS');
  }

  let row;
  if (clash[0]) {
    // An archived version in that language exists; bring it back with the copied content.
    ({ rows: [row] } = await adminPool.query(
      `UPDATE frm_forms SET status = 'active', is_active = false, name = $2, definition = $3,
              version = version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING ${COLS}`,
      [clash[0].id, src.name, JSON.stringify(src.definition)],
    ));
  } else {
    ({ rows: [row] } = await adminPool.query(
      `INSERT INTO frm_forms (tenant_id, business_id, group_id, name, language, definition, applies,
                              renew_after_months, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)
       RETURNING ${COLS}`,
      [tenantId, businessId, src.groupId, src.name, lang, JSON.stringify(src.definition),
        JSON.stringify(src.applies), src.renewAfterMonths, userId],
    ));
  }
  const created = mapRow(row);
  await audit(tenantId, userId, 'form.language_version', created);
  return created;
}

async function audit(tenantId: string, userId: string, action: string, f: Form): Promise<void> {
  await logAudit({
    tenantId,
    userId,
    action,
    resourceType: 'frm_forms',
    resourceId: f.id,
    details: { businessId: f.businessId, groupId: f.groupId, name: f.name, language: f.language, version: f.version },
  });
}
