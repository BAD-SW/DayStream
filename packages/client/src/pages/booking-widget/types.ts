import { WidgetAvailabilityCombo, WidgetBooking, WidgetCustomer, WidgetProductDetail } from '../../api/widget';

export type FlowStep =
  | 'product'
  | 'calendar'
  | 'slots'
  | 'auth'
  | 'customer'
  | 'payment'
  | 'confirmation';

/** Requirement 3.2 — the full service booking flow. */
export const SERVICE_STEP_ORDER: FlowStep[] = [
  'product', 'calendar', 'slots', 'auth', 'customer', 'payment', 'confirmation',
];

/** Requirement 18.1 — no Availability Calendar or Time Slot Picker; nothing to reserve. */
export const PACKAGE_STEP_ORDER: FlowStep[] = [
  'product', 'auth', 'customer', 'payment', 'confirmation',
];

/** The widget:* key of each step's name; the component that shows it calls t. */
export const STEP_LABEL_KEYS: Record<FlowStep, string> = {
  product: 'step.product',
  calendar: 'step.calendar',
  slots: 'step.slots',
  auth: 'step.auth',
  customer: 'step.customer',
  payment: 'step.payment',
  confirmation: 'step.confirmation',
};

/** Normalized result of a package purchase or membership enrollment — the two API
 * response shapes differ (package_name vs plan_name, billing_frequency only on
 * memberships), flattened here so the UI doesn't need to branch on it repeatedly. */
export interface PurchaseResult {
  kind: 'package' | 'membership';
  id: string;
  name: string;
  price: number;
  status: 'pending' | 'active';
  billingFrequency?: string;
}

/** Booking flow state, accumulated as the visitor moves forward; Back never discards it. */
export interface FlowState {
  businessId: string;
  productId: string;
  product: WidgetProductDetail | null;
  requirePaymentBeforeConfirmation: boolean | null;

  selectedVariantId: string | null;
  /** The add-ons chosen with the service (spec 51, gap 15). */
  selectedAddonIds: string[];
  selectedDate: string | null;
  /** The one specific (time, location, staff) combo the visitor is booking. */
  selectedSlot: WidgetAvailabilityCombo | null;

  holdId: string | null;
  holdExpiresAt: string | null;

  phone: string;
  customer: WidgetCustomer | null;

  booking: WidgetBooking | null;
  /** Set instead of `booking` when product_type is 'package' or 'membership'. */
  purchase: PurchaseResult | null;
}

export const initialFlowState = (businessId: string, productId: string): FlowState => ({
  businessId,
  productId,
  product: null,
  requirePaymentBeforeConfirmation: null,
  selectedVariantId: null,
  selectedAddonIds: [],
  selectedDate: null,
  selectedSlot: null,
  holdId: null,
  holdExpiresAt: null,
  phone: '',
  customer: null,
  booking: null,
  purchase: null,
});
