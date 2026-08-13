import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as compensationService from '../services/compensation.service';
import * as timeService from '../services/time-tracking.service';

export const payrollRouter = Router();

payrollRouter.use(authenticate);
payrollRouter.use(tenantContext);

// ============================================================
// Compensation Rules
// ============================================================

const createCompRuleSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  user_id: Joi.string().uuid().required(),
  rule_type: Joi.string().valid('hourly', 'per_session', 'commission', 'salary').required(),
  rate: Joi.number().integer().min(1).required(),
  threshold_amount: Joi.number().integer().min(0).allow(null),
  reference_type: Joi.string().valid('service', 'product', 'membership', 'package').allow(null),
  reference_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  overtime_multiplier: Joi.number().min(1).max(5).default(1.5),
  overtime_after_hours: Joi.number().integer().min(1).default(40),
  holiday_multiplier: Joi.number().min(1).max(5).default(2.0),
  effective_from: Joi.string().isoDate().required(),
  effective_to: Joi.string().isoDate().allow(null),
});

const updateCompRuleSchema = Joi.object({
  rate: Joi.number().integer().min(1),
  threshold_amount: Joi.number().integer().min(0).allow(null),
  reference_type: Joi.string().valid('service', 'product', 'membership', 'package').allow(null),
  reference_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  overtime_multiplier: Joi.number().min(1).max(5),
  overtime_after_hours: Joi.number().integer().min(1),
  holiday_multiplier: Joi.number().min(1).max(5),
  effective_from: Joi.string().isoDate(),
  effective_to: Joi.string().isoDate().allow(null),
  status: Joi.string().valid('active', 'inactive'),
}).min(1);

