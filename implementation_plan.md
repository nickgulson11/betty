# Betty Implementation Plan

## Project Overview
Betty is a conversational betting bot that integrates with Slack to enable friends to make casual bets on NBA games. Betty uses Claude AI for natural language processing to detect, confirm, track, and settle bets within group chats.

## Design Decisions Made

### Key Choices
1. **NBA Game Data**: Try multiple APIs (ESPN, NBA Stats) and Claude web search - evaluate what works best
2. **Settlement Timing**: Check every 30 minutes starting 30 minutes after game time
   - If game not finalized, delay another 30 min and retry
   - More responsive than 3-hour window
3. **Postponed Games**: Auto-cancel bets and notify users
4. **Ambiguity Handling**: Use Claude's conversational abilities to ask clarifying questions in chat

### Technology Stack
- **Backend**: Node.js with Express + TypeScript
- **Database**: PostgreSQL 15+
- **NLP**: Anthropic Claude API (Sonnet 4.5)
- **Chat Platform**: Slack Bolt SDK
- **Scheduling**: node-cron
- **Game Results**: Claude API with web search + NBA APIs

---

## Implementation Plan

### Phase 1: Foundation (Days 1-2)

#### 1.1 Project Setup
- Initialize Node.js project with TypeScript
- Install dependencies:
  ```bash
  npm init -y
  npm install express @slack/bolt @anthropic-ai/sdk pg node-cron dotenv uuid
  npm install -D typescript @types/node @types/express ts-node nodemon
  ```
- Set up directory structure:
  ```
  src/
    api/          # Express routes
    bot/          # Slack bot handlers
    services/     # Business logic (BetManager, Claude service)
    models/       # Database models
    scheduler/    # Cron jobs for settlement
    utils/        # Helpers
    types/        # TypeScript type definitions
  ```
- Configure TypeScript (tsconfig.json)
- Set up environment variables (.env)

#### 1.2 Database Setup
- Install PostgreSQL locally (or use Docker)
- Create database: `betty_dev`
- Create migration tool setup (node-pg-migrate)
- Create `bets` table schema:
  ```sql
  CREATE TABLE bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL, -- pending, active, settled, declined, cancelled
    initiator_slack_id TEXT NOT NULL,
    opponent_slack_id TEXT NOT NULL,
    initiator_team TEXT NOT NULL,
    opponent_team TEXT NOT NULL,
    game_date TIMESTAMP NOT NULL,
    stakes TEXT DEFAULT 'bragging rights',
    slack_channel_id TEXT NOT NULL,
    slack_thread_ts TEXT NOT NULL,
    slack_message_ts TEXT, -- for the confirmation message
    winner_slack_id TEXT,
    final_score TEXT,
    settled_at TIMESTAMP,
    conversation_state JSONB, -- for multi-turn clarification
    settlement_attempts INTEGER DEFAULT 0,
    last_settlement_check TIMESTAMP
  );

  CREATE INDEX idx_bets_status ON bets(status);
  CREATE INDEX idx_bets_settlement ON bets(status, game_date) WHERE status = 'active';
  ```
- Create seed data for testing

---

### Phase 2: Slack Integration (Days 3-4)

#### 2.1 Slack App Configuration
- Create Slack app at api.slack.com/apps
- Configure OAuth scopes:
  - `app_mentions:read` - Detect @betty mentions
  - `chat:write` - Post messages
  - `reactions:read` - Monitor bet acceptances
  - `users:read` - Get user names
- Set up Event Subscriptions:
  - Subscribe to `app_mention` event
  - Subscribe to `reaction_added` event
- Install ngrok for local development: `ngrok http 3000`
- Set Request URL to ngrok URL + `/slack/events`
- Install app to test workspace
- Save Bot Token and Signing Secret to .env

#### 2.2 Message Receiving
```typescript
// src/bot/slackBot.ts
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Handle @betty mentions
app.event('app_mention', async ({ event, say }) => {
  // Extract message text and user info
  const messageText = event.text;
  const userId = event.user;
  const channelId = event.channel;
  const threadTs = event.ts;

  // TODO: Pass to bet parsing service
  await say({
    text: `Got it! Processing your bet...`,
    thread_ts: threadTs
  });
});

// Start the app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('Betty is running!');
})();
```

---

### Phase 3: Bet Parsing with Claude (Days 5-7)

#### 3.1 Basic Parsing Service
```typescript
// src/services/claudeService.ts
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function parseBetIntent(messageText: string, currentDate: Date) {
  const prompt = `Extract betting details from this message: "${messageText}"

Current date: ${currentDate.toISOString()}

