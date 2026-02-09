import express, { Request, Response } from 'express';
import { sendDM, sendMainChannelMessage } from '../../services/slackMessaging';

const router = express.Router();

/**
 * POST /api/betty/message
 * Send a custom message as Betty
 */
router.post('/message', async (req: Request, res: Response) => {
  try {
    const { destination, target, message } = req.body;

    if (!destination || !message) {
      res.status(400).json({
        error: 'Missing required fields: destination (channel/dm), message',
      });
      return;
    }

    if (destination === 'dm' && !target) {
      res.status(400).json({
        error: 'Target slack_user_id required for DM destination',
      });
      return;
    }

    console.log('📬 Betty Message (Admin):', {
      destination,
      target,
      message,
    });

    let success = false;

    if (destination === 'channel') {
      // Send to main channel
      success = await sendMainChannelMessage(message);
    } else if (destination === 'dm') {
      // Send DM to specific user
      success = await sendDM(target, message);
    } else {
      res.status(400).json({
        error: 'Invalid destination. Must be "channel" or "dm"',
      });
      return;
    }

    if (success) {
      res.json({
        success: true,
        message: 'Message sent successfully',
        details: { destination, target, messageLength: message.length },
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to send message to Slack',
      });
    }
  } catch (error) {
    console.error('Error sending Betty message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * GET /api/betty/templates
 * Get message templates for common announcements
 */
router.get('/templates', (_req: Request, res: Response) => {
  const templates = [
    {
      id: 'welcome',
      name: 'Welcome Message',
      template:
        'Welcome to the March Madness Pool! 🏀 Here are the rules: Pick one team per round (6 rounds total). If your team wins, you advance. If they lose, you\'re eliminated. You can\'t use the same team twice. Good luck!',
    },
    {
      id: 'deadline_reminder',
      name: 'Deadline Reminder',
      template:
        '⏰ Reminder: {round} picks are due by {deadline}! Submit your pick via DM if you haven\'t already.',
    },
    {
      id: 'round_start',
      name: 'Round Start Announcement',
      template:
        '🏀 {round} has begun! {active_count} participants are still in the running. Games start soon - good luck everyone!',
    },
    {
      id: 'round_complete',
      name: 'Round Complete',
      template:
        '✅ {round} is complete! {advanced_count} participants advance to the next round. {eliminated_count} were eliminated. Results coming shortly...',
    },
    {
      id: 'elimination',
      name: 'Elimination Announcement',
      template:
        '❌ {participant_name} has been eliminated! Their pick {team_name} lost in {round}. Better luck next year!',
    },
  ];

  res.json(templates);
});

export default router;
