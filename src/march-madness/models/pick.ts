import { pool } from '../../shared/models/database';
import { Pick, CreatePickInput, UpdatePickInput } from '../types/pick';
import { TournamentRound } from '../types/pool';

/**
 * Get all picks for a participant
 */
export async function getPicksByParticipant(participantId: string): Promise<Pick[]> {
  const result = await pool.query(
    'SELECT * FROM picks WHERE participant_id = $1 ORDER BY submitted_at ASC',
    [participantId]
  );
  return result.rows;
}

/**
 * Get all picks for a pool and round
 */
export async function getPicksByPoolAndRound(
  poolId: string,
  round: TournamentRound
): Promise<Pick[]> {
  const result = await pool.query(
    'SELECT * FROM picks WHERE pool_id = $1 AND round = $2 ORDER BY submitted_at ASC',
    [poolId, round]
  );
  return result.rows;
}

/**
 * Get pick by participant and round
 */
export async function getPickByParticipantAndRound(
  participantId: string,
  round: TournamentRound
): Promise<Pick | null> {
  const result = await pool.query(
    'SELECT * FROM picks WHERE participant_id = $1 AND round = $2',
    [participantId, round]
  );
  return result.rows[0] || null;
}

/**
 * Get pick by ID
 */
export async function getPickById(id: string): Promise<Pick | null> {
  const result = await pool.query('SELECT * FROM picks WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Create or update a pick (upsert)
 */
export async function createOrUpdatePick(input: CreatePickInput): Promise<Pick> {
  const result = await pool.query(
    `INSERT INTO picks (participant_id, pool_id, round, team_name, team_seed, result)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (participant_id, round)
     DO UPDATE SET
       team_name = EXCLUDED.team_name,
       team_seed = EXCLUDED.team_seed,
       updated_at = NOW()
     RETURNING *`,
    [
      input.participant_id,
      input.pool_id,
      input.round,
      input.team_name,
      input.team_seed || null,
    ]
  );

  return result.rows[0];
}

/**
 * Update pick
 */
export async function updatePick(id: string, input: UpdatePickInput): Promise<Pick | null> {
  const updates: string[] = ['updated_at = NOW()'];
  const values: any[] = [];
  let paramCount = 1;

  if (input.team_name !== undefined) {
    updates.push(`team_name = $${paramCount++}`);
    values.push(input.team_name);
  }
  if (input.team_seed !== undefined) {
    updates.push(`team_seed = $${paramCount++}`);
    values.push(input.team_seed);
  }
  if (input.result !== undefined) {
    updates.push(`result = $${paramCount++}`);
    values.push(input.result);
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE picks SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

/**
 * Delete pick
 */
export async function deletePick(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM picks WHERE id = $1', [id]);
  return result.rowCount ? result.rowCount > 0 : false;
}

/**
 * Check if a participant has already used a team
 */
export async function hasParticipantUsedTeam(
  participantId: string,
  teamName: string
): Promise<boolean> {
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM picks WHERE participant_id = $1 AND team_name = $2',
    [participantId, teamName]
  );
  return parseInt(result.rows[0].count) > 0;
}

/**
 * Get all teams used by a participant
 */
export async function getTeamsUsedByParticipant(participantId: string): Promise<string[]> {
  const result = await pool.query(
    'SELECT team_name FROM picks WHERE participant_id = $1',
    [participantId]
  );
  return result.rows.map((row) => row.team_name);
}
