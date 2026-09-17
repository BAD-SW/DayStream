import crypto from 'node:crypto';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { createBooking, getBookingById } from './booking.service';
import { createHold } from './slot-hold.service';
import { queueBookingConfirmation } from './booking-notifications.service';
import { createActivity } from './customer-activity.service';
import { resolveForBusiness } from './theme.service';
import { computeDayStatus, getDaysInMonth, isDayClosedForBusiness } from '../routes/bookings';
import * as availabilityService from './availability.service';
import { purchasePackage } from './package.service';
import { enrollCustomer } from './membership.service';

/** Requirement 15.4 — never log a raw email, only its hash, for booking-attempt audit entries. */
function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
}

export class WidgetError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'WidgetError';
  }
}

interface WidgetConfig {
  tenant_id: string;
  business_id: string;
  is_enabled: boolean;
  require_payment_before_confirmation: boolean;
  allowed_origins: string[] | null;
}

/** Loads the widget config for a business, or throws 403/404 per Requirement 4.8 / 12.6. */
export async function requireEnabledWidget(businessId: string): Promise<WidgetConfig> {
  const { rows: bizRows } = await adminPool.query('SELECT id, tenant_id FROM sys_businesses WHERE id = $1', [businessId]);
  if (bizRows.length === 0) throw new WidgetError('Business not found', 404);

  const { rows } = await adminPool.query('SELECT * FROM wgt_widget_configs WHERE business_id = $1', [businessId]);
  const config = rows[0];
  if (!config || !config.is_enabled) throw new WidgetError('Widget is not enabled for this business', 403);
  return config;
}

/** Requirement 12.2 — validates the Origin header against allowed_origins, when configured. */
export function assertOriginAllowed(config: WidgetConfig, origin: string | undefined): void {
  if (!config.allowed_origins || config.allowed_origins.length === 0) return;
  if (!origin || !config.allowed_origins.includes(origin)) throw new WidgetError('Origin not permitted', 403);
}

export async function getBusinessInfo(businessId: string) {
  const config = await requireEnabledWidget(businessId);
  const { rows } = await adminPool.query(
    'SELECT id, name, logo_url, tenant_id FROM sys_businesses WHERE id = $1',
    [businessId],
  );
  const business = rows[0];
  const theme = await resolveForBusiness(businessId, adminPool);
  return {
    id: business.id,
    name: business.name,
    logo_url: business.logo_url,
    tenant_id: business.tenant_id,
    theme,
    require_payment_before_confirmation: config.require_payment_before_confirmation,
  };
}

export async function getProducts(businessId: string) {
  await requireEnabledWidget(businessId);
  const { rows: services } = await adminPool.query(
    `SELECT s.id, s.name, s.short_description, s.booking_type,
            json_agg(json_build_object('id', v.id, 'name', v.name, 'duration', v.duration, 'price', v.price) ORDER BY v.display_order) AS variants
     FROM svc_services s
     JOIN svc_variants v ON v.service_id = s.id AND v.status = 'active'
     WHERE s.business_id = $1 AND s.status = 'active' AND s.online_booking_enabled = true
     GROUP BY s.id
     ORDER BY s.display_order`,
    [businessId],
  );
  const { rows: packages } = await adminPool.query(
    `SELECT id, name, short_description, price FROM pkg_packages WHERE business_id = $1 AND status = 'active' ORDER BY display_order`,
    [businessId],
  );
  const { rows: memberships } = await adminPool.query(
    `SELECT id, name, short_description, price, billing_frequency FROM mbr_plans WHERE business_id = $1 AND status = 'active' ORDER BY display_order`,
    [businessId],
  );
  return [
    ...services.map((r: any) => ({ ...r, product_type: 'service' })),
    ...packages.map((r: any) => ({ ...r, product_type: 'package' })),
    ...memberships.map((r: any) => ({ ...r, product_type: 'membership' })),
  ];
}

