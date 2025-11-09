import dotenv from 'dotenv';
import { testConnection } from './models/database';
import { startSlackBot, stopSlackBot } from './bot/slackBot';
import { startSettlementScheduler, stopSettlementScheduler } from './scheduler/settlementScheduler';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🤖 Betty Bot Starting...\n');

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

  // Start Slack bot
  const port = parseInt(process.env.PORT || '3000', 10);
  console.log('\n🚀 Starting Slack bot...');
  await startSlackBot(port);

  // Start settlement scheduler
  console.log('\n⏰ Starting settlement scheduler...');
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
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  stopSettlementScheduler();
  await stopSlackBot();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  stopSettlementScheduler();
  await stopSlackBot();
  process.exit(0);
});

main().catch((error) => {
  console.error('❌ Error starting Betty:', error);
  process.exit(1);
});
