import axios from 'axios';

/**
 * Dedicated, isolated API client for the /booking-widget page — deliberately NOT the
 * shared `apiClient` from ./client.ts. That client waits on ContextManager
 * initialization and reads/writes the admin app's own localStorage token; the widget
 * is a standalone, unauthenticated-until-login page embedded on a third-party site and
 * must never touch admin session state (Requirement 3.8, 13.1).
 */
// Same VITE_API_URL story as ./client.ts — no Vite dev proxy exists once this is a
// static Vercel deployment, so a relative '/api' would resolve against the client's own
// domain instead of the API's.
const widgetHttp = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || ''}/api`,
  headers: { 'Content-Type': 'application/json' },
});

const TOKEN_KEY = 'daystream_widget_token';

export function getWidgetToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setWidgetToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearWidgetToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

widgetHttp.interceptors.request.use((config) => {
  const token = getWidgetToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export class WidgetApiError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
    this.name = 'WidgetApiError';
  }
}

/**
 * Joi validation failures (register, etc.) come back as { error: "Validation failed",
 * code: "VALIDATION_ERROR", details: [{ field, message }] } — the generic top-level
 * `error` string alone ("Validation failed") tells the visitor nothing actionable, so
 * when `details` is present its per-field messages are what's actually shown.
 */
function extractErrorMessage(err: any): string {
  const details = err.response?.data?.details;
  if (Array.isArray(details) && details.length > 0) {
    return details.map((d: { message?: string }) => d.message).filter(Boolean).join('; ');
  }
  return err.response?.data?.error || err.message || 'Request failed';
}

function toWidgetApiError(err: any): WidgetApiError {
  return new WidgetApiError(extractErrorMessage(err), err.response?.status, err.response?.data?.code);
}

function unwrap<T>(promise: Promise<{ data: { data: T } }>): Promise<T> {
  return promise
    .then((res) => res.data.data)
    .catch((err) => { throw toWidgetApiError(err); });
}

// --- Types ---

export interface ResolvedWidgetTheme {
  base_theme: string;
  tokens: Record<string, string>;
  source: string;
}

export interface WidgetBusinessInfo {
  id: string;
  name: string;
  logo_url: string | null;
  tenant_id: string;
  theme: ResolvedWidgetTheme;
  require_payment_before_confirmation: boolean;
}

export interface WidgetProductVariant {
  id: string;
  name: string;
  duration: number;
  price: number;
}

export interface WidgetProduct {
  id: string;
  name: string;
  short_description?: string | null;
  product_type: 'service' | 'package' | 'membership';
  // service-only
  booking_type?: string;
  variants?: WidgetProductVariant[];
  // package/membership-only — no variants, a single price
  price?: number;
  billing_frequency?: string;
}

export interface WidgetProductItem {
  item_type?: string;
  quantity?: number;
  quantity_per_period?: number;
  service_name?: string | null;
}

export interface WidgetProductDetail extends WidgetProduct {
  description?: string | null;
  default_duration?: number;
  expiration_type?: string;
  expiration_days?: number | null;
  trial_days?: number;
  items?: WidgetProductItem[];
}

export type DayStatus = 'available' | 'unavailable' | 'closed';

export interface WidgetAvailabilityDays {
  timezone: string;
  days: Record<string, DayStatus>;
}

/**
 * One (time, location, staff) combination — the same shape the admin booking flow
 * (BookingCreate.tsx) already consumes from availability.service.ts's combinations
 * endpoint. A single start_time appears as multiple rows when more than one
 * location/staff can serve it; staff_id is absent entirely for staff-less
 * (booking_type: 'resource') services.
 */
export interface WidgetAvailabilityCombo {
  start_time: string;
  end_time: string;
  duration: number;
  location_id: string | null;
  location_name: string | null;
  staff_id?: string;
  staff_first_name?: string;
  staff_last_name?: string;
  capacity_remaining?: number;
}

export interface WidgetHold {
  hold_id: string;
  expires_at: string;
}

export interface WidgetCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
}

export interface WidgetBooking {
  id: string;
  booking_reference: string;
  service_name: string;
  start_time: string;
  staff_name: string | null;
  status: 'pending' | 'confirmed';
}

export interface WidgetPaymentResult {
  status: 'confirmed';
  transaction_id: string;
}

export interface WidgetAuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

export interface WidgetAuthResult {
  access_token: string;
  user: WidgetAuthUser;
}

// --- Business / Products / Availability (public) ---

export function getBusinessInfo(businessId: string): Promise<WidgetBusinessInfo> {
  return unwrap(widgetHttp.get(`/v1/widget/business/${businessId}`));
}

export function getProducts(businessId: string): Promise<WidgetProduct[]> {
  return unwrap(widgetHttp.get(`/v1/widget/business/${businessId}/products`));
}

export function getProductDetail(businessId: string, productId: string): Promise<WidgetProductDetail> {
  return unwrap(widgetHttp.get(`/v1/widget/business/${businessId}/products/${productId}`));
}

export function getAvailabilityDays(
  businessId: string, serviceId: string, variantId: string, month: string,
): Promise<WidgetAvailabilityDays> {
  return unwrap(widgetHttp.get('/v1/widget/availability', {
    params: { business_id: businessId, service_id: serviceId, variant_id: variantId, month },
  }));
}

export function getAvailabilitySlots(
  businessId: string, serviceId: string, variantId: string, dateFrom: string, dateTo: string,
): Promise<WidgetAvailabilityCombo[]> {
  return unwrap(widgetHttp.get('/v1/widget/availability/slots', {
    params: { business_id: businessId, service_id: serviceId, variant_id: variantId, date_from: dateFrom, date_to: dateTo },
  }));
}

// --- Auth (existing endpoints, unchanged) ---

export function widgetLogin(tenantId: string, email: string, password: string): Promise<WidgetAuthResult> {
  return unwrap(widgetHttp.post('/v1/auth/login', { tenant_id: tenantId, email, password }));
}

export function widgetRegister(
  tenantId: string, businessId: string, email: string, password: string, firstName: string, lastName: string,
): Promise<WidgetAuthResult> {
  return unwrap(widgetHttp.post('/v1/auth/register', {
    tenant_id: tenantId, business_id: businessId, email, password, first_name: firstName, last_name: lastName,
  }));
}

// --- Authenticated widget actions ---

export function holdSlot(businessId: string, serviceId: string, variantId: string, startTime: string): Promise<WidgetHold> {
  return unwrap(widgetHttp.post('/v1/widget/availability/hold', {
    business_id: businessId, service_id: serviceId, variant_id: variantId, start_time: startTime,
  }));
}

export async function findOrCreateCustomer(
  businessId: string, phone?: string,
): Promise<{ customer: WidgetCustomer; isNew: boolean }> {
  try {
    const res = await widgetHttp.post('/v1/widget/customer', { business_id: businessId, phone });
    return { customer: res.data.data, isNew: res.status === 201 };
  } catch (err: any) {
    throw toWidgetApiError(err);
  }
}

export interface CreateWidgetBookingDto {
  businessId: string;
  customerId: string;
  serviceId: string;
  variantId: string;
  startTime: string;
  staffId?: string;
  notes?: string;
  holdId?: string;
}

export function createBooking(dto: CreateWidgetBookingDto): Promise<WidgetBooking> {
  return unwrap(widgetHttp.post('/v1/widget/booking', {
    business_id: dto.businessId,
    customer_id: dto.customerId,
    service_id: dto.serviceId,
    variant_id: dto.variantId,
    start_time: dto.startTime,
    staff_id: dto.staffId,
    notes: dto.notes,
    hold_id: dto.holdId,
  }));
}

export function payForBooking(bookingId: string, businessId: string): Promise<WidgetPaymentResult> {
  return unwrap(widgetHttp.post(`/v1/widget/booking/${bookingId}/pay`, { business_id: businessId }));
}

// --- Phase 5: package purchase / membership enrollment ---

export interface WidgetPackagePurchase {
  id: string;
  package_name: string;
  price: number;
  status: 'pending' | 'active';
}

export interface WidgetMembershipEnrollment {
  id: string;
  plan_name: string;
  price: number;
  billing_frequency: string;
  status: 'pending' | 'active';
}

export function purchasePackage(businessId: string, customerId: string, packageId: string): Promise<WidgetPackagePurchase> {
  return unwrap(widgetHttp.post('/v1/widget/package-purchase', {
    business_id: businessId, customer_id: customerId, package_id: packageId,
  }));
}

export function payForPackagePurchase(purchaseId: string, businessId: string): Promise<WidgetPaymentResult> {
  return unwrap(widgetHttp.post(`/v1/widget/package-purchase/${purchaseId}/pay`, { business_id: businessId }));
}

export function enrollMembership(
  businessId: string, customerId: string, planId: string, startDate: string,
): Promise<WidgetMembershipEnrollment> {
  return unwrap(widgetHttp.post('/v1/widget/membership-enrollment', {
    business_id: businessId, customer_id: customerId, plan_id: planId, start_date: startDate,
  }));
}

export function payForMembershipEnrollment(enrollmentId: string, businessId: string): Promise<WidgetPaymentResult> {
  return unwrap(widgetHttp.post(`/v1/widget/membership-enrollment/${enrollmentId}/pay`, { business_id: businessId }));
}
