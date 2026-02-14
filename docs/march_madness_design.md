# Betty March Madness Pool - Design Document

**Created:** 2025-02-08
**Status:** Design Phase
**Target Launch:** March 2025

---

## Executive Summary

Betty will be repurposed to host a survivor-style March Madness pool within a Slack workspace. Participants pick one team per round (6 rounds total), cannot reuse teams, and are eliminated when their team loses. The last person standing wins.

**Key Features:**
- Round-by-round pick submission via DM to Betty
- Public announcements and leaderboard in main Slack channel
- Password-protected admin web console for pool management
- Automatic game result fetching from NCAA/ESPN APIs
- Payment tracking and participant management
- Tiebreaker system for multiple survivors

---

## Tournament Rules

### Round Structure
1. **Round of 64** (First Round)
2. **Round of 32** (Second Round)
3. **Sweet Sixteen**
4. **Elite Eight**
5. **Final Four**
6. **Championship Game**

### Participation Rules
- Each participant picks ONE team per round (6 total picks across the tournament)
- **No team can be used twice** (if you pick Duke in Round of 64, Duke is unavailable for all other rounds)
- Multiple participants can pick the same team in the same round
- Picks must be submitted before the first game of each round starts
- Users can change their pick any time before the deadline (latest submission wins)
- **Miss the deadline = Automatic elimination**

### Elimination & Advancement
- If your team wins their game(s) in a round, you advance to the next round
- If your team loses, you are eliminated from the pool
- If all your remaining eligible teams play each other in one matchup, you're guaranteed elimination in the next round

### Winning & Tiebreaker
- Last person standing wins the pool
- **Tiebreaker:** If multiple people survive all 6 rounds, winner is determined by the highest sum of seeds picked across all rounds (lower seed number = stronger team = harder pick = more points)

### Payment
- Entry fee required (amount TBD by admin)
- Admin tracks payment status via console
- Admin enforces payment policy

---

## User Experience

### Participant Flow

#### 1. Registration
- Admin manually adds participants via web console
- Betty sends welcome DM to each participant with rules and instructions

#### 2. Pick Submission (Each Round)
- Participant DMs Betty with their pick for the current round
- Betty validates:
  - Round is currently accepting picks
  - Team hasn't been used by this participant before
  - Team is still in the tournament
  - Deadline hasn't passed
- Betty confirms pick via DM

#### 3. Pick Changes
- Participants can DM Betty to change their pick before deadline
- Betty confirms the updated pick
- Only the latest submission counts

#### 4. Round Results
- After round completes, Betty announces results in main channel:
  - Who advanced
  - Who was eliminated (and which team caused elimination)
  - Updated leaderboard/standings

#### 5. Championship Tiebreaker
- If multiple participants survive all 6 rounds, tiebreaker is calculated automatically from picks already submitted
- No additional input needed from participants

### Main Channel Communication
Betty posts to the main Slack channel:
- Tournament start announcement
- Pick deadline reminders (e.g., "24 hours until Round of 32 picks are due!")
- Round completion results
- Elimination announcements
- Current standings/leaderboard
- Championship winner announcement

