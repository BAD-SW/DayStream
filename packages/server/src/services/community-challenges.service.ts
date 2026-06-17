import { adminPool } from '../db/pool';

/**
 * Get challenges for a tenant, optionally filtered by status.
 */
export async function getChallenges(tenantId: string, status?: string) {
  let query = `SELECT * FROM challenges WHERE tenant_id = $1`;
  const params: any[] = [tenantId];

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  query += ` ORDER BY start_date DESC`;
  const { rows } = await adminPool.query(query, params);
  return rows;
}

/**
 * Create a new challenge.
 */
export async function createChallenge(tenantId: string, input: {
  title: string;
  description?: string;
  challengeType: string;
  goalConfig: Record<string, any>;
  startDate: string;
  endDate: string;
  rewardConfig?: Record<string, any>;
  capacity?: number;
  imagePath?: string;
  isRecurring?: boolean;
  status?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO challenges (tenant_id, title, description, challenge_type, goal_config, start_date, end_date, reward_config, capacity, image_path, is_recurring, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      tenantId,
      input.title,
      input.description || null,
      input.challengeType,
      JSON.stringify(input.goalConfig),
      input.startDate,
      input.endDate,
      JSON.stringify(input.rewardConfig || {}),
      input.capacity || null,
      input.imagePath || null,
      input.isRecurring ?? false,
      input.status || 'active',
    ],
  );
  return rows[0];
}

/**
 * Join a challenge.
 */
export async function joinChallenge(challengeId: string, customerId: string, goalTarget: number) {
  const { rows } = await adminPool.query(
    `INSERT INTO challenge_participants (challenge_id, customer_id, goal_target)
     VALUES ($1, $2, $3) RETURNING *`,
    [challengeId, customerId, goalTarget],
  );
  return rows[0];
}

/**
 * Update progress for a participant. If progress >= goal_target, mark as completed.
 */
export async function updateProgress(challengeId: string, customerId: string, increment: number) {
  const { rows } = await adminPool.query(
    `UPDATE challenge_participants
     SET progress = progress + $3,
         status = CASE WHEN progress + $3 >= goal_target THEN 'completed' ELSE status END,
         completed_at = CASE WHEN progress + $3 >= goal_target AND completed_at IS NULL THEN NOW() ELSE completed_at END
     WHERE challenge_id = $1 AND customer_id = $2 AND status = 'active'
     RETURNING *`,
    [challengeId, customerId, increment],
  );
  return rows[0] || null;
}

/**
 * Get leaderboard for a challenge (ordered by progress descending).
 */
export async function getChallengeLeaderboard(challengeId: string) {
  const { rows } = await adminPool.query(
    `SELECT cp.*, c.first_name, c.last_name
     FROM challenge_participants cp
     JOIN customers c ON c.id = cp.customer_id
     WHERE cp.challenge_id = $1
     ORDER BY cp.progress DESC, cp.joined_at ASC`,
    [challengeId],
  );
  return rows;
}

/**
 * Get a customer's active challenges.
 */
export async function getMyActiveChallenges(tenantId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT ch.*, cp.progress, cp.goal_target, cp.status AS participant_status, cp.joined_at
     FROM challenge_participants cp
     JOIN challenges ch ON ch.id = cp.challenge_id
     WHERE ch.tenant_id = $1 AND cp.customer_id = $2 AND cp.status = 'active'
     ORDER BY ch.end_date ASC`,
    [tenantId, customerId],
  );
  return rows;
}
