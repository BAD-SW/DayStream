import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as paymentService from '../services/payment.service';

export const paymentsRouter = Router();

paymentsRouter.use(authenticate);
paymentsRouter.use(tenantContext);

// GET /api/v1/payments — List transactions
paymentsRouter.get('/', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await paymentService.getTransactions({
      businessId,
      type: req.query.type as string,
      status: req.query.status as string,
      customerId: req.query.customer_id as string,
      customerSearch: req.query.customer_search as string,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
      paymentMethod: req.query.payment_method as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });

    success(res, result.transactions, { page: result.page, limit: result.limit, total: result.total, totalPages: Math.ceil(result.total / result.limit) });
  } catch (err: any) {
    error(res, 'Failed to list transactions', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/payments/summary — Summary metrics
paymentsRouter.get('/summary', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const summary = await paymentService.getTransactionSummary(businessId);
    success(res, summary);
  } catch (err: any) {
    error(res, 'Failed to get payment summary', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/payments — Record a payment
const createTransactionSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().required(),
  booking_id: Joi.string().uuid().allow(null),
  membership_id: Joi.string().uuid().allow(null),
  type: Joi.string().valid('charge', 'refund', 'credit').required(),
  amount: Joi.number().integer().min(1).required(),
  payment_method: Joi.string().valid('cash', 'card', 'bank_transfer', 'check', 'gift_card', 'google_pay', 'apple_pay', 'other').required(),
  reference_number: Joi.string().max(100).allow('', null),
  description: Joi.string().max(500).allow('', null),
  refund_of_id: Joi.string().uuid().allow(null),
  refund_reason: Joi.string().max(500).allow('', null),
  // Payment method metadata
  card_last4: Joi.string().max(4).allow('', null),
  card_brand: Joi.string().max(20).allow('', null),
  bank_routing_number: Joi.string().max(20).allow('', null),
  bank_account_number: Joi.string().max(30).allow('', null),
  check_number: Joi.string().max(20).allow('', null),
  gift_card_code: Joi.string().max(50).allow('', null),
});

paymentsRouter.post('/', requirePermission('bookings:*'), validate(createTransactionSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Get business currency
    const { adminPool } = require('../db/pool');
    const { rows: bizRows } = await adminPool.query('SELECT currency FROM sys_businesses WHERE id = $1', [req.body.business_id]);
    const currency = bizRows[0]?.currency || 'USD';

    const transaction = await paymentService.createTransaction({
      businessId: req.body.business_id,
      customerId: req.body.customer_id,
      bookingId: req.body.booking_id,
      membershipId: req.body.membership_id,
      type: req.body.type,
      amount: req.body.amount,
      currency,
      paymentMethod: req.body.payment_method,
      referenceNumber: req.body.reference_number,
      description: req.body.description,
      refundOfId: req.body.refund_of_id,
      refundReason: req.body.refund_reason,
      processedBy: authReq.user.sub,
      cardLast4: req.body.card_last4,
      cardBrand: req.body.card_brand,
      bankRoutingNumber: req.body.bank_routing_number,
      bankAccountNumber: req.body.bank_account_number,
      checkNumber: req.body.check_number,
      giftCardCode: req.body.gift_card_code,
    });

    success(res, transaction, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('Refund amount exceeds') || err.message?.includes('Original transaction not found')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to record transaction', 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/payments/refundable — Get refundable charges for a customer
paymentsRouter.get('/refundable', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    const customerId = req.query.customer_id as string;
    if (!businessId || !customerId) { error(res, 'business_id and customer_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await paymentService.getRefundableCharges({
      businessId,
      customerId,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
      paymentMethod: req.query.payment_method as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 5,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
    });
    success(res, result.charges, { total: result.total, limit: result.limit, offset: result.offset, distinctMethods: result.distinctMethods });
  } catch (err: any) {
    error(res, 'Failed to get refundable charges', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/payments/methods — Get accepted payment methods for a business
paymentsRouter.get('/methods', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const methods = await paymentService.getAcceptedMethods(businessId);
    success(res, methods);
  } catch (err: any) {
    error(res, 'Failed to get accepted methods', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/payments/methods — Update accepted payment methods for a business
const updateMethodsSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  methods: Joi.array().items(Joi.object({
    method: Joi.string().valid('cash', 'card', 'bank_transfer', 'check', 'gift_card', 'google_pay', 'apple_pay', 'other').required(),
    enabled: Joi.boolean().required(),
  })).min(1).required(),
});

paymentsRouter.put('/methods', requirePermission('bookings:*'), validate(updateMethodsSchema), async (req: Request, res: Response) => {
  try {
    const result = await paymentService.updateAcceptedMethods(req.body.business_id, req.body.methods);
    success(res, result);
  } catch (err: any) {
    error(res, 'Failed to update accepted methods', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/payments/:id — Get transaction detail
paymentsRouter.get('/:id', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const transaction = await paymentService.getTransactionById(req.params.id, businessId);
    if (!transaction) { error(res, 'Transaction not found', 'NOT_FOUND', 404); return; }
    success(res, transaction);
  } catch (err: any) {
    error(res, 'Failed to get transaction', 'INTERNAL_ERROR', 500);
  }
});
