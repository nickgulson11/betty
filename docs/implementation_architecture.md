# Betty March Madness - Technical Implementation Architecture

**Created:** 2025-02-08
**Status:** ✅ **COMPLETE - All systems operational and tested in live tournament**
**Related:** march_madness_design.md, PROGRESS.md

> **Implementation Complete:** This architecture was fully implemented and successfully ran a live March Madness tournament in March 2026. All components are production-ready.

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         SLACK WORKSPACE                          │
│  ┌──────────────────┐              ┌─────────────────────────┐  │
│  │  Main Channel    │              │   Participant DMs       │  │
│  │  - Announcements │              │   - Pick submissions    │  │
│  │  - Leaderboard   │◄────────────►│   - Confirmations       │  │
│  │  - Eliminations  │              │   - Reminders           │  │
│  └──────────────────┘              └─────────────────────────┘  │
└────────────────┬────────────────────────────┬───────────────────┘
                 │                            │
                 │ Slack Events API           │ Slack Web API
                 │                            │
┌────────────────▼────────────────────────────▼───────────────────┐
│                      BETTY APPLICATION                           │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              FEATURE FLAG ROUTER (BETTY_MODE)             │  │
│  │    ┌──────────────────┐      ┌──────────────────────┐    │  │
│  │    │  betting mode    │      │  march_madness mode  │    │  │
│  │    │  (preserved)     │      │  (new)               │    │  │
│  │    └──────────────────┘      └──────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │             MARCH MADNESS COMPONENTS                        │ │
│  │                                                             │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │ │
│  │  │ Slack Bot    │  │ Pick Manager │  │ Pool Manager     │ │ │
│  │  │ - DM Handler │  │ - Validation │  │ - Rounds         │ │ │
│  │  │ - Mentions   │  │ - Submission │  │ - Participants   │ │ │
│  │  │ - Reactions  │  │ - Updates    │  │ - Eliminations   │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘ │ │
│  │                                                             │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │ │
│  │  │ NCAA Service │  │ Notification │  │ Admin API        │ │ │
│  │  │ - ESPN API   │  │ Manager      │  │ - Auth           │ │ │
│  │  │ - Results    │  │ - Reminders  │  │ - Pool CRUD      │ │ │
│  │  │ - Schedule   │  │ - Broadcasts │  │ - Participants   │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘ │ │
│  │                                                             │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │              SHARED SERVICES                          │ │ │
│  │  │  - Claude AI Service (adapted for MM announcements)  │ │ │
│  │  │  - Database Service (PostgreSQL)                     │ │ │
│  │  │  - Personality Service (Betty's sassy voice)         │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  ADMIN WEB CONSOLE                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │ │
│  │  │ Dashboard    │  │ Participant  │  │ Betty Chat       │ │ │
│  │  │ - Overview   │  │ Management   │  │ Console          │ │ │
│  │  │ - Stats      │  │ - Add/Remove │  │ - Send Messages  │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘ │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │ │
│  │  │ Picks View   │  │ Payment      │  │ Tournament       │ │ │
│  │  │ - All Picks  │  │ Tracking     │  │ Management       │ │ │
│  │  │ - Edit/Fix   │  │ - Mark Paid  │  │ - Rounds/Teams   │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────┬────────────────────────────┬───────────────────┘
                 │                            │
                 │                            │
┌────────────────▼───────────┐   ┌───────────▼──────────────────┐
│   PostgreSQL Database      │   │   External APIs              │
│   - pools                  │   │   - ESPN NCAA API            │
│   - participants           │   │   - Claude AI API            │
│   - picks                  │   │   - Slack API                │
│   - tournament_teams       │   │                              │
│   - game_results           │   │                              │
│   - admin_actions          │   │                              │
│   - bets (legacy)          │   │                              │
└────────────────────────────┘   └──────────────────────────────┘
```

---

## File Structure

```
betty/
├── src/
│   ├── index.ts                      # Entry point - mode router
│   │
│   ├── betting/                      # LEGACY - Preserved behind feature flag
│   │   ├── bot/
│   │   │   └── slackBot.ts
│   │   ├── services/
│   │   │   ├── betManager.ts
│   │   │   ├── nbaService.ts
│   │   │   ├── nflService.ts
│   │   │   └── resultsService.ts
│   │   └── scheduler/
│   │       └── settlementScheduler.ts
│   │
│   ├── march-madness/                # NEW - March Madness pool
│   │   ├── bot/
│   │   │   ├── dmHandler.ts         # Handle participant DMs
│   │   │   ├── channelHandler.ts    # Handle main channel events
│   │   │   └── messageFormatter.ts  # Format Slack messages
│   │   │
│   │   ├── services/
│   │   │   ├── poolManager.ts       # Pool lifecycle, rounds, participants
│   │   │   ├── pickManager.ts       # Pick submission, validation, updates
│   │   │   ├── ncaaService.ts       # ESPN API for tournament data
│   │   │   ├── notificationManager.ts # Reminders, announcements
│   │   │   ├── leaderboardService.ts  # Generate standings
│   │   │   └── tiebreakerService.ts   # Seed-sum tiebreaker logic (highest sum of seeds picked wins)
│   │   │
│   │   ├── admin/
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts          # Login/logout
│   │   │   │   ├── pool.ts          # Pool management endpoints
│   │   │   │   ├── participants.ts  # Participant CRUD
│   │   │   │   ├── picks.ts         # View/edit picks
│   │   │   │   ├── betty.ts         # Send custom messages
│   │   │   │   └── reports.ts       # Leaderboard, exports
│   │   │   │
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts          # Password protection
│   │   │   │
│   │   │   └── public/              # Frontend static files
│   │   │       ├── index.html       # Login page
│   │   │       ├── dashboard.html   # Admin dashboard
│   │   │       ├── css/
│   │   │       │   └── admin.css
│   │   │       └── js/
│   │   │           ├── dashboard.js
│   │   │           ├── participants.js
│   │   │           └── betty-chat.js
│   │   │
│   │   ├── models/
│   │   │   ├── pool.ts              # Pool database queries
│   │   │   ├── participant.ts       # Participant queries
│   │   │   ├── pick.ts              # Pick queries
│   │   │   ├── team.ts              # Tournament team queries
│   │   │   └── gameResult.ts        # Game result queries
│   │   │
│   │   ├── types/
│   │   │   ├── pool.ts              # Pool types
│   │   │   ├── participant.ts       # Participant types
│   │   │   ├── pick.ts              # Pick types
│   │   │   └── ncaa.ts              # NCAA API types
│   │   │
│   │   └── scheduler/
│   │       └── poolScheduler.ts     # Cron jobs for reminders, result fetching
│   │
│   ├── shared/                       # SHARED - Used by both modes
│   │   ├── models/
│   │   │   └── database.ts          # PostgreSQL connection
│   │   ├── services/
│   │   │   ├── claudeService.ts     # Claude AI client
│   │   │   └── personalityService.ts # Betty's personality
│   │   └── utils/
│   │       ├── logger.ts            # Logging
│   │       └── helpers.ts           # Common utilities
│   │
│   └── config/
│       └── mode.ts                   # Feature flag logic
│
├── database/
│   ├── schema.sql                    # Legacy betting schema
│   ├── march-madness-schema.sql      # New MM schema
│   └── migrations/
│       └── 001_add_march_madness_tables.sql
│
├── docs/
│   ├── march_madness_design.md       # Design document (created above)
│   ├── implementation_architecture.md # This file
│   └── admin_guide.md                # Admin console user guide (TBD)
│
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Feature Flag Implementation

### Environment Variable
```bash
# .env
BETTY_MODE=march_madness  # or 'betting' for legacy mode
```

### Mode Router (`src/index.ts`)
```typescript
import dotenv from 'dotenv';
import { testConnection } from './shared/models/database';
import { getMode } from './config/mode';

dotenv.config();

async function main() {
  console.log('🤖 Betty Bot Starting...\n');

  const mode = getMode();
  console.log(`📍 Running in ${mode.toUpperCase()} mode\n`);

  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('❌ Database connection failed');
    process.exit(1);
  }

  // Route to appropriate mode
  if (mode === 'betting') {
    console.log('🎲 Starting Betting Bot...');
    const { startBettingBot } = await import('./betting/bot/slackBot');
    await startBettingBot(parseInt(process.env.PORT || '3000', 10));
  } else if (mode === 'march_madness') {
    console.log('🏀 Starting March Madness Pool...');
    const { startMarchMadnessBot } = await import('./march-madness/bot/channelHandler');
    const { startAdminServer } = await import('./march-madness/admin/server');

    await startMarchMadnessBot(parseInt(process.env.PORT || '3000', 10));
    await startAdminServer(parseInt(process.env.ADMIN_PORT || '3001', 10));
  } else {
    console.error(`❌ Unknown mode: ${mode}`);
    process.exit(1);
  }

  console.log('✅ Betty is ready!\n');
}

main().catch((error) => {
  console.error('❌ Error starting Betty:', error);
  process.exit(1);
});
```

### Mode Config (`src/config/mode.ts`)
```typescript
export type BettyMode = 'betting' | 'march_madness';

export function getMode(): BettyMode {
  const mode = process.env.BETTY_MODE || 'march_madness';

  if (mode !== 'betting' && mode !== 'march_madness') {
    console.warn(`⚠️  Invalid BETTY_MODE: ${mode}. Defaulting to march_madness.`);
    return 'march_madness';
  }

  return mode as BettyMode;
}

export function isBettingMode(): boolean {
  return getMode() === 'betting';
}

export function isMarchMadnessMode(): boolean {
  return getMode() === 'march_madness';
}
```

---

## Database Migration Strategy

### Step 1: Preserve Existing Schema
- Do NOT delete or modify existing `bets` table
- All legacy betting tables remain intact

### Step 2: Add New Tables
```sql
-- Run migration: database/migrations/001_add_march_madness_tables.sql

CREATE TABLE pools (...);
CREATE TABLE participants (...);
CREATE TABLE picks (...);
CREATE TABLE tournament_teams (...);
CREATE TABLE game_results (...);
CREATE TABLE admin_actions (...);
```

### Step 3: Migration Script
```bash
# Create migration
psql $DATABASE_URL < database/migrations/001_add_march_madness_tables.sql

# Verify
psql $DATABASE_URL -c "\dt"  # Should show both old and new tables
```

---

## Reusable Components Mapping

### Component Reuse Plan

| Old Component | New Usage | Modifications Needed |
|---------------|-----------|---------------------|
| `models/database.ts` | Shared DB connection | ✅ No changes, move to `shared/` |
| `services/claudeService.ts` | Personality generation | ✅ Adapt prompts for MM context |
| `services/personalityService.ts` | Betty's voice | ✅ Add MM-specific templates |
| `bot/slackBot.ts` | Slack initialization | ⚠️ Split into betting-specific and shared logic |
| `types/bet.ts` | Type definitions | ❌ Keep separate, create new `types/pick.ts` |
| `scheduler/settlementScheduler.ts` | Cron jobs | ⚠️ Create new `scheduler/poolScheduler.ts` |
| Environment setup | Startup checks | ✅ Move to shared, add mode routing |

### Shared Services Directory

Move these to `src/shared/`:
```
src/shared/
├── models/
│   └── database.ts          # PostgreSQL pool (unchanged)
├── services/
│   ├── claudeService.ts     # Claude AI client
│   └── personalityService.ts # Betty personality templates
└── utils/
    └── logger.ts            # Logging utilities
```

---

## Admin Console Architecture

### Backend: Express API

#### Authentication
```typescript
// src/march-madness/admin/middleware/auth.ts

import { Request, Response, NextFunction } from 'express';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
```

#### API Routes
```typescript
// src/march-madness/admin/server.ts

import express from 'express';
import path from 'path';
import { requireAuth } from './middleware/auth';
import poolRoutes from './routes/pool';
import participantRoutes from './routes/participants';
import pickRoutes from './routes/picks';
import bettyRoutes from './routes/betty';

const app = express();

app.use(express.json());

// Serve static files (HTML/CSS/JS)
app.use('/admin', express.static(path.join(__dirname, 'public')));

// API routes (protected)
app.use('/api/pool', requireAuth, poolRoutes);
app.use('/api/participants', requireAuth, participantRoutes);
app.use('/api/picks', requireAuth, pickRoutes);
app.use('/api/betty', requireAuth, bettyRoutes);

// Login endpoint (no auth required)
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;

  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, token: password });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

export async function startAdminServer(port: number) {
  app.listen(port, () => {
    console.log(`🔐 Admin console running on http://localhost:${port}/admin`);
  });
}
```

### Frontend: Vanilla JS (Simple & Fast)

#### Dashboard HTML (`admin/public/dashboard.html`)
```html
<!DOCTYPE html>
<html>
<head>
  <title>Betty Admin - March Madness Pool</title>
  <link rel="stylesheet" href="/admin/css/admin.css">
