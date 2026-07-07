import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * Get credit balance and transaction history for a membership.
 */
export async function getCreditInfo(membershipId: string) {
  const { rows: membershipRows } = await adminPool.query(
    'SELECT credit_balance FROM mem_memberships WHERE id = $1',
    [membershipId],
  );
  if (membershipRows.length === 0) return null;

  const { rows: transactions } = await adminPool.query(
    'SELECT * FROM mem_credit_transactions WHERE membership_id = $1 ORDER BY created_at DESC LIMIT 50',
    [membershipId],
  );

  return {
    balance: membershipRows[0].credit_balance,
    transactions,
  };
}

/**
 * Deduct credits from a membership (FIFO — oldest first).
 * Called when a booking is confirmed.
 */
export async function deductCredits(
  membershipId: string,
  amount: number,
  bookingId?: string,
  description?: string,
): Promise<{ success: boolean; balance_after?: number; error?: string }> {
  // Get current balance
  const { rows } = await adminPool.query(
    'SELECT credit_balance FROM mem_memberships WHERE id = $1',
    [membershipId],
  );
  if (rows.length === 0) return { success: false, error: 'Membership not found' };

  const currentBalance = rows[0].credit_balance;
  if (currentBalance < amount) {
    return { success: false, error: 'Insufficient credits' };
  }

  const newBalance = currentBalance - amount;

  // Update balance
  await adminPool.query(
    'UPDATE mem_memberships SET credit_balance = $2, updated_at = NOW() WHERE id = $1',
    [membershipId, newBalance],
  );

  // Record transaction
  await adminPool.query(
    `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description, booking_id)
     VALUES ($1, 'deducted', $2, $3, $4, $5)`,
    [membershipId, -amount, newBalance, description || 'Credit deduction', bookingId || null],
  );

  return { success: true, balance_after: newBalance };
}

/**
 * Restore credits to a membership.
 * Called when a booking is cancelled within the free cancellation window.
 */
export async function restoreCredits(
  membershipId: string,
  amount: number,
  bookingId?: string,
  description?: string,
): Promise<{ success: boolean; balance_after?: number; error?: string }> {
  const { rows } = await adminPool.query(
    'SELECT credit_balance FROM mem_memberships WHERE id = $1',
    [membershipId],
  );
  if (rows.length === 0) return { success: false, error: 'Membership not found' };

  const newBalance = rows[0].credit_balance + amount;

  await adminPool.query(
    'UPDATE mem_memberships SET credit_balance = $2, updated_at = NOW() WHERE id = $1',
    [membershipId, newBalance],
  );

  await adminPool.query(
    `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description, booking_id)
     VALUES ($1, 'restored', $2, $3, $4, $5)`,
    [membershipId, amount, newBalance, description || 'Credit restored (booking cancelled)', bookingId || null],
  );

  return { success: true, balance_after: newBalance };
}

/**
 * Manually adjust credits (admin action).
 */
export async function adjustCredits(
  membershipId: string,
  amount: number, // positive = add, negative = remove
  description: string,
): Promise<{ success: boolean; balance_after?: number; error?: string }> {
  const { rows } = await adminPool.query(
    'SELECT credit_balance FROM mem_memberships WHERE id = $1',
    [membershipId],
  );
  if (rows.length === 0) return { success: false, error: 'Membership not found' };

  const newBalance = rows[0].credit_balance + amount;
  if (newBalance < 0) return { success: false, error: 'Adjustment would result in negative balance' };

  await adminPool.query(
    'UPDATE mem_memberships SET credit_balance = $2, updated_at = NOW() WHERE id = $1',
    [membershipId, newBalance],
  );

  await adminPool.query(
    `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description)
     VALUES ($1, 'adjusted', $2, $3, $4)`,
    [membershipId, amount, newBalance, description],
  );

  return { success: true, balance_after: newBalance };
}

/**
 * Allocate credits on renewal (called by billing job).
 */
export async function allocateCredits(membershipId: string, amount: number, validityDays?: number): Promise<number> {
  const { rows } = await adminPool.query(
    'SELECT credit_balance FROM mem_memberships WHERE id = $1',
    [membershipId],
  );
  if (rows.length === 0) return 0;

  const newBalance = rows[0].credit_balance + amount;

  await adminPool.query(
    'UPDATE mem_memberships SET credit_balance = $2, updated_at = NOW() WHERE id = $1',
    [membershipId, newBalance],
  );

  const expiresAt = validityDays
    ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000)
    : null;

  await adminPool.query(
    `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description, expires_at)
     VALUES ($1, 'allocated', $2, $3, 'Cycle credit allocation', $4)`,
    [membershipId, amount, newBalance, expiresAt ? expiresAt.toISOString() : null],
  );

  return newBalance;
}

