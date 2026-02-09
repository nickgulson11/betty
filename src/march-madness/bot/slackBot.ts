import { App, ExpressReceiver } from '@slack/bolt';
import { setupAdminRoutes } from '../admin/server';
import { submitPick, getCurrentPick } from '../services/pickManager';
import { sendErrorDM } from '../services/slackMessaging';

export async function startMarchMadnessBot(port: number): Promise<void> {
  console.log('🏀 March Madness Bot starting...');

  // Create Express receiver so we can add custom routes
  const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  });

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
  });

  // Setup admin routes on the same Express app
  setupAdminRoutes(receiver.app);

  // Handle DM messages for pick submission
  app.message(async ({ message, say }) => {
    try {
      console.log('📩 Received message:', message);

      // Only handle direct messages
      if (message.channel_type !== 'im') {
        return;
      }

      // Ignore bot messages
      if (message.subtype === 'bot_message' || (message as any).bot_id) {
        return;
      }

      const userId = (message as any).user;
      const text = (message as any).text?.trim();

      if (!text) {
        return;
      }

      console.log(`📝 Pick submission from ${userId}: "${text}"`);

      // Handle special commands
      const lowerText = text.toLowerCase();

      if (lowerText === 'help' || lowerText === 'info') {
        await say(
          `🏀 **March Madness Pool - How to Play**\n\n` +
            `**Submit a pick:** Just send me the team name (e.g., "Duke", "North Carolina")\n\n` +
            `**Check your pick:** Send "my pick" or "status"\n\n` +
            `**Rules:**\n` +
            `• Pick ONE team per round\n` +
            `• If your team wins, you advance\n` +
            `• If your team loses, you're eliminated\n` +
            `• You CANNOT reuse teams\n\n` +
            `Good luck! 🍀`
        );
        return;
      }

      if (lowerText === 'my pick' || lowerText === 'status') {
        const { pick, round } = await getCurrentPick(userId);

        if (!pick || !round) {
          await say(`You haven't submitted a pick for the current round yet.`);
        } else {
          await say(`Your pick for **${round}**: **${pick.team_name}**\n\nYou can change it by sending me a new team name.`);
        }
        return;
      }

      // Treat message as a team pick submission
      const result = await submitPick(userId, text);

      if (!result.success) {
        // Error occurred - send error message
        await sendErrorDM(userId, result.message);
        return;
      }

      // Success - confirmation already sent by submitPick
      console.log(`✅ Pick submitted successfully for ${userId}`);
    } catch (error) {
      console.error('❌ Error handling message:', error);

      try {
        await say(
          `❌ Oops! Something went wrong processing your pick. Please try again or contact the admin.`
        );
      } catch (sayError) {
        console.error('Failed to send error message:', sayError);
      }
    }
  });

  // Start the app
  await app.start(port);
  console.log(`⚡️ March Madness bot running on port ${port}!`);
  console.log(`🔐 Admin console available at /admin`);
}