export async function getProductDetail(businessId: string, productId: string) {
  await requireEnabledWidget(businessId);

  const { rows: serviceRows } = await adminPool.query(
    `SELECT s.id, s.name, s.description, s.short_description, s.booking_type, s.default_duration
     FROM svc_services s
     WHERE s.id = $1 AND s.business_id = $2 AND s.status = 'active' AND s.online_booking_enabled = true`,
    [productId, businessId],
  );
  if (serviceRows.length > 0) {
    const { rows: variants } = await adminPool.query(
      `SELECT id, name, duration, price FROM svc_variants WHERE service_id = $1 AND status = 'active' ORDER BY display_order`,
      [productId],
    );
    return { ...serviceRows[0], product_type: 'service', variants };
  }

  const { rows: packageRows } = await adminPool.query(
    `SELECT id, name, description, short_description, price, expiration_type, expiration_days FROM pkg_packages
     WHERE id = $1 AND business_id = $2 AND status = 'active'`,
    [productId, businessId],
  );
  if (packageRows.length > 0) {
    const { rows: items } = await adminPool.query(
      `SELECT pi.item_type, pi.quantity, s.name AS service_name
       FROM pkg_package_items pi LEFT JOIN svc_services s ON s.id = pi.service_id
       WHERE pi.package_id = $1`,
      [productId],
    );
    return { ...packageRows[0], product_type: 'package', items };
  }

  const { rows: planRows } = await adminPool.query(
    `SELECT id, name, description, short_description, price, billing_frequency, trial_days FROM mbr_plans
     WHERE id = $1 AND business_id = $2 AND status = 'active'`,
    [productId, businessId],
  );
  if (planRows.length > 0) {
    const { rows: items } = await adminPool.query(
      `SELECT pi.quantity_per_period, s.name AS service_name
       FROM mbr_plan_items pi LEFT JOIN svc_services s ON s.id = pi.service_id
       WHERE pi.plan_id = $1`,
      [productId],
    );
    return { ...planRows[0], product_type: 'membership', items };
  }

  throw new WidgetError('Product not found', 404);
}

/** Mirrors GET /bookings/availability/days (bookings.ts) exactly — same helpers, same logic. */
export async function getAvailabilityDays(businessId: string, serviceId: string, variantId: string, month: string) {
  await requireEnabledWidget(businessId);
  const days = getDaysInMonth(month);
  const result: Record<string, 'available' | 'unavailable' | 'closed'> = {};
  let timezone = 'UTC';
  for (const day of days) {
    const availability = await availabilityService.getAvailabilityCombinations({
      serviceId, businessId, variantId, dateFrom: day, dateTo: day,
    });
    timezone = availability.timezone;
    const isClosed = availability.slots.length === 0 ? await isDayClosedForBusiness(businessId, day) : false;
    result[day] = computeDayStatus(availability.slots, 1, isClosed);
  }
  return { timezone, days: result };
}

/**
 * Returns the same rich (time x location x staff) combinations the admin booking flow
 * uses — not the collapsed "available_staff per time" shape — so the widget can offer the
 * same location/staff selection a business owner already gets in BookingCreate.tsx, and so
 * a specific chosen combo's staff_id can be sent to createBooking() rather than
 * auto-picking the first available one.
 */
export async function getAvailabilitySlots(businessId: string, serviceId: string, variantId: string, dateFrom: string, dateTo: string) {
  await requireEnabledWidget(businessId);
  const result = await availabilityService.getAvailabilityCombinations({ businessId, serviceId, variantId, dateFrom, dateTo });
  return result.slots;
}

interface HoldDto { businessId: string; serviceId: string; variantId: string; startTime: string; userId: string }

export async function holdSlot(dto: HoldDto) {
  await requireEnabledWidget(dto.businessId);
  const { rows: variantRows } = await adminPool.query('SELECT duration FROM svc_variants WHERE id = $1', [dto.variantId]);
  if (variantRows.length === 0) throw new WidgetError('Variant not found', 404);
  const start = new Date(dto.startTime);
  const end = new Date(start.getTime() + variantRows[0].duration * 60 * 1000);
  const hold = await createHold({
    businessId: dto.businessId,
    serviceId: dto.serviceId,
    variantId: dto.variantId,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    heldBy: dto.userId,
  });
  return hold;
}

// The JWT carries only { sub, tid, role, permissions } — no email claim — so every widget
// function that needs the caller's email resolves it from usr_users by sub.
interface AuthUser { sub: string; tid: string; role: string }

/** Requirement 6.5 — only a 'customer' persona JWT may use the widget's customer/booking endpoints. */
export function assertCustomerRole(user: AuthUser): void {
  if (user.role !== 'Customer') throw new WidgetError('This action requires a customer account', 401);
}

async function resolveAuthEmail(userId: string): Promise<string> {
  const { rows } = await adminPool.query('SELECT email FROM usr_users WHERE id = $1', [userId]);
  if (rows.length === 0) throw new WidgetError('Account not found', 404);
  return rows[0].email;
}

