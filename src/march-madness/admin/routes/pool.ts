import express, { Request, Response } from 'express';
import * as poolModel from '../../models/pool';
import { CreatePoolInput, UpdatePoolInput, TournamentRound } from '../../types/pool';
import { NBA_PLAYOFFS_NEXT_ROUND } from '../../constants/nbaPlayoffs';

const router = express.Router();

// March Madness next round mapping
const NEXT_ROUND: Partial<Record<TournamentRound, TournamentRound | null>> = {
  'Round of 64': 'Round of 32',
  'Round of 32': 'Sweet Sixteen',
  'Sweet Sixteen': 'Elite Eight',
  'Elite Eight': 'Final Four',
  'Final Four': 'Championship',
  'Championship': null,
};

/**
 * GET /api/pool
 * Get the current active pool
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const currentPool = await poolModel.getCurrentPool();

    if (!currentPool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    res.json(currentPool);
  } catch (error) {
    console.error('Error fetching pool:', error);
    res.status(500).json({ error: 'Failed to fetch pool' });
  }
});

/**
 * GET /api/pool/all
 * Get all pools
 */
router.get('/all', async (_req: Request, res: Response) => {
  try {
    const pools = await poolModel.getAllPools();
    res.json(pools);
  } catch (error) {
    console.error('Error fetching pools:', error);
    res.status(500).json({ error: 'Failed to fetch pools' });
  }
});

/**
 * GET /api/pool/:id
 * Get pool by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = await poolModel.getPoolById(req.params.id);

    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.json(pool);
  } catch (error) {
    console.error('Error fetching pool:', error);
    res.status(500).json({ error: 'Failed to fetch pool' });
  }
});

/**
 * POST /api/pool
 * Create a new pool
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreatePoolInput = req.body;

    if (!input.name || !input.slack_channel_id || !input.admin_slack_id) {
      res.status(400).json({
        error: 'Missing required fields: name, slack_channel_id, admin_slack_id',
      });
      return;
    }

    const pool = await poolModel.createPool(input);
    res.status(201).json(pool);
  } catch (error) {
    console.error('Error creating pool:', error);
    res.status(500).json({ error: 'Failed to create pool' });
  }
});

/**
 * PUT /api/pool/:id
 * Update pool
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const input: UpdatePoolInput = req.body;
    const pool = await poolModel.updatePool(req.params.id, input);

    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.json(pool);
  } catch (error) {
    console.error('Error updating pool:', error);
    res.status(500).json({ error: 'Failed to update pool' });
  }
});

/**
 * DELETE /api/pool/:id
 * Delete pool
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const success = await poolModel.deletePool(req.params.id);

    if (!success) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.json({ success: true, message: 'Pool deleted' });
  } catch (error) {
    console.error('Error deleting pool:', error);
    res.status(500).json({ error: 'Failed to delete pool' });
  }
});

/**
 * POST /api/pool/advance
 * Advance pool to next round
 */
router.post('/advance', async (req: Request, res: Response) => {
  try {
    const { poolId, nextRound } = req.body;

    if (!poolId || !nextRound) {
      res.status(400).json({ error: 'Missing required fields: poolId, nextRound' });
      return;
    }

    const pool = await poolModel.updatePool(poolId, {
      current_round: nextRound,
    });

    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.json({ success: true, pool });
  } catch (error) {
    console.error('Error advancing round:', error);
    res.status(500).json({ error: 'Failed to advance round' });
  }
});

/**
 * POST /api/pool/:id/clear
 * Clear all participants and picks from a pool (for testing)
 * WARNING: This is destructive and cannot be undone
 */
router.post('/:id/clear', async (req: Request, res: Response) => {
  try {
    const poolId = req.params.id;

    // Delete all picks for this pool (cascade will handle this via participant deletion, but being explicit)
    await poolModel.clearPoolData(poolId);

    res.json({
      success: true,
      message: 'Pool cleared successfully. All participants and picks have been deleted.'
    });
  } catch (error) {
    console.error('Error clearing pool:', error);
    res.status(500).json({ error: 'Failed to clear pool' });
  }
});

/**
 * POST /api/pool/allow-next-round-picks
 * Enable accepting picks for the next round while current round is in progress
 */
router.post('/allow-next-round-picks', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    if (pool.status !== 'active') {
      res.status(400).json({ error: 'Pool must be active to allow next round picks' });
      return;
    }

    if (pool.allow_next_round_picks) {
      res.status(400).json({ error: 'Next round picks already allowed' });
      return;
    }

    // Get next round
    const nextRoundMap = pool.tournament_type === 'nba_playoffs'
      ? NBA_PLAYOFFS_NEXT_ROUND
      : NEXT_ROUND;
    const nextRound = nextRoundMap[pool.current_round!];

    if (!nextRound) {
      res.status(400).json({ error: 'Already on final round' });
      return;
    }

    // Update pool (no Slack message sent per user request)
    await poolModel.updatePool(pool.id, { allow_next_round_picks: true });

    res.json({
      success: true,
      nextRound,
      message: `Next round picks enabled for ${nextRound}`
    });
  } catch (error) {
    console.error('Error enabling next round picks:', error);
    res.status(500).json({ error: 'Failed to enable next round picks' });
  }
});

/**
 * POST /api/pool/disable-next-round-picks
 * Disable accepting picks for the next round (return to current round only)
 */
router.post('/disable-next-round-picks', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    if (!pool.allow_next_round_picks) {
      res.status(400).json({ error: 'Next round picks not currently enabled' });
      return;
    }

    // Update pool (no Slack message sent)
    await poolModel.updatePool(pool.id, { allow_next_round_picks: false });

    res.json({
      success: true,
      message: 'Next round picks disabled - now accepting picks for current round only'
    });
  } catch (error) {
    console.error('Error disabling next round picks:', error);
    res.status(500).json({ error: 'Failed to disable next round picks' });
  }
});

export default router;
