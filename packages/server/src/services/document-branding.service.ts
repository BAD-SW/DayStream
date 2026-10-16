import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { isKnownArtifactType, getArtifactType, DOCUMENT_ARTIFACT_TYPES } from '@daystream/shared';

/**
 * Section C — Document branding templates (spec 10-payment-platform, task 6.3 /
 * Requirement C12).
 *
 * A business keeps named, brandable templates for each customer-facing document
 * type (invoice, receipt, ...). The schema allows MANY templates per
 * (business, artifact_type); this service is the CRUD surface the Templates
 * editor drives. It does NOT decide which template a real document uses — that's
 * the resolver (task 6.2). Here we only list/create/update/delete candidates.
 *
 * Isolation is application-level (adminPool), scoped by business_id + tenant_id,
 * matching the rest of Section C (migrations 127/146/148).
 */

class DocumentBrandingError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DocumentBrandingError';
    this.code = code;
  }
}

export interface DocumentBrandingTemplate {
  id: string;
  tenantId: string;
  businessId: string;
  artifactType: string;
  name: string;
  language: string | null;
  isActive: boolean;
  selectionRules: Record<string, unknown>;
  logoUrl: string | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  senderName: string | null;
  replyTo: string | null;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  footerText: string | null;
  footerLinkText: string | null;
  footerLinkUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Shape accepted from the editor for create/update. Nullable fields clear overrides. */
export interface DocumentBrandingInput {
  name?: string;
  language?: string | null;
  isActive?: boolean;
  selectionRules?: Record<string, unknown>;
  logoUrl?: string | null;
  colorPrimary?: string | null;
  colorSecondary?: string | null;
  senderName?: string | null;
  replyTo?: string | null;
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
  footerText?: string | null;
  footerLinkText?: string | null;
  footerLinkUrl?: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): DocumentBrandingTemplate {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    businessId: r.business_id,
    artifactType: r.artifact_type,
    name: r.name,
    language: r.language,
    isActive: r.is_active,
    selectionRules: r.selection_rules ?? {},
    logoUrl: r.logo_url,
    colorPrimary: r.color_primary,
    colorSecondary: r.color_secondary,
    senderName: r.sender_name,
    replyTo: r.reply_to,
    subjectTemplate: r.subject_template,
    bodyTemplate: r.body_template,
    footerText: r.footer_text,
    footerLinkText: r.footer_link_text,
    footerLinkUrl: r.footer_link_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SELECT_COLS = `
  id, tenant_id, business_id, artifact_type, name, language, is_active,
  selection_rules, logo_url, color_primary, color_secondary, sender_name,
  reply_to, subject_template, body_template, footer_text, footer_link_text,
  footer_link_url, created_at, updated_at
`;

/**
 * List templates for a business, optionally filtered to one artifact type.
 * Ordered so the editor shows active templates first, then by name.
 */
export async function listTemplates(
  businessId: string,
  artifactType?: string,
): Promise<DocumentBrandingTemplate[]> {
  const params: unknown[] = [businessId];
  let where = 'business_id = $1';
  if (artifactType) {
    params.push(artifactType);
    where += ` AND artifact_type = $${params.length}`;
  }
  const { rows } = await adminPool.query(
    `SELECT ${SELECT_COLS} FROM pay_document_branding
      WHERE ${where}
      ORDER BY artifact_type, is_active DESC, name ASC`,
    params,
  );
  return rows.map(mapRow);
}

/** Fetch a single template, scoped to the business. */
export async function getTemplate(
  businessId: string,
  id: string,
): Promise<DocumentBrandingTemplate | null> {
  const { rows } = await adminPool.query(
    `SELECT ${SELECT_COLS} FROM pay_document_branding
      WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface CreateTemplateInput extends DocumentBrandingInput {
  tenantId: string;
  businessId: string;
  artifactType: string;
  createdBy: string;
}

/** Create a new template for an artifact type. */
export async function createTemplate(input: CreateTemplateInput): Promise<DocumentBrandingTemplate> {
  if (!isKnownArtifactType(input.artifactType)) {
    throw new DocumentBrandingError(
      `Unknown artifact type: ${input.artifactType}`,
      'UNKNOWN_ARTIFACT_TYPE',
    );
  }
  const name = (input.name ?? 'Default').trim();
  if (!name) {
    throw new DocumentBrandingError('Template name is required', 'INVALID_NAME');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO pay_document_branding
       (tenant_id, business_id, artifact_type, name, language, is_active,
        selection_rules, logo_url, color_primary, color_secondary, sender_name,
        reply_to, subject_template, body_template, footer_text, footer_link_text,
        footer_link_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING ${SELECT_COLS}`,
    [
      input.tenantId,
      input.businessId,
      input.artifactType,
      name,
      input.language ?? null,
      input.isActive ?? true,
      JSON.stringify(input.selectionRules ?? {}),
      input.logoUrl ?? null,
      input.colorPrimary ?? null,
      input.colorSecondary ?? null,
      input.senderName ?? null,
      input.replyTo ?? null,
      input.subjectTemplate ?? null,
      input.bodyTemplate ?? null,
      input.footerText ?? null,
      input.footerLinkText ?? null,
      input.footerLinkUrl ?? null,
    ],
  );
  const created = mapRow(rows[0]);
  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'document_branding.create',
    resourceType: 'pay_document_branding',
    resourceId: created.id,
    details: { businessId: input.businessId, artifactType: created.artifactType, name: created.name },
  });
  return created;
}