export async function findOrCreateCustomer(businessId: string, user: AuthUser, phone: string | undefined) {
  await requireEnabledWidget(businessId);
  assertCustomerRole(user);

  const { rows: bizRows } = await adminPool.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);
  const tenantId = bizRows[0]?.tenant_id;
  if (!tenantId || tenantId !== user.tid) throw new WidgetError('Not authorized for this business', 403);

  // usr_users has no phone column — only cus_customers does — so phone is collected at the
  // Customer Details step (Requirement 3.9) and passed in here, not sourced from the account.
  const { rows: userRows } = await adminPool.query('SELECT email, first_name, last_name FROM usr_users WHERE id = $1', [user.sub]);
  const authAccount = userRows[0];
  if (!authAccount) throw new WidgetError('Account not found', 404);

  const { rows: existing } = await adminPool.query(
    'SELECT id, first_name, last_name, email, phone FROM cus_customers WHERE business_id = $1 AND email = $2',
    [businessId, authAccount.email],
  );
  if (existing.length > 0) {
    if (phone && !existing[0].phone) {
      await adminPool.query('UPDATE cus_customers SET phone = $1, updated_at = NOW() WHERE id = $2', [phone, existing[0].id]);
      existing[0].phone = phone;
    }
    return { customer: existing[0], isNew: false };
  }

  const { rows: created } = await adminPool.query(
    `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, phone, lifecycle_stage, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'lead', 'active', $8)
     RETURNING id, first_name, last_name, email, phone`,
    [
      tenantId, businessId, `CUS-${Date.now().toString(36).toUpperCase()}`,
      authAccount.email, authAccount.first_name, authAccount.last_name, phone || null, user.sub,
    ],
  );
  const customer = created[0];

  await createActivity({
    customerId: customer.id,
    businessId,
    activityType: 'widget_registration',
    description: 'Registered via the booking widget',
    metadata: { source: 'widget' },
    createdBy: user.sub,
  });

  return { customer, isNew: true };
}

interface CreateWidgetBookingDto {
  businessId: string;
  customerId: string;
  serviceId: string;
  variantId: string;
  startTime: string;
  staffId?: string;
  notes?: string;
  holdId?: string;
}

export async function createWidgetBooking(dto: CreateWidgetBookingDto, user: AuthUser) {
  const config = await requireEnabledWidget(dto.businessId);
  assertCustomerRole(user);

  const email = await resolveAuthEmail(user.sub);
  const { rows: custRows } = await adminPool.query(
    'SELECT id, tenant_id FROM cus_customers WHERE id = $1 AND business_id = $2 AND email = $3',
    [dto.customerId, dto.businessId, email],
  );
  if (custRows.length === 0) throw new WidgetError('Not authorized for this customer', 401);

  if (dto.holdId) {
    const { rows: holdRows } = await adminPool.query(
      `SELECT * FROM apt_slot_holds WHERE id = $1 AND business_id = $2 AND service_id = $3 AND variant_id = $4
         AND start_time = $5 AND held_by = $6 AND expires_at > NOW()`,
      [dto.holdId, dto.businessId, dto.serviceId, dto.variantId, new Date(dto.startTime).toISOString(), user.sub],
    );
    if (holdRows.length === 0) throw new WidgetError('Slot hold expired or does not match', 409);
  }

  const { rows: bizRows } = await adminPool.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [dto.businessId]);
  const initialStatus = config.require_payment_before_confirmation ? 'pending' : 'confirmed';

  // Requirement 15.4 — log the attempt (business_id, hashed email, product_id, requested
  // start time, outcome) via the existing logger, regardless of whether it succeeds.
  const attemptMeta = {
    businessId: dto.businessId, hashedEmail: hashEmail(email), productId: dto.serviceId, startTime: dto.startTime,
  };

  let booking;
  try {
    booking = await createBooking({
      businessId: dto.businessId,
      customerId: dto.customerId,
      serviceId: dto.serviceId,
      variantId: dto.variantId,
      staffId: dto.staffId,
      startTime: dto.startTime,
      notes: dto.notes,
      createdBy: user.sub,
      tenantId: bizRows[0].tenant_id,
      initialStatus,
      source: 'widget',
    });
  } catch (err: any) {
    logger.warn('Widget booking attempt failed', { ...attemptMeta, outcome: 'failed', reason: err.message });
    throw new WidgetError(err.message || 'Failed to create booking', 422);
  }

  logger.info('Widget booking attempt succeeded', { ...attemptMeta, outcome: 'succeeded', bookingId: booking.id });

  const full = await getBookingById(booking.id, dto.businessId);

  if (!config.require_payment_before_confirmation) {
    await queueBookingConfirmation(full, email);
  }

  return full;
}

