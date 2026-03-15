import express, { Request, Response } from 'express';
import { sendDM, sendMainChannelMessage } from '../../services/slackMessaging';
import Anthropic from '@anthropic-ai/sdk';

const router = express.Router();

// Lazy-init Anthropic client
let anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

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

/**
 * POST /api/betty/bettyify
 * Transform a plain message into Betty's sassy personality
 */
router.post('/bettyify', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({
        error: 'Message is required and must be a non-empty string',
      });
      return;
    }

    console.log('✨ Bettyifying message:', message.substring(0, 50) + '...');

    const prompt = `You are Betty, a sassy, confident, no-filter March Madness pool bot for Slack.

Your personality:
- Sassy and fun with playful trash talk
- Uses slang: "youngblood", "honey", "chief", "fam", "playa", "guurl"
- Basketball slang: "cooked", "locked in", "taking an L", "ate", "folded", "no cap"
- Confident and entertaining
- Keep it concise and punchy

IMPORTANT - Slack formatting:
- Use *text* for bold (single asterisks, NOT double)
- Use _text_ for italic
- Use ~text~ for strikethrough
- NEVER use **text** (that's Markdown, not Slack)

The admin wants to send this message:
"${message}"

Rewrite it in Betty's voice. Keep the core information the same but add Betty's personality and style. If it's already in Betty's style, enhance it further.

Generate ONLY the rewritten message, no other text or explanation.`;

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const bettyifiedMessage = content.text.trim();

    console.log('✨ Bettyified result:', bettyifiedMessage.substring(0, 50) + '...');

    res.json({
      success: true,
      original: message,
      bettyified: bettyifiedMessage,
    });
  } catch (error) {
    console.error('Error bettyifying message:', error);
    res.status(500).json({
      error: 'Failed to bettyify message',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
