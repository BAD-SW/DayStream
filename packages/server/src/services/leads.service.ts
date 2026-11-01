import { adminPool } from '../db/pool';
import { LEAD_SOURCES, DEFAULT_LEAD_STAGES, LEAD_SOURCE_LABELS } from '@daystream/shared';
import { createActivity } from './customer-activity.service';
import { createCustomer } from './customer.service';

/**
 * Leads (THE-17): the people of a business still at lifecycle stage "lead", with the
 * business's own lead stages. Same people data as People; only the lead stage and the
 * lead source are added. Decisions by David, 28 October 2026.
 */

export class LeadError extends Error {
  constructor(message: string, public code: string, public status = 400) { super(message); }
}

export interface LeadStage { id: string; name: string; sort_order: number; lead_count?: number }

/** The business's stages in order. Defaults are created the first time a business has none at all. */
export async function getStages(businessId: string): Promise<LeadStage[]> {
  const { rows: existing } = await adminPool.query('SELECT 1 FROM cus_lead_stages WHERE business_id = $1 LIMIT 1', [businessId]);
  if (existing.length === 0) {
    await adminPool.query(
      `INSERT INTO cus_lead_stages (business_id, name, sort_order)
       SELECT $1, name, ord FROM unnest($2::text[]) WITH ORDINALITY AS s(name, ord)`,
      [businessId, DEFAULT_LEAD_STAGES],
    );
  }
  const { rows } = await adminPool.query(
    `SELECT s.id, s.name, s.sort_order,
            (SELECT COUNT(*)::int FROM cus_customers c
              WHERE c.business_id = s.business_id AND c.lifecycle_stage = 'lead'
                AND c.status IN ('active', 'archived') AND c.lead_stage_id = s.id) AS lead_count
       FROM cus_lead_stages s WHERE s.business_id = $1 AND s.deleted_at IS NULL
      ORDER BY s.sort_order, s.created_at`,
    [businessId],
  );
  // Leads with no stage set are shown in the first one.
  if (rows[0]) {
    const { rows: unset } = await adminPool.query(
      `SELECT COUNT(*)::int AS n FROM cus_customers
        WHERE business_id = $1 AND lifecycle_stage = 'lead' AND status IN ('active', 'archived') AND lead_stage_id IS NULL`,
      [businessId],
    );
    rows[0].lead_count += unset[0].n;
  }
  return rows;
}

async function stageOf(businessId: string, stageId: string) {
  const { rows } = await adminPool.query(
    'SELECT id, name, sort_order FROM cus_lead_stages WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
    [stageId, businessId],
  );
  if (!rows[0]) throw new LeadError('Lead stage not found', 'STAGE_NOT_FOUND', 404);
  return rows[0];
}

function cleanName(name: unknown): string {
  const n = String(name ?? '').trim();
  if (!n) throw new LeadError('A stage needs a name', 'VALIDATION_ERROR');
  if (n.length > 60) throw new LeadError('A stage name can have at most 60 characters', 'VALIDATION_ERROR');
  return n;
}

async function assertNameFree(businessId: string, name: string, exceptId?: string) {
  const { rows } = await adminPool.query(
    `SELECT 1 FROM cus_lead_stages WHERE business_id = $1 AND deleted_at IS NULL AND LOWER(name) = LOWER($2) AND id IS DISTINCT FROM $3`,
    [businessId, name, exceptId || null],
  );
  if (rows[0]) throw new LeadError('A stage with this name already exists', 'DUPLICATE_STAGE', 409);
}

export async function addStage(businessId: string, name: unknown) {
  await getStages(businessId);
  const clean = cleanName(name);
  await assertNameFree(businessId, clean);
  const { rows } = await adminPool.query(
    `INSERT INTO cus_lead_stages (business_id, name, sort_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM cus_lead_stages WHERE business_id = $1 AND deleted_at IS NULL))
     RETURNING id, name, sort_order`,
    [businessId, clean],
  );
  return rows[0];
}

export async function renameStage(businessId: string, stageId: string, name: unknown) {
  await stageOf(businessId, stageId);
  const clean = cleanName(name);
  await assertNameFree(businessId, clean, stageId);
  const { rows } = await adminPool.query(
    'UPDATE cus_lead_stages SET name = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING id, name, sort_order',
    [stageId, businessId, clean],
  );
  return rows[0];
}

