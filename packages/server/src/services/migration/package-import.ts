import { adminPool } from '../../db/pool';
import {
  ImportResult, RowFailure, emptyResult, matchCustomer, noCustomerReason, matchByName, parseDateCell,
  fileDateOrder, customerMatchInput, DateOrder,
} from './import-core';

/**
 * Package import (spec 50, Wave 2). Brings across a customer's prepaid package PURCHASES so
 * they can keep redeeming what they already paid for.
 *
 * Per row: customer (unified matching) + package (matched by name to a configured package) +
 * the ORIGINAL purchase date. Inserted directly into `pkg_purchases` — not through
 * `purchasePackage`, which dates the purchase and its expiry from "now". The expiry is
 * computed from the package's own policy (days / weeks / months) relative to the ORIGINAL
 * purchase date, so a package bought 40 days ago with a 90-day window has 50 days left.
 *
 * Utilization is NOT in the file. Remaining balance is derived later: importing a past
 * appointment against a qualifying package inserts the matching redemption (Wave 3).
 *
 * A package definition that has since been archived is still accepted — importing a
 * purchase is not a sale, and the customer's existing balance should survive. No emails.
 */

interface MappedRow { [field: string]: string }

interface PackageRow {
  id: string; name: string; status: string;
  expiration_type: string; expiration_days: number | null; expiration_unit: string | null;
}

/** Store purchases at noon UTC so the calendar date is stable across business timezones. */
function purchaseTimestamp(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

/**
 * Expiry relative to the purchase date, using the same policy fields as `purchasePackage`.
 * Returns null when the package never expires.
 */
export function computeExpiry(purchasedAt: Date, pkg: Pick<PackageRow, 'expiration_type' | 'expiration_days' | 'expiration_unit'>): Date | null {
  if (pkg.expiration_type === 'none' || !pkg.expiration_days) return null;
  const d = new Date(purchasedAt.getTime());
  const unit = pkg.expiration_unit || 'days';
  if (unit === 'months') d.setUTCMonth(d.getUTCMonth() + pkg.expiration_days);
  else if (unit === 'weeks') d.setUTCDate(d.getUTCDate() + pkg.expiration_days * 7);
  else d.setUTCDate(d.getUTCDate() + pkg.expiration_days);
  return d;
}

export async function runPackageImport(args: {
  businessId: string;
  tenantId: string;
  userId: string;
  rows: MappedRow[];
  commit: boolean;
  dateOrder?: DateOrder | null;
}): Promise<ImportResult> {
  const { businessId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;
  const warnings: RowFailure[] = [];
  result.warnings = warnings;

  const { rows: packages } = await adminPool.query<PackageRow>(
    `SELECT id, name, status, expiration_type, expiration_days, expiration_unit
     FROM pkg_packages WHERE business_id = $1`,
    [businessId],
  );
  const now = new Date();
  const dateOrder = await fileDateOrder(businessId, rows, ['purchase_date'], args.dateOrder);
  // (customer|package|date) already handled in THIS file — keeps a trial faithful to the commit.
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const r = rows[i];
    const fail = (field: string, message: string) => {
      result.failed += 1;
      result.failures.push({ row: rowNum, field, message });
    };

    const pkgMatch = matchByName(packages, r.package, 'package');
    if (!pkgMatch.match) { fail('package', pkgMatch.reason!); continue; }
    const pkg = pkgMatch.match;

    const purchaseDate = parseDateCell(r.purchase_date, dateOrder);
    if (!purchaseDate) {
      fail('purchase_date', (r.purchase_date || '').trim()
        ? `"${r.purchase_date}" is not a valid date`
        : 'The original purchase date is required (it sets when the package expires)');
      continue;
    }

    const matchInput = customerMatchInput(r);
    const match = await matchCustomer(businessId, matchInput);
    if (!match.customerId) { fail('customer', noCustomerReason(matchInput)); continue; }
    const customerId = match.customerId;

    // Idempotency: customer + package + purchase date (calendar day, UTC).
    const key = `${customerId}|${pkg.id}|${purchaseDate}`;
    if (seen.has(key)) { result.matched += 1; continue; }
    const { rows: existing } = await adminPool.query(
      `SELECT 1 FROM pkg_purchases
       WHERE business_id = $1 AND customer_id = $2 AND package_id = $3
         AND (purchased_at AT TIME ZONE 'UTC')::date = $4::date
       LIMIT 1`,
      [businessId, customerId, pkg.id, purchaseDate],
    );
    seen.add(key);
    if (existing.length > 0) { result.matched += 1; continue; }

    const purchasedAt = purchaseTimestamp(purchaseDate);
    const expiresAt = computeExpiry(purchasedAt, pkg);
    if (expiresAt && expiresAt < now) {
      warnings.push({
        row: rowNum, field: 'purchase_date',
        message: `Imported, but this package already expired on ${expiresAt.toISOString().slice(0, 10)} (${purchaseDate} + the package's expiry window) — it can't be redeemed`,
      });
    }

    if (!commit) { result.imported += 1; continue; }

    try {
      await adminPool.query(
        `INSERT INTO pkg_purchases (package_id, business_id, customer_id, status, purchased_at, expires_at, source)
         VALUES ($1,$2,$3,'active',$4,$5,'import')`,
        [pkg.id, businessId, customerId, purchasedAt.toISOString(), expiresAt ? expiresAt.toISOString() : null],
      );
      result.imported += 1;
    } catch (e: any) {
      fail('general', e?.message || 'Failed to import package purchase');
    }
  }

  return result;
}