Return JSON with:
- confidence: "high" | "low" | "unclear"
- initiator_name: string (username who made the bet)
- opponent_name: string (username being challenged)
- team: string (team initiator is betting on)
- opponent_team: string (inferred opponent's team)
- timing: "tonight" | "tomorrow" | specific date
- stakes: string | null
- missing_info: string[] (what needs clarification)
- clarifying_question: string | null (question to ask user)

If multiple games match or unclear, set confidence to "unclear" and provide clarifying_question.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  // Parse JSON response
  const content = message.content[0];
  if (content.type === 'text') {
    return JSON.parse(content.text);
  }
}
```

#### 3.2 Conversational Clarification Flow
- Detect when `confidence === "unclear"` or `missing_info.length > 0`
- Store conversation state in database:
  ```typescript
  conversation_state: {
    original_message: string,
    clarification_needed: string[],
    clarification_attempts: number,
    context: any
  }
  ```
- Betty posts clarifying question in thread
- When user responds, fetch conversation state and re-parse with full context
- Limit clarification attempts to 2-3 rounds

#### 3.3 Game Validation Service
```typescript
// src/services/nbaService.ts

// Try multiple data sources
async function getTodayGames(date: Date) {
  // Try ESPN API first
  try {
    const games = await fetchESPNSchedule(date);
    if (games.length > 0) return games;
  } catch (e) {
    console.warn('ESPN API failed, trying NBA Stats API');
  }

  // Fallback to NBA Stats API
  try {
    const games = await fetchNBAStatsSchedule(date);
    if (games.length > 0) return games;
  } catch (e) {
    console.warn('NBA Stats API failed, using Claude web search');
  }

  // Ultimate fallback: Claude with web search
  return await searchGamesWithClaude(date);
}

async function validateTeamAndGame(team: string, timing: string) {
  const games = await getTodayGames(new Date());

  // Normalize team name (handle nicknames)
  const normalizedTeam = normalizeTeamName(team);

  // Find matching game
  const game = games.find(g =>
    g.homeTeam === normalizedTeam || g.awayTeam === normalizedTeam
  );

  if (!game) {
    return { valid: false, error: 'No game found for that team today' };
  }

  if (game.startTime < new Date()) {
    return { valid: false, error: 'Game has already started' };
  }

  return { valid: true, game };
}
```

---

### Phase 4: Bet Confirmation (Days 8-9)

#### 4.1 Create Pending Bet
```typescript
// src/services/betManager.ts

