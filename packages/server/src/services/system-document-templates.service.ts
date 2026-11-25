import { adminPool } from '../db/pool';
import { isKnownArtifactType } from '@daystream/shared';
import { logAudit } from './audit.service';
import type { DocumentBrandingTemplate, DocumentBrandingInput } from './document-branding.service';

/**
 * System templates (spec 51, gap 17; design 17). The platform keeps one set of document templates,
 * built by platform administrators in System Configuration > Templates. A business sees them read
 * only and duplicates one to customise it; a business with no active template of its own for a
 * type sends with the active system template. Same fields as a business template, so the editor and
 * the renderer serve both. Platform configuration: no tenant or business.
 */

export class SystemTemplateError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'UNKNOWN_ARTIFACT_TYPE' | 'INVALID_NAME') {
    super(message); this.name = 'SystemTemplateError';
  }
}

/** The platform administrator making the change (their own tenant, for the audit log). */
export interface Actor { userId: string; tenantId: string }

/** A system template, in the shape of a business template (no tenant or business). */
export type SystemDocumentTemplate = DocumentBrandingTemplate & { isSystem: true };

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): SystemDocumentTemplate {
  return {
    id: r.id, tenantId: '', businessId: '', isSystem: true,
    artifactType: r.artifact_type, name: r.name, language: r.language, isActive: r.is_active,
    selectionRules: r.selection_rules ?? {},
    logoUrl: r.logo_url, colorPrimary: r.color_primary, colorSecondary: r.color_secondary,
    senderName: r.sender_name, replyTo: r.reply_to,
    subjectTemplate: r.subject_template, bodyTemplate: r.body_template,
    footerText: r.footer_text, footerLinkText: r.footer_link_text, footerLinkUrl: r.footer_link_url,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const COLS = `id, artifact_type, name, language, is_active, selection_rules, logo_url, color_primary, color_secondary,
  sender_name, reply_to, subject_template, body_template, footer_text, footer_link_text, footer_link_url, created_at, updated_at`;

/** The system templates, optionally of one type and only the active ones; active first, then by name. */
export async function listSystemTemplates(opts: { artifactType?: string; activeOnly?: boolean } = {}): Promise<SystemDocumentTemplate[]> {
  const { rows } = await adminPool.query(
    `SELECT ${COLS} FROM sys_document_templates
      WHERE ($1::text IS NULL OR artifact_type = $1) AND (NOT $2::boolean OR is_active)
      ORDER BY artifact_type, is_active DESC, name`,
    [opts.artifactType ?? null, !!opts.activeOnly],
  );
  return rows.map(mapRow);
}

export async function getSystemTemplate(id: string): Promise<SystemDocumentTemplate | null> {
  const { rows } = await adminPool.query(`SELECT ${COLS} FROM sys_document_templates WHERE id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * The system template a business without its own uses for a type: the active one whose language
 * matches, else one with no language, else the first active one (the same order as a business's).
 */
export async function activeSystemTemplate(artifactType: string, language?: string | null): Promise<SystemDocumentTemplate | null> {
  // In the recipient's language, else English, else one with no language (Phase 44, requirement 5).
  const candidates = await listSystemTemplates({ artifactType, activeOnly: true });
  const { pickTemplateForLanguage } = await import('./document-branding-resolver.service');
  return pickTemplateForLanguage(candidates, language);
}

export async function createSystemTemplate(artifactType: string, input: DocumentBrandingInput, actor: Actor): Promise<SystemDocumentTemplate> {
  const userId = actor.userId;
  if (!isKnownArtifactType(artifactType)) throw new SystemTemplateError(`Unknown document type: ${artifactType}`, 'UNKNOWN_ARTIFACT_TYPE');
  const name = (input.name ?? 'Default').trim();
  if (!name) throw new SystemTemplateError('Template name is required', 'INVALID_NAME');
  const { rows } = await adminPool.query(
    `INSERT INTO sys_document_templates (artifact_type, name, language, is_active, selection_rules, logo_url, color_primary, color_secondary,
       sender_name, reply_to, subject_template, body_template, footer_text, footer_link_text, footer_link_url, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) RETURNING ${COLS}`,
    [artifactType, name, input.language ?? null, input.isActive ?? false, JSON.stringify(input.selectionRules ?? {}),
      input.logoUrl ?? null, input.colorPrimary ?? null, input.colorSecondary ?? null, input.senderName ?? null, input.replyTo ?? null,
      input.subjectTemplate ?? null, input.bodyTemplate ?? null, input.footerText ?? null, input.footerLinkText ?? null, input.footerLinkUrl ?? null, userId],
  );
  const created = mapRow(rows[0]);
  await logAudit({ tenantId: actor.tenantId, userId, action: 'system_template.create', resourceType: 'sys_document_templates', resourceId: created.id, details: { artifactType, name } }).catch(() => undefined);
  return created;
}

export async function updateSystemTemplate(id: string, input: DocumentBrandingInput, actor: Actor): Promise<SystemDocumentTemplate> {
  const userId = actor.userId;
  const existing = await getSystemTemplate(id);
  if (!existing) throw new SystemTemplateError('Template not found', 'NOT_FOUND');
  const sets: string[] = []; const params: unknown[] = [];
  const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new SystemTemplateError('Template name is required', 'INVALID_NAME');
    set('name', input.name.trim());
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
  set('updated_by', userId);
  sets.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await adminPool.query(`UPDATE sys_document_templates SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLS}`, params);
  await logAudit({ tenantId: actor.tenantId, userId, action: 'system_template.update', resourceType: 'sys_document_templates', resourceId: id, details: { artifactType: existing.artifactType } }).catch(() => undefined);
  return mapRow(rows[0]);
}

export async function deleteSystemTemplate(id: string, actor: Actor): Promise<void> {
  const userId = actor.userId;
  const { rowCount } = await adminPool.query('DELETE FROM sys_document_templates WHERE id = $1', [id]);
  if (!rowCount) throw new SystemTemplateError('Template not found', 'NOT_FOUND');
  await logAudit({ tenantId: actor.tenantId, userId, action: 'system_template.delete', resourceType: 'sys_document_templates', resourceId: id, details: {} }).catch(() => undefined);
}
