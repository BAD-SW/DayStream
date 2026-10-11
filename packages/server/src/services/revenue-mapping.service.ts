/**
 * Shared revenue-account mapping for sales.
 *
 * Single source of truth for "which GL account does this line item earn into?",
 * mirroring the mapping order-journal.service.ts has long used for POS orders so
 * that POS checkout and invoice payment classify revenue identically.
 *
 * Rules:
 *   - Each item type credits its own revenue account (service 4100, product 4300,
 *     no-show fee 4600, …).
 *   - Memberships and packages are NOT recognised as revenue at point of sale —
 *     they are a performance obligation delivered over time, so they credit
 *     2400 Deferred Revenue. The revenue-recognition job moves deferred → the
 *     real revenue account (4200 / 4500) over the entitlement period.
 *   - Tax is never revenue; it credits 2300 Tax Payable.
 */

export type SaleItemType = 'service' | 'product' | 'membership' | 'package' | 'no_show_fee';

/** Item type → revenue account code (used when the line is recognised immediately). */
export const REVENUE_ACCOUNT_CODES: Record<SaleItemType, string> = {
  service: '4100',      // Service Revenue
  product: '4300',      // Product Revenue
  membership: '4200',   // Membership Revenue (via deferral + recognition)
  package: '4500',      // Package Revenue   (via deferral + recognition)
  no_show_fee: '4600',  // No-Show Fee Revenue (immediate)
};

/** Item types whose revenue is deferred at point of sale (credited to 2400). */
export const DEFERRED_ITEM_TYPES: ReadonlySet<SaleItemType> = new Set(['membership', 'package']);

export const DEFERRED_REVENUE_CODE = '2400'; // Deferred Revenue (liability)
export const TAX_PAYABLE_CODE = '2300';      // Tax Payable (liability)
export const SERVICE_REVENUE_CODE = '4100';  // default / fallback revenue

/** A sellable line reduced to what revenue mapping needs. */
export interface RevenueLine {
  itemType: string | null | undefined;
  /** Net revenue for the line, in cents (quantity × unit price, net of discount). */
  amountCents: number;
  /** Tax for the line, in cents. */
  taxCents?: number | null;
}

/** A single credit line in a journal entry, keyed by account CODE. */
export interface RevenueCreditLine {
  code: string;
  amountCents: number;
  description: string;
}

function normalizeType(t: string | null | undefined): SaleItemType {
  return (t && (t in REVENUE_ACCOUNT_CODES)) ? (t as SaleItemType) : 'service';
}

/**
 * Build the credit side of a sale's journal entry from its line items: one credit
 * per distinct revenue account (immediate lines), a combined 2400 credit for all
 * deferred lines, and a 2300 credit for total tax. Amounts are summed by account
 * so the result is compact. The caller supplies the matching debit (cash, or the
 * 2500 Customer Deposits release when applying account credit); total credits here
 * equal the sum of all line revenue + tax, which must equal that debit.
 */
export function buildRevenueCreditLines(lines: RevenueLine[]): RevenueCreditLine[] {
  const byCode = new Map<string, number>();
  let deferred = 0;
  let tax = 0;

  for (const line of lines) {
    const type = normalizeType(line.itemType);
    const amount = line.amountCents;
    if (amount > 0) {
      if (DEFERRED_ITEM_TYPES.has(type)) {
        deferred += amount;
      } else {
        const code = REVENUE_ACCOUNT_CODES[type];
        byCode.set(code, (byCode.get(code) ?? 0) + amount);
      }
    }
    tax += line.taxCents && line.taxCents > 0 ? line.taxCents : 0;
  }

  const out: RevenueCreditLine[] = [];
  for (const [code, amountCents] of byCode) {
    out.push({ code, amountCents, description: `Revenue — ${code}` });
  }
  if (deferred > 0) {
    out.push({ code: DEFERRED_REVENUE_CODE, amountCents: deferred, description: 'Deferred revenue (membership/package)' });
  }
  if (tax > 0) {
    out.push({ code: TAX_PAYABLE_CODE, amountCents: tax, description: 'Tax collected' });
  }
  return out;
}

/** Total cents the credit lines sum to (for balance assertions). */
export function sumCreditLines(lines: RevenueCreditLine[]): number {
  return lines.reduce((n, l) => n + l.amountCents, 0);
}