async function createPendingBet(betDetails: ParsedBet, slackInfo: SlackContext) {
  // Insert bet record
  const bet = await db.query(
    `INSERT INTO bets (
      status, initiator_slack_id, opponent_slack_id,
      initiator_team, opponent_team, game_date,
      stakes, slack_channel_id, slack_thread_ts
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    ['pending', betDetails.initiator_id, betDetails.opponent_id,
     betDetails.team, betDetails.opponent_team, betDetails.game_date,
     betDetails.stakes || 'bragging rights',
     slackInfo.channel_id, slackInfo.thread_ts]
  );

  // Post confirmation message
  const message = await slackApp.client.chat.postMessage({
    channel: slackInfo.channel_id,
    thread_ts: slackInfo.thread_ts,
    text: formatConfirmationMessage(bet)
  });

  // Add reactions for acceptance
  await slackApp.client.reactions.add({
    channel: slackInfo.channel_id,
    timestamp: message.ts,
    name: '+1' // thumbs up
  });

  await slackApp.client.reactions.add({
    channel: slackInfo.channel_id,
    timestamp: message.ts,
    name: 'hand' // stop hand
  });

  // Store message timestamp for reaction handling
  await db.query(
    'UPDATE bets SET slack_message_ts = $1 WHERE id = $2',
    [message.ts, bet.id]
  );
}

function formatConfirmationMessage(bet: Bet): string {
  return `🎲 Bet proposed!
<@${bet.initiator_slack_id}> bets <@${bet.opponent_slack_id}> that ${bet.initiator_team} beats ${bet.opponent_team}
Game: ${bet.initiator_team} vs ${bet.opponent_team}, ${formatGameTime(bet.game_date)}
Stakes: ${bet.stakes}

<@${bet.opponent_slack_id}> - React 👍 to accept or ✋ to pass`;
}
```

#### 4.2 Reaction Handling
```typescript
// src/bot/slackBot.ts

app.event('reaction_added', async ({ event }) => {
  // Find bet by message timestamp
  const bet = await db.query(
    'SELECT * FROM bets WHERE slack_message_ts = $1 AND status = $2',
    [event.item.ts, 'pending']
  );

  if (!bet || bet.rows.length === 0) return;

  const betRecord = bet.rows[0];

  // Verify reactor is the opponent
  if (event.user !== betRecord.opponent_slack_id) {
    // Ignore reactions from other users
    return;
  }

  // Handle acceptance
  if (event.reaction === '+1') {
    await db.query(
      'UPDATE bets SET status = $1 WHERE id = $2',
      ['active', betRecord.id]
    );

    await slackApp.client.chat.postMessage({
      channel: betRecord.slack_channel_id,
      thread_ts: betRecord.slack_thread_ts,
      text: `✅ Bet locked! May the best predictor win 🏀`
    });
  }

  // Handle decline
  if (event.reaction === 'hand') {
    await db.query(
      'UPDATE bets SET status = $1 WHERE id = $2',
      ['declined', betRecord.id]
    );

    await slackApp.client.chat.postMessage({
      channel: betRecord.slack_channel_id,
      thread_ts: betRecord.slack_thread_ts,
      text: `✋ Bet declined. Maybe next time!`
    });
  }
});
```

---

### Phase 5: Settlement System (Days 10-12)

#### 5.1 Scheduler Setup
```typescript
// src/scheduler/settlementScheduler.ts
import cron from 'node-cron';

// Run every 30 minutes
cron.schedule('*/30 * * * *', async () => {
  console.log('Running bet settlement check...');

  // Get bets ready for settlement
  const bets = await db.query(`
    SELECT * FROM bets
    WHERE status = 'active'
    AND game_date + INTERVAL '30 minutes' < NOW()
    AND settled_at IS NULL
  `);

  for (const bet of bets.rows) {
    await attemptSettlement(bet);
  }
});

async function attemptSettlement(bet: Bet) {
  try {
    // Increment attempt counter
    await db.query(
      'UPDATE bets SET settlement_attempts = settlement_attempts + 1, last_settlement_check = NOW() WHERE id = $1',
      [bet.id]
    );

    // Check game result
    const result = await checkGameResult(bet);

    if (result.status === 'completed') {
      await settleBet(bet, result);
    } else if (result.status === 'postponed') {
      await cancelBet(bet, 'Game was postponed');
    } else if (result.status === 'in_progress') {
      // Game still ongoing, check again in 30 min
      console.log(`Game still in progress for bet ${bet.id}`);
    }

  } catch (error) {
    console.error(`Error settling bet ${bet.id}:`, error);

    // After 8 attempts (4 hours), give up and notify
    if (bet.settlement_attempts >= 8) {
      await cancelBet(bet, 'Unable to verify game result');
    }
  }
}
```

#### 5.2 Results Verification with Claude
```typescript
// src/services/resultsService.ts

async function checkGameResult(bet: Bet) {
  const prompt = `Search the web for the final score of the NBA game between ${bet.initiator_team} and ${bet.opponent_team} on ${bet.game_date.toDateString()}.

Return JSON with:
- status: "completed" | "in_progress" | "postponed" | "not_found"
- winner: team name | null
- loser: team name | null
- final_score: "Team1 XXX-YYY Team2" | null
- is_final: boolean (true only if game is officially final)

If the game is still in progress or hasn't started, return status "in_progress".
If the game was postponed or cancelled, return status "postponed".`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: prompt
    }],
    // Enable web search
    tools: [{
      type: "web_search_1",
      name: "web_search",
      description: "Search the web for current information"
    }]
  });

  // Parse response
  const content = message.content[0];
  if (content.type === 'text') {
    return JSON.parse(content.text);
  }
}
```

#### 5.3 Bet Settlement
```typescript
async function settleBet(bet: Bet, result: GameResult) {
  // Determine winner
  const initiatorWon = result.winner === bet.initiator_team;
  const winnerId = initiatorWon ? bet.initiator_slack_id : bet.opponent_slack_id;
  const loserId = initiatorWon ? bet.opponent_slack_id : bet.initiator_slack_id;

  // Update database
  await db.query(
    `UPDATE bets
     SET status = 'settled',
         winner_slack_id = $1,
         final_score = $2,
         settled_at = NOW()
     WHERE id = $3`,
    [winnerId, result.final_score, bet.id]
  );

  // Post settlement message
  await slackApp.client.chat.postMessage({
    channel: bet.slack_channel_id,
    thread_ts: bet.slack_thread_ts,
    text: `🏆 Bet settled! ${result.final_score}
<@${winnerId}> wins! <@${loserId}>, pay up those ${bet.stakes} 😤`
  });
}

async function cancelBet(bet: Bet, reason: string) {
  await db.query(
    'UPDATE bets SET status = $1 WHERE id = $2',
    ['cancelled', bet.id]
  );

  await slackApp.client.chat.postMessage({
    channel: bet.slack_channel_id,
    thread_ts: bet.slack_thread_ts,
    text: `❌ Bet cancelled: ${reason}`
  });
}
```

---

### Phase 6: Error Handling & Polish (Days 13-14)

#### 6.1 Error Scenarios
```typescript
// Retry logic for Claude API
async function callClaudeWithRetry(prompt: string, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create({...});
    } catch (error) {
      if (attempt === maxRetries) throw error;

      // Exponential backoff
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}

// Database connection error handling
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  // Alert admin via Slack DM or email
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  await pool.end();
  await slackApp.stop();
  process.exit(0);
});
```

#### 6.2 Edge Cases
- **Game postponement**: Already handled in settlement flow
- **User deletes message**: Check if message exists before posting replies
- **Betty mentioned without bet intent**:
  ```typescript
  if (parsedBet.confidence === 'unclear' && parsedBet.missing_info.includes('no_bet_intent')) {
    await say({
      text: `Hey! I'm Betty, your friendly betting bot. Mention me when you want to make a bet on an NBA game! Example: "I bet @friend that Lakers win tonight @betty"`,
      thread_ts: event.ts
    });
    return;
  }
  ```
- **Duplicate bets**: Check if similar active bet exists before creating
- **NBA overtime games**: Claude should handle final scores regardless of OT

#### 6.3 Logging & Monitoring
```typescript
// src/utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'betty-bot' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ],
});

