import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

interface CreateLeaveInput {
  staffId: string;
  tenantId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  notes?: string;
}

interface LeaveFilters {
  staffId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

/**
 * List leave requests with filters.
 */
export async function getLeaveRequests(tenantId: string, filters: LeaveFilters) {
  const conditions = ['lr.tenant_id = $1'];
  const params: any[] = [tenantId];
  let paramIndex = 2;

  if (filters.staffId) {
    conditions.push(`lr.staff_id = $${paramIndex++}`);
    params.push(filters.staffId);
  }

  if (filters.status) {
    conditions.push(`lr.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.startDate) {
    conditions.push(`lr.end_date >= $${paramIndex++}::date`);
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    conditions.push(`lr.start_date <= $${paramIndex++}::date`);
    params.push(filters.endDate);
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT lr.*, sp.first_name, sp.last_name, sp.staff_ref
       FROM leave_requests lr
       JOIN staff_profiles sp ON sp.id = lr.staff_id
       WHERE ${where}
       ORDER BY lr.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM leave_requests lr WHERE ${where}`, params),
  ]);

  return {
    requests: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

/**
 * Submit a leave request.
 */
export async function submitLeaveRequest(input: CreateLeaveInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO leave_requests (staff_id, tenant_id, leave_type, start_date, end_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.staffId, input.tenantId, input.leaveType, input.startDate, input.endDate, input.notes || null],
  );
  return rows[0];
}

/**
 * Approve a leave request.
 * Returns { request, conflicts } where conflicts are bookings on leave dates.
 */
export async function approveLeave(id: string, tenantId: string, reviewedBy: string) {
  // Get the leave request
  const { rows: reqRows } = await adminPool.query(
    `SELECT * FROM leave_requests WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
    [id, tenantId],
  );
  if (reqRows.length === 0) return null;

  const leaveReq = reqRows[0];

  // Check for conflicting bookings
  const { rows: conflicts } = await adminPool.query(
    `SELECT id, start_time, end_time FROM bookings
     WHERE staff_id = $1
       AND status IN ('confirmed', 'checked_in')
       AND start_time::date BETWEEN $2 AND $3`,
    [leaveReq.staff_id, leaveReq.start_date, leaveReq.end_date],
  );

  // Approve regardless (conflicts are warnings, not blockers)
  const { rows } = await adminPool.query(
    `UPDATE leave_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [reviewedBy, id],
  );

  // Deduct from leave balance if tracking is enabled
  await deductLeaveBalance(leaveReq.staff_id, leaveReq.leave_type, leaveReq.start_date, leaveReq.end_date);

  await logAudit({
    tenantId,
    userId: reviewedBy,
    action: 'leave.approved',
    resourceType: 'leave_request',
    resourceId: id,
    details: { staffId: leaveReq.staff_id, conflicts: conflicts.length },
  });

  return { request: rows[0], conflicts };
}

/**
 * Reject a leave request.
 */
export async function rejectLeave(id: string, tenantId: string, reviewedBy: string) {
  const { rows } = await adminPool.query(
    `UPDATE leave_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
     WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
     RETURNING *`,
    [reviewedBy, id, tenantId],
  );

  if (rows.length === 0) return null;

  await logAudit({
    tenantId,
    userId: reviewedBy,
    action: 'leave.rejected',
    resourceType: 'leave_request',
    resourceId: id,
  });

  return rows[0];
}

/**
 * Cancel a leave request (by staff or manager).
 */
export async function cancelLeave(id: string, tenantId: string, userId: string) {
  // Get current request
  const { rows: reqRows } = await adminPool.query(
    `SELECT * FROM leave_requests WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'approved')`,
    [id, tenantId],
  );
  if (reqRows.length === 0) return null;

  const leaveReq = reqRows[0];

  const { rows } = await adminPool.query(
    `UPDATE leave_requests SET status = 'cancelled'
     WHERE id = $1
     RETURNING *`,
    [id],
  );

  // Restore leave balance if it was approved
  if (leaveReq.status === 'approved') {
    await restoreLeaveBalance(leaveReq.staff_id, leaveReq.leave_type, leaveReq.start_date, leaveReq.end_date);
  }

  await logAudit({
    tenantId,
    userId,
    action: 'leave.cancelled',
    resourceType: 'leave_request',
    resourceId: id,
  });

  return rows[0];
}

// ============================================================
// Leave Balances
// ============================================================

/**
 * Get leave balances for a staff member.
 */
export async function getLeaveBalances(staffId: string, year?: number) {
  const targetYear = year || new Date().getFullYear();
  const { rows } = await adminPool.query(
    `SELECT * FROM leave_balances WHERE staff_id = $1 AND year = $2 ORDER BY leave_type`,
    [staffId, targetYear],
  );
  return rows;
}

/**
 * Set leave balance for a staff member.
 */
export async function setLeaveBalance(staffId: string, leaveType: string, year: number, totalDays: number) {
  const { rows } = await adminPool.query(
    `INSERT INTO leave_balances (staff_id, leave_type, year, total_days)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (staff_id, leave_type, year)
     DO UPDATE SET total_days = $4
     RETURNING *`,
    [staffId, leaveType, year, totalDays],
  );
  return rows[0];
}

/**
 * Calculate business days between two dates.
 */
function calculateBusinessDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/**
 * Deduct from leave balance.
 */
async function deductLeaveBalance(staffId: string, leaveType: string, startDate: string, endDate: string) {
  const days = calculateBusinessDays(startDate, endDate);
  const year = new Date(startDate).getFullYear();

  await adminPool.query(
    `INSERT INTO leave_balances (staff_id, leave_type, year, total_days, used_days)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (staff_id, leave_type, year)
     DO UPDATE SET used_days = leave_balances.used_days + $4`,
    [staffId, leaveType, year, days],
  );
}

/**
 * Restore leave balance (on cancellation).
 */
async function restoreLeaveBalance(staffId: string, leaveType: string, startDate: string, endDate: string) {
  const days = calculateBusinessDays(startDate, endDate);
  const year = new Date(startDate).getFullYear();

  await adminPool.query(
    `UPDATE leave_balances SET used_days = GREATEST(used_days - $1, 0)
     WHERE staff_id = $2 AND leave_type = $3 AND year = $4`,
    [days, staffId, leaveType, year],
  );
}
