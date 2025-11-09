import dotenv from 'dotenv';
import { parseBetIntent, extractSlackUserId, extractAllUserMentions } from './claudeService';

// Load environment variables
dotenv.config();

/**
 * Test script for Claude service
 * Run with: npx ts-node src/services/testClaudeService.ts
 */

async function testBetParsing() {
  console.log('🧪 Testing Claude Bet Parsing Service\n');
  console.log('='.repeat(60));

  const testCases = [
    {
      name: 'Simple bet with mention and amount',
      message: 'I bet <@U12345|john> that the Lakers win tonight for $10',
      description: 'Should parse all details with high confidence'
    },
    {
      name: 'Bet without stakes',
      message: '@betty I bet Sarah the Warriors lose tomorrow',
      description: 'Should default stakes to bragging rights'
    },
    {
      name: 'Ambiguous bet - missing opponent',
      message: 'Lakers will win tonight',
      description: 'Should ask for clarification on who the bet is with'
    },
    {
      name: 'Bet with both teams specified',
      message: 'I bet <@U67890|mike> Lakers over Celtics tonight for $5',
      description: 'Should identify both teams'
    },
    {
      name: 'Not a bet',
      message: 'Hey @betty what time is the game?',
      description: 'Should detect no bet intent'
    },
  ];

  const currentDate = new Date('2024-11-07T18:00:00Z');

  for (const testCase of testCases) {
    console.log(`\n📝 Test: ${testCase.name}`);
    console.log(`Message: "${testCase.message}"`);
    console.log(`Expected: ${testCase.description}`);
    console.log('-'.repeat(60));

    try {
      const result = await parseBetIntent(testCase.message, currentDate);

      console.log('Result:');
      console.log(JSON.stringify(result, null, 2));

      // Evaluate result
      if (result.confidence === 'high') {
        console.log('✅ High confidence parse');
      } else if (result.confidence === 'low') {
        console.log('⚠️  Low confidence - may need clarification');
      } else {
        console.log('❌ Unclear - clarification needed');
      }

      if (result.clarifying_question) {
        console.log(`💬 Would ask: "${result.clarifying_question}"`);
      }

    } catch (error) {
      console.error('❌ Test failed with error:', error);
    }

    console.log('='.repeat(60));
  }

  // Test helper functions
  console.log('\n🔧 Testing Helper Functions\n');
  console.log('='.repeat(60));

  const testMention = '<@U12345|john>';
  const userId = extractSlackUserId(testMention);
  console.log(`Extract user ID from "${testMention}": ${userId}`);
  console.log(userId === 'U12345' ? '✅ Correct' : '❌ Failed');

  const testMessage = 'I bet <@U12345> and <@U67890|mike> that Lakers win';
  const allUsers = extractAllUserMentions(testMessage);
  console.log(`\nExtract all mentions from: "${testMessage}"`);
  console.log(`Found: [${allUsers.join(', ')}]`);
  console.log(allUsers.length === 2 ? '✅ Correct' : '❌ Failed');

  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests complete!\n');
}

// Run tests
testBetParsing().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
