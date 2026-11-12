import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
});

describe('link codes (a public link must not be guessable)', () => {
  it('accepts only long random booking codes', async () => {
    const { isLinkCode } = await import('../src/services/checkin-qr.service');
    expect(isLinkCode(`DSCI-${'a1b2c3d4'.repeat(3)}`)).toBe(true);
    // The short codes printed on QR codes are far too easy to guess for a public link.
    expect(isLinkCode('DSCI-a1b2c3')).toBe(false);
    // The permanent customer code is never used in a link.
    expect(isLinkCode(`DSCC-${'a1b2c3d4'.repeat(3)}`)).toBe(false);
    expect(isLinkCode('DSCI-' + 'z'.repeat(24))).toBe(false);
    expect(isLinkCode('')).toBe(false);
    expect(isLinkCode(undefined as unknown as string)).toBe(false);
  });
});

describe('kiosk session', () => {
  const ctx = { tenantId: 't1', businessId: 'b1', customerId: 'c1', bookingId: 'k1' };

  it('round-trips, and cannot be read, changed or made up by the tablet', async () => {
    const { createSession, readSession } = await import('../src/services/self-check-in.service');
    const token = createSession(ctx);
    expect(readSession(token)).toEqual(ctx);
    expect(readSession(token.slice(0, -2) + 'ab')).toBeNull();
    expect(readSession('nonsense')).toBeNull();
    expect(readSession(undefined)).toBeNull();
    expect(readSession(JSON.stringify(ctx))).toBeNull();
  });

  it('expires', async () => {
    const { createSession, readSession } = await import('../src/services/self-check-in.service');
    const token = createSession(ctx);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 31 * 60 * 1000;
      expect(readSession(token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});