</head>
<body>
  <nav>
    <h1>🏀 Betty Admin Console</h1>
    <button id="logout-btn">Logout</button>
  </nav>

  <main>
    <section id="dashboard">
      <h2>Pool Overview</h2>
      <div class="stats">
        <div class="stat-card">
          <h3 id="total-participants">0</h3>
          <p>Total Participants</p>
        </div>
        <div class="stat-card">
          <h3 id="active-participants">0</h3>
          <p>Still Alive</p>
        </div>
        <div class="stat-card">
          <h3 id="current-round">-</h3>
          <p>Current Round</p>
        </div>
      </div>
    </section>

    <section id="quick-actions">
      <h2>Quick Actions</h2>
      <button onclick="showBettyChat()">Send Betty Message</button>
      <button onclick="showAddParticipant()">Add Participant</button>
      <button onclick="viewPicks()">View All Picks</button>
    </section>

    <section id="participants-list">
      <h2>Participants</h2>
      <table id="participants-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Paid</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>
  </main>

  <script src="/admin/js/dashboard.js"></script>
</body>
</html>
```

#### Dashboard JS (`admin/public/js/dashboard.js`)
```javascript
// Get auth token from localStorage
const token = localStorage.getItem('admin_token');
if (!token) {
  window.location.href = '/admin/index.html';
}