/** Update an existing template. Only provided fields change. */
export async function updateTemplate(
  businessId: string,
  id: string,
  input: DocumentBrandingInput,
  updatedBy: string,
  tenantId: string,
): Promise<DocumentBrandingTemplate> {
  const existing = await getTemplate(businessId, id);
  if (!existing) {
    throw new DocumentBrandingError('Template not found', 'NOT_FOUND');
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new DocumentBrandingError('Template name is required', 'INVALID_NAME');
    set('name', name);
  }
  if (input.language !== undefined) set('language', input.language);
  if (input.isActive !== undefined) set('is_active', input.isActive);
  if (input.selectionRules !== undefined) set('selection_rules', JSON.stringify(input.selectionRules));
  if (input.logoUrl !== undefined) set('logo_url', input.logoUrl);
  if (input.colorPrimary !== undefined) set('color_primary', input.colorPrimary);
  if (input.colorSecondary !== undefined) set('color_secondary', input.colorSecondary);
  if (input.senderName !== undefined) set('sender_name', input.senderName);
  if (input.replyTo !== undefined) set('reply_to', input.replyTo);
  if (input.subjectTemplate !== undefined) set('subject_template', input.subjectTemplate);
  if (input.bodyTemplate !== undefined) set('body_template', input.bodyTemplate);
  if (input.footerText !== undefined) set('footer_text', input.footerText);
  if (input.footerLinkText !== undefined) set('footer_link_text', input.footerLinkText);
  if (input.footerLinkUrl !== undefined) set('footer_link_url', input.footerLinkUrl);

  if (sets.length === 0) return existing;

  set('updated_at', new Date().toISOString());
  params.push(id, businessId);

  const { rows } = await adminPool.query(
    `UPDATE pay_document_branding
        SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND business_id = $${params.length}
      RETURNING ${SELECT_COLS}`,
    params,
  );
  const updated = mapRow(rows[0]);
  await logAudit({
    tenantId,
    userId: updatedBy,
    action: 'document_branding.update',
    resourceType: 'pay_document_branding',
    resourceId: id,
    details: { businessId, artifactType: updated.artifactType, name: updated.name },
  });
  return updated;
}

/** Delete a template, scoped to the business. */
export async function deleteTemplate(
  businessId: string,
  id: string,
  deletedBy: string,
  tenantId: string,
): Promise<void> {
  const { rowCount } = await adminPool.query(
    `DELETE FROM pay_document_branding WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  if (!rowCount) {
    throw new DocumentBrandingError('Template not found', 'NOT_FOUND');
  }
  await logAudit({
    tenantId,
    userId: deletedBy,
    action: 'document_branding.delete',
    resourceType: 'pay_document_branding',
    resourceId: id,
    details: { businessId },
  });
}

/** The brandable artifact-type catalog (with placeholders) for the editor. */
export function getArtifactCatalog() {
  return DOCUMENT_ARTIFACT_TYPES;
}

export { getArtifactType, DocumentBrandingError };
