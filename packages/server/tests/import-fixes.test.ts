import { describe, it, expect } from 'vitest';
import { parseDateCell, detectDateOrder, customerMatchInput } from '../src/services/migration/import-core';
import { appointmentStart, isNotHappening } from '../src/services/migration/appointment-import';
import { balanceImportKey } from '../src/services/migration/account-balance-import';

describe('dates — day-first and month-first', () => {
  it('reads ISO dates regardless of order', () => {
    expect(parseDateCell('2026-03-15', 'dmy')).toBe('2026-03-15');
    expect(parseDateCell('2026-03-15', 'mdy')).toBe('2026-03-15');
  });
  it('reads the same digits differently by order', () => {
    expect(parseDateCell('05/04/2026', 'mdy')).toBe('2026-05-04'); // May 4
    expect(parseDateCell('05/04/2026', 'dmy')).toBe('2026-04-05'); // 5 April
  });
  it('accepts a day-first date that month-first rejects', () => {
    expect(parseDateCell('15/03/2026', 'dmy')).toBe('2026-03-15');
    expect(parseDateCell('15/03/2026', 'mdy')).toBeNull();
  });
  it('accepts dots and dashes as separators', () => {
    expect(parseDateCell('15.03.2026', 'dmy')).toBe('2026-03-15');
    expect(parseDateCell('3-15-2026', 'mdy')).toBe('2026-03-15');
  });
  it('expands two-digit years: near future is 20xx, otherwise 19xx (birth dates)', () => {
    const nextYY = String((new Date().getUTCFullYear() + 1) % 100).padStart(2, '0');
    expect(parseDateCell(`03/04/${nextYY}`, 'mdy')).toBe(`20${nextYY}-03-04`);
    expect(parseDateCell('05/03/67', 'mdy')).toBe('1967-05-03');
  });
  it('rejects impossible dates', () => {
    expect(parseDateCell('31/02/2026', 'dmy')).toBeNull();
    expect(parseDateCell('2026-13-01', 'dmy')).toBeNull();
  });
  it('still reads written-out dates', () => {
    expect(parseDateCell('15 March 2026', 'dmy')).toBe('2026-03-15');
  });
});

describe('detectDateOrder — working the order out from a file', () => {
  it('a first part over 12 means day-first', () => {
    expect(detectDateOrder(['05/04/2026', '15/03/2026', '01/02/2026'])).toBe('dmy');
  });
  it('a second part over 12 means month-first', () => {
    expect(detectDateOrder(['05/04/2026', '3/15/2026'])).toBe('mdy');
  });
  it('cannot tell when every part is 12 or under, or the file contradicts itself', () => {
    expect(detectDateOrder(['05/04/2026', '01/02/2026'])).toBeNull();
    expect(detectDateOrder(['15/03/2026', '3/15/2026'])).toBeNull();
    expect(detectDateOrder(['2026-03-15', 'Visa', ''])).toBeNull();
  });
});

describe('appointments — business time zone', () => {
  it('reads the time as Madrid wall-clock time (summer, UTC+2)', () => {
    expect(appointmentStart('2026-07-10', 14 * 60 + 30, 'Europe/Madrid').toISOString()).toBe('2026-07-10T12:30:00.000Z');
  });
  it('reads the time as Madrid wall-clock time (winter, UTC+1)', () => {
    expect(appointmentStart('2026-01-10', 14 * 60 + 30, 'Europe/Madrid').toISOString()).toBe('2026-01-10T13:30:00.000Z');
  });
  it('reads New York time and defaults a blank time to local noon', () => {
    expect(appointmentStart('2026-07-10', 9 * 60, 'America/New_York').toISOString()).toBe('2026-07-10T13:00:00.000Z');
    expect(appointmentStart('2026-07-10', null, 'America/New_York').toISOString()).toBe('2026-07-10T16:00:00.000Z');
  });
});

describe('appointments — statuses that mean it will not happen', () => {
  it('recognises cancelled and no-show in their usual spellings', () => {
    for (const s of ['cancelled', 'Canceled', 'No Show', 'no_show', 'no-show', 'Late Cancel', 'missed']) {
      expect(isNotHappening(s)).toBe(true);
    }
  });
  it('treats booked statuses and blank as happening', () => {
    for (const s of ['', 'confirmed', 'Booked', 'pending', 'checked in']) expect(isNotHappening(s)).toBe(false);
  });
});

