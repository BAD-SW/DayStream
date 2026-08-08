import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as vendorsService from '../services/vendors.service';
import * as billsService from '../services/bills.service';
import * as expensesService from '../services/expenses.service';

export const apRouter = Router();

apRouter.use(authenticate);
apRouter.use(tenantContext);

// ============================================================
// Vendors
// ============================================================

const createVendorSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  contact_name: Joi.string().max(100).allow('', null),
  email: Joi.string().email({ tlds: false }).allow('', null),
  phone: Joi.string().max(50).allow('', null),
  address: Joi.string().max(500).allow('', null),
  tax_id: Joi.string().max(50).allow('', null),
  payment_terms: Joi.number().integer().min(0).default(30),
  category: Joi.string().max(50).allow('', null),
  notes: Joi.string().max(1000).allow('', null),
});

apRouter.get('/vendors', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const vendors = await vendorsService.getVendors(businessId);
    success(res, vendors);
  } catch (err: any) { error(res, 'Failed to list vendors', 'INTERNAL_ERROR', 500); }
});

apRouter.post('/vendors', requirePermission('settings:*'), validate(createVendorSchema), async (req: Request, res: Response) => {
  try {
    const vendor = await vendorsService.createVendor({
      businessId: req.body.business_id, name: req.body.name, contactName: req.body.contact_name,
      email: req.body.email, phone: req.body.phone, address: req.body.address,
      taxId: req.body.tax_id, paymentTerms: req.body.payment_terms, category: req.body.category, notes: req.body.notes,
    });
    success(res, vendor, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create vendor', 'INTERNAL_ERROR', 500); }
});

apRouter.put('/vendors/:id', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const vendor = await vendorsService.updateVendor(req.params.id, businessId, req.body);
    if (!vendor) { error(res, 'Vendor not found', 'NOT_FOUND', 404); return; }
    success(res, vendor);
  } catch (err: any) { error(res, 'Failed to update vendor', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Bills
// ============================================================

const createBillSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  vendor_id: Joi.string().uuid().required(),
  invoice_number: Joi.string().max(100).allow('', null),
  amount: Joi.number().integer().min(1).required(),
  due_date: Joi.string().isoDate().required(),
  description: Joi.string().max(500).allow('', null),
  account_id: Joi.string().uuid().allow(null),
  line_items: Joi.array().items(Joi.object({
    description: Joi.string().required(), quantity: Joi.number().required(),
    unit_price: Joi.number().integer().required(), account_id: Joi.string().uuid().allow(null),
  })).allow(null),
  is_recurring: Joi.boolean().default(false),
  recurrence_interval: Joi.string().valid('monthly', 'quarterly', 'annually').allow(null),
});

const recordPaymentSchema = Joi.object({ amount: Joi.number().integer().min(1).required() });

apRouter.get('/bills', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const bills = await billsService.getBills(businessId, { status: req.query.status as string, vendorId: req.query.vendor_id as string });
    success(res, bills);
  } catch (err: any) { error(res, 'Failed to list bills', 'INTERNAL_ERROR', 500); }
});

apRouter.post('/bills', requirePermission('settings:*'), validate(createBillSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const bill = await billsService.createBill({
      businessId: req.body.business_id, vendorId: req.body.vendor_id, invoiceNumber: req.body.invoice_number,
      amount: req.body.amount, dueDate: req.body.due_date, description: req.body.description,
      accountId: req.body.account_id,
      lineItems: req.body.line_items, isRecurring: req.body.is_recurring, recurrenceInterval: req.body.recurrence_interval,
      createdBy: authReq.user.sub,
    });
    success(res, bill, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create bill', 'INTERNAL_ERROR', 500); }
});

apRouter.put('/bills/:id', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const bill = await billsService.updateBill(req.params.id, businessId, req.body);
    if (!bill) { error(res, 'Bill not found', 'NOT_FOUND', 404); return; }
    success(res, bill);
  } catch (err: any) { error(res, 'Failed to update bill', 'INTERNAL_ERROR', 500); }
});

apRouter.put('/bills/:id/approve', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const approved = await billsService.approveBill(req.params.id, businessId, authReq.user.sub);
    if (!approved) { error(res, 'Bill not found or already approved', 'VALIDATION_ERROR', 400); return; }
    success(res, { approved: true });
  } catch (err: any) { error(res, 'Failed to approve bill', 'INTERNAL_ERROR', 500); }
});