### DM Communication
Betty sends DMs to individual participants:
- Welcome message with rules
- Pick confirmations
- Pick deadline reminders (personalized if they haven't submitted)
- Elimination notification
- Tiebreaker result notification (if applicable)

---

## Admin Console (Web-Based)

### Access
- Password-protected web interface
- Accessible at `/admin` route
- Single admin password (can be updated later for multi-admin support)

### Features

#### 1. Dashboard
- Pool overview:
  - Total participants
  - Active participants (still alive)
  - Eliminated participants
  - Payment status summary
  - Current round status
- Quick actions:
  - Advance to next round
  - Send custom Betty message
  - View all picks for current round

#### 2. Participant Management
- **Add Participant:**
  - Enter Slack User ID or @username
  - Betty sends welcome DM
- **Remove Participant:**
  - Mark as withdrawn (preserves history)
- **Payment Tracking:**
  - Mark participant as paid/unpaid
  - View payment status for all participants
  - Filter by payment status
- **Manual Elimination:**
  - Admin can manually eliminate a participant (with reason)
- **View Participant Details:**
  - All picks (past and current)
  - Teams used (unavailable teams)
  - Remaining eligible teams
  - Payment status
  - Elimination status

#### 3. Tournament Management
- **Round Control:**
  - View current round
  - Close current round (stop accepting picks)
  - Advance to next round
  - Set pick deadline for each round
- **Team Management:**
  - View all teams in tournament
  - Mark teams as eliminated (manual override if auto-fetch fails)
  - View which teams are still active
- **Results Entry (Manual Fallback):**
  - If auto-fetch fails, admin can manually mark game results
  - Input: Team name, Win/Loss

#### 4. Betty Chat Console
- **Send Custom Message:**
  - Compose message as Betty
  - Preview before sending
  - Choose destination:
    - Main channel (public announcement)
    - Specific participant (DM)
    - All participants (broadcast DM)
- **Message Templates:**
  - Pre-built templates for common announcements
  - Variables: {participant}, {round}, {team}, etc.

#### 5. Picks Dashboard
- **View All Picks:**
  - Current round: See everyone's picks in real-time
  - Past rounds: Historical view
  - Filter by participant
  - Export picks to CSV
- **Pick Status:**
  - Submitted vs Not Submitted
  - Highlight participants who haven't picked yet
- **Edit Pick (Override):**
  - Admin can edit/fix a participant's pick if they made an error
  - Requires confirmation

#### 6. Leaderboard & Reports
- **Current Standings:**
  - Active participants
  - Eliminated participants (with round of elimination)
  - Teams used by each participant
- **Reports:**
  - Most popular picks per round
  - Elimination timeline
  - Payment report
  - Export all data to CSV/JSON

---

## Technical Architecture

### Feature Flag System
- Preserve existing betting functionality behind feature flag
- Environment variable: `BETTY_MODE=betting|march_madness`
- Separate route handlers and services by mode
- Shared components: Slack bot initialization, database connection, Claude service

### Database Schema

#### New Tables

##### `pools`
Represents a tournament pool instance
```sql
CREATE TABLE pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  sport VARCHAR(50) NOT NULL DEFAULT 'NCAA Basketball',
  status VARCHAR(20) NOT NULL, -- setup, active, completed
  current_round VARCHAR(50), -- 'Round of 64', 'Round of 32', etc.
  entry_fee DECIMAL(10,2),
  slack_channel_id TEXT NOT NULL,
  admin_slack_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
```

##### `participants`
Users in the pool
```sql
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  slack_username TEXT,
  status VARCHAR(20) NOT NULL, -- active, eliminated, withdrawn
  eliminated_round VARCHAR(50), -- which round they were eliminated
  eliminated_team TEXT, -- which team caused elimination
  paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMP,
  seed_sum INTEGER DEFAULT 0, -- Running sum of seeds picked across all rounds (used for tiebreaker)
  joined_at TIMESTAMP DEFAULT NOW(),
  eliminated_at TIMESTAMP,
  UNIQUE(pool_id, slack_user_id)
);

CREATE INDEX idx_participants_pool ON participants(pool_id);
CREATE INDEX idx_participants_status ON participants(pool_id, status);
```

##### `picks`
Team selections per round
```sql
CREATE TABLE picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  round VARCHAR(50) NOT NULL,
  team_name TEXT NOT NULL,
  team_seed INTEGER,
  result VARCHAR(20), -- won, lost, pending
  submitted_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(participant_id, round) -- One pick per participant per round
);

CREATE INDEX idx_picks_participant ON picks(participant_id);
CREATE INDEX idx_picks_round ON picks(pool_id, round);
```

##### `tournament_teams`
Teams in the tournament (snapshot at start)
```sql
CREATE TABLE tournament_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  seed INTEGER,
  region VARCHAR(50),
  status VARCHAR(20) NOT NULL, -- active, eliminated
  eliminated_round VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_teams_pool ON tournament_teams(pool_id);
CREATE INDEX idx_teams_status ON tournament_teams(pool_id, status);
```

##### `game_results`
NCAA game results per round
```sql
CREATE TABLE game_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  round VARCHAR(50) NOT NULL,
  game_id TEXT, -- ESPN/NCAA API game ID
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  winner TEXT,
  home_score INTEGER,
  away_score INTEGER,
  game_date TIMESTAMP,
  status VARCHAR(20), -- scheduled, in_progress, completed
  fetched_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_results_pool_round ON game_results(pool_id, round);
```

##### `admin_actions`
Audit log for admin console actions
```sql
CREATE TABLE admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  admin_user_id TEXT NOT NULL,
  action_type VARCHAR(50) NOT NULL, -- add_participant, eliminate, edit_pick, send_message, etc.
  target_participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,
  action_details JSONB, -- Flexible field for action-specific data
  performed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_actions_pool ON admin_actions(pool_id);
CREATE INDEX idx_admin_actions_time ON admin_actions(performed_at DESC);
```

### Reusable Components from Existing Codebase

#### From Current Betty Betting Bot:
- ✅ **Slack Bot Initialization** (`bot/slackBot.ts`)
  - Event listeners structure
  - DM handling
  - Message formatting utilities
- ✅ **Database Connection** (`models/database.ts`)
  - PostgreSQL pool setup
  - Connection testing
- ✅ **Claude Service** (`services/claudeService.ts`)
  - API client initialization
  - Can adapt for pick validation, response generation
- ✅ **Personality Service** (Optional)
  - Adapt Betty's sassy personality for March Madness announcements
  - Generate custom elimination/advancement messages
- ✅ **Environment Setup** (`index.ts`)
  - .env loading
  - Startup checks
  - Graceful shutdown

#### New Components Needed:
- **NCAA Service** - Fetch tournament data and results from ESPN/NCAA API
- **Pick Manager** - Handle pick submission, validation, updates
- **Pool Manager** - Manage pool lifecycle, rounds, participants
- **Admin API** - Express routes for web console
- **Admin Web UI** - React/Vue frontend for admin console
- **Notification Manager** - Handle reminders and announcements

### API Integration

#### NCAA Tournament Data
**Option 1: ESPN API (Recommended)**
- Endpoint: `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard`
- Free, no authentication required
- Provides real-time scores, schedules, team info
- Similar structure to existing NBA/NFL services in Betty

**Option 2: NCAA API**
- Official NCAA statistics API
- May require API key
- More authoritative but potentially more complex

**Option 3: Manual Entry (Fallback)**
- Admin manually updates game results via console
- Used if API fails or during testing

### Admin Console Tech Stack

**Backend:**
- Express.js routes (add to existing Betty server)
- JWT or session-based authentication
- RESTful API endpoints

**Frontend:**
- Simple HTML/CSS/Vanilla JS (lightweight, no build step)
- OR React (if more complex UI needed)
- Hosted as static files served by Express

**Authentication:**
- Simple password protection initially
- Environment variable: `ADMIN_PASSWORD`
- Can upgrade to multi-user auth later

---

## Implementation Plan

### Phase 1: Foundation (Week 1)
**Goal:** Set up feature flag, database, and basic structure

1. **Feature Flag System**
   - Add `BETTY_MODE` environment variable
   - Create mode-specific entry points
   - Preserve existing betting code (no deletions)

2. **Database Schema**
   - Create new tables for March Madness
   - Write migration scripts
   - Seed test data

3. **Project Structure**
   - Create new directories:
     ```
     src/
       march-madness/
         services/
         models/
         bot/
         admin/
         types/
     ```

### Phase 2: Admin Console (Week 2)
**Goal:** Build password-protected admin interface

1. **Backend API**
   - Authentication middleware
   - Pool management endpoints
   - Participant CRUD endpoints
   - Picks viewing/editing endpoints

2. **Frontend UI**
   - Login page
   - Dashboard
   - Participant management
   - Betty Chat console
   - Basic styling

3. **Admin Actions**
   - Add/remove participants
   - Send custom Betty messages
   - View current picks
   - Mark payments

### Phase 3: Participant Experience (Week 3)
**Goal:** Pick submission and validation via Slack DM

1. **Pick Submission Flow**
   - DM event handlers
   - Pick validation logic
   - Team availability checking
   - Confirmation messages

2. **Pick Management**
   - Update existing picks (before deadline)
   - Prevent team reuse
   - Store pick history

3. **Notifications**
   - Welcome DMs to new participants
   - Pick confirmations
   - Deadline reminders

### Phase 4: Tournament Automation (Week 4)
**Goal:** Auto-fetch results and update standings

1. **NCAA Service**
   - ESPN API integration
   - Fetch tournament schedule
   - Fetch game results
   - Map API teams to pool teams

2. **Results Processing**
   - Auto-update game results
   - Determine pick outcomes (won/lost)
   - Eliminate participants whose teams lost
   - Advance participants whose teams won

3. **Round Progression**
   - Detect when round is complete
   - Trigger next round setup
   - Admin approval before advancing

### Phase 5: Announcements & Leaderboard (Week 5)
**Goal:** Public channel communication

1. **Main Channel Announcements**
   - Tournament start
   - Pick deadline reminders
   - Round results
   - Eliminations
   - Leaderboard updates

2. **Leaderboard Generation**
   - Active participants count
   - Eliminated participants (with details)
   - Most popular picks
   - Formatted Slack messages

3. **Personality Mode**
   - Adapt sassy Betty personality for March Madness
   - Claude-generated elimination roasts
   - Celebration messages for survivors

### Phase 6: Tiebreaker & Testing (Week 6)
**Goal:** Seed-sum tiebreaker and end-to-end testing

1. **Tiebreaker System**
   - `seed_sum` column on `participants` table — incremented by the results processor when picks lock at round end (not at submission time)
   - Admin console shows `seed_sum` per participant — admin handles comms manually
   - Highest seed sum wins in a tiebreaker scenario

2. **Edge Case Handling**
   - Missed pick deadlines (auto-elimination)
   - All eligible teams play each other
   - API failures (manual fallback)

3. **Testing**
   - Simulate full tournament with test data
   - Test admin console features
   - Dry run with small group

### Phase 7: Deployment & Launch (Week 7)
**Goal:** Production deployment and real tournament

1. **Production Setup**
   - Deploy to hosting (Railway/Render/Heroku)
   - Configure production database
   - Set up admin password
   - Test Slack workspace integration

2. **Documentation**
   - Admin guide for console
   - Participant instructions (Slack message templates)
   - Troubleshooting guide

3. **Launch Preparation**
   - Announce tournament to Slack workspace
   - Admin adds participants
   - Betty sends welcome DMs
   - Set Round of 64 pick deadline

---

## Open Questions / Future Enhancements

### For Design Phase
- [ ] Confirm entry fee amount
- [ ] Test ESPN NCAA API reliability
- [ ] Decide on exact deadline timing (e.g., "first game tipoff" vs "12 hours before")
- [ ] Admin console UI framework (vanilla JS vs React)
- [ ] Personality mode enabled or neutral Betty?

### Future Features (Post-Launch)
- [ ] Multiple pool support (different friend groups)
- [ ] SMS notifications via Twilio
- [ ] Public leaderboard webpage (no login required)
- [ ] Historical stats (who picks which teams most often)
- [ ] Automated payment collection (Venmo/PayPal integration)
- [ ] Bracket visualization (who picked what in each round)
- [ ] Multi-admin support with role-based permissions
- [ ] Mobile-responsive admin console
- [ ] Real-time dashboard (websockets for live updates)

---

## Success Metrics

### Pre-Tournament
- [ ] All participants successfully registered
- [ ] All participants received welcome DM from Betty
- [ ] Admin console accessible and functional
- [ ] Payment tracking working

### During Tournament
- [ ] >95% pick submission rate (participants submit before deadline)
- [ ] Zero critical bugs requiring manual intervention
- [ ] Auto-fetch game results working for >90% of games
- [ ] Announcements posted within 30 min of round completion

### Post-Tournament
- [ ] Winner correctly determined
- [ ] Tiebreaker (if needed) calculated correctly
- [ ] Participant satisfaction survey >4/5 stars
- [ ] Admin workload <30 min per round

---

## Risk Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| ESPN API unreliable during tournament | High | Medium | Manual fallback in admin console, test API before tournament |
| Participants confused about rules | Medium | High | Clear welcome DM, pinned rules in channel, admin FAQ |
| Database failure during live tournament | High | Low | Automated backups, test restore process, monitoring |
| Participant disputes (pick not recorded) | Medium | Medium | Admin audit log, DM timestamps, admin override ability |
| Missed deadline handling | Medium | Medium | Auto-elimination clearly communicated, test thoroughly |
| Multiple people survive all rounds | Low | Medium | Tiebreaker system in place, tested before championship |

---

## Timeline

**Today (Feb 8):** Design document complete ✅
**Feb 10-16:** Phase 1 - Foundation
**Feb 17-23:** Phase 2 - Admin Console
**Feb 24-Mar 2:** Phase 3 - Participant Experience
**Mar 3-9:** Phase 4 - Tournament Automation
**Mar 10-16:** Phase 5 - Announcements & Leaderboard
**Mar 17-23:** Phase 6 - Tiebreaker & Testing
**Mar 24-30:** Phase 7 - Deployment & Launch

**March Madness 2025 Starts:** ~March 18 (Selection Sunday)
**Round of 64:** ~March 20-21

---

*End of Design Document*