/** New order: every current stage id, first to last. */
export async function reorderStages(businessId: string, ids: string[]) {
  const current = await getStages(businessId);
  const known = new Set(current.map((s) => s.id));
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new LeadError('The new order must list every stage once', 'VALIDATION_ERROR');
  }
  await adminPool.query(
    `UPDATE cus_lead_stages s SET sort_order = o.ord, updated_at = NOW()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, ord)
      WHERE s.id = o.id AND s.business_id = $1`,
    [businessId, ids],
  );
  return getStages(businessId);
}

/**
 * Delete a stage. Leads still in it move to `moveTo` (David: ask which stage they move to).
 * The last stage cannot be deleted, because a new lead starts in the first stage.
 */
export async function deleteStage(businessId: string, stageId: string, moveTo: string | undefined, userId: string) {
  const stages = await getStages(businessId);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) throw new LeadError('Lead stage not found', 'STAGE_NOT_FOUND', 404);
  if (stages.length === 1) throw new LeadError('The last stage cannot be deleted', 'LAST_STAGE');

  const isFirst = stages[0].id === stageId;
  if ((stage.lead_count || 0) > 0) {
    if (!moveTo) throw new LeadError('Choose the stage its leads move to', 'MOVE_TO_REQUIRED');
    if (moveTo === stageId) throw new LeadError('Choose another stage', 'VALIDATION_ERROR');
    const target = await stageOf(businessId, moveTo);
    // Leads with no stage set are in the first stage; they move too when that one is deleted.
    const { rows: moved } = await adminPool.query(
      `UPDATE cus_customers SET lead_stage_id = $3, updated_at = NOW()
        WHERE business_id = $1 AND lifecycle_stage = 'lead' AND status IN ('active', 'archived')
          AND (lead_stage_id = $2 OR ($4 AND lead_stage_id IS NULL))
        RETURNING id`,
      [businessId, stageId, target.id, isFirst],
    );
    for (const r of moved) {
      await createActivity({
        customerId: r.id, businessId, activityType: 'lifecycle', createdBy: userId,
        description: `Lead stage: ${stage.name} → ${target.name} (stage "${stage.name}" deleted)`,
        metadata: { lead_stage_from: stage.id, lead_stage_to: target.id },
      });
    }
  }
  await adminPool.query('UPDATE cus_lead_stages SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND business_id = $2', [stageId, businessId]);
  return getStages(businessId);
}

// --- The Leads list ---

export interface LeadFilters {
  stage_id?: string;
  lead_source?: string;
  owner?: string;
  search?: string;
  archived?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

const SORTS: Record<string, string> = {
  first_name: 'c.first_name', last_name: 'c.last_name', created_at: 'c.created_at', owner_name: 'owner_name',
  lead_source: 'c.lead_source', messages_sent: 'messages_sent', stage: 'st.sort_order',
};

/** Messages sent to the person on every channel, automatic ones included (David, THE-17). Same sources as the Timeline. */
const MESSAGES_SENT = `
  ((SELECT COUNT(*) FROM apt_notification_queue q WHERE q.recipient_id = c.id AND q.business_id = c.business_id AND q.status = 'sent')
 + (SELECT COUNT(*) FROM mkt_campaign_recipients cr JOIN mkt_campaigns mc ON mc.id = cr.campaign_id
     WHERE cr.customer_id = c.id AND mc.business_id = c.business_id AND cr.sent_at IS NOT NULL
       AND cr.status IN ('sent', 'delivered', 'opened', 'clicked')))::int`;

export async function listLeads(businessId: string, f: LeadFilters) {
  const stages = await getStages(businessId);
  const first = stages[0]?.id || null;

  const where = ['c.business_id = $1', "c.lifecycle_stage = 'lead'", f.archived ? "c.status = 'archived'" : "c.status = 'active'"];
  const params: any[] = [businessId, first];
  const add = (v: any) => { params.push(v); return `$${params.length}`; };

  if (f.stage_id) where.push(`COALESCE(c.lead_stage_id, $2) = ${add(f.stage_id)}`);
  if (f.lead_source) where.push(f.lead_source === 'none' ? 'c.lead_source IS NULL' : `c.lead_source = ${add(f.lead_source)}`);
  if (f.owner === 'none') where.push('c.owner_user_id IS NULL');
  else if (f.owner) where.push(`c.owner_user_id = ${add(f.owner)}`);
  if (f.search) {
    const p = add(`%${f.search}%`);
    where.push(`(c.first_name ILIKE ${p} OR c.last_name ILIKE ${p} OR (c.first_name || ' ' || COALESCE(c.last_name, '')) ILIKE ${p}
                 OR COALESCE(c.email, '') ILIKE ${p} OR COALESCE(c.phone, '') ILIKE ${p})`);
  }

  const sort = SORTS[f.sort || ''] || 'c.created_at';
  const order = f.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(f.limit || 20, 1), 100);
  const page = Math.max(f.page || 1, 1);
  const from = `FROM cus_customers c
    LEFT JOIN cus_lead_stages st ON st.id = COALESCE(c.lead_stage_id, $2)
    LEFT JOIN usr_users ou ON ou.id = c.owner_user_id
    WHERE ${where.join(' AND ')}`;

