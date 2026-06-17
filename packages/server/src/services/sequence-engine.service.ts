import { adminPool } from '../db/pool';

/**
 * Main engine loop: evaluate triggers for active sequences and advance enrollments.
 */
export async function runEngine(tenantId: string) {
  // Get all active sequences for the tenant
  const { rows: sequences } = await adminPool.query(
    `SELECT id FROM sequences WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId],
  );

  const results = { triggersEvaluated: 0, enrollmentsAdvanced: 0 };

  for (const seq of sequences) {
    await evaluateTriggers(seq.id, tenantId);
    results.triggersEvaluated++;
  }

  // Advance all active enrollments for this tenant's sequences
  const { rows: enrollments } = await adminPool.query(
    `SELECT se.id FROM sequence_enrollments se
     JOIN sequences s ON s.id = se.sequence_id
     WHERE s.tenant_id = $1 AND se.status = 'active'`,
    [tenantId],
  );

  for (const enrollment of enrollments) {
    await advanceEnrollment(enrollment.id);
    results.enrollmentsAdvanced++;
  }

  return results;
}

/**
 * Evaluate trigger conditions for a sequence and enroll matching customers.
 */
export async function evaluateTriggers(sequenceId: string, tenantId: string) {
  // Get trigger steps for this sequence
  const { rows: triggerSteps } = await adminPool.query(
    `SELECT * FROM sequence_steps WHERE sequence_id = $1 AND step_category = 'trigger'`,
    [sequenceId],
  );

  // Placeholder: trigger evaluation logic depends on step_type config
  // e.g., 'customer_created', 'tag_added', 'form_submitted'
  // In production, each trigger type would query relevant events/conditions
  return { sequenceId, triggersChecked: triggerSteps.length };
}

/**
 * Advance an enrollment: process current step and move to next.
 */
export async function advanceEnrollment(enrollmentId: string) {
  const { rows } = await adminPool.query(
    `SELECT se.*, s.tenant_id FROM sequence_enrollments se
     JOIN sequences s ON s.id = se.sequence_id
     WHERE se.id = $1 AND se.status = 'active'`,
    [enrollmentId],
  );

  const enrollment = rows[0];
  if (!enrollment) return null;

  if (!enrollment.current_step_id) {
    // Find the start step and set it as current
    const { rows: startSteps } = await adminPool.query(
      `SELECT id FROM sequence_steps WHERE sequence_id = $1 AND step_category = 'start' LIMIT 1`,
      [enrollment.sequence_id],
    );
    if (startSteps.length === 0) return null;

    await adminPool.query(
      `UPDATE sequence_enrollments SET current_step_id = $1, step_entered_at = NOW() WHERE id = $2`,
      [startSteps[0].id, enrollmentId],
    );
    return advanceEnrollment(enrollmentId);
  }

  // Get current step
  const { rows: stepRows } = await adminPool.query(
    `SELECT * FROM sequence_steps WHERE id = $1`,
    [enrollment.current_step_id],
  );
  const step = stepRows[0];
  if (!step) return null;

  // Execute the current step
  const result = await executeStep(step, enrollment);

  if (result.action === 'wait') {
    // Stay on the current step
    return { enrollmentId, action: 'wait' };
  }

  if (result.action === 'exit') {
    await exitCustomer(enrollmentId, result.reason || 'step_exit');
    return { enrollmentId, action: 'exit' };
  }

  // Move to the next step
  const { rows: connections } = await adminPool.query(
    `SELECT target_step_id FROM sequence_connections
     WHERE sequence_id = $1 AND source_step_id = $2
     ORDER BY sort_order LIMIT 1`,
    [enrollment.sequence_id, step.id],
  );

  if (connections.length === 0) {
    // No next step — complete the enrollment
    await adminPool.query(
      `UPDATE sequence_enrollments SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [enrollmentId],
    );
    await logStepExecution(enrollment.sequence_id, enrollment.customer_id, step.id, 'completed');
    return { enrollmentId, action: 'completed' };
  }

  const nextStepId = connections[0].target_step_id;

  // Check if next step is an end step
  const { rows: nextStepRows } = await adminPool.query(
    `SELECT step_category FROM sequence_steps WHERE id = $1`,
    [nextStepId],
  );

  if (nextStepRows[0]?.step_category === 'end') {
    await adminPool.query(
      `UPDATE sequence_enrollments SET status = 'completed', current_step_id = $1, completed_at = NOW() WHERE id = $2`,
      [nextStepId, enrollmentId],
    );
    await logStepExecution(enrollment.sequence_id, enrollment.customer_id, nextStepId, 'completed');
    return { enrollmentId, action: 'completed' };
  }

  // Move to next step
  await adminPool.query(
    `UPDATE sequence_enrollments SET current_step_id = $1, step_entered_at = NOW() WHERE id = $2`,
    [nextStepId, enrollmentId],
  );

  await logStepExecution(enrollment.sequence_id, enrollment.customer_id, step.id, 'advanced', { nextStepId });

  return { enrollmentId, action: 'advanced', nextStepId };
}

