import { App } from '@slack/bolt';

export async function startMarchMadnessBot(port: number): Promise<void> {
  console.log('🏀 March Madness Bot starting...');

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });

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
  console.log(`⚡️ March Madness Slack bot is running on port ${port}!`);
}
