/**
 * Fill in cus_customers.phone_e164 for people created before Phase 46.
 *
 * People are matched by their phone in international form (phone_e164). Records that
 * existed before migration 136 only have the phone as it was typed, so they cannot be
 * found by phone until this has run. Safe to run again: it only touches rows where
 * phone_e164 is still empty, and leaves alone numbers it cannot read.
 *
 * Usage: npx tsx scripts/backfill-phone-e164.ts
 */

import { adminPool } from '../src/db/pool';
import { normalisePhone, defaultRegionFor } from '../src/services/person-identity.service';

async function backfill() {
  const { rows } = await adminPool.query(
    `SELECT id, business_id, phone, country FROM cus_customers
      WHERE phone IS NOT NULL AND BTRIM(phone) <> '' AND phone_e164 IS NULL`,
  );
  let filled = 0;
  let unreadable = 0;
  for (const row of rows) {
    const region = row.country && String(row.country).length === 2 ? String(row.country).toUpperCase() : await defaultRegionFor(row.business_id);
    const e164 = normalisePhone(row.phone, region);
    if (!e164) { unreadable++; continue; }
    await adminPool.query('UPDATE cus_customers SET phone_e164 = $1 WHERE id = $2', [e164, row.id]);
    filled++;
  }
  console.log(`Phone numbers checked: ${rows.length}. Filled in: ${filled}. Could not be read (left as typed): ${unreadable}.`);
}

backfill()
  .then(() => adminPool.end())
  .catch((err) => { console.error('Backfill failed:', err.message); process.exit(1); });
