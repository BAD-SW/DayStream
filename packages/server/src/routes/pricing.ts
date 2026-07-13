import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as pricingService from '../services/pricing.service';
import * as rulesService from '../services/pricing-rules.service';

export const pricingRouter = Router();

pricingRouter.use(authenticate);
pricingRouter.use(tenantContext);

// ============================================================
// Price Calculation
// ============================================================

const calculateSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  items: Joi.array().items(Joi.object({ variant_id: Joi.string().uuid().required() })).min(1).required(),
  customer_id: Joi.string().uuid().allow(null),
  discount_code: Joi.string().max(50).allow('', null),
  booking_datetime: Joi.string().isoDate().allow(null),
});

// POST /api/v1/pricing/calculate
pricingRouter.post('/calculate', requirePermission('bookings:read'), validate(calculateSchema), async (req: Request, res: Response) => {
  try {
    const breakdown = await pricingService.calculatePrice({
      businessId: req.body.business_id,
      items: req.body.items,
      customerId: req.body.customer_id,
      discountCode: req.body.discount_code,
      bookingDatetime: req.body.booking_datetime,
    });
    success(res, breakdown);
  } catch (err: any) {
    error(res, 'Failed to calculate price', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Pricing Rules
// ============================================================

const createRuleSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(500).allow('', null),
  rule_type: Joi.string().valid('membership', 'promotion', 'seasonal', 'first_time', 'corporate', 'volume', 'time_of_day', 'day_of_week').required(),
  discount_type: Joi.string().valid('percentage', 'fixed', 'premium_percentage', 'premium_fixed').required(),
  discount_value: Joi.number().integer().min(1).required(),
  priority: Joi.number().integer().min(0).default(100),
  stacking_mode: Joi.string().valid('stackable', 'exclusive', 'non_stackable').default('stackable'),
  applies_to_all_services: Joi.boolean().default(true),
  service_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  category_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  variant_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  applies_to_all_customers: Joi.boolean().default(true),
  customer_segment: Joi.string().max(50).allow('', null),
  membership_plan_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  corporate_account_id: Joi.string().uuid().allow(null),
  min_purchase_amount: Joi.number().integer().min(0).allow(null),
  max_redemptions: Joi.number().integer().min(1).allow(null),
  first_time_booking_limit: Joi.number().integer().min(1).allow(null),
  effective_from: Joi.string().isoDate().allow(null),
  effective_to: Joi.string().isoDate().allow(null),
  time_from: Joi.string().pattern(/^\d{2}:\d{2}$/).allow(null),
  time_to: Joi.string().pattern(/^\d{2}:\d{2}$/).allow(null),
  days_of_week: Joi.array().items(Joi.number().integer().min(0).max(6)).allow(null),
});

const updateRuleSchema = Joi.object({
  name: Joi.string().min(1).max(200),
  description: Joi.string().max(500).allow('', null),
  discount_type: Joi.string().valid('percentage', 'fixed', 'premium_percentage', 'premium_fixed'),
  discount_value: Joi.number().integer().min(1),
  priority: Joi.number().integer().min(0),
  stacking_mode: Joi.string().valid('stackable', 'exclusive', 'non_stackable'),
  status: Joi.string().valid('active', 'inactive'),
  effective_from: Joi.string().isoDate().allow(null),
  effective_to: Joi.string().isoDate().allow(null),
  max_redemptions: Joi.number().integer().min(1).allow(null),
}).min(1);

// GET /api/v1/pricing/rules
pricingRouter.get('/rules', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const rules = await rulesService.getRules(businessId, req.query.rule_type as string);
    success(res, rules);
  } catch (err: any) { error(res, 'Failed to list rules', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/pricing/rules
pricingRouter.post('/rules', requirePermission('services:*'), validate(createRuleSchema), async (req: Request, res: Response) => {
  try {
    const rule = await rulesService.createRule({
      businessId: req.body.business_id, name: req.body.name, description: req.body.description,
      ruleType: req.body.rule_type, discountType: req.body.discount_type, discountValue: req.body.discount_value,
      priority: req.body.priority, stackingMode: req.body.stacking_mode,
      appliesToAllServices: req.body.applies_to_all_services, serviceIds: req.body.service_ids,
      categoryIds: req.body.category_ids, variantIds: req.body.variant_ids,
      appliesToAllCustomers: req.body.applies_to_all_customers, customerSegment: req.body.customer_segment,
      membershipPlanIds: req.body.membership_plan_ids, corporateAccountId: req.body.corporate_account_id,
      minPurchaseAmount: req.body.min_purchase_amount, maxRedemptions: req.body.max_redemptions,
      firstTimeBookingLimit: req.body.first_time_booking_limit,
      effectiveFrom: req.body.effective_from, effectiveTo: req.body.effective_to,
      timeFrom: req.body.time_from, timeTo: req.body.time_to, daysOfWeek: req.body.days_of_week,
    });
    success(res, rule, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create rule', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/pricing/rules/:id
pricingRouter.put('/rules/:id', requirePermission('services:*'), validate(updateRuleSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const rule = await rulesService.updateRule(req.params.id, businessId, req.body);
    if (!rule) { error(res, 'Rule not found', 'NOT_FOUND', 404); return; }
    success(res, rule);
  } catch (err: any) { error(res, 'Failed to update rule', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/pricing/rules/:id
pricingRouter.delete('/rules/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const deleted = await rulesService.deleteRule(req.params.id, businessId);
    if (!deleted) { error(res, 'Rule not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete rule', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Discount Codes
// ============================================================

import * as codesService from '../services/discount-codes.service';

const createCodeSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  code: Joi.string().min(3).max(50).required(),
  discount_type: Joi.string().valid('percentage', 'fixed').required(),
  discount_value: Joi.number().integer().min(1).required(),
  valid_from: Joi.string().isoDate().allow(null),
  valid_to: Joi.string().isoDate().allow(null),
  max_total_uses: Joi.number().integer().min(1).allow(null),
  max_uses_per_customer: Joi.number().integer().min(1).default(1),
  min_purchase_amount: Joi.number().integer().min(0).allow(null),
  applies_to_all_services: Joi.boolean().default(true),
  service_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  category_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  is_single_use: Joi.boolean().default(false),
});

const validateCodeSchema = Joi.object({
  code: Joi.string().min(1).max(50).required(),
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().allow(null),
  purchase_amount: Joi.number().integer().allow(null),
});

const bulkCodeSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  count: Joi.number().integer().min(1).max(1000).required(),
  prefix: Joi.string().min(1).max(10).required(),
  discount_type: Joi.string().valid('percentage', 'fixed').required(),
  discount_value: Joi.number().integer().min(1).required(),
  valid_to: Joi.string().isoDate().allow(null),
  is_single_use: Joi.boolean().default(true),
});

const updateCodeSchema = Joi.object({
  status: Joi.string().valid('active', 'inactive'),
  valid_to: Joi.string().isoDate().allow(null),
  max_total_uses: Joi.number().integer().min(1).allow(null),
  max_uses_per_customer: Joi.number().integer().min(1).allow(null),
}).min(1);

// GET /api/v1/pricing/codes
pricingRouter.get('/codes', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const codes = await codesService.getCodes(businessId);
    success(res, codes);
  } catch (err: any) { error(res, 'Failed to list codes', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/pricing/codes
pricingRouter.post('/codes', requirePermission('services:*'), validate(createCodeSchema), async (req: Request, res: Response) => {
  try {
    const code = await codesService.createCode({
      businessId: req.body.business_id, code: req.body.code,
      discountType: req.body.discount_type, discountValue: req.body.discount_value,
      validFrom: req.body.valid_from, validTo: req.body.valid_to,
      maxTotalUses: req.body.max_total_uses, maxUsesPerCustomer: req.body.max_uses_per_customer,
      minPurchaseAmount: req.body.min_purchase_amount,
      appliesToAllServices: req.body.applies_to_all_services,
      serviceIds: req.body.service_ids, categoryIds: req.body.category_ids,
      isSingleUse: req.body.is_single_use,
    });
    success(res, code, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('duplicate') || err.message.includes('unique')) {
      error(res, 'Code already exists', 'DUPLICATE', 409);
    } else { error(res, 'Failed to create code', 'INTERNAL_ERROR', 500); }
  }
});

// POST /api/v1/pricing/codes/validate
pricingRouter.post('/codes/validate', requirePermission('bookings:read'), validate(validateCodeSchema), async (req: Request, res: Response) => {
  try {
    const result = await codesService.validateCode(req.body.code, req.body.business_id, req.body.customer_id, req.body.purchase_amount);
    success(res, result);
  } catch (err: any) { error(res, 'Failed to validate code', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/pricing/codes/bulk
pricingRouter.post('/codes/bulk', requirePermission('services:*'), validate(bulkCodeSchema), async (req: Request, res: Response) => {
  try {
    const codes = await codesService.bulkGenerateCodes(
      req.body.business_id, req.body.count, req.body.prefix,
      req.body.discount_type, req.body.discount_value,
      { validTo: req.body.valid_to, isSingleUse: req.body.is_single_use },
    );
    success(res, { codes, count: codes.length }, undefined, 201);
  } catch (err: any) { error(res, 'Failed to generate codes', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/pricing/codes/:id
pricingRouter.put('/codes/:id', requirePermission('services:*'), validate(updateCodeSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const code = await codesService.updateCode(req.params.id, businessId, req.body);
    if (!code) { error(res, 'Code not found', 'NOT_FOUND', 404); return; }
    success(res, code);
  } catch (err: any) { error(res, 'Failed to update code', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Bundles
// ============================================================

import * as bundlesService from '../services/pricing-bundles.service';

const createBundleSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(500).allow('', null),
  bundle_type: Joi.string().valid('fixed_price', 'percentage_off').required(),
  bundle_price: Joi.number().integer().min(0).allow(null),
  discount_percentage: Joi.number().integer().min(1).max(100).allow(null),
  expiration_days: Joi.number().integer().min(1).allow(null),
  items: Joi.array().items(Joi.object({ variant_id: Joi.string().uuid().required(), quantity: Joi.number().integer().min(1).default(1) })).min(1).required(),
});

const updateBundleSchema = Joi.object({
  name: Joi.string().min(1).max(200),
  description: Joi.string().max(500).allow('', null),
  bundle_price: Joi.number().integer().min(0),
  discount_percentage: Joi.number().integer().min(1).max(100),
  expiration_days: Joi.number().integer().min(1).allow(null),
}).min(1);

// GET /api/v1/pricing/bundles
pricingRouter.get('/bundles', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const bundles = await bundlesService.getBundles(businessId);
    success(res, bundles);
  } catch (err: any) { error(res, 'Failed to list bundles', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/pricing/bundles
pricingRouter.post('/bundles', requirePermission('services:*'), validate(createBundleSchema), async (req: Request, res: Response) => {
  try {
    const bundle = await bundlesService.createBundle({
      businessId: req.body.business_id, name: req.body.name, description: req.body.description,
      bundleType: req.body.bundle_type, bundlePrice: req.body.bundle_price,
      discountPercentage: req.body.discount_percentage, expirationDays: req.body.expiration_days,
      items: req.body.items,
    });
    success(res, bundle, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('require')) { error(res, err.message, 'VALIDATION_ERROR', 400); }
    else { error(res, 'Failed to create bundle', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/pricing/bundles/:id
pricingRouter.put('/bundles/:id', requirePermission('services:*'), validate(updateBundleSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const bundle = await bundlesService.updateBundle(req.params.id, businessId, req.body);
    if (!bundle) { error(res, 'Bundle not found', 'NOT_FOUND', 404); return; }
    success(res, bundle);
  } catch (err: any) { error(res, 'Failed to update bundle', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/pricing/bundles/:id
pricingRouter.delete('/bundles/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const archived = await bundlesService.archiveBundle(req.params.id, businessId);
    if (!archived) { error(res, 'Bundle not found', 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) { error(res, 'Failed to archive bundle', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Corporate Accounts
// ============================================================

import * as corporateService from '../services/corporate-pricing.service';

const createCorporateSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  contact_email: Joi.string().email({ tlds: false }).allow('', null),
  billing_email: Joi.string().email({ tlds: false }).allow('', null),
  agreement_start: Joi.string().allow('', null),
  agreement_end: Joi.string().allow('', null),
  status: Joi.string().valid('active', 'inactive').default('active'),
});

const addCorporateMemberSchema = Joi.object({
  customer_id: Joi.string().uuid().required(),
});

// GET /api/v1/pricing/corporate
pricingRouter.get('/corporate', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const accounts = await corporateService.getAccounts(businessId);
    success(res, accounts);
  } catch (err: any) { error(res, 'Failed to list corporate accounts', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/pricing/corporate
pricingRouter.post('/corporate', requirePermission('services:*'), validate(createCorporateSchema), async (req: Request, res: Response) => {
  try {
    const account = await corporateService.createAccount({
      businessId: req.body.business_id, name: req.body.name,
      contactEmail: req.body.contact_email, billingEmail: req.body.billing_email,
      agreementStart: req.body.agreement_start, agreementEnd: req.body.agreement_end,
      status: req.body.status,
    });
    success(res, account, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create corporate account', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/pricing/corporate/:id/members
pricingRouter.post('/corporate/:id/members', requirePermission('services:*'), validate(addCorporateMemberSchema), async (req: Request, res: Response) => {
  try {
    const result = await corporateService.addMember(req.params.id, req.body.customer_id);
    if (!result.success) { error(res, result.error!, 'CONFLICT', 409); return; }
    success(res, { added: true }, undefined, 201);
  } catch (err: any) { error(res, 'Failed to add member', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/pricing/corporate/:id/members/:customerId
pricingRouter.delete('/corporate/:id/members/:customerId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const removed = await corporateService.removeMember(req.params.id, req.params.customerId);
    if (!removed) { error(res, 'Member not found', 'NOT_FOUND', 404); return; }
    success(res, { removed: true });
  } catch (err: any) { error(res, 'Failed to remove member', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/pricing/corporate/:id/members
pricingRouter.get('/corporate/:id/members', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const members = await corporateService.getMembers(req.params.id);
    success(res, members);
  } catch (err: any) { error(res, 'Failed to list members', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/pricing/corporate/:id
pricingRouter.put('/corporate/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const { name, contact_email, billing_email, status, agreement_start, agreement_end } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (contact_email !== undefined) { fields.push(`contact_email = $${idx++}`); values.push(contact_email); }
    if (billing_email !== undefined) { fields.push(`billing_email = $${idx++}`); values.push(billing_email); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (agreement_start !== undefined) { fields.push(`agreement_start = $${idx++}`); values.push(agreement_start || null); }
    if (agreement_end !== undefined) { fields.push(`agreement_end = $${idx++}`); values.push(agreement_end || null); }
    if (fields.length === 0) { error(res, 'No fields to update', 'VALIDATION_ERROR', 400); return; }
    fields.push('updated_at = NOW()');
    values.push(req.params.id);
    const { rows } = await adminPool.query(
      `UPDATE pri_corporate_accounts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    if (rows.length === 0) { error(res, 'Account not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { error(res, 'Failed to update corporate account', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/pricing/corporate/:id
pricingRouter.delete('/corporate/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const { rowCount } = await adminPool.query('DELETE FROM pri_corporate_accounts WHERE id = $1', [req.params.id]);
    if (!rowCount) { error(res, 'Account not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete corporate account', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Price History
// ============================================================

import * as historyService from '../services/price-history.service';

// GET /api/v1/pricing/history
pricingRouter.get('/history', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await historyService.getBusinessHistory(businessId, {
      entityType: req.query.entity_type as string,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    });

    success(res, result.entries, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) { error(res, 'Failed to get price history', 'INTERNAL_ERROR', 500); }
});
