import { pool } from '../../shared/models/database';
import { Pool, CreatePoolInput, UpdatePoolInput } from '../types/pool';

/**
 * Get the current active pool (assumes single pool for now)
 */
export async function getCurrentPool(): Promise<Pool | null> {
  const result = await pool.query(
    `SELECT * FROM pools
     WHERE status IN ('setup', 'active')
     ORDER BY created_at DESC
     LIMIT 1`
  );

  return result.rows[0] || null;
}

/**
 * Get pool by ID
 */
export async function getPoolById(id: string): Promise<Pool | null> {
  const result = await pool.query('SELECT * FROM pools WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Create a new pool
 */
export async function createPool(input: CreatePoolInput): Promise<Pool> {
  const result = await pool.query(
    `INSERT INTO pools (name, sport, entry_fee, slack_channel_id, admin_slack_id, status)
     VALUES ($1, $2, $3, $4, $5, 'setup')
     RETURNING *`,
    [
      input.name,
      input.sport || 'NCAA Basketball',
      input.entry_fee || null,
      input.slack_channel_id,
      input.admin_slack_id,
    ]
  );

  return result.rows[0];
}

/**
 * Update pool
 */
export async function updatePool(id: string, input: UpdatePoolInput): Promise<Pool | null> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(input.name);
  }
  if (input.status !== undefined) {
    updates.push(`status = $${paramCount++}`);
    values.push(input.status);

    // Set started_at when status changes to active
    if (input.status === 'active') {
      updates.push(`started_at = NOW()`);
    }
    // Set completed_at when status changes to completed
    if (input.status === 'completed') {
      updates.push(`completed_at = NOW()`);
    }
  }
  if (input.current_round !== undefined) {
    updates.push(`current_round = $${paramCount++}`);
    values.push(input.current_round);
  }
  if (input.entry_fee !== undefined) {
    updates.push(`entry_fee = $${paramCount++}`);
    values.push(input.entry_fee);
  }

  if (updates.length === 0) {
    return getPoolById(id);
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE pools SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

/**
 * Delete pool
 */
export async function deletePool(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM pools WHERE id = $1', [id]);
  return result.rowCount ? result.rowCount > 0 : false;
}

/**
 * Get all pools (for future multi-pool support)
 */
export async function getAllPools(): Promise<Pool[]> {
  const result = await pool.query('SELECT * FROM pools ORDER BY created_at DESC');
  return result.rows;
}
