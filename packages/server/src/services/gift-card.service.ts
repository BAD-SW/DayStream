import crypto from 'crypto';
import { adminPool } from '../db/pool';
import { resolveBusinessCurrency } from './customer-payment.service';
import { logAudit } from './audit.service';
import { queueNotification } from './booking-notifications.service';

/**
 * Section C — Gift cards (spec 10-payment-platform, task 4.8 / Requirement C7).
 *
 * Business-scoped stored value: a gift card is purchased for a monetary amount,
 * gets a unique code, and is redeemable ONLY at the issuing business (C7.8).
 * Redemption (partial supported) is handled in `customer-payment.service`
 * (`runGiftCard`) — this service covers issuing, listing, balance/history, void,
 * and emailing the recipient.
 */

class GiftCardError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'GiftCardError';
    this.code = code;
  }
}

/** A human-friendly, unguessable code: GC-XXXX-XXXX (Crockford-ish, no ambiguous chars). */
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n: number) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `GC-${pick(4)}-${pick(4)}`;
}

export interface CreateGiftCardInput {
  businessId: string;
  tenantId: string;
  amountCents: number;
  recipientEmail?: string | null;
  recipientName?: string | null;
  purchaserCustomerId?: string | null;
  expiresAt?: string | null;   // YYYY-MM-DD
  createdBy: string;
}

/** Issue a gift card with a unique code. The code is returned so it can be shown/emailed. */
export async function createGiftCard(input: CreateGiftCardInput): Promise<any> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new GiftCardError('Gift card amount must be a positive integer (cents)', 'INVALID_AMOUNT');
  }
  const currency = await resolveBusinessCurrency(input.businessId);

  // Allocate a unique code (retry on the UNIQUE collision, which is astronomically rare).
  let card: any = null;
  for (let attempt = 0; attempt < 5 && !card; attempt++) {
    const code = generateCode();
    try {
      const { rows } = await adminPool.query(
        `INSERT INTO pay_gift_cards
           (tenant_id, business_id, code, currency, initial_amount_cents, balance_cents,
            recipient_email, recipient_name, purchaser_customer_id, expires_at, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'active',$10)
         RETURNING *`,
        [
          input.tenantId, input.businessId, code, currency, input.amountCents,
          input.recipientEmail ?? null, input.recipientName ?? null,
          input.purchaserCustomerId ?? null, input.expiresAt ?? null, input.createdBy,
        ],
      );
      card = rows[0];
    } catch (e: any) {
      if (e?.code === '23505') continue;  // unique_violation on code — retry
      throw e;
    }
  }
  if (!card) throw new GiftCardError('Could not allocate a unique gift card code', 'CODE_ALLOCATION_FAILED');

  await logAudit({
    tenantId: input.tenantId, userId: input.createdBy, action: 'gift_card.issued',
    resourceType: 'gift_card', resourceId: card.id,
    details: { code: card.code, amount_cents: input.amountCents, currency },
  }).catch(() => {});

  // Email the recipient (C7.3). Full branding is Phase 6 (C12).
  if (card.recipient_email) {
    queueNotification({
      businessId: input.businessId, type: 'gift_card.issued',
      recipientId: input.purchaserCustomerId || card.id, recipientEmail: card.recipient_email,
      data: {
        code: card.code, amount_cents: input.amountCents, currency,
        recipient_name: card.recipient_name, expires_at: card.expires_at,
      },
    }).catch(() => {});
  }

  return card;
}

export interface GiftCardFilters { status?: string; }

export async function listGiftCards(businessId: string, filters: GiftCardFilters = {}): Promise<any[]> {
  const conditions = ['business_id = $1'];
  const params: any[] = [businessId];
  if (filters.status) { conditions.push(`status = $2`); params.push(filters.status); }
  const { rows } = await adminPool.query(
    `SELECT id, code, currency, initial_amount_cents, balance_cents, recipient_email, recipient_name,
            purchaser_customer_id, expires_at, status, created_at
     FROM pay_gift_cards WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

/** A gift card with its redemption history (C7.6), derived from the ledger. */
export async function getGiftCard(id: string, businessId: string): Promise<any | null> {
  const { rows } = await adminPool.query(
    `SELECT * FROM pay_gift_cards WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  const card = rows[0];
  if (!card) return null;

  const { rows: history } = await adminPool.query(
    `SELECT id, amount, currency, status, reference_number, created_at
     FROM pay_transactions
     WHERE business_id = $1 AND payment_method = 'gift_card' AND gift_card_code = $2
     ORDER BY created_at DESC`,
    [businessId, card.code],
  );
  card.redemptions = history;
  return card;
}

/** Look up a card by code for a checkout balance check (never cross-business — C7.8). */
export async function getGiftCardByCode(code: string, businessId: string): Promise<any | null> {
  const { rows } = await adminPool.query(
    `SELECT id, code, currency, balance_cents, expires_at, status
     FROM pay_gift_cards WHERE code = $1 AND business_id = $2`,
    [code.trim(), businessId],
  );
  return rows[0] || null;
}

/** Void a gift card (e.g. issued in error). A depleted card cannot be re-voided. */
export async function voidGiftCard(id: string, businessId: string, tenantId: string, userId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `UPDATE pay_gift_cards SET status = 'void', updated_at = NOW()
     WHERE id = $1 AND business_id = $2 AND status = 'active'
     RETURNING code`,
    [id, businessId],
  );
  if (rows.length === 0) return false;
  await logAudit({
    tenantId, userId, action: 'gift_card.voided', resourceType: 'gift_card', resourceId: id,
    details: { code: rows[0].code },
  }).catch(() => {});
  return true;
}

/** Re-send the gift card email to its recipient. */
export async function emailGiftCard(id: string, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT code, currency, initial_amount_cents, recipient_email, recipient_name, expires_at
     FROM pay_gift_cards WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  const card = rows[0];
  if (!card || !card.recipient_email) return false;
  await queueNotification({
    businessId, type: 'gift_card.issued', recipientId: id, recipientEmail: card.recipient_email,
    data: {
      code: card.code, amount_cents: card.initial_amount_cents, currency: card.currency,
      recipient_name: card.recipient_name, expires_at: card.expires_at,
    },
  });
  return true;
}

export { GiftCardError };
