import express, { Request, Response } from 'express';
import * as teamModel from '../../models/tournamentTeam';
import * as poolModel from '../../models/pool';
import { CreateTeamInput, UpdateTeamInput, BulkImportInput } from '../../types/tournamentTeam';
import { TournamentRound } from '../../types/pool';
import { eliminateTeam, processGames, simulateRoundEnd, processResults } from '../../services/resultsProcessor';
import { fetchTodaysGames, TournamentGame } from '../../services/ncaaService';

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
 * POST /api/teams/sync
 * Trigger an immediate ESPN fetch + results processing cycle.
 * Used by the "Force Sync Now" button in the admin UI.
 * Routes to appropriate handler based on tournament type.
 */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    console.log('[teams/sync] Manual sync triggered by admin');

    const pool = await poolModel.getCurrentPool();
    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    console.log(`[teams/sync] Processing ${pool.tournament_type} tournament`);

    if (pool.tournament_type === 'nba_playoffs') {
      // NBA Playoffs: processResults handles fetching and processing series
      await processResults(pool.id);
      res.json({
        success: true,
        message: `NBA Playoffs sync complete - series data processed`,
      });
    } else {
      // March Madness: fetch games first, then process
      const games = await fetchTodaysGames();
      const result = await processGames(games);
      res.json({
        success: true,
        message: `March Madness sync complete: ${result.gamesProcessed} game(s) processed, ${result.teamsEliminated.length} team(s) eliminated`,
        result,
      });
    }
  } catch (error) {
    console.error('Error during manual sync:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

/**
 * POST /api/teams/simulate-round-end
 * Testing tool: runs end-of-round pipeline for the pool's current round,
 * bypassing the tournament date check.
 */
router.post('/simulate-round-end', async (_req: Request, res: Response) => {
  try {
    console.log('[teams/simulate-round-end] Simulate round end triggered by admin');
    const result = await simulateRoundEnd();
    res.json({
      success: true,
      message: `End-of-round simulated for ${result.round}${result.nextRound ? ` → advanced to ${result.nextRound}` : ' → tournament complete'}`,
      result,
    });
  } catch (error: any) {
    console.error('Error simulating round end:', error);
    res.status(500).json({ error: error.message || 'Failed to simulate round end' });
  }
});

/**
 * POST /api/teams/simulate-game
 * Testing tool: simulate a single completed game result.
 * Accepts { winner, loser, round } and runs the full processGames pipeline —
 * loser gets eliminated, winner picks get marked won and congrats DMs sent.
 */
router.post('/simulate-game', async (req: Request, res: Response) => {
  try {
    const { winner, loser, round } = req.body;

    if (!winner || !loser || !round) {
      res.status(400).json({ error: 'winner, loser, and round are required' });
      return;
    }

    const validRounds: TournamentRound[] = [
      'Round of 64', 'Round of 32', 'Sweet Sixteen', 'Elite Eight', 'Final Four', 'Championship',
    ];
    if (!validRounds.includes(round as TournamentRound)) {
      res.status(400).json({ error: `round must be one of: ${validRounds.join(', ')}` });
      return;
    }

    console.log(`[teams/simulate-game] Simulating: ${winner} beats ${loser} in ${round}`);

    const mockGame: TournamentGame = {
      id: `sim-${Date.now()}`,
      homeTeam: winner as string,
      awayTeam: loser as string,
      winner: winner as string,
      loser: loser as string,
      round: round as TournamentRound,
      roundRaw: round as string,
      status: 'final',
    };

    const result = await processGames([mockGame]);

    res.json({
      success: true,
      message: `Game simulated: ${winner} beat ${loser} in ${round}. ${result.picksMarkedWon} pick(s) marked won, ${result.participantsEliminated.length} participant(s) eliminated.`,
      result,
    });
  } catch (error: any) {
    console.error('Error simulating game:', error);
    res.status(500).json({ error: error.message || 'Failed to simulate game' });
  }
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
 * Mark a team as eliminated and run the full downstream pipeline:
 * updates picks, eliminates participants, sends Slack DMs + channel announcement.
 */
router.post('/:id/eliminate', async (req: Request, res: Response) => {
  try {
    const { round } = req.body;

    if (!round) {
      res.status(400).json({ error: 'round is required' });
      return;
    }

    // Look up team by ID to get canonical name
    const team = await teamModel.getTeamById(req.params.id);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    // Run full elimination pipeline (marks team, updates picks, eliminates participants, sends Slack)
    const result = await eliminateTeam(team.team_name, round as TournamentRound);

    if (result.teamNotFound) {
      res.status(404).json({ error: 'Team not found in pool' });
      return;
    }

    if (result.alreadyEliminated) {
      res.status(409).json({ error: 'Team is already eliminated' });
      return;
    }

    // Return updated team record for the UI
    const updatedTeam = await teamModel.getTeamById(req.params.id);
    res.json({
      team: updatedTeam,
      picksMarkedLost: result.picksMarkedLost,
      participantsEliminated: result.participantsEliminated.length,
    });
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
