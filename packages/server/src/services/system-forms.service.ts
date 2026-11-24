import { adminPool } from '../db/pool';
import { validateFormDefinition, isSignedForm } from '@daystream/shared';
import type { FormDefinition } from '@daystream/shared';
import { logAudit } from './audit.service';
import type { Actor } from './system-document-templates.service';

/**
 * System forms and chart templates (spec 51, gap 17, criterion 8). Platform administrators build
 * them with the business's form builder; a business sees the active ones read only and duplicates
 * one into its own form or chart template. A system form never applies to a business by itself.
 */

export class SystemFormError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'INVALID_NAME' | 'INVALID_DEFINITION') { super(message); this.name = 'SystemFormError'; }
}

export interface SystemForm {
  id: string;
  kind: 'form' | 'chart';
  name: string;
  language: string | null;
  definition: FormDefinition;
  isActive: boolean;
  signed: boolean;
  isSystem: true;
  createdAt: string;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): SystemForm {
  return {
    id: r.id, kind: r.kind, name: r.name, language: r.language, definition: r.definition, isActive: r.is_active,
    signed: isSignedForm(r.definition), isSystem: true, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const COLS = 'id, kind, name, language, definition, is_active, created_at, updated_at';

function cleanName(name: string | undefined): string {
  const v = (name ?? '').trim();
  if (!v || v.length > 200) throw new SystemFormError('A form needs a name (up to 200 characters).', 'INVALID_NAME');
  return v;
}

function checkDefinition(def: unknown, kind: 'form' | 'chart'): FormDefinition {
  const issues = validateFormDefinition(def, kind);
  if (issues.length > 0) throw new SystemFormError(issues.map((i) => i.message).join(' '), 'INVALID_DEFINITION');
  return def as FormDefinition;
}

export async function listSystemForms(kind: 'form' | 'chart', opts: { activeOnly?: boolean } = {}): Promise<SystemForm[]> {
  const { rows } = await adminPool.query(
    `SELECT ${COLS} FROM sys_form_templates WHERE kind = $1 AND (NOT $2::boolean OR is_active) ORDER BY is_active DESC, name`,
    [kind, !!opts.activeOnly]);
  return rows.map(mapRow);
}

export async function getSystemForm(id: string): Promise<SystemForm | null> {
  const { rows } = await adminPool.query(`SELECT ${COLS} FROM sys_form_templates WHERE id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function createSystemForm(input: { kind: 'form' | 'chart'; name?: string; language?: string | null; definition?: unknown; isActive?: boolean }, actor: Actor): Promise<SystemForm> {
  const name = cleanName(input.name);
  const definition = checkDefinition(input.definition, input.kind);
  const { rows } = await adminPool.query(
    `INSERT INTO sys_form_templates (kind, name, language, definition, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING ${COLS}`,
    [input.kind, name, input.kind === 'chart' ? null : input.language || null, JSON.stringify(definition), input.isActive ?? false, actor.userId]);
  const created = mapRow(rows[0]);
  await logAudit({ tenantId: actor.tenantId, userId: actor.userId, action: 'system_form.create', resourceType: 'sys_form_templates', resourceId: created.id, details: { kind: created.kind, name } }).catch(() => undefined);
  return created;
}

export async function updateSystemForm(id: string, input: { name?: string; language?: string | null; definition?: unknown; isActive?: boolean }, actor: Actor): Promise<SystemForm> {
  const existing = await getSystemForm(id);
  if (!existing) throw new SystemFormError('Form not found', 'NOT_FOUND');
  const sets: string[] = []; const params: unknown[] = [];
  const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (input.name !== undefined) set('name', cleanName(input.name));
  if (input.language !== undefined && existing.kind === 'form') set('language', input.language || null);
  if (input.definition !== undefined) set('definition', JSON.stringify(checkDefinition(input.definition, existing.kind)));
  if (input.isActive !== undefined) set('is_active', input.isActive);
  if (sets.length === 0) return existing;
  set('updated_by', actor.userId);
  sets.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await adminPool.query(`UPDATE sys_form_templates SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLS}`, params);
  await logAudit({ tenantId: actor.tenantId, userId: actor.userId, action: 'system_form.update', resourceType: 'sys_form_templates', resourceId: id, details: { kind: existing.kind } }).catch(() => undefined);
  return mapRow(rows[0]);
}

export async function deleteSystemForm(id: string, actor: Actor): Promise<void> {
  const { rowCount } = await adminPool.query('DELETE FROM sys_form_templates WHERE id = $1', [id]);
  if (!rowCount) throw new SystemFormError('Form not found', 'NOT_FOUND');
  await logAudit({ tenantId: actor.tenantId, userId: actor.userId, action: 'system_form.delete', resourceType: 'sys_form_templates', resourceId: id, details: {} }).catch(() => undefined);
}