// GET /api/v1/payroll/compensation-rules
payrollRouter.get('/compensation-rules', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const rules = await compensationService.getRules(businessId, req.query.user_id as string);
    success(res, rules);
  } catch (err: any) { error(res, 'Failed to list rules', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/payroll/compensation-rules
payrollRouter.post('/compensation-rules', requirePermission('staff:*'), validate(createCompRuleSchema), async (req: Request, res: Response) => {
  try {
    const rule = await compensationService.createRule({
      businessId: req.body.business_id, userId: req.body.user_id, ruleType: req.body.rule_type,
      rate: req.body.rate, thresholdAmount: req.body.threshold_amount,
      referenceType: req.body.reference_type, referenceIds: req.body.reference_ids,
      overtimeMultiplier: req.body.overtime_multiplier, overtimeAfterHours: req.body.overtime_after_hours,
      holidayMultiplier: req.body.holiday_multiplier, effectiveFrom: req.body.effective_from, effectiveTo: req.body.effective_to,
    });
    success(res, rule, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('overlapping')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to create rule', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/payroll/compensation-rules/:id
payrollRouter.put('/compensation-rules/:id', requirePermission('staff:*'), validate(updateCompRuleSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const rule = await compensationService.updateRule(req.params.id, businessId, req.body);
    if (!rule) { error(res, 'Rule not found', 'NOT_FOUND', 404); return; }
    success(res, rule);
  } catch (err: any) {
    if (err.message.includes('overlapping')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to update rule', 'INTERNAL_ERROR', 500); }
  }
});

// DELETE /api/v1/payroll/compensation-rules/:id
payrollRouter.delete('/compensation-rules/:id', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const deleted = await compensationService.deleteRule(req.params.id, businessId);
    if (!deleted) { error(res, 'Rule not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete rule', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Time Entries
// ============================================================

const createTimeEntrySchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  user_id: Joi.string().uuid().required(),
  entry_type: Joi.string().valid('clock', 'manual', 'booking').default('manual'),
  start_time: Joi.string().isoDate().required(),
  end_time: Joi.string().isoDate().allow(null),
  hours: Joi.number().min(0).allow(null),
  description: Joi.string().max(200).allow('', null),
  booking_id: Joi.string().uuid().allow(null),
});

// GET /api/v1/payroll/time-entries
payrollRouter.get('/time-entries', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const entries = await timeService.getTimeEntries(businessId, {
      userId: req.query.user_id as string,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
      approved: req.query.approved === 'true' ? true : req.query.approved === 'false' ? false : undefined,
    });
    success(res, entries);
  } catch (err: any) { error(res, 'Failed to list time entries', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/payroll/time-entries
payrollRouter.post('/time-entries', requirePermission('staff:*'), validate(createTimeEntrySchema), async (req: Request, res: Response) => {
  try {
    const entry = await timeService.createTimeEntry({
      businessId: req.body.business_id, userId: req.body.user_id, entryType: req.body.entry_type,
      startTime: req.body.start_time, endTime: req.body.end_time,
      hours: req.body.hours, description: req.body.description, bookingId: req.body.booking_id,
    });
    success(res, entry, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create time entry', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/payroll/time-entries/:id/approve
payrollRouter.put('/time-entries/:id/approve', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const approved = await timeService.approveTimeEntry(req.params.id, businessId, authReq.user.sub);
    if (!approved) { error(res, 'Entry not found', 'NOT_FOUND', 404); return; }
    success(res, { approved: true });
  } catch (err: any) { error(res, 'Failed to approve', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Pay Periods & Payroll Run
// ============================================================

import * as payrollService from '../services/payroll.service';

const openPeriodSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  period_start: Joi.string().isoDate().required(),
  period_end: Joi.string().isoDate().required(),
});

// GET /api/v1/payroll/periods
payrollRouter.get('/periods', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const periods = await payrollService.getPayPeriods(businessId);
    success(res, periods);
  } catch (err: any) { error(res, 'Failed to list periods', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/payroll/periods
payrollRouter.post('/periods', requirePermission('staff:*'), validate(openPeriodSchema), async (req: Request, res: Response) => {
  try {
    const period = await payrollService.openPayPeriod({
      businessId: req.body.business_id, periodStart: req.body.period_start, periodEnd: req.body.period_end,
    });
    success(res, period, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('already exists')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to create period', 'INTERNAL_ERROR', 500); }
  }
});

// POST /api/v1/payroll/periods/:id/run
payrollRouter.post('/periods/:id/run', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await payrollService.runPayroll(req.params.id, businessId, authReq.tenantId);
    success(res, result);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('not open')) { error(res, err.message, 'VALIDATION_ERROR', 400); }
    else { error(res, 'Failed to run payroll', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/payroll/periods/:id/finalize
payrollRouter.put('/periods/:id/finalize', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const finalized = await payrollService.finalizePayroll(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!finalized) { error(res, 'Period not found or not in processing status', 'VALIDATION_ERROR', 400); return; }
    success(res, { finalized: true });
  } catch (err: any) { error(res, 'Failed to finalize', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/payroll/periods/:id/entries
payrollRouter.get('/periods/:id/entries', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const entries = await payrollService.getPayrollEntries(req.params.id);
    success(res, entries);
  } catch (err: any) { error(res, 'Failed to get entries', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Deductions
// ============================================================

const createDeductionSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  user_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(100).required(),
  deduction_type: Joi.string().valid('tax', 'insurance', 'benefits', 'loan', 'other').required(),
  calculation_type: Joi.string().valid('percentage', 'fixed').required(),
  value: Joi.number().integer().min(1).required(),
  is_recurring: Joi.boolean().default(true),
  effective_from: Joi.string().isoDate().required(),
  effective_to: Joi.string().isoDate().allow(null),
});

const updateDeductionSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  value: Joi.number().integer().min(1),
  effective_to: Joi.string().isoDate().allow(null),
  status: Joi.string().valid('active', 'inactive'),
}).min(1);

// GET /api/v1/payroll/deductions
payrollRouter.get('/deductions', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const userId = req.query.user_id as string;
    const userFilter = userId ? `AND user_id = '${userId}'` : '';
    const { rows } = await adminPool.query(
      `SELECT pd.*, u.first_name, u.last_name FROM fin_payroll_deductions pd
       JOIN usr_users u ON u.id = pd.user_id
       WHERE pd.business_id = $1 ${userFilter} ORDER BY pd.user_id, pd.deduction_type`,
      [businessId],
    );
    success(res, rows);
  } catch (err: any) { error(res, 'Failed to list deductions', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/payroll/deductions
payrollRouter.post('/deductions', requirePermission('staff:*'), validate(createDeductionSchema), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `INSERT INTO fin_payroll_deductions (business_id, user_id, name, deduction_type, calculation_type, value, is_recurring, effective_from, effective_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.body.business_id, req.body.user_id, req.body.name, req.body.deduction_type, req.body.calculation_type, req.body.value, req.body.is_recurring, req.body.effective_from, req.body.effective_to || null],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { error(res, 'Failed to create deduction', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/payroll/deductions/:id
payrollRouter.put('/deductions/:id', requirePermission('staff:*'), validate(updateDeductionSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    const allowed: Record<string, string> = { name: 'name', value: 'value', effective_to: 'effective_to', status: 'status' };
    for (const [key, val] of Object.entries(req.body)) {
      if (allowed[key]) { fields.push(`${allowed[key]} = $${idx++}`); values.push(val); }
    }
    if (fields.length === 0) { error(res, 'No valid fields', 'VALIDATION_ERROR', 400); return; }
    values.push(req.params.id); values.push(businessId);

    const { rows } = await adminPool.query(
      `UPDATE fin_payroll_deductions SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`, values,
    );
    if (rows.length === 0) { error(res, 'Deduction not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { error(res, 'Failed to update deduction', 'INTERNAL_ERROR', 500); }
});

import { adminPool } from '../db/pool';


// ============================================================
// Tax Documents
// ============================================================

import * as taxDocsService from '../services/tax-documents.service';

// POST /api/v1/payroll/tax-documents/generate
payrollRouter.post('/tax-documents/generate', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string || req.body.business_id;
    const taxYear = parseInt(req.body.tax_year || req.query.tax_year as string, 10);
    if (!businessId || !taxYear) { error(res, 'business_id and tax_year required', 'VALIDATION_ERROR', 400); return; }
    const result = await taxDocsService.generateTaxDocuments(businessId, taxYear, authReq.user.sub);
    success(res, result);
  } catch (err: any) { error(res, 'Failed to generate tax documents', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/payroll/tax-documents
payrollRouter.get('/tax-documents', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const docs = await taxDocsService.getTaxDocuments(businessId, {
      taxYear: req.query.tax_year ? parseInt(req.query.tax_year as string, 10) : undefined,
      documentType: req.query.document_type as string,
      userId: req.query.user_id as string,
    });
    success(res, docs);
  } catch (err: any) { error(res, 'Failed to list tax documents', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Employee Tax Profiles
// ============================================================

import { getEmployeeTaxProfile, upsertEmployeeTaxProfile } from '../services/tax-calculation.service';

// GET /api/v1/payroll/tax-profiles — List all staff with their tax profiles
payrollRouter.get('/tax-profiles', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    // Get all active staff and their tax profiles
    const { rows } = await adminPool.query(
      `SELECT u.id AS user_id, u.first_name, u.last_name,
              tp.country_code, tp.state_code, tp.filing_status, tp.allowances, tp.additional_withholding, tp.exempt
       FROM usr_users u
       JOIN stf_profiles sp ON sp.user_id = u.id
       LEFT JOIN pay_employee_tax_profiles tp ON tp.user_id = u.id AND tp.business_id = $1
       WHERE sp.tenant_id = (SELECT tenant_id FROM sys_businesses WHERE id = $1)
         AND sp.status = 'active'
       ORDER BY u.last_name, u.first_name`,
      [businessId],
    );
    success(res, rows);
  } catch (err: any) { error(res, 'Failed to list tax profiles', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/payroll/tax-profiles/:userId — Create or update an employee's tax profile
payrollRouter.put('/tax-profiles/:userId', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.body.business_id;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const profile = await upsertEmployeeTaxProfile(businessId, req.params.userId, {
      country_code: req.body.country_code,
      state_code: req.body.state_code,
      filing_status: req.body.filing_status,
      allowances: req.body.allowances,
      additional_withholding: req.body.additional_withholding,
      exempt: req.body.exempt,
    });
    success(res, profile);
  } catch (err: any) { error(res, 'Failed to update tax profile', 'INTERNAL_ERROR', 500); }
});
