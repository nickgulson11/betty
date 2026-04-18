import express, { Request, Response } from 'express';
import * as pickModel from '../../models/pick';
import * as poolModel from '../../models/pool';
import { CreatePickInput, UpdatePickInput } from '../../types/pick';
import { TournamentRound } from '../../types/pool';

const router = express.Router();

/**
 * GET /api/picks
 * Get all picks for current round
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    if (!pool.current_round) {
      res.status(400).json({ error: 'No current round set' });
      return;
    }

    const picks = await pickModel.getPicksByPoolAndRound(pool.id, pool.current_round);
    res.json(picks);
  } catch (error) {
    console.error('Error fetching picks:', error);
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

/**
 * GET /api/picks/round/:round
 * Get all picks for a specific round
 */
router.get('/round/:round', async (req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    const round = req.params.round as TournamentRound;
    const picks = await pickModel.getPicksByPoolAndRound(pool.id, round);
    res.json(picks);
  } catch (error) {
    console.error('Error fetching picks:', error);
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

/**
 * GET /api/picks/participant/:participantId
 * Get all picks for a participant
 */
router.get('/participant/:participantId', async (req: Request, res: Response) => {
  try {
    const picks = await pickModel.getPicksByParticipant(req.params.participantId);

    // Also get teams used for easy reference
    const teamsUsed = await pickModel.getTeamsUsedByParticipant(req.params.participantId);

    res.json({ picks, teamsUsed });
  } catch (error) {
    console.error('Error fetching participant picks:', error);
    res.status(500).json({ error: 'Failed to fetch participant picks' });
  }
});

/**
 * GET /api/picks/:id
 * Get pick by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pick = await pickModel.getPickById(req.params.id);

    if (!pick) {
      res.status(404).json({ error: 'Pick not found' });
      return;
    }

    res.json(pick);
  } catch (error) {
    console.error('Error fetching pick:', error);
    res.status(500).json({ error: 'Failed to fetch pick' });
  }
});

/**
 * POST /api/picks
 * Create or update a pick (admin override)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreatePickInput = req.body;

    if (!input.participant_id || !input.round || !input.team_name) {
      res.status(400).json({
        error: 'Missing required fields: participant_id, round, team_name',
      });
      return;
    }

    // If pool_id not provided, use current pool
    if (!input.pool_id) {
      const pool = await poolModel.getCurrentPool();
      if (!pool) {
        res.status(404).json({ error: 'No active pool found' });
        return;
      }
      input.pool_id = pool.id;
    }

    // Check if team has already been used by this participant (excluding current round)
    const teamsUsed = await pickModel.getTeamsUsedByParticipant(input.participant_id);
    const existingPick = await pickModel.getPickByParticipantAndRound(
      input.participant_id,
      input.round
    );

    // Filter out the current pick's team if updating
    const otherTeamsUsed = existingPick
      ? teamsUsed.filter((t) => t !== existingPick.team_name)
      : teamsUsed;

    if (otherTeamsUsed.includes(input.team_name)) {
      res.status(409).json({
        error: `Team "${input.team_name}" has already been used by this participant`,
      });
      return;
    }

    const pick = await pickModel.createOrUpdatePick(input);
    res.status(201).json(pick);
  } catch (error) {
    console.error('Error creating/updating pick:', error);
    res.status(500).json({ error: 'Failed to create/update pick' });
  }
});

/**
 * PUT /api/picks/:id
 * Update pick
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const input: UpdatePickInput = req.body;

    // If team_name is being changed, check for duplicates
    if (input.team_name) {
      const existingPick = await pickModel.getPickById(req.params.id);
      if (existingPick) {
        const teamsUsed = await pickModel.getTeamsUsedByParticipant(
          existingPick.participant_id
        );
        const otherTeamsUsed = teamsUsed.filter((t) => t !== existingPick.team_name);

        if (otherTeamsUsed.includes(input.team_name)) {
          res.status(409).json({
            error: `Team "${input.team_name}" has already been used by this participant`,
          });
          return;
        }
      }
    }

    const pick = await pickModel.updatePick(req.params.id, input);

    if (!pick) {
      res.status(404).json({ error: 'Pick not found' });
      return;
    }

    res.json(pick);
  } catch (error) {
    console.error('Error updating pick:', error);
    res.status(500).json({ error: 'Failed to update pick' });
  }
});

/**
 * DELETE /api/picks/:id
 * Delete pick
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const success = await pickModel.deletePick(req.params.id);

    if (!success) {
      res.status(404).json({ error: 'Pick not found' });
      return;
    }

    res.json({ success: true, message: 'Pick deleted' });
  } catch (error) {
    console.error('Error deleting pick:', error);
    res.status(500).json({ error: 'Failed to delete pick' });
  }
});

/**
 * GET /api/picks/summary/current
 * Get pick summary for current round (most popular picks, etc.)
 */
router.get('/summary/current', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    if (!pool.current_round) {
      res.status(400).json({ error: 'No current round set' });
      return;
    }

    const picks = await pickModel.getPicksByPoolAndRound(pool.id, pool.current_round);

    // Count picks by team
    const teamCounts: Record<string, number> = {};
    picks.forEach((pick) => {
      teamCounts[pick.team_name] = (teamCounts[pick.team_name] || 0) + 1;
    });

    // Sort by popularity
    const popularPicks = Object.entries(teamCounts)
      .map(([team, count]) => ({ team, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      round: pool.current_round,
      totalPicks: picks.length,
      popularPicks,
      picks,
    });
  } catch (error) {
    console.error('Error fetching pick summary:', error);
    res.status(500).json({ error: 'Failed to fetch pick summary' });
  }
});

export default router;
