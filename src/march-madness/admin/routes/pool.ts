import express, { Request, Response } from 'express';
import * as poolModel from '../../models/pool';
import { CreatePoolInput, UpdatePoolInput } from '../../types/pool';

const router = express.Router();

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

export default router;