apRouter.put('/bills/:id/pay', requirePermission('settings:*'), validate(recordPaymentSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const bill = await billsService.recordPayment(req.params.id, businessId, req.body.amount);
    if (!bill) { error(res, 'Bill not found', 'NOT_FOUND', 404); return; }
    success(res, bill);
  } catch (err: any) { error(res, 'Failed to record payment', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Expenses
// ============================================================

const createExpenseSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  date: Joi.string().isoDate().required(),
  amount: Joi.number().integer().min(1).required(),
  account_id: Joi.string().uuid().allow(null),
  description: Joi.string().max(500).allow('', null),
  vendor_id: Joi.string().uuid().allow(null),
  payment_method: Joi.string().max(50).allow('', null),
  is_recurring: Joi.boolean().default(false),
});

apRouter.get('/expenses', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const expenses = await expensesService.getExpenses(businessId, {
      status: req.query.status as string, accountId: req.query.account_id as string,
      dateFrom: req.query.date_from as string, dateTo: req.query.date_to as string,
    });
    success(res, expenses);
  } catch (err: any) { error(res, 'Failed to list expenses', 'INTERNAL_ERROR', 500); }
});

apRouter.post('/expenses', requirePermission('settings:*'), validate(createExpenseSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const expense = await expensesService.createExpense({
      businessId: req.body.business_id, date: req.body.date, amount: req.body.amount,
      accountId: req.body.account_id, description: req.body.description, vendorId: req.body.vendor_id,
      paymentMethod: req.body.payment_method, isRecurring: req.body.is_recurring, submittedBy: authReq.user.sub,
    });
    success(res, expense, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create expense', 'INTERNAL_ERROR', 500); }
});

apRouter.put('/expenses/:id/approve', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const approved = await expensesService.approveExpense(req.params.id, businessId, authReq.user.sub);
    if (!approved) { error(res, 'Expense not found or already processed', 'VALIDATION_ERROR', 400); return; }
    success(res, { approved: true });
  } catch (err: any) { error(res, 'Failed to approve expense', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Chart of Accounts
// ============================================================

import * as coaService from '../services/chart-of-accounts.service';

const createAccountSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  code: Joi.string().min(1).max(20).required(),
  name: Joi.string().min(1).max(100).required(),
  account_type: Joi.string().valid('asset', 'liability', 'equity', 'revenue', 'expense').required(),
  parent_id: Joi.string().uuid().allow(null),
  description: Joi.string().max(500).allow('', null),
});

// GET /api/v1/ap/accounts
apRouter.get('/accounts', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const accounts = await coaService.getAccounts(businessId);
    success(res, accounts);
  } catch (err: any) { error(res, 'Failed to list accounts', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/ap/accounts
apRouter.post('/accounts', requirePermission('settings:*'), validate(createAccountSchema), async (req: Request, res: Response) => {
  try {
    const account = await coaService.createAccount({
      businessId: req.body.business_id, code: req.body.code, name: req.body.name,
      accountType: req.body.account_type, parentId: req.body.parent_id, description: req.body.description,
    });
    success(res, account, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('duplicate') || err.message.includes('unique')) { error(res, 'Account code already exists', 'DUPLICATE', 409); }
    else { error(res, 'Failed to create account', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/ap/accounts/:id/archive
apRouter.put('/accounts/:id/archive', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await coaService.archiveAccount(req.params.id, businessId);
    if (!result.success) { error(res, result.error!, 'VALIDATION_ERROR', 400); return; }
    success(res, { archived: true });
  } catch (err: any) { error(res, 'Failed to archive account', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/ap/accounts/:id/unarchive
apRouter.put('/accounts/:id/unarchive', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await coaService.unarchiveAccount(req.params.id, businessId);
    if (!result.success) { error(res, result.error!, 'VALIDATION_ERROR', 400); return; }
    success(res, { unarchived: true });
  } catch (err: any) { error(res, 'Failed to unarchive account', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/ap/accounts/:id
const updateAccountSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  description: Joi.string().max(500).allow('', null),
  code: Joi.string().min(1).max(20),
}).min(1);

apRouter.put('/accounts/:id', requirePermission('settings:*'), validate(updateAccountSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const account = await coaService.updateAccount(req.params.id, businessId, req.body);
    if (!account) { error(res, 'Account not found', 'NOT_FOUND', 404); return; }
    success(res, account);
  } catch (err: any) {
    if (err.message.includes('duplicate') || err.message.includes('unique')) { error(res, 'Account code already exists', 'DUPLICATE', 409); }
    else { error(res, 'Failed to update account', 'INTERNAL_ERROR', 500); }
  }
});

// POST /api/v1/ap/accounts/seed — Seed defaults
apRouter.post('/accounts/seed', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string || req.body.business_id;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    await coaService.seedDefaults(businessId);
    success(res, { seeded: true });
  } catch (err: any) { error(res, 'Failed to seed accounts', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Journal Entries
// ============================================================

import * as journalService from '../services/journal.service';

const createJournalSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  entry_date: Joi.string().isoDate().required(),
  description: Joi.string().min(1).max(500).required(),
  reference_type: Joi.string().max(30).allow('', null),
  reference_id: Joi.string().uuid().allow(null),
  lines: Joi.array().items(Joi.object({
    account_id: Joi.string().uuid().required(),
    debit: Joi.number().integer().min(0).required(),
    credit: Joi.number().integer().min(0).required(),
    description: Joi.string().max(200).allow('', null),
  })).min(2).required(),
});

// GET /api/v1/ap/journal
apRouter.get('/journal', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await journalService.getEntries(businessId, {
      dateFrom: req.query.date_from as string, dateTo: req.query.date_to as string,
      referenceType: req.query.reference_type as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
    });
    success(res, result.entries, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) { error(res, 'Failed to list journal entries', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/ap/journal
apRouter.post('/journal', requirePermission('settings:*'), validate(createJournalSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const entry = await journalService.createEntry({
      businessId: req.body.business_id, entryDate: req.body.entry_date,
      description: req.body.description, referenceType: req.body.reference_type,
      referenceId: req.body.reference_id, lines: req.body.lines, createdBy: authReq.user.sub,
    });
    success(res, entry, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('balance') || err.message.includes('non-zero')) { error(res, err.message, 'VALIDATION_ERROR', 400); }
    else { error(res, 'Failed to create journal entry', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/ap/journal/:id/void
apRouter.put('/journal/:id/void', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await journalService.voidEntry(req.params.id, businessId, authReq.user.sub);
    if (!result.success) { error(res, result.error!, 'VALIDATION_ERROR', 400); return; }
    success(res, { voided: true, reversing_entry_id: result.reversing_entry_id });
  } catch (err: any) { error(res, 'Failed to void entry', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Financial Reports
// ============================================================

import * as reportsService from '../services/financial-reports.service';

apRouter.get('/reports/pnl', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    const dateFrom = req.query.date_from as string;
    const dateTo = req.query.date_to as string;
    if (!businessId || !dateFrom || !dateTo) { error(res, 'business_id, date_from, date_to required', 'VALIDATION_ERROR', 400); return; }
    const report = await reportsService.getProfitAndLoss({ businessId, dateFrom, dateTo });
    success(res, report);
  } catch (err: any) { error(res, 'Failed to generate P&L', 'INTERNAL_ERROR', 500); }
});

apRouter.get('/reports/staff-costs', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    const dateFrom = req.query.date_from as string;
    const dateTo = req.query.date_to as string;
    if (!businessId || !dateFrom || !dateTo) { error(res, 'business_id, date_from, date_to required', 'VALIDATION_ERROR', 400); return; }
    const report = await reportsService.getStaffCosts({ businessId, dateFrom, dateTo });
    success(res, report);
  } catch (err: any) { error(res, 'Failed to generate staff costs', 'INTERNAL_ERROR', 500); }
});

apRouter.get('/reports/ap-aging', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const report = await reportsService.getAPAging(businessId);
    success(res, report);
  } catch (err: any) { error(res, 'Failed to generate AP aging', 'INTERNAL_ERROR', 500); }
});

apRouter.get('/reports/expenses', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    const dateFrom = req.query.date_from as string;
    const dateTo = req.query.date_to as string;
    if (!businessId || !dateFrom || !dateTo) { error(res, 'business_id, date_from, date_to required', 'VALIDATION_ERROR', 400); return; }
    const report = await reportsService.getExpenseBreakdown({ businessId, dateFrom, dateTo });
    success(res, report);
  } catch (err: any) { error(res, 'Failed to generate expense report', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Bank Reconciliation
// ============================================================

import * as reconService from '../services/bank-reconciliation.service';

apRouter.post('/reconciliation/import', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { business_id, account_name, statement_date, lines } = req.body;
    if (!business_id || !account_name || !lines) { error(res, 'business_id, account_name, lines required', 'VALIDATION_ERROR', 400); return; }
    const statement = await reconService.importStatement(business_id, account_name, statement_date || new Date().toISOString().slice(0, 10), lines);
    success(res, statement, undefined, 201);
  } catch (err: any) { error(res, 'Failed to import statement', 'INTERNAL_ERROR', 500); }
});

apRouter.get('/reconciliation/:statementId', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const lines = await reconService.getStatementLines(req.params.statementId);
    const status = await reconService.getReconciliationStatus(req.params.statementId);
    success(res, { lines, status });
  } catch (err: any) { error(res, 'Failed to get statement', 'INTERNAL_ERROR', 500); }
});

apRouter.put('/reconciliation/:lineId/match', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { journal_entry_id } = req.body;
    if (!journal_entry_id) { error(res, 'journal_entry_id required', 'VALIDATION_ERROR', 400); return; }
    const matched = await reconService.matchLine(req.params.lineId, journal_entry_id);
    if (!matched) { error(res, 'Line not found', 'NOT_FOUND', 404); return; }
    success(res, { matched: true });
  } catch (err: any) { error(res, 'Failed to match', 'INTERNAL_ERROR', 500); }
});