  const [data, count, biz] = await Promise.all([
    adminPool.query(
      `SELECT c.id, c.reference_number, c.first_name, c.last_name, c.email, c.phone, c.status, c.created_at,
              c.owner_user_id, NULLIF(BTRIM(COALESCE(ou.first_name, '') || ' ' || COALESCE(ou.last_name, '')), '') AS owner_name,
              c.lead_source, st.id AS lead_stage_id, st.name AS lead_stage_name,
              ${MESSAGES_SENT} AS messages_sent,
              COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name)
                          FROM cus_customer_tags ct JOIN cus_tags t ON t.id = ct.tag_id WHERE ct.customer_id = c.id), '[]') AS tags
         ${from} ORDER BY ${sort} ${order} NULLS LAST, c.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS n ${from}`, params),
    adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]),
  ]);
  return { leads: data.rows, total: count.rows[0].n, page, limit, stages, timezone: biz.rows[0]?.timezone || 'UTC' };
}

async function assertStaff(businessId: string, tenantId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await adminPool.query(
    `SELECT first_name, last_name FROM usr_users
      WHERE id = $1 AND tenant_id = $2 AND business_id = $3 AND status = 'active' AND persona = 'business'`,
    [userId, tenantId, businessId],
  );
  if (!rows[0]) throw new LeadError('Assigned staff must be an active staff member of this business', 'VALIDATION_ERROR');
  return `${rows[0].first_name} ${rows[0].last_name || ''}`.trim();
}

function assertSource(source: string | null | undefined) {
  if (source && !LEAD_SOURCES.includes(source)) throw new LeadError('Unknown lead source', 'VALIDATION_ERROR');
}

async function assertTags(businessId: string, tagIds: string[]) {
  if (tagIds.length === 0) return;
  const { rows } = await adminPool.query('SELECT id FROM cus_tags WHERE business_id = $1 AND id = ANY($2::uuid[])', [businessId, tagIds]);
  if (rows.length !== new Set(tagIds).size) throw new LeadError('Tag not found', 'VALIDATION_ERROR');
}

export interface NewLead {
  first_name: string; last_name?: string | null; email?: string | null; phone?: string | null;
  lead_source?: string | null; lead_stage_id?: string | null; owner_user_id?: string | null; tag_ids?: string[];
}

/** Add a lead by hand (David, THE-17 point 6). A person who already exists is refused, as in People. */
export async function createLead(businessId: string, tenantId: string, userId: string, input: NewLead) {
  if (!(input.email || '').trim() && !(input.phone || '').trim()) {
    throw new LeadError('An email address or a phone number is required', 'CONTACT_POINT_REQUIRED');
  }
  assertSource(input.lead_source);
  const stages = await getStages(businessId);
  const stage = input.lead_stage_id ? await stageOf(businessId, input.lead_stage_id) : stages[0];
  const ownerName = await assertStaff(businessId, tenantId, input.owner_user_id || null);
  const tagIds = input.tag_ids || [];
  await assertTags(businessId, tagIds);

  const result = await createCustomer({
    businessId, tenantId, createdBy: userId, source: 'manual',
    firstName: input.first_name, lastName: input.last_name, email: input.email, phone: input.phone || undefined,
  });
  if (result.duplicate) {
    const err = new LeadError(
      result.matchedBy === 'phone' ? 'This phone number already belongs to a person in this business' : 'A person with this email already exists in this business',
      result.matchedBy === 'phone' ? 'DUPLICATE_PHONE' : 'DUPLICATE_EMAIL', 409,
    );
    (err as any).details = { existing_id: result.existingId, existing_name: result.customer?.display_name, matched_by: result.matchedBy };
    throw err;
  }
  const id = result.customer.id;
  await adminPool.query(
    `UPDATE cus_customers SET lead_source = $3, lead_stage_id = $4, owner_user_id = $5, updated_at = NOW()
      WHERE id = $1 AND business_id = $2`,
    [id, businessId, input.lead_source || null, stage?.id || null, input.owner_user_id || null],
  );
  if (tagIds.length) {
    await adminPool.query(
      `INSERT INTO cus_customer_tags (customer_id, tag_id, assigned_by) SELECT $1, unnest($2::uuid[]), $3 ON CONFLICT DO NOTHING`,
      [id, tagIds, userId],
    );
  }
  if (stage) {
    await createActivity({
      customerId: id, businessId, activityType: 'lifecycle', createdBy: userId,
      description: `Lead stage: ${stage.name}${ownerName ? ` · assigned to ${ownerName}` : ''}`,
      metadata: { lead_stage_to: stage.id },
    });
  }
  return getLead(businessId, id);
}