/**
 * Process rollover at cycle end.
 * Called before allocating new cycle credits.
 */
export async function processRollover(
  membershipId: string,
  rolloverPolicy: string,
  maxRollover: number | null,
): Promise<{ expired: number; rolled_over: number }> {
  const { rows } = await adminPool.query(
    'SELECT credit_balance FROM mem_memberships WHERE id = $1',
    [membershipId],
  );
  if (rows.length === 0) return { expired: 0, rolled_over: 0 };

  const currentBalance = rows[0].credit_balance;

  if (rolloverPolicy === 'none') {
    // Expire all remaining credits
    if (currentBalance > 0) {
      await adminPool.query(
        'UPDATE mem_memberships SET credit_balance = 0, updated_at = NOW() WHERE id = $1',
        [membershipId],
      );
      await adminPool.query(
        `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description)
         VALUES ($1, 'expired', $2, 0, 'End of cycle - no rollover')`,
        [membershipId, -currentBalance],
      );
    }
    return { expired: currentBalance, rolled_over: 0 };
  }

  if (rolloverPolicy === 'limited' && maxRollover !== null) {
    const toExpire = Math.max(0, currentBalance - maxRollover);
    if (toExpire > 0) {
      const newBalance = currentBalance - toExpire;
      await adminPool.query(
        'UPDATE mem_memberships SET credit_balance = $2, updated_at = NOW() WHERE id = $1',
        [membershipId, newBalance],
      );
      await adminPool.query(
        `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description)
         VALUES ($1, 'expired', $2, $3, 'Rollover limit exceeded')`,
        [membershipId, -toExpire, newBalance],
      );
      // Record rollover
      await adminPool.query(
        `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description)
         VALUES ($1, 'rollover', $2, $2, 'Credits rolled over to new cycle')`,
        [membershipId, newBalance],
      );
      return { expired: toExpire, rolled_over: newBalance };
    }
    // All fit within limit
    if (currentBalance > 0) {
      await adminPool.query(
        `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description)
         VALUES ($1, 'rollover', $2, $2, 'Credits rolled over to new cycle')`,
        [membershipId, currentBalance],
      );
    }
    return { expired: 0, rolled_over: currentBalance };
  }

  // Unlimited rollover — just log it
  if (currentBalance > 0) {
    await adminPool.query(
      `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description)
       VALUES ($1, 'rollover', $2, $2, 'Credits rolled over (unlimited)')`,
      [membershipId, currentBalance],
    );
  }
  return { expired: 0, rolled_over: currentBalance };
}

/**
 * Expire credits past their validity period (scheduled job).
 */
export async function expireStaleCredits(): Promise<number> {
  // Find allocated credits that have expired
  const { rows: expiredAllocations } = await adminPool.query(
    `SELECT ct.membership_id, ct.amount, ct.id
     FROM mem_credit_transactions ct
     WHERE ct.type = 'allocated' AND ct.expires_at IS NOT NULL AND ct.expires_at < NOW()
       AND NOT EXISTS (
         SELECT 1 FROM mem_credit_transactions ct2
         WHERE ct2.membership_id = ct.membership_id AND ct2.type = 'expired'
           AND ct2.description LIKE '%expired allocation%' AND ct2.created_at > ct.created_at
       )`,
  );

  let totalExpired = 0;
  for (const alloc of expiredAllocations) {
    // Only expire if balance is positive
    const { rows: mbr } = await adminPool.query(
      'SELECT credit_balance FROM mem_memberships WHERE id = $1 AND credit_balance > 0',
      [alloc.membership_id],
    );
    if (mbr.length === 0) continue;

    const toExpire = Math.min(alloc.amount, mbr[0].credit_balance);
    if (toExpire <= 0) continue;

    const newBalance = mbr[0].credit_balance - toExpire;
    await adminPool.query(
      'UPDATE mem_memberships SET credit_balance = $2, updated_at = NOW() WHERE id = $1',
      [alloc.membership_id, newBalance],
    );
    await adminPool.query(
      `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description)
       VALUES ($1, 'expired', $2, $3, 'Expired allocation (validity period passed)')`,
      [alloc.membership_id, -toExpire, newBalance],
    );
    totalExpired += toExpire;
  }

  if (totalExpired > 0) logger.info('Stale credits expired', { totalExpired });
  return totalExpired;
}