// Track key metrics
const metrics = {
  bets_created: 0,
  bets_settled: 0,
  parsing_failures: 0,
  settlement_failures: 0,
};

// Log structured events
logger.info('bet_created', {
  bet_id: bet.id,
  initiator: bet.initiator_slack_id,
  parsing_confidence: betDetails.confidence
});
```

---

### Phase 7: Testing & Deployment (Days 15-16)

#### 7.1 Testing Strategy
```typescript
// tests/betParsing.test.ts
describe('Bet Parsing', () => {
  test('parses simple bet correctly', async () => {
    const result = await parseBetIntent(
      'I bet @john that Lakers win tonight @betty',
      new Date('2024-11-06')
    );

    expect(result.confidence).toBe('high');
    expect(result.team).toBe('Lakers');
    expect(result.opponent_name).toBe('john');
  });

  test('asks for clarification on ambiguous bet', async () => {
    const result = await parseBetIntent(
      'They will win tonight @betty',
      new Date('2024-11-06')
    );

    expect(result.confidence).toBe('unclear');
    expect(result.clarifying_question).toBeTruthy();
  });
});

// Integration tests
describe('End-to-End Bet Flow', () => {
  test('complete bet lifecycle', async () => {
    // 1. Create bet
    // 2. Accept bet
    // 3. Mock game completion
    // 4. Verify settlement
  });
});
```

#### 7.2 Deployment
**Option 1: Railway**
```bash
railway init
railway add postgresql
railway up
```

**Option 2: Heroku**
```bash
heroku create betty-bot
heroku addons:create heroku-postgresql:mini
git push heroku main
```

**Option 3: DigitalOcean App Platform**
- Deploy directly from GitHub
- Add PostgreSQL managed database
- Set environment variables

**Environment Variables Needed:**
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
ANTHROPIC_API_KEY=...
DATABASE_URL=postgresql://...
NODE_ENV=production
PORT=3000
```

**Post-Deployment:**
- Update Slack app Request URL to production domain
- Monitor logs for first 24 hours
- Test with real bets in controlled environment
- Set up uptime monitoring (UptimeRobot, Pingdom)

---

## Timeline Estimates

### Optimistic (Full-time, experienced): 2-3 weeks
- Assumes familiarity with all technologies
- Minimal debugging/integration issues
- Claude prompts work well on first tries

### Realistic (Full-time, some learning): 3-4 weeks
- Time for debugging Slack integration
- Iterating on Claude prompts for reliability
- Testing edge cases thoroughly
- Handling unexpected issues

### Part-time/Side Project: 6-8 weeks
- Working 10-15 hours/week
- More context switching overhead
- Time for research and learning

## Acceleration Strategy: "Walking Skeleton"

Build simplest end-to-end flow first (3-5 days):
1. ✅ Basic Slack connection
2. ✅ Hardcode one game/bet (skip NBA API)
3. ✅ Manual settlement trigger (skip scheduler)
4. ✅ Get one complete bet working

Then iterate and add:
- Real NBA game data
- Automated settlement
- Conversational clarification
- Error handling
- Edge cases

---

## Next Steps

When ready to start:
1. Set up development environment (Node.js, PostgreSQL, ngrok)
2. Create Slack app and get credentials
3. Get Anthropic API key
4. Begin with Phase 1: Project Setup

---

## Notes & Considerations

- **NBA API Reliability**: Be prepared to switch data sources if one proves unreliable
- **Claude Prompt Engineering**: Initial prompts may need refinement based on real usage
- **Rate Limits**: Monitor Slack and Claude API rate limits as usage grows
- **Database Backups**: Set up automated backups in production
- **Future WhatsApp Integration**: Keep architecture flexible for adding new chat platforms

---

*Document created: November 6, 2024*
*Last updated: November 6, 2024*