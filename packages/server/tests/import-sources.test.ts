import { describe, it, expect } from 'vitest';
import { detectHeaderRow, detectColumns, PAYMENT_METHOD_FIELDS, CUSTOMER_FIELDS } from '../src/services/migration/import-engine';
import { applySourcePreset, isValidSource } from '../src/services/migration/import-sources';
import type { ImportSourceId } from '../src/services/migration/import-sources';

/** Analyze exactly as the endpoint does: header detection, automatic columns, then the source layout. */
const analyzeAs = (grid: string[][], source: ImportSourceId, fields = PAYMENT_METHOD_FIELDS) => {
  const hasHeader = detectHeaderRow(grid, fields).hasHeader;
  const { proposals, layout } = applySourcePreset(detectColumns(grid, hasHeader, fields), grid[0] ?? [], hasHeader, source);
  const map: Record<string, number> = {};
  for (const p of proposals) if (p.field) map[p.field] = p.index;
  return { map, layout };
};
const mapOf = (grid: string[][], source: ImportSourceId, fields = PAYMENT_METHOD_FIELDS) => analyzeAs(grid, source, fields).map;

const STRIPE_COPY_FILE = [
  ['customer_id_old', 'source_id_old', 'customer_id_new', 'source_id_new'],
  ['cus_AAA111', 'card_OLD111aaa', 'cus_AAA111', 'pm_NEW111aaa'],
  ['cus_BBB222', 'pm_OLD222bbb', 'cus_BBB222', 'pm_NEW222bbb'],
];

// Stripe's processor-import CSV mapping file, as documented by Stripe.
const STRIPE_IMPORT_FILE = [
  ['old_customer_id', 'customer_id', 'old_card_id', 'card_id', 'card_fingerprint', 'card_last4', 'card_exp_month', 'card_exp_year', 'card_brand'],
  ['old_cus_100', 'cus_abc123def456', 'old_src_100', 'card_2222222222', 'x9yW1WE4nLvl6zjg', '4242', '09', '2024', 'Visa'],
  ['old_cus_101', 'cus_bcd234efg567', 'old_src_101', 'card_3333333333', 'nZnMWbJBurX3VHIN', '0341', '06', '2027', 'Mastercard'],
];

describe('source systems — one "Stripe" choice, the file layout is recognised', () => {
  it("recognises and maps Stripe's processor-import file", () => {
    const { map, layout } = analyzeAs(STRIPE_IMPORT_FILE, 'stripe');
    expect(layout).toBe('Stripe import mapping file (from another processor)');
    expect(map).toEqual({
      previous_processor_customer_id: 0, stripe_customer_id: 1, payment_method_token: 3,
      last4: 5, exp_month: 6, exp_year: 7, brand: 8,
    });
  });

  it("recognises and maps Stripe's account-copy file (old payment id left unmapped)", () => {
    const { map, layout } = analyzeAs(STRIPE_COPY_FILE, 'stripe');
    expect(layout).toBe('Stripe account copy file');
    expect(map).toEqual({ previous_processor_customer_id: 0, stripe_customer_id: 2, payment_method_token: 3 });
  });

  it('recognises each Stripe file with its header removed, by width', () => {
    expect(analyzeAs(STRIPE_COPY_FILE.slice(1), 'stripe').layout).toBe('Stripe account copy file');
    const headerless = analyzeAs(STRIPE_IMPORT_FILE.slice(1), 'stripe');
    expect(headerless.layout).toBe('Stripe import mapping file (from another processor)');
    expect(headerless.map.payment_method_token).toBe(3);
  });

  it('reports no layout when a file chosen as Stripe matches neither Stripe file', () => {
    const grid = [
      ['LEG-1', 'cus_Qa1B2c3D4e5F', 'pm_1Nx0aBcDeFgHiJkL', 'Visa', '4242', '9', '2028'],
      ['LEG-2', 'cus_Qb9Z8y7X6w5V', 'pm_1Ny5kLmNoPqRsTuV', 'Mastercard', '1111', '12', '2027'],
    ];
    const asStripe = analyzeAs(grid, 'stripe');
    expect(asStripe.layout).toBeNull();
    expect(asStripe.map).toEqual(mapOf(grid, 'auto')); // automatic mapping kept
  });

  it('does not take a single shared column name as a Stripe layout', () => {
    // A custom file that happens to have a "customer_id" column is not Stripe's import file.
    const grid = [
      ['customer_id', 'email', 'stripe_customer_id', 'token'],
      ['LEG-1', 'a@x.com', 'cus_Qa1B2c3D4e5F', 'pm_1Nx0aBcDeFgHiJkL'],
      ['LEG-2', 'b@x.com', 'cus_Qb9Z8y7X6w5V', 'pm_1Ny5kLmNoPqRsTuV'],
    ];
    expect(analyzeAs(grid, 'stripe').layout).toBeNull();
  });

  it('without the preset, the previous processor id is mistaken for a legacy customer id (why the dropdown exists)', () => {
    const m = mapOf(STRIPE_IMPORT_FILE, 'auto');
    expect(m.legacy_customer_id).toBe(0);                     // old processor id read as a client number
    expect(m.previous_processor_customer_id).toBeUndefined(); // so the exact processor-id match is lost
  });

  it('validates a source against the import kind', () => {
    expect(isValidSource('auto', 'customers')).toBe(true);
    expect(isValidSource('stripe', 'payment_methods')).toBe(true);
    expect(isValidSource('stripe', 'customers')).toBe(false);
    expect(isValidSource('stripe_copy', 'payment_methods')).toBe(false); // internal layouts aren't choices
    expect(isValidSource('nonsense', 'payment_methods')).toBe(false);
  });
});

describe('customer files — processor customer id', () => {
  it('maps a cus_ column to Processor Customer ID by value, even with no header', () => {
    const m = mapOf([
      ['LEG-10001', 'cus_Qa1B2c3D4e5F', 'avery.morgan@example.com', 'Avery', 'Morgan'],
      ['LEG-10002', 'cus_Qb9Z8y7X6w5V', 'jordan.lee@example.com', 'Jordan', 'Lee'],
      ['LEG-10003', 'cus_Qc4T3s2R1q0P', 'isabella.davis@example.com', 'Isabella', 'Davis'],
    ], 'auto', CUSTOMER_FIELDS);
    expect(m.processor_customer_id).toBe(1);
    expect(m.legacy_customer_id).toBe(0);
    expect(m.email).toBe(2);
  });

  it('maps a "Stripe Customer ID" header to Processor Customer ID', () => {
    const m = mapOf([
      ['Client ID', 'Stripe Customer ID', 'Email', 'First Name'],
      ['LEG-10001', 'cus_Qa1B2c3D4e5F', 'avery.morgan@example.com', 'Avery'],
      ['LEG-10002', 'cus_Qb9Z8y7X6w5V', 'jordan.lee@example.com', 'Jordan'],
    ], 'auto', CUSTOMER_FIELDS);
    expect(m.processor_customer_id).toBe(1);
  });
});
