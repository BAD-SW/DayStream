/**
 * End-to-end test helper: confirm a card (or bank debit) capture with one of Stripe's
 * published TEST payment methods, without a browser.
 *
 * In the product a card is typed into Stripe's hosted fields, which confirm a SetupIntent
 * in the browser. An automated run cannot type into that frame, so this script does the same
 * confirmation from the server side, using the processor connection already saved in the
 * application. It refuses to run against a live key.
 *
 * Usage (from packages/server):
 *   npx tsx scripts/e2e-confirm-test-card.ts <charging-level> <tenant-id|-> <business-id|-> <client-secret> [test-method]
 *
 *   charging-level  whose processor account holds the method: platform (a tenant's card),
 *                   tenant (a business's card) or business (a customer's card)
 *   client-secret   the clientSecret returned by POST /api/v1/pay/methods/capture-session
 *   test-method     pm_card_visa (default), pm_card_mastercard, pm_card_chargeCustomerFail ...
 *
 * Prints the payment method id on the last line, for POST /api/v1/pay/methods
 * ({ capture_payload: { paymentMethodId } }).
 */

import Stripe from 'stripe';
import { adminPool } from '../src/db/pool';
import { getDecryptedSecrets } from '../src/services/processor-config.service';

async function main() {
  const [level, tenantArg, businessArg, clientSecret, testMethod = 'pm_card_visa'] = process.argv.slice(2);
  if (!['platform', 'tenant', 'business'].includes(level) || !clientSecret) {
    throw new Error('Usage: e2e-confirm-test-card.ts <platform|tenant|business> <tenant-id|-> <business-id|-> <client-secret> [test-method]');
  }
  const secrets = await getDecryptedSecrets({
    ownerLevel: level as any,
    tenantId: tenantArg === '-' ? null : tenantArg,
    businessId: businessArg === '-' ? null : businessArg,
  });
  const key = secrets.secret_key || '';
  if (!key.startsWith('sk_test_')) throw new Error('This helper only runs against a Stripe TEST key');
  if (!/^pm_(card|usBankAccount|sepa)/.test(testMethod) && !testMethod.startsWith('pm_')) throw new Error('Unknown test method');

  const stripe = new Stripe(key);
  const setupIntentId = clientSecret.split('_secret_')[0];
  const intent = await stripe.setupIntents.confirm(setupIntentId, { payment_method: testMethod });
  if (intent.status !== 'succeeded') throw new Error(`SetupIntent is ${intent.status}`);
  console.log(typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id);
}

main()
  .then(() => adminPool.end())
  .catch(async (err) => { console.error('FAILED:', err.message); await adminPool.end(); process.exit(1); });
