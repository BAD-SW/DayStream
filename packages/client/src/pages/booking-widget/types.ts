import { WidgetAvailabilityCombo, WidgetBooking, WidgetCustomer, WidgetProductDetail } from '../../api/widget';

export type ServiceFlowStep =
  | 'product'
  | 'calendar'
  | 'slots'
  | 'auth'
  | 'customer'
  | 'payment'
  | 'confirmation';

export const SERVICE_STEP_ORDER: ServiceFlowStep[] = [
  'product', 'calendar', 'slots', 'auth', 'customer', 'payment', 'confirmation',
];

export const SERVICE_STEP_LABELS: Record<ServiceFlowStep, string> = {
  product: 'Details',
  calendar: 'Date',
  slots: 'Time',
  auth: 'Sign in',
  customer: 'Your details',
  payment: 'Payment',
  confirmation: 'Confirmed',
};

/** Booking flow state, accumulated as the visitor moves forward; Back never discards it. */
export interface FlowState {
  businessId: string;
  productId: string;
  product: WidgetProductDetail | null;
  requirePaymentBeforeConfirmation: boolean | null;

  selectedVariantId: string | null;
  selectedDate: string | null;
  /** The one specific (time, location, staff) combo the visitor is booking. */
  selectedSlot: WidgetAvailabilityCombo | null;

  holdId: string | null;
  holdExpiresAt: string | null;

  phone: string;
  customer: WidgetCustomer | null;

  booking: WidgetBooking | null;
}

export const initialFlowState = (businessId: string, productId: string): FlowState => ({
  businessId,
  productId,
  product: null,
  requirePaymentBeforeConfirmation: null,
  selectedVariantId: null,
  selectedDate: null,
  selectedSlot: null,
  holdId: null,
  holdExpiresAt: null,
  phone: '',
  customer: null,
  booking: null,
});
