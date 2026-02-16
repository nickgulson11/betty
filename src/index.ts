import dotenv from 'dotenv';
import { testConnection } from './shared/models/database';
import { getMode, getModeName } from './config/mode';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🤖 Betty Bot Starting...\n');

  // Display current mode
  const mode = getMode();
  const modeName = getModeName();
  console.log(`📍 Mode: ${mode.toUpperCase()}`);
  console.log(`   ${modeName}\n`);

  // Check environment variables
  console.log('📋 Checking environment variables...');
  const requiredEnvVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'ANTHROPIC_API_KEY',
    'DATABASE_URL',
  ];

  const missingVars: string[] = [];
  requiredEnvVars.forEach(varName => {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      console.log(`  ❌ ${varName}: Not set`);
      missingVars.push(varName);
    } else {
      // Mask sensitive values
      const masked = varName.includes('TOKEN') || varName.includes('KEY') || varName.includes('SECRET')
        ? value.substring(0, 8) + '...'
        : value;
      console.log(`  ✅ ${varName}: ${masked}`);
    }
  });

  if (missingVars.length > 0) {
    console.error('\n❌ Missing required environment variables. Please update .env file.');
    process.exit(1);
  }

  // Test database connection
  console.log('\n🗄️  Testing database connection...');
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.error('❌ Database connection failed. Please check your DATABASE_URL.');
    process.exit(1);
  }

  const port = parseInt(process.env.PORT || '3000', 10);

  // Route to appropriate mode
  if (mode === 'betting') {
    console.log('\n🎲 Starting Betting Bot Mode...\n');

    const { startSlackBot, stopSlackBot } = await import('./betting/bot/slackBot');
    const { startSettlementScheduler, stopSettlementScheduler } = await import('./betting/scheduler/settlementScheduler');

    // Start Slack bot
    console.log('🚀 Starting Slack bot...');
    await startSlackBot(port);

    // Start settlement scheduler
    console.log('⏰ Starting settlement scheduler...');
    startSettlementScheduler();

    console.log('\n' + '='.repeat(50));
    console.log('✅ Betty is ready to accept bets!');
    console.log('='.repeat(50));
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Start ngrok: ngrok http ${port}`);
    console.log(`   2. Copy the ngrok URL (https://....ngrok-free.app)`);
    console.log(`   3. Go to Slack API dashboard > Event Subscriptions`);
    console.log(`   4. Set Request URL to: https://your-ngrok-url/slack/events`);
    console.log(`   5. Subscribe to: app_mention, reaction_added`);
    console.log(`   6. Mention @betty in your Slack workspace!\n`);

    // Graceful shutdown handlers
    const shutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');
      stopSettlementScheduler();
      await stopSlackBot();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } else if (mode === 'march_madness') {
    console.log('\n🏀 Starting March Madness Pool Mode...\n');

    const { startMarchMadnessBot } = await import('./march-madness/bot/slackBot');

    // Start unified server (Slack bot + admin console on same port)
    await startMarchMadnessBot(port);

    // Start ESPN polling scheduler (imported after bot is up to avoid blocking startup)
    const { startTournamentScheduler, stopTournamentScheduler } = await import('./march-madness/scheduler/tournamentScheduler');
    console.log('⏰ Starting tournament scheduler...');
    startTournamentScheduler();

    console.log('\n' + '='.repeat(50));
    console.log('✅ Betty March Madness is ready!');
    console.log('='.repeat(50));
    console.log(`\n💡 Running on port ${port}:`);
    console.log(`   🏀 Slack Bot: /slack/events`);
    console.log(`   🔐 Admin Console: /admin`);
    console.log(`   📡 API: /api`);
    console.log(`   🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'changeme'}`);
    console.log(`   ⏰ ESPN Scheduler: polling every 30 minutes\n`);

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');
      stopTournamentScheduler();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } else {
    console.error(`❌ Unknown mode: ${mode}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Error starting Betty:', error);
  process.exit(1);
});