// API helper
async function api(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`/api${endpoint}`, options);

  if (response.status === 401) {
    localStorage.removeItem('admin_token');
    window.location.href = '/admin/index.html';
  }

  return response.json();
}

// Load dashboard data
async function loadDashboard() {
  const pool = await api('/pool');
  const participants = await api('/participants');

  document.getElementById('total-participants').textContent = participants.length;
  document.getElementById('active-participants').textContent =
    participants.filter(p => p.status === 'active').length;
  document.getElementById('current-round').textContent = pool.current_round || 'Not Started';

  renderParticipantsTable(participants);
}

function renderParticipantsTable(participants) {
  const tbody = document.querySelector('#participants-table tbody');
  tbody.innerHTML = participants.map(p => `
    <tr>
      <td>${p.slack_username}</td>
      <td>${p.status}</td>
      <td>${p.paid ? '✅' : '❌'}</td>
      <td>
        <button onclick="viewParticipant('${p.id}')">View</button>
        ${!p.paid ? `<button onclick="markPaid('${p.id}')">Mark Paid</button>` : ''}
      </td>
    </tr>
  `).join('');
}

// Load on page load
loadDashboard();
```

---

## API Endpoints Reference

### Pool Management
```
GET    /api/pool              - Get current pool details
POST   /api/pool              - Create new pool
PUT    /api/pool/:id          - Update pool settings
DELETE /api/pool/:id          - Delete pool
POST   /api/pool/advance      - Advance to next round
```

### Participant Management
```
GET    /api/participants           - List all participants
POST   /api/participants           - Add new participant
GET    /api/participants/:id       - Get participant details
PUT    /api/participants/:id       - Update participant
DELETE /api/participants/:id       - Remove participant
POST   /api/participants/:id/paid  - Mark as paid
POST   /api/participants/:id/eliminate - Manually eliminate
```

### Pick Management
```
GET    /api/picks                   - Get all picks for current round
GET    /api/picks/participant/:id   - Get picks for specific participant
POST   /api/picks                   - Create/update pick (admin override)
PUT    /api/picks/:id               - Edit existing pick
DELETE /api/picks/:id               - Delete pick
```

### Betty Chat
```
POST   /api/betty/message           - Send custom message
  Body: {
    destination: 'channel' | 'dm',
    target: 'slack_user_id' (if DM),
    message: 'Message text'
  }
