import express, { Request, Response } from 'express';
import * as participantModel from '../../models/participant';
import * as poolModel from '../../models/pool';
import { CreateParticipantInput, UpdateParticipantInput } from '../../types/participant';
import { sendWelcomeDM, getUserInfo } from '../../services/slackMessaging';
import { syncChannelMembers } from '../../services/channelSync';

const router = express.Router();

/**
 * GET /api/participants
 * Get all participants for current pool
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    const participants = await participantModel.getParticipantsByPool(pool.id);
    res.json(participants);
  } catch (error) {
    console.error('Error fetching participants:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

/**
 * GET /api/participants/active
 * Get active participants
 */
router.get('/active', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    const participants = await participantModel.getActiveParticipants(pool.id);
    res.json(participants);
  } catch (error) {
    console.error('Error fetching active participants:', error);
    res.status(500).json({ error: 'Failed to fetch active participants' });
  }
});

/**
 * GET /api/participants/eliminated
 * Get eliminated participants
 */
router.get('/eliminated', async (_req: Request, res: Response) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    const participants = await participantModel.getEliminatedParticipants(pool.id);
    res.json(participants);
  } catch (error) {
    console.error('Error fetching eliminated participants:', error);
    res.status(500).json({ error: 'Failed to fetch eliminated participants' });
  }
});

/**
 * GET /api/participants/:id
 * Get participant by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const participant = await participantModel.getParticipantById(req.params.id);

    if (!participant) {
      res.status(404).json({ error: 'Participant not found' });
      return;
    }

    res.json(participant);
  } catch (error) {
    console.error('Error fetching participant:', error);
    res.status(500).json({ error: 'Failed to fetch participant' });
  }
});

/**
 * POST /api/participants
 * Add a new participant
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreateParticipantInput = req.body;

    if (!input.slack_user_id) {
      res.status(400).json({ error: 'Missing required field: slack_user_id' });
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

    // Check if participant already exists
    const existing = await participantModel.getParticipantBySlackId(
      input.pool_id,
      input.slack_user_id
    );

    if (existing) {
      res.status(409).json({ error: 'Participant already exists in this pool' });
      return;
    }

    // Get pool info for welcome message
    const pool = await poolModel.getPoolById(input.pool_id);

    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    // Get user info from Slack (to store username)
    const userInfo = await getUserInfo(input.slack_user_id);

    // Create participant with username if available
    const participantWithUsername: CreateParticipantInput = {
      ...input,
      slack_username: userInfo?.realName || userInfo?.name,
    };

    const participant = await participantModel.createParticipant(participantWithUsername);

    // If paid flag was provided and true, mark as paid immediately
    let isPaid = false;
    if (req.body.paid === true) {
      await participantModel.updateParticipant(participant.id, { paid: true });
      isPaid = true;
    }

    // Only send welcome DM if participant is paid
    if (isPaid) {
      const welcomeSent = await sendWelcomeDM(input.slack_user_id, pool.name);

      if (!welcomeSent) {
        console.warn(`Failed to send welcome DM to ${input.slack_user_id}`);
      }
    }

    // Get the updated participant (with paid status if applicable)
    const updatedParticipant = await participantModel.getParticipantById(participant.id);

    res.status(201).json(updatedParticipant);
  } catch (error) {
    console.error('Error creating participant:', error);
    res.status(500).json({ error: 'Failed to create participant' });
  }
});

/**
 * PUT /api/participants/:id
 * Update participant
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const input: UpdateParticipantInput = req.body;
    const participant = await participantModel.updateParticipant(req.params.id, input);

    if (!participant) {
      res.status(404).json({ error: 'Participant not found' });
      return;
    }

    res.json(participant);
  } catch (error) {
    console.error('Error updating participant:', error);
    res.status(500).json({ error: 'Failed to update participant' });
  }
});

/**
 * DELETE /api/participants/:id
 * Remove participant
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const success = await participantModel.deleteParticipant(req.params.id);

    if (!success) {
      res.status(404).json({ error: 'Participant not found' });
      return;
    }

    res.json({ success: true, message: 'Participant removed' });
  } catch (error) {
    console.error('Error deleting participant:', error);
    res.status(500).json({ error: 'Failed to delete participant' });
  }
});

/**
 * POST /api/participants/:id/paid
 * Mark participant as paid and send welcome DM
 */
router.post('/:id/paid', async (req: Request, res: Response) => {
  try {
    const participant = await participantModel.updateParticipant(req.params.id, { paid: true });

    if (!participant) {
      res.status(404).json({ error: 'Participant not found' });
      return;
    }

    // Get pool info for welcome message
    const pool = await poolModel.getPoolById(participant.pool_id);

    if (pool) {
      // Send welcome DM now that they're paid
      const welcomeSent = await sendWelcomeDM(participant.slack_user_id, pool.name);

      if (!welcomeSent) {
        console.warn(`Failed to send welcome DM to ${participant.slack_user_id}`);
      }
    }

    res.json(participant);
  } catch (error) {
    console.error('Error marking participant as paid:', error);
    res.status(500).json({ error: 'Failed to mark participant as paid' });
  }
});

/**
 * POST /api/participants/:id/eliminate
 * Manually eliminate a participant
 */
router.post('/:id/eliminate', async (req: Request, res: Response) => {
  try {
    const { reason, round } = req.body;

    const participant = await participantModel.updateParticipant(req.params.id, {
      status: 'eliminated',
      eliminated_round: round || 'Manual Elimination',
      eliminated_team: reason || 'Admin action',
    });

    if (!participant) {
      res.status(404).json({ error: 'Participant not found' });
      return;
    }

    res.json(participant);
  } catch (error) {
    console.error('Error eliminating participant:', error);
    res.status(500).json({ error: 'Failed to eliminate participant' });
  }
});

/**
 * POST /api/participants/sync
 * Sync all members from pool's Slack channel as unpaid participants
 * Only adds new members, doesn't remove existing participants
 */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    // Get current pool
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      res.status(404).json({ error: 'No active pool found' });
      return;
    }

    if (!pool.slack_channel_id) {
      res.status(400).json({ error: 'Pool does not have a slack_channel_id configured' });
      return;
    }

    // Sync channel members
    const result = await syncChannelMembers(pool.id, pool.slack_channel_id);

    res.json({
      success: true,
      message: `Synced ${result.newParticipants} new participants from channel`,
      result,
    });
  } catch (error) {
    console.error('Error syncing channel members:', error);
    res.status(500).json({ error: 'Failed to sync channel members' });
  }
});

export default router;
