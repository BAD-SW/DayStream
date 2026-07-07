import { adminPool } from '../db/pool';

/**
 * Get the current streak record for a customer.
 */
export async function getStreak(tenantId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM eng_customer_streaks WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId],
  );
  return rows[0] || null;
}

/**
 * Update streak on check-in. Increments if within the next week,
 * resets if gap > 1 week (unless a freeze is available).
 * Creates the record if it doesn't exist.
 */
export async function updateStreak(tenantId: string, customerId: string) {
  const now = new Date();
  // Get Monday of the current ISO week
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const currentWeekStart = new Date(now.getFullYear(), now.getMonth(), diff);
  const currentWeekStr = currentWeekStart.toISOString().slice(0, 10);

  const existing = await getStreak(tenantId, customerId);

  if (!existing) {
    // First check-in ever
    const { rows } = await adminPool.query(
      `INSERT INTO eng_customer_streaks (tenant_id, customer_id, current_streak, longest_streak, last_activity_week)
       VALUES ($1, $2, 1, 1, $3)
       ON CONFLICT (tenant_id, customer_id) DO UPDATE
         SET current_streak = 1, longest_streak = GREATEST(eng_customer_streaks.longest_streak, 1), last_activity_week = $3
       RETURNING *`,
      [tenantId, customerId, currentWeekStr],
    );
    return rows[0];
  }

  // Already checked in this week
  if (existing.last_activity_week && existing.last_activity_week.toISOString().slice(0, 10) === currentWeekStr) {
    return existing;
  }

  // Calculate gap in weeks
  const lastWeek = existing.last_activity_week ? new Date(existing.last_activity_week) : null;
  let gapWeeks = 0;
  if (lastWeek) {
    gapWeeks = Math.round((currentWeekStart.getTime() - lastWeek.getTime()) / (7 * 24 * 60 * 60 * 1000));
  }

  if (gapWeeks === 1) {
    // Consecutive week — increment
    const newStreak = existing.current_streak + 1;
    const { rows } = await adminPool.query(
      `UPDATE eng_customer_streaks
       SET current_streak = $3, longest_streak = GREATEST(longest_streak, $3), last_activity_week = $4
       WHERE tenant_id = $1 AND customer_id = $2
       RETURNING *`,
      [tenantId, customerId, newStreak, currentWeekStr],
    );
    return rows[0];
  } else if (gapWeeks > 1 && existing.streak_freezes_remaining > 0) {
    // Gap but freeze available — use freeze and continue streak
    const newStreak = existing.current_streak + 1;
    const { rows } = await adminPool.query(
      `UPDATE eng_customer_streaks
       SET current_streak = $3, longest_streak = GREATEST(longest_streak, $3),
           last_activity_week = $4, streak_freezes_remaining = streak_freezes_remaining - 1
       WHERE tenant_id = $1 AND customer_id = $2
       RETURNING *`,
      [tenantId, customerId, newStreak, currentWeekStr],
    );
    return rows[0];
  } else {
    // Gap > 1 week, no freeze — reset
    const { rows } = await adminPool.query(
      `UPDATE eng_customer_streaks
       SET current_streak = 1, last_activity_week = $3
       WHERE tenant_id = $1 AND customer_id = $2
       RETURNING *`,
      [tenantId, customerId, currentWeekStr],
    );
    return rows[0];
  }
}

/**
 * Manually use a streak freeze (grants protection for one missed week).
 */
export async function useStreakFreeze(tenantId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `UPDATE eng_customer_streaks
     SET streak_freezes_remaining = GREATEST(streak_freezes_remaining - 1, 0)
     WHERE tenant_id = $1 AND customer_id = $2 AND streak_freezes_remaining > 0
     RETURNING *`,
    [tenantId, customerId],
  );
  if (rows.length === 0) {
    throw new Error('No streak freezes available');
  }
  return rows[0];
}
