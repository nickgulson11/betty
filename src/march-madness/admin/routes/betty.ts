import express, { Request, Response } from 'express';

const router = express.Router();

// We'll implement the Slack messaging service later
// For now, this is a placeholder that logs the message

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

    // TODO: Implement actual Slack messaging in Phase 3
    // For now, just log and return success
    console.log('📬 Betty Message (Admin):', {
      destination,
      target,
      message,
    });

    res.json({
      success: true,
      message: 'Message sent successfully (stubbed for now)',
      details: { destination, target, messageLength: message.length },
    });
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