describe('account balances — import key', () => {
  const base = { kind: 'credit' as const, customerId: 'c1', amountCents: 4500, description: 'Gift' };
  it('is the same for the same balance (re-import detected), ignoring spacing and capitals', () => {
    expect(balanceImportKey(base)).toBe(balanceImportKey({ ...base, description: '  gift ' }));
  });
  it('differs when anything that defines the balance differs', () => {
    const k = balanceImportKey(base);
    expect(balanceImportKey({ ...base, amountCents: 4600 })).not.toBe(k);
    expect(balanceImportKey({ ...base, customerId: 'c2' })).not.toBe(k);
    expect(balanceImportKey({ ...base, kind: 'invoice', issueDate: '2026-03-01' })).not.toBe(k);
  });
  it('fits the column', () => {
    expect(balanceImportKey({ ...base, description: 'x'.repeat(2000) }).length).toBeLessThanOrEqual(255);
  });
});

describe('customer matching keys', () => {
  it('every customer-linked import offers the processor customer id first', () => {
    expect(customerMatchInput({ processor_customer_id: 'cus_1', legacy_customer_id: 'L1', email: 'a@x.com' })).toEqual({
      processorCustomerIds: ['cus_1'], legacyCustomerId: 'L1', email: 'a@x.com', phone: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// Headerless memberships: values matched against the business's own data
// ---------------------------------------------------------------------------
import { detectColumns, PAYMENT_METHOD_FIELDS, ReferenceSet, futureDateShare } from '../src/services/migration/import-engine';
import { normalizeRefName } from '../src/services/migration/import-core';

// Mirrors the memberships field list in routes/import.ts (synonyms don't matter header-less).
const MEMBERSHIP_FIELDS = [
  { field: 'legacy_customer_id', synonyms: ['legacyid', 'customerid'] },
  { field: 'processor_customer_id', synonyms: ['processorcustomerid'] },
  { field: 'email', synonyms: ['email'], valueKinds: ['email' as const] },
  { field: 'phone', synonyms: ['phone'], valueKinds: ['phone' as const] },
  { field: 'plan', synonyms: ['plan'] },
  { field: 'next_billing_date', synonyms: ['nextbillingdate'], valueKinds: ['date' as const] },
  { field: 'status', synonyms: ['status'] },
  { field: 'start_date', synonyms: ['startdate'] },
];
const idNorm = (v: string) => v.trim().toLowerCase();
const refs = (ids: string[], plans: string[] = []): ReferenceSet => ({
  legacy_customer_id: { values: new Set(ids.map(idNorm)), normalize: idNorm },
  ...(plans.length ? { plan: { values: new Set(plans.map(normalizeRefName)), normalize: normalizeRefName } } : {}),
});
const mapWith = (grid: string[][], references: ReferenceSet, fields = MEMBERSHIP_FIELDS) => {
  const m: Record<string, number> = {};
  for (const p of detectColumns(grid, false, fields, references)) if (p.field) m[p.field] = p.index;
  return m;
};
const y = new Date().getUTCFullYear();
const past = (mmdd: string) => `${y - 2}-${mmdd}`;
const future = (mmdd: string) => `${y + 1}-${mmdd}`;

describe('memberships without a header — matched against the business\u2019s own data', () => {
  it('maps every column: stored customer ids, plan names, future vs past dates, status words', () => {
    const m = mapWith([
      ['9284', 'Optimize Monthly', future('02-01'), 'active', past('06-15')],
      ['58291', 'Recovery Plus', future('02-03'), 'Active', past('01-20')],
      ['619304', 'optimize monthly', future('02-07'), 'paused', past('11-02')],
      ['9284', 'Recovery Plus', future('02-09'), 'cancelled', past('03-30')],
    ], refs(['9284', '58291', '619304', '77777'], ['Optimize Monthly', 'Recovery Plus']));
    expect(m).toEqual({ legacy_customer_id: 0, plan: 1, next_billing_date: 2, status: 3, start_date: 4 });
  });

  it('tells the dates apart whichever comes first, despite a few exceptions', () => {
    const m = mapWith([
      ['9284', past('06-15'), future('02-01')],
      ['58291', past('01-20'), future('02-03')],
      ['619304', future('03-01'), past('12-30')],   // an exception in each column
      ['77777', past('03-30'), future('02-09')],
    ], refs(['9284', '58291', '619304', '77777']));
    expect(m.start_date).toBe(1);
    expect(m.next_billing_date).toBe(2);
  });

  it('a single mostly-past date column is the start date, not the next billing date', () => {
    const m = mapWith([
      ['9284', past('06-15')], ['58291', past('01-20')], ['619304', past('11-02')],
    ], refs(['9284', '58291', '619304']));
    expect(m.start_date).toBe(1);
    expect(m.next_billing_date).toBeUndefined();
  });

  it('finds a repeating bare-number customer id by matching stored ids (uniqueness can\u2019t)', () => {
    const m = mapWith([
      ['9284', 'Optimize Monthly', future('02-01')],
      ['9284', 'Recovery Plus', future('02-03')],
      ['58291', 'Optimize Monthly', future('02-07')],
    ], refs(['9284', '58291'], ['Optimize Monthly', 'Recovery Plus']));
    expect(m.legacy_customer_id).toBe(0);
  });

  it('prefers the column with the most distinct matching ids over a decoy that happens to match', () => {
    // Column 0 only holds 60 / 90 (a duration), and ids 60 and 90 exist; column 1 is the real id.
    const m = mapWith([
      ['60', '9284', future('02-01')], ['90', '58291', future('02-03')],
      ['60', '619304', future('02-07')], ['90', '77777', future('02-09')],
    ], refs(['60', '90', '9284', '58291', '619304', '77777']));
    expect(m.legacy_customer_id).toBe(1);
  });

  it('does not change payment-file detection (no reference sets passed)', () => {
    const grid = [['LEG-1', 'cus_Qa1B2c3D4e5F', 'pm_1Nx0aBcDeFgHiJkL'], ['LEG-2', 'cus_Qb9Z8y7X6w5V', 'pm_1Ny5kLmNoPqRsTuV']];
    const m = mapWith(grid, {}, PAYMENT_METHOD_FIELDS);
    expect(m.stripe_customer_id).toBe(1);
    expect(m.payment_method_token).toBe(2);
  });

  it('futureDateShare counts the share of dates after today', () => {
    expect(futureDateShare([future('01-01'), past('01-01'), future('05-05'), ''])).toBeCloseTo(2 / 3);
  });
});

// ---------------------------------------------------------------------------
// Header-less files for the other imports: matched against the business's setup
// ---------------------------------------------------------------------------
const nameRefOf = (names: string[]) => ({ values: new Set(names.map(normalizeRefName)), normalize: normalizeRefName });
const F = (field: string, valueKinds?: Array<'email' | 'phone' | 'date' | 'money'>) => ({ field, synonyms: [field.replace(/_/g, '')], ...(valueKinds ? { valueKinds } : {}) });
const CUSTOMER_KEYS = [F('legacy_customer_id'), F('processor_customer_id'), F('email', ['email']), F('phone', ['phone'])];

describe('other imports without a header — matched against setup', () => {
  it('packages: package names + purchase date', () => {
    const m = mapWith([
      [past('03-01'), 'RE9284A', '10 Float Pack'],
      [past('04-11'), 'DS83749', 'Sauna 5'],
      [past('05-20'), 'RE9284A', '10 float pack'],
    ], { ...refs(['RE9284A', 'DS83749']), package: nameRefOf(['10 Float Pack', 'Sauna 5']) },
    [...CUSTOMER_KEYS, F('package'), F('purchase_date', ['date'])]);
    expect(m).toEqual({ purchase_date: 0, legacy_customer_id: 1, package: 2 });
  });

  it('appointments: service, staff and service length from setup, time by shape, status by words', () => {
    const m = mapWith([
      ['RE9284A', 'Float Session', 'Nicole Santos', past('03-01'), '14:30', '60', 'completed'],
      ['DS83749', 'Infrared Sauna', 'Ana Ruiz', past('03-02'), '9:00 AM', '30', 'no show'],
      ['RE9284A', 'float session', 'Nicole Santos', future('01-05'), '16:00', '60', 'confirmed'],
    ], {
      ...refs(['RE9284A', 'DS83749', '60']),   // id "60" exists, but the real id column has more distinct hits
      service: nameRefOf(['Float Session', 'Infrared Sauna']),
      staff: nameRefOf(['Nicole Santos', 'Ana Ruiz']),
      duration: { values: new Set(['30', '60', '90']), normalize: (v: string) => String(Number(v.trim())) },
    }, [...CUSTOMER_KEYS, F('service'), F('staff'), F('date', ['date']), F('time'), F('duration'), F('status')]);
    expect(m).toEqual({ legacy_customer_id: 0, service: 1, staff: 2, date: 3, time: 4, duration: 5, status: 6 });
  });

  it('transactions: accepted payment methods, unique reference, amount and date', () => {
    const m = mapWith([
      ['RE9284A', past('03-01'), '45.00', 'Visa', 'RCPT-10021'],
      ['RE9284A', past('03-08'), '45.00', 'Cash', 'RCPT-10022'],
      ['DS83749', past('03-09'), '80.00', 'cheque', 'RCPT-10023'],
    ], { ...refs(['RE9284A', 'DS83749']), method: nameRefOf(['card', 'visa', 'cash', 'check', 'cheque']) },
    [...CUSTOMER_KEYS, F('date', ['date']), F('amount', ['money']), F('description'), F('method'), F('reference')]);
    expect(m).toEqual({ legacy_customer_id: 0, date: 1, amount: 2, method: 3, reference: 4 });
  });

  it('account balances: credit / invoice words, and the earlier date is the issue date', () => {
    const m = mapWith([
      ['RE9284A', 'invoice', '80.00', past('04-30'), past('04-01')],
      ['DS83749', 'credit', '25.00', past('05-31'), past('05-01')],
      ['NY39481', 'invoice', '120.00', past('07-15'), past('06-15')],
    ], refs(['RE9284A', 'DS83749', 'NY39481']),
    [...CUSTOMER_KEYS, F('type'), F('amount', ['money']), F('amount_paid', ['money']), F('description'), F('issue_date', ['date']), F('due_date', ['date'])]);
    expect(m.legacy_customer_id).toBe(0);
    expect(m.type).toBe(1);
    expect(m.amount).toBe(2);
    expect(m.issue_date).toBe(4);
    expect(m.due_date).toBe(3);
  });

  it('notes: staff as author (first name is enough), note categories, and the note text', () => {
    const m = mapWith([
      ['RE9284A', 'Prefers the lavender room and a quiet session', 'Nicole', 'Preferences', past('03-01')],
      ['DS83749', 'Mild knee injury, avoid deep pressure on the left side', 'Ana Ruiz', 'Medical', past('03-02')],
      ['RE9284A', 'Asked about the annual membership upgrade options', 'Nicole', 'Sales', past('03-09')],
    ], { ...refs(['RE9284A', 'DS83749']), author: nameRefOf(['Nicole Santos', 'Nicole', 'Ana Ruiz', 'Ana']), category: nameRefOf(['Preferences', 'Medical', 'Sales']) },
    [...CUSTOMER_KEYS, F('note'), F('date', ['date']), F('author'), F('category')]);
    expect(m).toEqual({ legacy_customer_id: 0, note: 1, author: 2, category: 3, date: 4 });
  });
});

// ---------------------------------------------------------------------------
// Customer matching: every key is checked, and keys that disagree fail the row
// ---------------------------------------------------------------------------
import { resolveCustomerMatch, MatchCandidate } from '../src/services/migration/import-core';

const cand = (id: string, name: string, flags: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id, name, byProcessor: false, byLegacy: false, byEmail: false, byPhone: false, ...flags,
});
const INPUT = { processorCustomerIds: ['cus_1'], legacyCustomerId: 'RE9284A', email: 'maria@x.com', phone: '+34600000000' };

describe('resolveCustomerMatch — keys that agree, disagree, or are shared', () => {
  it('keys that all point to the same customer resolve it (strongest key reported)', () => {
    const m = resolveCustomerMatch([cand('A', 'Ana Ruiz', { byLegacy: true, byEmail: true, byPhone: true })], INPUT);
    expect(m).toEqual({ customerId: 'A', matchedBy: 'legacy_id' });
  });

  it('a single key is enough, as before', () => {
    expect(resolveCustomerMatch([cand('A', 'Ana Ruiz', { byEmail: true })], INPUT)).toEqual({ customerId: 'A', matchedBy: 'email' });
  });

  it('keys pointing to different customers attach nobody and explain the conflict', () => {
    const m = resolveCustomerMatch([
      cand('A', 'Ana Ruiz', { byLegacy: true }),
      cand('M', 'Maria Lopez', { byEmail: true }),
    ], INPUT);
    expect(m.customerId).toBeNull();
    expect(m.conflict).toContain('legacy ID "RE9284A" matches Ana Ruiz');
    expect(m.conflict).toContain('email "maria@x.com" matches Maria Lopez');
  });

  it('a shared email (two customers) is ignored, not a conflict, when the legacy id is clear', () => {
    const m = resolveCustomerMatch([
      cand('A', 'Ana Ruiz', { byLegacy: true, byEmail: true }),
      cand('B', 'Ben Ruiz', { byEmail: true }),
    ], INPUT);
    expect(m).toEqual({ customerId: 'A', matchedBy: 'legacy_id' });
  });

  it('only shared keys resolve nobody (the row fails with the usual "no single customer" reason)', () => {
    const m = resolveCustomerMatch([cand('A', 'Ana', { byPhone: true }), cand('B', 'Ben', { byPhone: true })], INPUT);
    expect(m).toEqual({ customerId: null, matchedBy: null });
  });

  it('a processor id conflicting with the email is caught too', () => {
    const m = resolveCustomerMatch([cand('A', 'Ana Ruiz', { byProcessor: true }), cand('M', 'Maria Lopez', { byEmail: true })], INPUT);
    expect(m.conflict).toContain('processor customer ID "cus_1" matches Ana Ruiz');
  });
});
