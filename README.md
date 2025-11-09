# Betty - NBA Betting Bot for Slack

Betty is a conversational betting bot that integrates with Slack to enable friends to make casual bets on NBA games. Using Claude AI for natural language processing, Betty can detect, confirm, track, and automatically settle bets within your Slack workspace.

## Features

- **Natural Language Processing**: Mention @betty with your bet in plain English
- **Easy Bet Confirmation**: React with 👍 to accept or ❌ to decline bets
- **Automatic Settlement**: Checks game results every 30 minutes and settles bets automatically
- **Game Validation**: Verifies NBA games exist and haven't started yet
- **Conversational Clarification**: Asks follow-up questions when bet details are unclear
- **Thread-based Tracking**: All bet activity happens in organized Slack threads

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Database**: PostgreSQL
- **NLP**: Anthropic Claude API (Sonnet 4.5)
- **Chat Platform**: Slack Bolt SDK
- **Scheduling**: node-cron
- **Game Results**: ESPN API + Claude web search

## Prerequisites

Before running Betty, ensure you have:

- Node.js 18+
- PostgreSQL 15+
- A Slack workspace with admin access
- Anthropic Claude API key
- ngrok (for local development)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/nickgulson11/betty.git
   cd betty
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up the database**
   ```bash
   # Create PostgreSQL database
   createdb betty_dev

   # Run schema
   psql betty_dev < database/schema.sql
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in your credentials:
   ```bash
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your-signing-secret
   ANTHROPIC_API_KEY=sk-ant-your-api-key
   DATABASE_URL=postgresql://user:password@localhost:5432/betty_dev
   NODE_ENV=development
   PORT=3000
   TESTING_MODE=false
   ```

## Slack App Setup

1. **Create a Slack app** at [api.slack.com/apps](https://api.slack.com/apps)

2. **Configure OAuth scopes** (Settings → OAuth & Permissions):
   - `app_mentions:read` - Detect @betty mentions
   - `chat:write` - Post messages
   - `reactions:read` - Monitor bet acceptances
   - `users:read` - Get user names

3. **Enable Event Subscriptions** (Settings → Event Subscriptions):
   - Turn on "Enable Events"
   - Request URL: `https://your-ngrok-url.ngrok-free.app/slack/events`
   - Subscribe to bot events:
     - `app_mention`
     - `reaction_added`

4. **Install the app** to your workspace and copy the Bot Token to `.env`

## Usage

### Development

1. **Start ngrok** (in a separate terminal):
   ```bash
   ngrok http 3000
   ```

2. **Update Slack Event Subscriptions** with your ngrok URL:
   ```
   https://your-ngrok-url.ngrok-free.app/slack/events
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Start betting in Slack!**
   ```
   @betty I bet @john that the Lakers beat the Celtics tonight
   ```

### Making Bets

Betty understands natural language. Try:

- `@betty I bet @sarah that Warriors win tonight for $5`
- `@betty @mike I got the Heat over the Knicks tomorrow, bragging rights`
- `@betty betting @alex that Bucks win vs Nets on Friday`

Betty will:
1. Parse your bet details
2. Post a confirmation message
3. Wait for your opponent to react (👍 to accept, ❌ to decline)
4. Automatically settle the bet after the game completes

### Production

Build and start:
```bash
npm run build
npm start
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed production deployment instructions.

## Project Structure

```
betty/
├── src/
│   ├── bot/
│   │   └── slackBot.ts          # Slack event handlers
│   ├── models/
│   │   └── database.ts          # PostgreSQL connection
│   ├── scheduler/
│   │   └── settlementScheduler.ts  # Cron job for bet settlement
│   ├── services/
│   │   ├── betManager.ts        # Bet creation and management
│   │   ├── claudeService.ts     # Claude API integration
│   │   ├── nbaService.ts        # NBA game data
│   │   └── resultsService.ts    # Game result verification
│   ├── types/
│   │   └── bet.ts               # TypeScript type definitions
│   └── index.ts                 # Application entry point
├── database/
│   ├── schema.sql               # Database schema
│   └── setup.sh                 # Database setup script
├── .env.example                 # Environment variable template
├── package.json
└── tsconfig.json
```

## How It Works

### 1. Bet Creation
- User mentions @betty with a bet proposal
- Claude parses the message to extract bet details
- Betty validates the NBA game exists and hasn't started
- Betty posts a confirmation message with reaction options

### 2. Bet Acceptance
- Opponent reacts with 👍 (accept) or ❌ (decline)
- If accepted, bet status changes to "active"
- If declined, bet is cancelled

### 3. Automatic Settlement
- Cron job runs every 30 minutes
- Checks active bets where game time + 30 minutes has passed
- Uses ESPN API and Claude web search to get final scores
- Posts settlement message announcing the winner
- Updates bet status to "settled"

## Database Schema

```sql
CREATE TABLE bets (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP,
  status VARCHAR(20),           -- pending, active, settled, declined, cancelled
  initiator_slack_id TEXT,
  opponent_slack_id TEXT,
  initiator_team TEXT,
  opponent_team TEXT,
  game_date TIMESTAMP,
  stakes TEXT,
  slack_channel_id TEXT,
  slack_thread_ts TEXT,
  slack_message_ts TEXT,
  winner_slack_id TEXT,
  final_score TEXT,
  settled_at TIMESTAMP,
  conversation_state JSONB,
  settlement_attempts INTEGER,
  last_settlement_check TIMESTAMP
);
```

## Testing

Test bet creation with a completed game:
```bash
psql $DATABASE_URL < create_test_bet.sql
```

Query Slack IDs:
```bash
psql $DATABASE_URL < get_slack_ids.sql
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive production deployment instructions.

Recommended hosting providers:
- **Railway** - Easiest deployment
- **Render** - Free tier available
- **Heroku** - Classic PaaS
- **DigitalOcean App Platform** - Affordable and reliable

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token from Slack | Yes |
| `SLACK_SIGNING_SECRET` | Signing Secret from Slack app settings | Yes |
| `ANTHROPIC_API_KEY` | Claude API key from Anthropic | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `NODE_ENV` | Environment (`development` or `production`) | Yes |
| `PORT` | Server port (default: 3000) | No |
| `TESTING_MODE` | Set to `true` to allow self-acceptance of bets | No |

## Troubleshooting

**Slack events not received:**
- Verify ngrok is running and URL is up to date in Slack app settings
- Check that Request URL shows "Verified" in Slack Event Subscriptions
- Ensure server is running on port 3000

**Database connection errors:**
- Verify DATABASE_URL is correct
- Check PostgreSQL is running
- Ensure database schema is created

**Settlement not working:**
- Check cron job logs (`⏰ Running bet settlement check...`)
- Verify server is running continuously (not sleeping)
- Check ESPN API is accessible
