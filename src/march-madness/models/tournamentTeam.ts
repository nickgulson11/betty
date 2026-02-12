import { pool } from '../../shared/models/database';
import { TournamentTeam, CreateTeamInput, UpdateTeamInput } from '../types/tournamentTeam';
import { TournamentRound } from '../types/pool';

/**
 * Get all teams for a pool
 */
export async function getTeamsByPool(poolId: string): Promise<TournamentTeam[]> {
  const result = await pool.query(
    'SELECT * FROM tournament_teams WHERE pool_id = $1 ORDER BY region ASC, seed ASC, team_name ASC',
    [poolId]
  );
  return result.rows;
}

/**
 * Get only active (non-eliminated) teams for a pool
 */
export async function getActiveTeams(poolId: string): Promise<TournamentTeam[]> {
  const result = await pool.query(
    "SELECT * FROM tournament_teams WHERE pool_id = $1 AND status = 'active' ORDER BY region ASC, seed ASC, team_name ASC",
    [poolId]
  );
  return result.rows;
}

/**
 * Get a team by exact name (case-insensitive)
 */
export async function getTeamByName(poolId: string, teamName: string): Promise<TournamentTeam | null> {
  const result = await pool.query(
    'SELECT * FROM tournament_teams WHERE pool_id = $1 AND LOWER(team_name) = LOWER($2)',
    [poolId, teamName]
  );
  return result.rows[0] || null;
}

/**
 * Get a team by ID
 */
export async function getTeamById(id: string): Promise<TournamentTeam | null> {
  const result = await pool.query('SELECT * FROM tournament_teams WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Create a single team
 */
export async function createTeam(poolId: string, input: CreateTeamInput): Promise<TournamentTeam> {
  const result = await pool.query(
    `INSERT INTO tournament_teams (pool_id, team_name, seed, region, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING *`,
    [poolId, input.team_name, input.seed || null, input.region || null]
  );
  return result.rows[0];
}

/**
 * Bulk upsert teams — safe to re-run, won't create duplicates
 */
export async function bulkCreateTeams(
  poolId: string,
  teams: CreateTeamInput[]
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const team of teams) {
    const result = await pool.query(
      `INSERT INTO tournament_teams (pool_id, team_name, seed, region, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (pool_id, team_name)
       DO UPDATE SET
         seed = EXCLUDED.seed,
         region = EXCLUDED.region
       RETURNING (xmax = 0) AS inserted`,
      [poolId, team.team_name, team.seed || null, team.region || null]
    );
    if (result.rows[0]?.inserted) {
      inserted++;
    } else {
      updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Update a team's name, seed, or region
 */
export async function updateTeam(id: string, input: UpdateTeamInput): Promise<TournamentTeam | null> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (input.team_name !== undefined) {
    updates.push(`team_name = $${paramCount++}`);
    values.push(input.team_name);
  }
  if (input.seed !== undefined) {
    updates.push(`seed = $${paramCount++}`);
    values.push(input.seed);
  }
  if (input.region !== undefined) {
    updates.push(`region = $${paramCount++}`);
    values.push(input.region);
  }

  if (updates.length === 0) return getTeamById(id);

  values.push(id);
  const result = await pool.query(
    `UPDATE tournament_teams SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

/**
 * Mark a team as eliminated in a given round
 */
export async function markTeamEliminated(
  id: string,
  round: TournamentRound
): Promise<TournamentTeam | null> {
  const result = await pool.query(
    `UPDATE tournament_teams
     SET status = 'eliminated', eliminated_round = $1
     WHERE id = $2
     RETURNING *`,
    [round, id]
  );
  return result.rows[0] || null;
}

/**
 * Delete a single team
 */
export async function deleteTeam(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM tournament_teams WHERE id = $1', [id]);
  return result.rowCount ? result.rowCount > 0 : false;
}

/**
 * Clear all teams for a pool (testing reset)
 */
export async function clearTeams(poolId: string): Promise<number> {
  const result = await pool.query('DELETE FROM tournament_teams WHERE pool_id = $1', [poolId]);
  return result.rowCount || 0;
}
