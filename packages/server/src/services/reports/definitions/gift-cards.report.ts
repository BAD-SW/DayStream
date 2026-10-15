import { reportDb } from '../lib/report-db';
import { ReportDefinition } from '../types';

/**
 * Gift Cards report — a snapshot of the business's issued gift cards.
 *
 * Lists each card with its face (initial) value, current balance, amount redeemed
 * to date (initial − balance), status, recipient, and issue/expiry dates. Covers
 * all cards whether sold through checkout or issued directly (comp).
 *
 * This is a point-in-time snapshot (a gift card's balance is a running figure, not
 * period-bound), so the date range is not applied — matching the Active Memberships
 * report. Business-scoped via ctx.businessId; a gift card is never cross-business.
 */
export const giftCardsReport: ReportDefinition = {
  id: 'gift-cards',
  title: 'Gift Cards',
  columns: [
    { key: 'code', header: 'Code', type: 'text', filterable: true },
    { key: 'recipient', header: 'Recipient', type: 'text', filterable: true },
    { key: 'initial', header: 'Initial Value', type: 'currency', total: true },
    { key: 'balance', header: 'Balance', type: 'currency', total: true },
    { key: 'redeemed', header: 'Redeemed', type: 'currency', total: true },
    { key: 'status', header: 'Status', type: 'text', filterable: true, groupable: true },
    { key: 'issued', header: 'Issued', type: 'date', filterable: true },
    { key: 'expires', header: 'Expires', type: 'date', filterable: true },
  ],
  run: async (ctx) => {
    const { rows } = await reportDb.query(
      `SELECT g.code,
              COALESCE(NULLIF(TRIM(COALESCE(g.recipient_name, '')), ''), g.recipient_email, '—') AS recipient,
              g.initial_amount_cents::int AS initial,
              g.balance_cents::int AS balance,
              (g.initial_amount_cents - g.balance_cents)::int AS redeemed,
              INITCAP(g.status) AS status,
              g.created_at::date AS issued,
              g.expires_at AS expires
         FROM pay_gift_cards g
        WHERE g.business_id = $1
        ORDER BY g.created_at DESC`,
      [ctx.businessId],
    );
    return rows;
  },
};
