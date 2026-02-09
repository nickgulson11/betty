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

    console.log('📦 Loading admin server module...');
    const { startAdminServer } = await import('./march-madness/admin/server');
    console.log('✅ Admin server module loaded');

    // Start admin server FIRST (doesn't depend on Slack)
    const adminPort = parseInt(process.env.ADMIN_PORT || '3001', 10);
    console.log('🔐 Starting Admin Console...');
    await startAdminServer(adminPort);

    // Load Slack bot module separately (after admin is running)
    console.log('📦 Loading Slack bot module...');
    const { startMarchMadnessBot } = await import('./march-madness/bot/slackBot');
    console.log('✅ Slack bot module loaded');

    // Start Slack bot in background (non-blocking)
    console.log('🚀 Starting March Madness Slack bot (this may take a moment)...');
    startMarchMadnessBot(port)
      .then(() => {
        console.log('✅ Slack bot connected successfully!');
      })
      .catch((error) => {
        console.error('⚠️  Slack bot failed to connect (admin console still working):', error.message);
        console.log('   Admin console is still available at http://localhost:' + adminPort + '/admin');
      });

    console.log('\n' + '='.repeat(50));
    console.log('✅ Betty March Madness Admin Console is ready!');
    console.log('='.repeat(50));
    console.log(`\n💡 Admin Console:`);
    console.log(`   🌐 URL: http://localhost:${adminPort}/admin`);
    console.log(`   🔑 Password: ${process.env.ADMIN_PASSWORD || 'changeme'}`);
    console.log(`\n💡 Slack Bot:`);
    console.log(`   ⏳ Connecting in background...`);
    console.log(`   📡 Will listen on port ${port} when ready`);
    console.log(`   💡 Tip: For local testing, admin console works without Slack\n`);

  } else {
    console.error(`❌ Unknown mode: ${mode}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Error starting Betty:', error);
  process.exit(1);
});
