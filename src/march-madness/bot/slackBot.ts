import { App, ExpressReceiver } from '@slack/bolt';
import { setupAdminRoutes } from '../admin/server';

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

  // Placeholder message handler
  app.message(async ({ message, say }) => {
    console.log('📩 Received message:', message);

    // TODO: Implement pick submission in Phase 3
    // For now, just acknowledge
    if (message.channel_type === 'im') {
      await say('👋 Hi! March Madness bot is under construction. Pick submission coming in Phase 3!');
    }
  });

  // Start the app
  await app.start(port);
  console.log(`⚡️ March Madness bot running on port ${port}!`);
  console.log(`🔐 Admin console available at /admin`);
}
