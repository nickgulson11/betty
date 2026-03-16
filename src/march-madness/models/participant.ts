import { pool } from '../../shared/models/database';
import { Participant, CreateParticipantInput, UpdateParticipantInput } from '../types/participant';

/**
 * Get all participants for a pool
 */
export async function getParticipantsByPool(poolId: string): Promise<Participant[]> {
  const result = await pool.query(
    'SELECT * FROM participants WHERE pool_id = $1 ORDER BY joined_at ASC',
    [poolId]
  );
  return result.rows;
}

/**
 * Get participant by ID
 */
export async function getParticipantById(id: string): Promise<Participant | null> {
  const result = await pool.query('SELECT * FROM participants WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Get participant by Slack user ID and pool
 */
export async function getParticipantBySlackId(
  poolId: string,
  slackUserId: string
): Promise<Participant | null> {
  const result = await pool.query(
    'SELECT * FROM participants WHERE pool_id = $1 AND slack_user_id = $2',
    [poolId, slackUserId]
  );
  return result.rows[0] || null;
}

/**
 * Create a new participant
 * Status defaults to 'pending' until they pay
 */
export async function createParticipant(input: CreateParticipantInput): Promise<Participant> {
  const result = await pool.query(
    `INSERT INTO participants (pool_id, slack_user_id, slack_username, status, paid)
     VALUES ($1, $2, $3, 'pending', false)
     RETURNING *`,
    [input.pool_id, input.slack_user_id, input.slack_username || null]
  );

  return result.rows[0];
}

/**
 * Update participant
 */
export async function updateParticipant(
  id: string,
  input: UpdateParticipantInput
): Promise<Participant | null> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (input.slack_username !== undefined) {
    updates.push(`slack_username = $${paramCount++}`);
    values.push(input.slack_username);
  }
  if (input.status !== undefined) {
    updates.push(`status = $${paramCount++}`);
    values.push(input.status);

    // Set eliminated_at when status changes to eliminated
    if (input.status === 'eliminated') {
      updates.push(`eliminated_at = NOW()`);
    }
  }
  if (input.eliminated_round !== undefined) {
    updates.push(`eliminated_round = $${paramCount++}`);
    values.push(input.eliminated_round);
  }
  if (input.eliminated_team !== undefined) {
    updates.push(`eliminated_team = $${paramCount++}`);
    values.push(input.eliminated_team);
  }
  if (input.paid !== undefined) {
    updates.push(`paid = $${paramCount++}`);
    values.push(input.paid);

    // Set paid_at when paid changes to true
    if (input.paid) {
      updates.push(`paid_at = NOW()`);
    }
  }
  if (input.seed_sum !== undefined) {
    updates.push(`seed_sum = $${paramCount++}`);
    values.push(input.seed_sum);
  }
  if (updates.length === 0) {
    return getParticipantById(id);
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE participants SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

/**
 * Delete participant
 */
export async function deleteParticipant(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM participants WHERE id = $1', [id]);
  return result.rowCount ? result.rowCount > 0 : false;
}

/**
 * Get active participants for a pool
 */
export async function getActiveParticipants(poolId: string): Promise<Participant[]> {
  const result = await pool.query(
    `SELECT * FROM participants
     WHERE pool_id = $1 AND status = 'active'
     ORDER BY joined_at ASC`,
    [poolId]
  );
  return result.rows;
}

/**
 * Get eliminated participants for a pool
 */
export async function getEliminatedParticipants(poolId: string): Promise<Participant[]> {
  const result = await pool.query(
    `SELECT * FROM participants
     WHERE pool_id = $1 AND status = 'eliminated'
     ORDER BY eliminated_at DESC`,
    [poolId]
  );
  return result.rows;
}