```

### Reports
```
GET    /api/reports/leaderboard     - Current standings
GET    /api/reports/picks-summary   - Pick distribution by round
GET    /api/reports/export-csv      - Export all data to CSV
```

---

## NCAA Service Integration

### ESPN API Example

```typescript
// src/march-madness/services/ncaaService.ts

interface ESPNGame {
  id: string;
  name: string;
  shortName: string;
  date: string;
  competitions: Array<{
    competitors: Array<{
      team: {
        displayName: string;
        abbreviation: string;
      };
      score: string;
      winner: boolean;
    }>;
    status: {
      type: {
        completed: boolean;
      };
    };
  }>;
}

export async function fetchTournamentGames(date: Date): Promise<ESPNGame[]> {
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100`;

  const response = await fetch(url);
  const data = await response.json();

  return data.events || [];
}

export async function getGameResult(team: string, date: Date): Promise<{
  won: boolean;
  opponent: string;
  score: string;
} | null> {
  const games = await fetchTournamentGames(date);

  for (const game of games) {
    const competition = game.competitions[0];
    const competitors = competition.competitors;

    const teamData = competitors.find(c =>
      c.team.displayName.toLowerCase().includes(team.toLowerCase())
    );

    if (teamData && competition.status.type.completed) {
      const opponent = competitors.find(c => c.team.displayName !== teamData.team.displayName);

      return {
        won: teamData.winner,
        opponent: opponent?.team.displayName || 'Unknown',
        score: `${competitors[0].score}-${competitors[1].score}`
      };
    }
  }

  return null;
}
```

---

## Scheduler Jobs

```typescript
// src/march-madness/scheduler/poolScheduler.ts

import cron from 'node-cron';
import { fetchAndUpdateGameResults } from '../services/ncaaService';
import { sendPickReminders } from '../services/notificationManager';
import { processRoundResults } from '../services/poolManager';

export function startPoolScheduler() {
  // Check for game results every 30 minutes during tournament
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏰ Checking for game results...');
    await fetchAndUpdateGameResults();
    await processRoundResults();
  });

  // Send pick reminders daily at 9 AM ET
  cron.schedule('0 9 * * *', async () => {
    console.log('📬 Sending pick reminders...');
    await sendPickReminders();
  });

  console.log('⏰ Pool scheduler started');
}
```

---

## Security Considerations

### Admin Console
- ✅ Password protection via environment variable
- ✅ HTTPS required in production (via hosting platform)
- ⚠️ Single shared password (upgrade to multi-user auth later)
- ✅ All admin actions logged in `admin_actions` table

### Slack Integration
- ✅ Signing secret verification (already implemented)
- ✅ Bot token stored in environment variable
- ✅ DM privacy (picks not visible to other participants)

### Database
- ✅ Connection pooling with limits
- ✅ Prepared statements (SQL injection prevention)
- ✅ Automated backups (via hosting platform)

---

## Testing Strategy

### Unit Tests (Future)
```
src/march-madness/services/__tests__/
├── pickManager.test.ts
├── poolManager.test.ts
├── ncaaService.test.ts
└── tiebreakerService.test.ts
```

### Integration Tests (Future)
```
src/march-madness/__tests__/
├── pick-submission-flow.test.ts
├── elimination-flow.test.ts
└── admin-api.test.ts
```

### Manual Testing Checklist
- [ ] Participant can submit pick via DM
- [ ] Participant receives confirmation
- [ ] Duplicate team prevents submission
- [ ] Pick deadline prevents late submission
- [ ] Admin can view all picks
- [ ] Admin can send custom Betty message
- [ ] Game results auto-update picks
- [ ] Eliminations posted to main channel
- [ ] Leaderboard accurate
- [ ] Tiebreaker calculation correct

---

## Deployment Checklist

### Environment Variables
```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_MAIN_CHANNEL_ID=C...

# Claude
ANTHROPIC_API_KEY=sk-ant-...

# Database
DATABASE_URL=postgresql://...

# Betty Config
BETTY_MODE=march_madness
PERSONALITY_MODE=true

# Admin Console
ADMIN_PASSWORD=secure-password-here
ADMIN_PORT=3001
PORT=3000

# Optional
NODE_ENV=production
```

### Pre-Launch
- [ ] Test ESPN API reliability
- [ ] Verify database schema migrated
- [ ] Admin console accessible
- [ ] Slack bot responds to DMs
- [ ] Cron jobs running
- [ ] Backups configured
- [ ] Monitoring/alerts set up

### Launch Day
- [ ] Admin adds all participants
- [ ] Betty sends welcome DMs
- [ ] Pin rules in main channel
- [ ] Set Round of 64 deadline
- [ ] Test pick submission with 2-3 participants

---

*End of Implementation Architecture Document*