export async function getLead(businessId: string, id: string) {
  const { rows: who } = await adminPool.query('SELECT first_name, email FROM cus_customers WHERE id = $1 AND business_id = $2', [id, businessId]);
  if (!who[0]) throw new LeadError('Lead not found', 'NOT_FOUND', 404);
  const stages = await getStages(businessId);
  const { rows } = await adminPool.query(
    `SELECT c.id, c.reference_number, c.first_name, c.last_name, c.email, c.phone, c.status, c.created_at, c.lifecycle_stage,
            c.owner_user_id, NULLIF(BTRIM(COALESCE(ou.first_name, '') || ' ' || COALESCE(ou.last_name, '')), '') AS owner_name,
            c.lead_source, st.id AS lead_stage_id, st.name AS lead_stage_name, ${MESSAGES_SENT} AS messages_sent,
            COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name)
                        FROM cus_customer_tags ct JOIN cus_tags t ON t.id = ct.tag_id WHERE ct.customer_id = c.id), '[]') AS tags
       FROM cus_customers c
       LEFT JOIN cus_lead_stages st ON st.id = COALESCE(c.lead_stage_id, $3)
       LEFT JOIN usr_users ou ON ou.id = c.owner_user_id
      WHERE c.id = $1 AND c.business_id = $2`,
    [id, businessId, stages[0]?.id || null],
  );
  return rows[0];
}

/** Change a lead's stage, assigned staff or lead source from the Leads list. A stage change goes on the Timeline. */
export async function updateLead(
  businessId: string, tenantId: string, userId: string, id: string,
  patch: { lead_stage_id?: string; owner_user_id?: string | null; lead_source?: string | null },
) {
  const current = await getLead(businessId, id);
  if (current.lifecycle_stage !== 'lead') throw new LeadError('This person is no longer a lead', 'NOT_A_LEAD', 409);

  // The source can be corrected after the lead is added (David, 2026-10-29); the change is on the Timeline.
  if (patch.lead_source !== undefined && (patch.lead_source || null) !== (current.lead_source || null)) {
    assertSource(patch.lead_source);
    await adminPool.query('UPDATE cus_customers SET lead_source = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2',
      [id, businessId, patch.lead_source || null]);
    const label = (v: string | null | undefined) => (v ? LEAD_SOURCE_LABELS[v] || v : 'none');
    await createActivity({
      customerId: id, businessId, activityType: 'profile_change', createdBy: userId,
      description: `Lead source: ${label(current.lead_source)} → ${label(patch.lead_source)}`,
    });
  }
  if (patch.owner_user_id !== undefined && (patch.owner_user_id || null) !== current.owner_user_id) {
    const name = await assertStaff(businessId, tenantId, patch.owner_user_id || null);
    await adminPool.query('UPDATE cus_customers SET owner_user_id = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2',
      [id, businessId, patch.owner_user_id || null]);
    await createActivity({
      customerId: id, businessId, activityType: 'profile_change', createdBy: userId,
      description: name ? `Owner: ${name}` : 'Owner removed',
    });
  }
  if (patch.lead_stage_id && patch.lead_stage_id !== current.lead_stage_id) {
    const to = await stageOf(businessId, patch.lead_stage_id);
    await adminPool.query('UPDATE cus_customers SET lead_stage_id = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2',
      [id, businessId, to.id]);
    await createActivity({
      customerId: id, businessId, activityType: 'lifecycle', createdBy: userId,
      description: `Lead stage: ${current.lead_stage_name || '—'} → ${to.name}`,
      metadata: { lead_stage_from: current.lead_stage_id, lead_stage_to: to.id },
    });
  }
  return getLead(businessId, id);
}