/**
 * Execute a step based on its type.
 */
export async function executeStep(
  step: { id: string; step_category: string; step_type: string; config: any },
  enrollment: { id: string; customer_id: string; step_entered_at: string; context: any },
): Promise<{ action: 'advance' | 'wait' | 'exit'; reason?: string }> {
  const config = step.config || {};

  switch (step.step_category) {
    case 'start':
      return { action: 'advance' };

    case 'action': {
      // Action steps: wait, condition, etc.
      if (step.step_type === 'wait') {
        const waitMinutes = config.waitMinutes || config.waitHours * 60 || config.waitDays * 24 * 60 || 60;
        const enteredAt = new Date(enrollment.step_entered_at).getTime();
        const now = Date.now();
        const elapsed = (now - enteredAt) / 60000;
        if (elapsed < waitMinutes) {
          return { action: 'wait' };
        }
        return { action: 'advance' };
      }

      if (step.step_type === 'condition') {
        // Placeholder: evaluate condition from config
        // In production, this would check customer attributes, tags, etc.
        return { action: 'advance' };
      }

      // Default: advance
      return { action: 'advance' };
    }

    case 'output': {
      // Output steps: send_email, send_sms, add_tag, etc.
      // Placeholder: dispatch to appropriate adapter
      // In production, this calls marketing-adapters.service
      return { action: 'advance' };
    }

    case 'end':
      return { action: 'exit', reason: 'sequence_complete' };

    default:
      return { action: 'advance' };
  }
}

/**
 * Enroll a customer in a sequence.
 */
export async function enrollCustomer(
  sequenceId: string,
  customerId: string,
  context?: Record<string, any>,
) {
  // Check if already enrolled (unless allow_reentry is true)
  const { rows: existing } = await adminPool.query(
    `SELECT se.id, se.status, s.allow_reentry FROM sequence_enrollments se
     JOIN sequences s ON s.id = se.sequence_id
     WHERE se.sequence_id = $1 AND se.customer_id = $2`,
    [sequenceId, customerId],
  );

  if (existing.length > 0) {
    const enrollment = existing[0];
    if (enrollment.status === 'active') {
      throw new Error('Customer is already actively enrolled in this sequence');
    }
    if (!enrollment.allow_reentry) {
      throw new Error('Sequence does not allow re-entry');
    }
    // Remove old enrollment for re-entry
    await adminPool.query(`DELETE FROM sequence_enrollments WHERE id = $1`, [enrollment.id]);
  }

  // Find the start step
  const { rows: startSteps } = await adminPool.query(
    `SELECT id FROM sequence_steps WHERE sequence_id = $1 AND step_category = 'start' LIMIT 1`,
    [sequenceId],
  );

  const currentStepId = startSteps.length > 0 ? startSteps[0].id : null;

  const { rows } = await adminPool.query(
    `INSERT INTO sequence_enrollments (sequence_id, customer_id, current_step_id, context)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [sequenceId, customerId, currentStepId, JSON.stringify(context || {})],
  );

  await logStepExecution(sequenceId, customerId, currentStepId, 'enrolled', context);

  return rows[0];
}

/**
 * Exit a customer from a sequence.
 */
export async function exitCustomer(enrollmentId: string, reason: string) {
  const { rows } = await adminPool.query(
    `UPDATE sequence_enrollments SET status = 'exited', exit_reason = $1, completed_at = NOW()
     WHERE id = $2 AND status = 'active' RETURNING *`,
    [reason, enrollmentId],
  );

  if (rows[0]) {
    await logStepExecution(rows[0].sequence_id, rows[0].customer_id, rows[0].current_step_id, 'exited', { reason });
  }

  return rows[0] || null;
}

/**
 * Log a step execution event to sequence_history.
 */
export async function logStepExecution(
  sequenceId: string,
  customerId: string,
  stepId: string | null,
  action: string,
  details?: Record<string, any>,
) {
  if (!stepId) return;

  await adminPool.query(
    `INSERT INTO sequence_history (sequence_id, customer_id, step_id, action, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [sequenceId, customerId, stepId, action, details ? JSON.stringify(details) : null],
  );
}
