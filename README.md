# Betty - Dual-Mode Slack Bot

Betty is a versatile Slack bot with two distinct modes:
1. **Betting Mode** - Conversational betting bot for NBA/NFL games with automatic settlement
2. **March Madness Mode** - Survivor-style tournament pool with automated pick management ✅ *Production-tested*

Betty uses Claude AI for natural language processing and automatically handles all game tracking and result processing.

## Features

### 🎲 Betting Mode (Legacy)
- **Natural Language Processing**: Mention @betty with your bet in plain English
- **Easy Bet Confirmation**: React with 👍 to accept or ❌ to decline bets
- **Automatic Settlement**: Checks game results every 30 minutes and settles bets automatically
- **Game Validation**: Verifies NBA/NFL games exist and haven't started yet
- **Conversational Clarification**: Asks follow-up questions when bet details are unclear
- **Thread-based Tracking**: All bet activity happens in organized Slack threads

### 🏀 March Madness Mode (Production-Ready)
- **Survivor-Style Pool**: One pick per round, team elimination when pick loses
- **Slack DM Pick Submission**: Natural language team selection ("Duke", "Heels", "Zags")
- **Claude Fuzzy Matching**: Understands nicknames and abbreviations
- **Auto-Result Processing**: ESPN API integration with 30-min polling
- **Smart Elimination**: Automated roast DMs + channel announcements (Claude-generated)
- **Win Celebrations**: Personalized congrats messages for advancing picks
- **Admin Web Console**: Password-protected dashboard for pool management
- **Payment Tracking**: Mark participants as paid before they can submit picks
- **Pick Deadline Enforcement**: Auto-locks when games start (on-demand ESPN verification)
- **Round Advancement**: Automatic progression based on elimination counts
- **Channel Sync**: Bulk participant registration from Slack channel members
- **Date Override**: Testing tool for historical tournament simulation

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

## Mode Switching

Betty uses a feature flag system to switch between modes via the `BETTY_MODE` environment variable:

```bash
# Betting Mode (legacy)
BETTY_MODE=betting

# March Madness Mode (production-ready)
BETTY_MODE=march_madness
```

Both modes share the same database and can coexist. Simply change the environment variable and restart to switch modes.

## Project Structure

```
betty/
├── src/
│   ├── config/
│   │   └── mode.ts                    # Feature flag system
│   ├── shared/                        # Shared across both modes
│   │   ├── models/
│   │   │   └── database.ts            # PostgreSQL connection
│   │   └── services/
│   │       ├── claudeService.ts       # Claude API client
│   │       └── personalityService.ts  # Betty's personality
│   ├── betting/                       # Betting mode (legacy)
│   │   ├── bot/
│   │   │   └── slackBot.ts
│   │   ├── services/
│   │   │   ├── betManager.ts
│   │   │   ├── nbaService.ts
│   │   │   ├── nflService.ts
│   │   │   └── resultsService.ts
│   │   └── scheduler/
│   │       └── settlementScheduler.ts
│   ├── march-madness/                 # March Madness mode
│   │   ├── bot/
│   │   │   └── slackBot.ts            # DM pick submission handlers
│   │   ├── services/
│   │   │   ├── ncaaService.ts         # ESPN NCAA API
│   │   │   ├── pickManager.ts         # Pick validation & submission
│   │   │   ├── resultsProcessor.ts    # Auto-elimination pipeline
│   │   │   ├── teamMatcher.ts         # Claude fuzzy matching
│   │   │   ├── slackMessaging.ts      # DM & channel messaging
│   │   │   └── channelSync.ts         # Bulk participant registration
│   │   ├── models/
│   │   │   ├── pool.ts
│   │   │   ├── participant.ts
│   │   │   ├── pick.ts
│   │   │   └── tournamentTeam.ts
│   │   ├── admin/
│   │   │   ├── routes/                # API endpoints
│   │   │   ├── middleware/            # Auth
│   │   │   ├── public/                # Web console UI
│   │   │   └── server.ts
│   │   ├── scheduler/
│   │   │   └── tournamentScheduler.ts # 30-min ESPN polling
│   │   └── types/
│   └── index.ts                       # Mode router
├── database/
│   ├── schema.sql                     # Betting mode schema
│   ├── march-madness-schema.sql       # March Madness schema
│   └── migrations/
├── docs/                              # Comprehensive documentation
│   ├── PROGRESS.md                    # Project completion tracker
│   ├── march_madness_design.md        # Design document
│   ├── implementation_architecture.md # Technical architecture
│   └── plans/                         # Phase design docs
├── .env.example
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

### Core (Both Modes)
| Variable | Description | Required |
|----------|-------------|----------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token from Slack | Yes |
| `SLACK_SIGNING_SECRET` | Signing Secret from Slack app settings | Yes |
| `ANTHROPIC_API_KEY` | Claude API key from Anthropic | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `NODE_ENV` | Environment (`development` or `production`) | Yes |
| `PORT` | Server port (default: 3000) | No |
| `BETTY_MODE` | Mode selector: `betting` or `march_madness` | Yes |

### Betting Mode Only
| Variable | Description | Required |
|----------|-------------|----------|
| `TESTING_MODE` | Set to `true` to allow self-acceptance of bets | No |

### March Madness Mode Only
| Variable | Description | Required |
|----------|-------------|----------|
| `ADMIN_PASSWORD` | Password for admin web console | Yes |
| `ADMIN_PORT` | Admin console port (default: 3001) | No |
| `SLACK_MAIN_CHANNEL_ID` | Main channel for announcements | Yes |
| `PERSONALITY_MODE` | Enable Claude personality for messages (default: true) | No |

## March Madness Admin Console

When running in March Madness mode, Betty starts two servers:
- **Port 3000**: Slack bot for participant interactions
- **Port 3001**: Admin web console (password-protected)

### Accessing the Console
1. Navigate to `http://localhost:3001/admin` (or your production URL)
2. Enter the admin password (set via `ADMIN_PASSWORD`)
3. Manage your tournament pool

### Admin Features
- **Dashboard**: View pool statistics and participant status
- **Participants**: Add/remove participants, mark as paid, sync channel members
- **Teams**: Bulk import tournament teams, manage eliminations
- **Picks**: View all picks by round, add picks manually
- **Pool Settings**: Configure rounds, status, entry fee, date override for testing
- **Betty Chat**: Send custom messages to channel or individual participants
- **Force Sync**: Manually trigger ESPN result check
- **Simulate**: Test elimination/round-end logic with mock data

### Quick Start (March Madness Mode)
1. Set `BETTY_MODE=march_madness` and restart
2. Access admin console and create a pool
3. Click "Sync Channel Members" to bulk add participants
4. Mark participants as paid (triggers welcome DM)
5. Bulk import tournament teams (64 teams via CSV paste)
6. Participants DM Betty their picks (e.g., "Duke", "Heels")
7. Results process automatically every 30 minutes via ESPN API
8. Betty sends roast DMs to eliminated participants and congrats to winners
9. Round advances automatically when all expected eliminations complete

## Documentation

Comprehensive documentation available in `docs/`:
- **PROGRESS.md** - Project completion tracker with all implementation details
- **march_madness_design.md** - Original design document (fully implemented)
- **implementation_architecture.md** - Technical architecture and system design
- **plans/** - Detailed phase designs and testing documentation

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
