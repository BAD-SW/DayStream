import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * List sequences for a tenant with optional filters.
 */
export async function getSequences(
  tenantId: string,
  filters: { status?: string; page?: number; limit?: number } = {},
) {
  const conditions = ['tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 25, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT * FROM mkt_sequences WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM mkt_sequences WHERE ${where}`, params),
  ]);

  return {
    sequences: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}

/**
 * Create a new sequence.
 */
export async function createSequence(
  tenantId: string,
  input: { name: string; description?: string; canvasData?: any },
) {
  const { rows } = await adminPool.query(
    `INSERT INTO mkt_sequences (tenant_id, name, description, canvas_data)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, input.name, input.description || null, JSON.stringify(input.canvasData || {})],
  );

  await logAudit({
    tenantId,
    action: 'sequence.created',
    resourceType: 'sequence',
    resourceId: rows[0].id,
    details: { name: input.name },
  });

  return rows[0];
}

/**
 * Get a sequence by ID with its steps and connections.
 */
export async function getSequenceById(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM mkt_sequences WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  if (!rows[0]) return null;

  const [stepsResult, connectionsResult] = await Promise.all([
    adminPool.query(
      `SELECT * FROM mkt_sequence_steps WHERE sequence_id = $1 ORDER BY created_at`,
      [id],
    ),
    adminPool.query(
      `SELECT * FROM mkt_sequence_connections WHERE sequence_id = $1 ORDER BY sort_order`,
      [id],
    ),
  ]);

  return {
    ...rows[0],
    steps: stepsResult.rows,
    connections: connectionsResult.rows,
  };
}

/**
 * Update a sequence.
 */
export async function updateSequence(id: string, tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }
  if (updates.canvasData !== undefined) { fields.push(`canvas_data = $${idx++}`); values.push(JSON.stringify(updates.canvasData)); }
  if (updates.allowReentry !== undefined) { fields.push(`allow_reentry = $${idx++}`); values.push(updates.allowReentry); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE mkt_sequences SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} AND status IN ('draft', 'paused') RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Activate a sequence.
 */
export async function activateSequence(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE mkt_sequences SET status = 'active', activated_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status IN ('draft', 'paused') RETURNING *`,
    [id, tenantId],
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'sequence.activated',
      resourceType: 'sequence',
      resourceId: id,
    });
  }

  return rows[0] || null;
}

/**
 * Pause a sequence.
 */
export async function pauseSequence(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE mkt_sequences SET status = 'paused', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status = 'active' RETURNING *`,
    [id, tenantId],
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'sequence.paused',
      resourceType: 'sequence',
      resourceId: id,
    });
  }

  return rows[0] || null;
}

/**
 * Archive a sequence.
 */
export async function archiveSequence(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE mkt_sequences SET status = 'archived', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status IN ('draft', 'paused') RETURNING *`,
    [id, tenantId],
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'sequence.archived',
      resourceType: 'sequence',
      resourceId: id,
    });
  }

  return rows[0] || null;
}

/**
 * Validate a sequence: check all paths from Start reach End.
 */
export async function validateSequence(id: string, tenantId: string) {
  const sequence = await getSequenceById(id, tenantId);
  if (!sequence) throw new Error('Sequence not found');

  const { steps, connections } = sequence;
  const errors: string[] = [];

  const startSteps = steps.filter((s: any) => s.step_category === 'start');
  const endSteps = steps.filter((s: any) => s.step_category === 'end');

  if (startSteps.length === 0) errors.push('Sequence must have a Start step');
  if (endSteps.length === 0) errors.push('Sequence must have an End step');

  if (errors.length > 0) return { valid: false, errors };

  // BFS from each start to ensure all paths reach an end
  const endIds = new Set(endSteps.map((s: any) => s.id));
  const adjacency: Record<string, string[]> = {};
  for (const conn of connections) {
    if (!adjacency[conn.source_step_id]) adjacency[conn.source_step_id] = [];
    adjacency[conn.source_step_id].push(conn.target_step_id);
  }

  // Check that all non-end steps have at least one outgoing connection
  for (const step of steps) {
    if (step.step_category === 'end') continue;
    if (!adjacency[step.id] || adjacency[step.id].length === 0) {
      errors.push(`Step "${step.label || step.id}" has no outgoing connections`);
    }
  }

  // BFS reachability from start
  const visited = new Set<string>();
  const queue = startSteps.map((s: any) => s.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = adjacency[current] || [];
    for (const n of neighbors) {
      if (!visited.has(n)) queue.push(n);
    }
  }

  // Check that at least one end is reachable
  const reachableEnd = endSteps.some((s: any) => visited.has(s.id));
  if (!reachableEnd) errors.push('No End step is reachable from Start');

  return { valid: errors.length === 0, errors };
}

/**
 * Clone a sequence (with its steps and connections).
 */
export async function cloneSequence(id: string, tenantId: string) {
  const sequence = await getSequenceById(id, tenantId);
  if (!sequence) throw new Error('Sequence not found');

  // Create the new sequence
  const { rows: newSeqRows } = await adminPool.query(
    `INSERT INTO mkt_sequences (tenant_id, name, description, canvas_data)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, `${sequence.name} (Copy)`, sequence.description, JSON.stringify(sequence.canvas_data)],
  );
  const newSeqId = newSeqRows[0].id;

  // Clone steps with ID mapping
  const stepIdMap: Record<string, string> = {};
  for (const step of sequence.steps) {
    const { rows: newStepRows } = await adminPool.query(
      `INSERT INTO mkt_sequence_steps (sequence_id, step_category, step_type, label, config, position_x, position_y)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [newSeqId, step.step_category, step.step_type, step.label, JSON.stringify(step.config), step.position_x, step.position_y],
    );
    stepIdMap[step.id] = newStepRows[0].id;
  }

  // Clone connections
  for (const conn of sequence.connections) {
    await adminPool.query(
      `INSERT INTO mkt_sequence_connections (sequence_id, source_step_id, target_step_id, label, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [newSeqId, stepIdMap[conn.source_step_id], stepIdMap[conn.target_step_id], conn.label, conn.sort_order],
    );
  }

  await logAudit({
    tenantId,
    action: 'sequence.cloned',
    resourceType: 'sequence',
    resourceId: newSeqId,
    details: { sourceId: id },
  });

  return getSequenceById(newSeqId, tenantId);
}

/**
 * Get enrollments for a sequence with optional filters.
 */
export async function getEnrollments(
  sequenceId: string,
  filters: { status?: string; page?: number; limit?: number } = {},
) {
  const conditions = ['sequence_id = $1'];
  const params: any[] = [sequenceId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 25, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT * FROM mkt_sequence_enrollments WHERE ${where} ORDER BY entered_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM mkt_sequence_enrollments WHERE ${where}`, params),
  ]);

  return {
    enrollments: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}

/**
 * Get sequence templates (sequences marked as is_template=true).
 */
export async function getSequenceTemplates(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM mkt_sequences WHERE tenant_id = $1 AND is_template = true ORDER BY template_category, name`,
    [tenantId],
  );
  return rows;
}