export async function payForBooking(bookingId: string, businessId: string, user: AuthUser) {
  await requireEnabledWidget(businessId);
  assertCustomerRole(user);

  const email = await resolveAuthEmail(user.sub);
  const booking = await getBookingById(bookingId, businessId);
  if (!booking) throw new WidgetError('Booking not found', 404);
  if (booking.customer_email !== email) throw new WidgetError('Not authorized for this booking', 401);

  const { rows: bizRows } = await adminPool.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);

  // Requirement 15.3 — every /pay call against a real, correctly-addressed target is
  // recorded, not only successful ones; re-attempting payment on an already-confirmed
  // booking is the one realistic "failed" case v1's simulated payment can produce (there's
  // no real processor to decline a card).
  if (booking.status === 'confirmed') {
    await adminPool.query(
      `INSERT INTO wgt_widget_transactions (tenant_id, business_id, booking_id, customer_id, amount_cents, currency, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 'EUR', 'simulated', 'failed')`,
      [bizRows[0].tenant_id, businessId, bookingId, booking.customer_id, booking.price],
    );
    throw new WidgetError('Booking is already confirmed', 409);
  }

  const { rows: txRows } = await adminPool.query(
    `INSERT INTO wgt_widget_transactions (tenant_id, business_id, booking_id, customer_id, amount_cents, currency, payment_method, status)
     VALUES ($1, $2, $3, $4, $5, 'EUR', 'simulated', 'completed')
     RETURNING id`,
    [bizRows[0].tenant_id, businessId, bookingId, booking.customer_id, booking.price],
  );

  await adminPool.query(
    `UPDATE apt_bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
    [bookingId],
  );
  await adminPool.query(
    `INSERT INTO apt_booking_status_history (booking_id, from_status, to_status, changed_by) VALUES ($1, 'pending', 'confirmed', $2)`,
    [bookingId, user.sub],
  );

  const confirmedBooking = await getBookingById(bookingId, businessId);
  await queueBookingConfirmation(confirmedBooking, email);

  return { status: 'confirmed', transaction_id: txRows[0].id };
}

// ── Phase 5 — Package purchase / membership enrollment ──────────────────────
// purchasePackage()/enrollCustomer() are the same functions the admin app uses,
// unchanged — no booking-rule engine to violate here (no lead time, capacity, or
// staff availability for buying a bundle), so the only failure modes are
// "package/plan not active" or "already purchased and new_customers_only",
// which those functions already throw for.
//
// Note: the admin app itself sends no purchase/enrollment confirmation email
// today (confirmed by reading packages.ts/memberships.ts's routes) — Requirement
// 18.6 says to reuse whatever the admin app already sends, so widget purchases
// correctly send nothing too, rather than inventing a new template.

async function resolveOwnedCustomer(businessId: string, customerId: string, user: AuthUser): Promise<string> {
  const email = await resolveAuthEmail(user.sub);
  const { rows } = await adminPool.query(
    'SELECT id FROM cus_customers WHERE id = $1 AND business_id = $2 AND email = $3',
    [customerId, businessId, email],
  );
  if (rows.length === 0) throw new WidgetError('Not authorized for this customer', 401);
  return email;
}

interface PurchaseWidgetPackageDto { businessId: string; customerId: string; packageId: string }

export async function purchaseWidgetPackage(dto: PurchaseWidgetPackageDto, user: AuthUser) {
  const config = await requireEnabledWidget(dto.businessId);
  assertCustomerRole(user);
  await resolveOwnedCustomer(dto.businessId, dto.customerId, user);

  const initialStatus = config.require_payment_before_confirmation ? 'pending' : 'active';
  try {
    const purchase = await purchasePackage({
      packageId: dto.packageId,
      businessId: dto.businessId,
      customerId: dto.customerId,
      initialStatus,
      source: 'widget',
    });
    const { rows: pkgRows } = await adminPool.query('SELECT name, price FROM pkg_packages WHERE id = $1', [dto.packageId]);
    return { id: purchase.id, package_name: pkgRows[0]?.name, price: pkgRows[0]?.price, status: purchase.status };
  } catch (err: any) {
    throw new WidgetError(err.message || 'Failed to purchase package', 422);
  }
}

export async function payForPackagePurchase(purchaseId: string, businessId: string, user: AuthUser) {
  await requireEnabledWidget(businessId);
  assertCustomerRole(user);
  const email = await resolveAuthEmail(user.sub);

  const { rows } = await adminPool.query(
    `SELECT pp.id, pp.status, pp.customer_id, pp.business_id, pkg.price, c.email AS customer_email
     FROM pkg_purchases pp
     JOIN pkg_packages pkg ON pkg.id = pp.package_id
     JOIN cus_customers c ON c.id = pp.customer_id
     WHERE pp.id = $1 AND pp.business_id = $2`,
    [purchaseId, businessId],
  );
  const purchase = rows[0];
  if (!purchase) throw new WidgetError('Purchase not found', 404);
  if (purchase.customer_email !== email) throw new WidgetError('Not authorized for this purchase', 401);

  const { rows: bizRows } = await adminPool.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);

  if (purchase.status === 'active') {
    await adminPool.query(
      `INSERT INTO wgt_widget_transactions (tenant_id, business_id, purchase_id, customer_id, amount_cents, currency, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 'EUR', 'simulated', 'failed')`,
      [bizRows[0].tenant_id, businessId, purchaseId, purchase.customer_id, purchase.price],
    );
    throw new WidgetError('Purchase is already confirmed', 409);
  }

  const { rows: txRows } = await adminPool.query(
    `INSERT INTO wgt_widget_transactions (tenant_id, business_id, purchase_id, customer_id, amount_cents, currency, payment_method, status)
     VALUES ($1, $2, $3, $4, $5, 'EUR', 'simulated', 'completed')
     RETURNING id`,
    [bizRows[0].tenant_id, businessId, purchaseId, purchase.customer_id, purchase.price],
  );
  await adminPool.query(`UPDATE pkg_purchases SET status = 'active' WHERE id = $1`, [purchaseId]);

  return { status: 'confirmed', transaction_id: txRows[0].id };
}

interface EnrollWidgetMembershipDto { businessId: string; customerId: string; planId: string; startDate: string }

export async function enrollWidgetMembership(dto: EnrollWidgetMembershipDto, user: AuthUser) {
  const config = await requireEnabledWidget(dto.businessId);
  assertCustomerRole(user);
  await resolveOwnedCustomer(dto.businessId, dto.customerId, user);

  const initialStatus = config.require_payment_before_confirmation ? 'pending' : 'active';
  try {
    const enrollment = await enrollCustomer({
      planId: dto.planId,
      businessId: dto.businessId,
      customerId: dto.customerId,
      startDate: dto.startDate,
      initialStatus,
      source: 'widget',
    });
    const { rows: planRows } = await adminPool.query('SELECT name, price, billing_frequency FROM mbr_plans WHERE id = $1', [dto.planId]);
    return {
      id: enrollment.id, plan_name: planRows[0]?.name, price: planRows[0]?.price,
      billing_frequency: planRows[0]?.billing_frequency, status: enrollment.status,
    };
  } catch (err: any) {
    throw new WidgetError(err.message || 'Failed to enroll in membership', 422);
  }
}

export async function payForMembershipEnrollment(enrollmentId: string, businessId: string, user: AuthUser) {
  await requireEnabledWidget(businessId);
  assertCustomerRole(user);
  const email = await resolveAuthEmail(user.sub);

  const { rows } = await adminPool.query(
    `SELECT e.id, e.status, e.customer_id, e.business_id, p.price, c.email AS customer_email
     FROM mbr_enrollments e
     JOIN mbr_plans p ON p.id = e.plan_id
     JOIN cus_customers c ON c.id = e.customer_id
     WHERE e.id = $1 AND e.business_id = $2`,
    [enrollmentId, businessId],
  );
  const enrollment = rows[0];
  if (!enrollment) throw new WidgetError('Enrollment not found', 404);
  if (enrollment.customer_email !== email) throw new WidgetError('Not authorized for this enrollment', 401);

  const { rows: bizRows } = await adminPool.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);

  if (enrollment.status === 'active') {
    await adminPool.query(
      `INSERT INTO wgt_widget_transactions (tenant_id, business_id, enrollment_id, customer_id, amount_cents, currency, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 'EUR', 'simulated', 'failed')`,
      [bizRows[0].tenant_id, businessId, enrollmentId, enrollment.customer_id, enrollment.price],
    );
    throw new WidgetError('Enrollment is already confirmed', 409);
  }

  const { rows: txRows } = await adminPool.query(
    `INSERT INTO wgt_widget_transactions (tenant_id, business_id, enrollment_id, customer_id, amount_cents, currency, payment_method, status)
     VALUES ($1, $2, $3, $4, $5, 'EUR', 'simulated', 'completed')
     RETURNING id`,
    [bizRows[0].tenant_id, businessId, enrollmentId, enrollment.customer_id, enrollment.price],
  );
  await adminPool.query(`UPDATE mbr_enrollments SET status = 'active', updated_at = NOW() WHERE id = $1`, [enrollmentId]);

  return { status: 'confirmed', transaction_id: txRows[0].id };
}
