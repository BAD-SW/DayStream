import { adminPool } from '../db/pool';

/**
 * Get all scheduled reports for a tenant.
 */
export async function getScheduledReports(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM rpt_scheduled_reports WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

/**
 * Create a new scheduled report.
 */
export async function createScheduledReport(tenantId: string, input: {
  name: string;
  schedule_type: string;
  cron_expression?: string;
  report_types: string[];
  recipients: { email: string; name?: string }[];
  format?: string;
  created_by?: string;
  next_run_at?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO rpt_scheduled_reports
       (tenant_id, name, schedule_type, cron_expression, report_types, recipients, format, created_by, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      tenantId,
      input.name,
      input.schedule_type,
      input.cron_expression || null,
      JSON.stringify(input.report_types),
      JSON.stringify(input.recipients),
      input.format || 'pdf',
      input.created_by || null,
      input.next_run_at || null,
    ],
  );
  return rows[0];
}

/**
 * Update a scheduled report.
 */
export async function updateScheduledReport(id: string, tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.schedule_type !== undefined) { fields.push(`schedule_type = $${idx++}`); values.push(updates.schedule_type); }
  if (updates.cron_expression !== undefined) { fields.push(`cron_expression = $${idx++}`); values.push(updates.cron_expression); }
  if (updates.report_types !== undefined) { fields.push(`report_types = $${idx++}`); values.push(JSON.stringify(updates.report_types)); }
  if (updates.recipients !== undefined) { fields.push(`recipients = $${idx++}`); values.push(JSON.stringify(updates.recipients)); }
  if (updates.format !== undefined) { fields.push(`format = $${idx++}`); values.push(updates.format); }
  if (updates.is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(updates.is_active); }
  if (updates.next_run_at !== undefined) { fields.push(`next_run_at = $${idx++}`); values.push(updates.next_run_at); }

  if (fields.length === 0) return null;
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE rpt_scheduled_reports SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Delete a scheduled report.
 */
export async function deleteScheduledReport(id: string, tenantId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM rpt_scheduled_reports WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Find reports that are due to be sent (next_run_at <= NOW and is_active).
 */
export async function getDueReports() {
  const { rows } = await adminPool.query(
    `SELECT * FROM rpt_scheduled_reports WHERE is_active = true AND next_run_at <= NOW()`,
  );
  return rows;
}

/**
 * Process a scheduled report: log delivery and update next_run_at.
 */
export async function processScheduledReport(reportId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM rpt_scheduled_reports WHERE id = $1`,
    [reportId],
  );

  if (rows.length === 0) return null;
  const report = rows[0];
  const recipientsCount = Array.isArray(report.recipients) ? report.recipients.length : 0;

  // Log delivery
  await adminPool.query(
    `INSERT INTO rpt_delivery_log (scheduled_report_id, recipients_count, status)
     VALUES ($1, $2, 'sent')`,
    [reportId, recipientsCount],
  );

  // Calculate next run based on schedule_type
  let interval = '1 day';
  if (report.schedule_type === 'weekly') interval = '7 days';
  else if (report.schedule_type === 'monthly') interval = '1 month';

  // Update last_sent_at and next_run_at
  await adminPool.query(
    `UPDATE rpt_scheduled_reports
     SET last_sent_at = NOW(), next_run_at = NOW() + $2::interval
     WHERE id = $1`,
    [reportId, interval],
  );

  return { reportId, recipientsCount, status: 'sent' };
}
