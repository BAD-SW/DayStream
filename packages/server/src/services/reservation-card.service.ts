import { adminPool } from '../db/pool';
import { msg } from '../i18n';

/**
 * The card held for a reservation (spec 51, gap 5). A service's Reservation Payment Rule decides
 * what booking asks of the customer's card:
 *   no_card            nothing
 *   card_required      a saved card of the customer is attached to the booking, not charged;
 *                      Checkout charges it after the service (extras included)
 *   charge_at_booking  paid in full when booked (the payment step)
 * A walk-in is already at the business, so no card is asked of them.
 */
export type PaymentRule = 'no_card' | 'card_required' | 'charge_at_booking';

export class ReservationCardError extends Error {
  constructor(message: string, public code: 'CARD_REQUIRED' | 'CARD_INVALID') { super(message); }
}

export async function paymentRuleOf(serviceId: string, businessId: string): Promise<PaymentRule> {
  const { rows } = await adminPool.query(
    'SELECT payment_rule FROM svc_services WHERE id = $1 AND business_id = $2', [serviceId, businessId],
  );
  return (rows[0]?.payment_rule as PaymentRule | undefined) ?? 'no_card';
}

/** Whether a booking of this service for this customer must carry a card. */
export async function cardIsRequired(serviceId: string, businessId: string, customerId: string | null | undefined): Promise<boolean> {
  if (!customerId) return false; // a walk-in
  return (await paymentRuleOf(serviceId, businessId)) === 'card_required';
}

/** The card (or bank account) must be an active saved one of this customer at this business. */
export async function assertCustomerCard(paymentMethodId: string, businessId: string, customerId: string): Promise<void> {
  const { rows } = await adminPool.query(
    `SELECT 1 FROM pay_payment_methods
      WHERE id = $1 AND owner_level = 'customer' AND business_id = $2 AND customer_id = $3
        AND status = 'active' AND method_type IN ('card', 'bank_draw')`,
    [paymentMethodId, businessId, customerId],
  );
  if (rows.length === 0) throw new ReservationCardError(msg('errors:reservationCard.chooseOneOfThisCustomerS'), 'CARD_INVALID');
}

/**
 * Checks the card for a new booking. Returns the card to store, or null when none is needed.
 * A card sent for a service that does not need one is still stored (it does no harm and staff chose it).
 */
export async function cardForNewBooking(input: {
  serviceId: string; businessId: string; customerId?: string | null; paymentMethodId?: string | null;
  /** A membership or package pays for it (spec 51, gap 19; owner, 23 Nov 2026): no card is needed. */
  covered?: boolean;
}): Promise<string | null> {
  const required = !input.covered && await cardIsRequired(input.serviceId, input.businessId, input.customerId);
  if (!input.paymentMethodId) {
    if (required) throw new ReservationCardError(msg('errors:reservationCard.thisServiceNeedsACardFor'), 'CARD_REQUIRED');
    return null;
  }
  if (!input.customerId) return null; // a walk-in has no saved cards
  await assertCustomerCard(input.paymentMethodId, input.businessId, input.customerId);
  return input.paymentMethodId;
}

/** The booking's held card, if it is still an active saved card. */
export async function heldCardOf(bookingId: string, businessId: string): Promise<string | null> {
  const { rows } = await adminPool.query(
    `SELECT pm.id FROM apt_bookings b
       JOIN pay_payment_methods pm ON pm.id = b.payment_method_id
      WHERE b.id = $1 AND b.business_id = $2 AND pm.status = 'active'`,
    [bookingId, businessId],
  );
  return rows[0]?.id ?? null;
}
