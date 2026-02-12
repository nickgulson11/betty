import express, { Request, Response } from 'express';
import * as teamModel from '../../models/tournamentTeam';
import * as poolModel from '../../models/pool';
import { CreateTeamInput, UpdateTeamInput, BulkImportInput } from '../../types/tournamentTeam';
import { TournamentRound } from '../../types/pool';

const router = express.Router();

/**
 * GET /api/teams
 * Get all teams for the current pool
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();
    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    const teams = await teamModel.getTeamsByPool(pool.id);
    res.json(teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

/**
 * POST /api/teams
 * Add a single team
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();
    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    const input: CreateTeamInput = req.body;
    if (!input.team_name || !input.team_name.trim()) {
      res.status(400).json({ error: 'team_name is required' });
      return;
    }

    // Validate seed if provided
    if (input.seed !== undefined && (input.seed < 1 || input.seed > 16)) {
      res.status(400).json({ error: 'seed must be between 1 and 16' });
      return;
    }

    const team = await teamModel.createTeam(pool.id, {
      ...input,
      team_name: input.team_name.trim(),
    });
    res.status(201).json(team);
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'A team with that name already exists in this pool' });
      return;
    }
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

/**
 * POST /api/teams/bulk
 * Bulk import teams (upsert — safe to re-run)
 * Accepts either:
 *   { teams: [{ team_name, seed?, region? }] }
 *   or plain text lines (handled on frontend before sending)
 */
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();
    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    const input: BulkImportInput = req.body;

    if (!input.teams || !Array.isArray(input.teams) || input.teams.length === 0) {
      res.status(400).json({ error: 'teams array is required and must not be empty' });
      return;
    }

    // Validate and sanitize each team
    const sanitized: CreateTeamInput[] = [];
    const errors: string[] = [];

    for (const team of input.teams) {
      if (!team.team_name || !team.team_name.trim()) {
        errors.push(`Skipping entry with missing team_name`);
        continue;
      }
      if (team.seed !== undefined && (team.seed < 1 || team.seed > 16)) {
        errors.push(`${team.team_name}: seed must be between 1 and 16, skipping`);
        continue;
      }
      sanitized.push({ ...team, team_name: team.team_name.trim() });
    }

    if (sanitized.length === 0) {
      res.status(400).json({ error: 'No valid teams to import', validationErrors: errors });
      return;
    }

    const result = await teamModel.bulkCreateTeams(pool.id, sanitized);
    res.status(201).json({
      message: `Import complete: ${result.inserted} added, ${result.updated} updated`,
      inserted: result.inserted,
      updated: result.updated,
      skipped: input.teams.length - sanitized.length,
      validationErrors: errors,
    });
  } catch (error) {
    console.error('Error bulk importing teams:', error);
    res.status(500).json({ error: 'Failed to bulk import teams' });
  }
});

/**
 * POST /api/teams/fetch-espn
 * Placeholder — ESPN integration coming in Phase 4 Track 2
 */
router.post('/fetch-espn', (_req: Request, res: Response) => {
  res.status(501).json({
    message: 'ESPN integration coming in Phase 4 Track 2',
    status: 'not_implemented',
  });
});

/**
 * PUT /api/teams/:id
 * Edit team name, seed, or region
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const input: UpdateTeamInput = req.body;

    if (input.seed !== undefined && input.seed !== null && (input.seed < 1 || input.seed > 16)) {
      res.status(400).json({ error: 'seed must be between 1 and 16' });
      return;
    }

    if (input.team_name !== undefined) {
      input.team_name = input.team_name.trim();
      if (!input.team_name) {
        res.status(400).json({ error: 'team_name cannot be empty' });
        return;
      }
    }

    const team = await teamModel.updateTeam(req.params.id, input);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.json(team);
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'A team with that name already exists in this pool' });
      return;
    }
    console.error('Error updating team:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

/**
 * POST /api/teams/:id/eliminate
 * Mark a team as eliminated in a given round
 */
router.post('/:id/eliminate', async (req: Request, res: Response) => {
  try {
    const { round } = req.body;

    if (!round) {
      res.status(400).json({ error: 'round is required' });
      return;
    }

    const team = await teamModel.markTeamEliminated(req.params.id, round as TournamentRound);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.json(team);
  } catch (error) {
    console.error('Error eliminating team:', error);
    res.status(500).json({ error: 'Failed to eliminate team' });
  }
});

/**
 * DELETE /api/teams/all
 * Clear all teams for the current pool (testing tool)
 * NOTE: this route must be defined BEFORE /:id to avoid route conflicts
 */
router.delete('/all', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();
    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    const count = await teamModel.clearTeams(pool.id);
    res.json({ success: true, message: `Deleted ${count} teams` });
  } catch (error) {
    console.error('Error clearing teams:', error);
    res.status(500).json({ error: 'Failed to clear teams' });
  }
});

/**
 * DELETE /api/teams/:id
 * Delete a single team
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const success = await teamModel.deleteTeam(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.json({ success: true, message: 'Team deleted' });
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

export default router;
