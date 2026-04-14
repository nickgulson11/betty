# NBA Playoffs Pool Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend march-madness mode to support NBA Playoffs survivor pools with series-based elimination (best-of-7).

**Architecture:** Reuse existing march-madness infrastructure (pools, participants, picks, teams) and add `tournament_type` field to distinguish between March Madness (single-game elimination) and NBA Playoffs (series elimination). Create new ESPN NBA Playoffs API service to track series wins/losses. Update results processor to handle both elimination types.

**Tech Stack:** TypeScript, PostgreSQL, ESPN NBA API, existing march-madness services

---

## Task 1: Database Schema - Add Tournament Type Support

**Files:**
- Create: `database/migrations/004_add_tournament_type.sql`
- Modify: `src/march-madness/types/pool.ts`

**Step 1: Write migration to add tournament_type column**

Create `database/migrations/004_add_tournament_type.sql`:

```sql
-- Add tournament_type to pools table
ALTER TABLE pools
ADD COLUMN tournament_type VARCHAR(50) NOT NULL DEFAULT 'march_madness';

-- Add constraint to ensure valid tournament types
ALTER TABLE pools
ADD CONSTRAINT pools_tournament_type_check
CHECK (tournament_type IN ('march_madness', 'nba_playoffs'));

-- Create index for filtering by tournament type
CREATE INDEX idx_pools_tournament_type ON pools(tournament_type);

COMMENT ON COLUMN pools.tournament_type IS 'Type of tournament: march_madness or nba_playoffs';
```

**Step 2: Run migration on local database**

Run:
```bash
psql $DATABASE_URL < database/migrations/004_add_tournament_type.sql
```

Expected: Migration succeeds, column added to pools table

**Step 3: Verify migration**

Run:
```bash
psql $DATABASE_URL -c "\d pools"
```

Expected: `tournament_type` column visible with default 'march_madness'

**Step 4: Update TypeScript types**

Modify `src/march-madness/types/pool.ts`:

```typescript
// Add tournament type enum
export type TournamentType = 'march_madness' | 'nba_playoffs';

// Update Pool interface
export interface Pool {
  id: string;
  name: string;
  sport: string;
  status: PoolStatus;
  current_round: TournamentRound | null;
  tournament_type: TournamentType; // ADD THIS LINE
  entry_fee: number | null;
  slack_channel_id: string;
  admin_slack_id: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  override_date: Date | null;
  current_round_locked: boolean;
}

// Update CreatePoolInput
export interface CreatePoolInput {
  name: string;
  sport: string;
  tournament_type: TournamentType; // ADD THIS LINE
  entry_fee?: number;
  slack_channel_id: string;
  admin_slack_id: string;
}

// Update UpdatePoolInput
export interface UpdatePoolInput {
  name?: string;
  status?: PoolStatus;
  current_round?: TournamentRound;
  tournament_type?: TournamentType; // ADD THIS LINE
  entry_fee?: number;
  override_date?: Date | null;
  current_round_locked?: boolean;
}
```

**Step 5: Commit**

```bash
git add database/migrations/004_add_tournament_type.sql src/march-madness/types/pool.ts
git commit -m "feat: add tournament_type to pools schema and types"
```

---

## Task 2: Round Constants - Add NBA Playoffs Rounds

**Files:**
- Create: `src/march-madness/constants/nbaPlayoffs.ts`
- Modify: `src/march-madness/types/pool.ts`

**Step 1: Update TournamentRound type to include NBA Playoffs rounds**

Modify `src/march-madness/types/pool.ts`:

```typescript
// Update TournamentRound type
export type TournamentRound =
  // March Madness
  | 'Round of 64'
  | 'Round of 32'
  | 'Sweet Sixteen'
  | 'Elite Eight'
  | 'Final Four'
  | 'Championship'
  // NBA Playoffs
  | 'First Round'
  | 'Conference Semifinals'
  | 'Conference Finals'
  | 'NBA Finals';
```

**Step 2: Create NBA Playoffs constants file**

Create `src/march-madness/constants/nbaPlayoffs.ts`:

```typescript
import { TournamentRound } from '../types/pool';

/**
 * NBA Playoffs rounds in order
 */
export const NBA_PLAYOFFS_ROUNDS: TournamentRound[] = [
  'First Round',
  'Conference Semifinals',
  'Conference Finals',
  'NBA Finals',
];

/**
 * Expected number of team eliminations per round in NBA Playoffs
 * First Round: 8 series = 8 teams eliminated
 * Conference Semifinals: 4 series = 4 teams eliminated
 * Conference Finals: 2 series = 2 teams eliminated
 * NBA Finals: 1 series = 1 team eliminated
 */
export const NBA_PLAYOFFS_ELIMINATION_COUNTS: Record<string, number> = {
  'First Round': 8,
  'Conference Semifinals': 4,
  'Conference Finals': 2,
  'NBA Finals': 1,
};

/**
 * Map current round to next round in NBA Playoffs
 */
export const NBA_PLAYOFFS_NEXT_ROUND: Record<string, TournamentRound | null> = {
  'First Round': 'Conference Semifinals',
  'Conference Semifinals': 'Conference Finals',
  'Conference Finals': 'NBA Finals',
  'NBA Finals': null, // Tournament complete
};

/**
 * Number of teams in NBA Playoffs
 */
export const NBA_PLAYOFFS_TEAM_COUNT = 16;
```

**Step 3: Commit**

```bash
git add src/march-madness/constants/nbaPlayoffs.ts src/march-madness/types/pool.ts
git commit -m "feat: add NBA Playoffs round constants and types"
```

---

## Task 3: NBA Playoffs ESPN API Service - Series Tracking

**Files:**
- Create: `src/march-madness/services/nbaPlayoffsService.ts`
- Create: `src/march-madness/types/nbaPlayoffs.ts`

**Step 1: Create NBA Playoffs types**

Create `src/march-madness/types/nbaPlayoffs.ts`:

```typescript
/**
 * NBA Playoffs series data from ESPN API
 */
export interface PlayoffsSeries {
  seriesId: string;
  round: string;
  team1: string;
  team2: string;
  team1Wins: number;
  team2Wins: number;
  status: 'scheduled' | 'in_progress' | 'completed';
  winner?: string;
  loser?: string;
}

/**
 * Processed series result for elimination
 */
export interface SeriesResult {
  losingTeam: string;
  winningTeam: string;
  finalRecord: string; // e.g., "4-2"
  round: string;
}
```

**Step 2: Create NBA Playoffs service**

Create `src/march-madness/services/nbaPlayoffsService.ts`:

```typescript
import { PlayoffsSeries, SeriesResult } from '../types/nbaPlayoffs';
import { getPool } from '../models/pool';

/**
 * ESPN NBA Playoffs API endpoint
 * Returns playoff bracket with series information
 */
const ESPN_NBA_PLAYOFFS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

/**
 * Get current date for ESPN API (respects pool override_date)
 */
async function getTodayUrl(poolId: string): Promise<string> {
  const pool = await getPool(poolId);

  let targetDate: Date;
  if (pool?.override_date) {
    targetDate = new Date(pool.override_date);
  } else {
    targetDate = new Date();
  }

  const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
  return `${ESPN_NBA_PLAYOFFS_URL}?dates=${dateStr}&seasontype=3`; // seasontype=3 is playoffs
}

/**
 * Fetch playoff series data from ESPN API
 * Returns all series with current win counts
 */
export async function fetchPlayoffsSeries(poolId: string): Promise<PlayoffsSeries[]> {
  try {
    const url = await getTodayUrl(poolId);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`ESPN API error: ${response.status}`);
      return [];
    }

    const data = await response.json();

    // ESPN returns games, we need to aggregate them by series
    const seriesMap = new Map<string, PlayoffsSeries>();

    if (!data.events || data.events.length === 0) {
      return [];
    }

    for (const event of data.events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const seriesInfo = competition.series;
      if (!seriesInfo) continue; // Not a playoff game

      const seriesId = seriesInfo.summary || `${competition.competitors[0].team.displayName}-${competition.competitors[1].team.displayName}`;
      const team1 = competition.competitors[0].team.displayName;
      const team2 = competition.competitors[1].team.displayName;
      const team1Wins = parseInt(seriesInfo.competitors?.[0]?.wins || '0');
      const team2Wins = parseInt(seriesInfo.competitors?.[1]?.wins || '0');

      let status: 'scheduled' | 'in_progress' | 'completed' = 'scheduled';
      let winner: string | undefined;
      let loser: string | undefined;

      // Series is completed when one team has 4 wins
      if (team1Wins === 4) {
        status = 'completed';
        winner = team1;
        loser = team2;
      } else if (team2Wins === 4) {
        status = 'completed';
        winner = team2;
        loser = team1;
      } else if (team1Wins > 0 || team2Wins > 0) {
        status = 'in_progress';
      }

      seriesMap.set(seriesId, {
        seriesId,
        round: seriesInfo.title || 'Unknown',
        team1,
        team2,
        team1Wins,
        team2Wins,
        status,
        winner,
        loser,
      });
    }

    return Array.from(seriesMap.values());
  } catch (error) {
    console.error('Error fetching NBA Playoffs series:', error);
    return [];
  }
}

/**
 * Get completed series (teams that lost 4 games and are eliminated)
 */
export async function getCompletedSeries(poolId: string): Promise<SeriesResult[]> {
  const allSeries = await fetchPlayoffsSeries(poolId);

  return allSeries
    .filter((series) => series.status === 'completed' && series.loser)
    .map((series) => ({
      losingTeam: series.loser!,
      winningTeam: series.winner!,
      finalRecord: `${Math.max(series.team1Wins, series.team2Wins)}-${Math.min(series.team1Wins, series.team2Wins)}`,
      round: series.round,
    }));
}

/**
 * Check if any playoff games have started (for pick deadline enforcement)
 */
export async function hasRoundStarted(poolId: string, round: string): Promise<boolean> {
  try {
    const url = await getTodayUrl(poolId);
    const response = await fetch(url);

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    if (!data.events || data.events.length === 0) {
      return false;
    }

    // Check if any game in this round has started
    for (const event of data.events) {
      const competition = event.competitions?.[0];
      const seriesInfo = competition?.series;

      if (!seriesInfo) continue;

      const eventRound = seriesInfo.title || '';
      const status = competition.status?.type?.name;

      // If round matches and game is not "STATUS_SCHEDULED", games have started
      if (eventRound.includes(round) && status !== 'STATUS_SCHEDULED') {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking if round started:', error);
    return false;
  }
}
```

**Step 3: Commit**

```bash
git add src/march-madness/services/nbaPlayoffsService.ts src/march-madness/types/nbaPlayoffs.ts
git commit -m "feat: add NBA Playoffs ESPN API service for series tracking"
```

---

## Task 4: Update Results Processor - Support Both Tournament Types

**Files:**
- Modify: `src/march-madness/services/resultsProcessor.ts`

**Step 1: Import NBA Playoffs dependencies**

Add to top of `src/march-madness/services/resultsProcessor.ts`:

```typescript
import { fetchPlayoffsSeries, getCompletedSeries } from './nbaPlayoffsService';
import { NBA_PLAYOFFS_ELIMINATION_COUNTS, NBA_PLAYOFFS_NEXT_ROUND } from '../constants/nbaPlayoffs';
import { SeriesResult } from '../types/nbaPlayoffs';
```

**Step 2: Create processNBAPlayoffsSeries function**

Add new function to `src/march-madness/services/resultsProcessor.ts`:

```typescript
/**
 * Process NBA Playoffs series results and eliminate losing teams
 * Uses series completion (team loses 4 games) instead of individual games
 */
async function processNBAPlayoffsSeries(poolId: string): Promise<void> {
  console.log('🏀 Processing NBA Playoffs series results...');

  const pool = await getPool(poolId);
  if (!pool) {
    console.error('Pool not found');
    return;
  }

  if (!pool.current_round) {
    console.log('No current round set');
    return;
  }

  // Fetch completed series (teams that lost 4 games)
  const completedSeries = await getCompletedSeries(poolId);

  if (completedSeries.length === 0) {
    console.log('No completed series found');
    return;
  }

  console.log(`Found ${completedSeries.length} completed series`);

  for (const series of completedSeries) {
    await processSeriesResult(poolId, series, pool.current_round);
  }
}

/**
 * Process a single series result (team lost the series)
 */
async function processSeriesResult(
  poolId: string,
  series: SeriesResult,
  currentRound: string
): Promise<void> {
  const { losingTeam, winningTeam, finalRecord } = series;

  console.log(`Processing series: ${winningTeam} defeats ${losingTeam} (${finalRecord})`);

  // Check if team is already marked as eliminated
  const team = await getTeamByName(poolId, losingTeam);
  if (!team) {
    console.log(`Team not found: ${losingTeam}`);
    return;
  }

  if (team.status === 'eliminated') {
    console.log(`Team already eliminated: ${losingTeam}`);
    return;
  }

  // Mark team as eliminated
  await markTeamEliminated(team.id, currentRound);
  console.log(`✅ Team eliminated: ${losingTeam}`);

  // Find all picks for this team in current round
  const picksForTeam = await getPicksByTeamAndRound(poolId, losingTeam, currentRound);

  if (picksForTeam.length === 0) {
    console.log(`No picks found for ${losingTeam} in ${currentRound}`);
    return;
  }

  const eliminatedUsernames: string[] = [];

  for (const pick of picksForTeam) {
    // Update pick result
    await updatePickResult(pick.id, 'lost');

    // Get participant
    const participant = await getParticipantById(pick.participant_id);
    if (!participant) continue;

    // Eliminate participant if still active
    if (participant.status === 'active') {
      await eliminateParticipant(participant.id, currentRound, losingTeam);
      eliminatedUsernames.push(participant.slack_username);

      // Send elimination DM
      await sendEliminationMessage(participant, losingTeam, winningTeam, finalRecord);

      console.log(`❌ Eliminated participant: ${participant.slack_username}`);
    }
  }

  // Send channel announcement if anyone was eliminated
  if (eliminatedUsernames.length > 0) {
    await sendChannelElimination(poolId, eliminatedUsernames, losingTeam, winningTeam, finalRecord);
  }

  // Also celebrate winners (people who picked the winning team)
  await celebrateSeriesWinner(poolId, winningTeam, finalRecord, currentRound);
}

/**
 * Celebrate participants who picked the winning team in a series
 */
async function celebrateSeriesWinner(
  poolId: string,
  winningTeam: string,
  finalRecord: string,
  currentRound: string
): Promise<void> {
  const winningPicks = await getPicksByTeamAndRound(poolId, winningTeam, currentRound);

  for (const pick of winningPicks) {
    // Update pick result
    await updatePickResult(pick.id, 'won');

    // Get participant
    const participant = await getParticipantById(pick.participant_id);
    if (!participant || participant.status !== 'active') continue;

    // Send congrats DM
    const congratsMessage = await generateSeriesWinDM(participant.slack_username, winningTeam, finalRecord);
    await sendDM(participant.slack_user_id, congratsMessage);

    console.log(`🎉 Celebrated winner: ${participant.slack_username} (picked ${winningTeam})`);
  }
}

/**
 * Generate elimination DM for series loss
 */
async function sendEliminationMessage(
  participant: any,
  losingTeam: string,
  winningTeam: string,
  finalRecord: string
): Promise<void> {
  const roastMessage = await generateSeriesLossDM(
    participant.slack_username,
    losingTeam,
    winningTeam,
    finalRecord
  );
  await sendDM(participant.slack_user_id, roastMessage);
}

/**
 * Send channel announcement for series eliminations
 */
async function sendChannelElimination(
  poolId: string,
  eliminatedUsernames: string[],
  losingTeam: string,
  winningTeam: string,
  finalRecord: string
): Promise<void> {
  const pool = await getPool(poolId);
  if (!pool) return;

  const eliminatedList = eliminatedUsernames.map((u) => `@${u}`).join(', ');
  const message = `🏀 **Series Complete:** ${winningTeam} defeats ${losingTeam} (${finalRecord})\n\n❌ **Eliminated:** ${eliminatedList}`;

  await sendChannelMessage(pool.slack_channel_id, message);
}

/**
 * Generate roast DM for series loss using Claude
 */
async function generateSeriesLossDM(
  username: string,
  losingTeam: string,
  winningTeam: string,
  finalRecord: string
): Promise<string> {
  const prompt = `Generate a short, funny roast message for ${username} whose NBA Playoffs pick ${losingTeam} just lost their series to ${winningTeam} (${finalRecord}). Keep it light and playful, 2-3 sentences max.`;

  // Use existing Claude service
  const { generateResponse } = await import('../../shared/services/claudeService');
  const roast = await generateResponse(prompt, 'haiku');

  return `❌ **Your pick ${losingTeam} has been eliminated!**\n\n${roast}\n\nBetter luck next round!`;
}

/**
 * Generate congrats DM for series win using Claude
 */
async function generateSeriesWinDM(
  username: string,
  winningTeam: string,
  finalRecord: string
): Promise<string> {
  const prompt = `Generate a short, enthusiastic congratulations message for ${username} whose NBA Playoffs pick ${winningTeam} just won their series (${finalRecord}). Keep it exciting and celebratory, 2-3 sentences max.`;

  const { generateResponse } = await import('../../shared/services/claudeService');
  const congrats = await generateResponse(prompt, 'haiku');

  return `🎉 **Your pick ${winningTeam} advances!**\n\n${congrats}\n\nOn to the next round!`;
}
```

**Step 3: Update main processResults function to route by tournament type**

Modify the main `processResults` function in `src/march-madness/services/resultsProcessor.ts`:

```typescript
/**
 * Main entry point for processing tournament results
 * Routes to appropriate processor based on tournament type
 */
export async function processResults(poolId: string): Promise<void> {
  const pool = await getPool(poolId);
  if (!pool) {
    console.error('Pool not found');
    return;
  }

  console.log(`Processing results for ${pool.tournament_type} tournament`);

  if (pool.tournament_type === 'nba_playoffs') {
    // NBA Playoffs: Process series results (best-of-7)
    await processNBAPlayoffsSeries(poolId);
    await checkRoundCompletion(poolId);
  } else {
    // March Madness: Process individual games
    await processGames(poolId);
  }
}

/**
 * Check if round is complete and advance if needed
 * Works for both tournament types
 */
async function checkRoundCompletion(poolId: string): Promise<void> {
  const pool = await getPool(poolId);
  if (!pool || !pool.current_round) return;

  const eliminationCounts = pool.tournament_type === 'nba_playoffs'
    ? NBA_PLAYOFFS_ELIMINATION_COUNTS
    : ROUND_ELIMINATION_COUNTS; // Existing March Madness constant

  const nextRoundMap = pool.tournament_type === 'nba_playoffs'
    ? NBA_PLAYOFFS_NEXT_ROUND
    : NEXT_ROUND; // Existing March Madness constant

  const expectedEliminations = eliminationCounts[pool.current_round];
  if (!expectedEliminations) return;

  const actualEliminations = await getEliminationCountForRound(poolId, pool.current_round);

  if (actualEliminations >= expectedEliminations) {
    console.log(`🎯 Round complete: ${actualEliminations}/${expectedEliminations} eliminations`);

    // Send end-of-round summary
    await sendRoundSummary(poolId, pool.current_round);

    // Advance to next round
    const nextRound = nextRoundMap[pool.current_round];
    if (nextRound) {
      await advanceToNextRound(poolId, nextRound);
    } else {
      console.log('🏆 Tournament complete!');
      await updatePoolStatus(poolId, 'completed');
    }
  }
}
```

**Step 4: Commit**

```bash
git add src/march-madness/services/resultsProcessor.ts
git commit -m "feat: add NBA Playoffs series processing to results processor"
```

---

## Task 5: Update Pool Model - Support Tournament Type

**Files:**
- Modify: `src/march-madness/models/pool.ts`

**Step 1: Update createPool function**

Modify `createPool` in `src/march-madness/models/pool.ts`:

```typescript
export async function createPool(input: CreatePoolInput): Promise<Pool> {
  const result = await query(
    `INSERT INTO pools (
      name, sport, status, tournament_type, entry_fee, slack_channel_id, admin_slack_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      input.name,
      input.sport,
      'setup',
      input.tournament_type || 'march_madness', // Default to march_madness
      input.entry_fee || null,
      input.slack_channel_id,
      input.admin_slack_id,
    ]
  );

  return mapRowToPool(result.rows[0]);
}
```

**Step 2: Update updatePool function**

Modify `updatePool` in `src/march-madness/models/pool.ts`:

```typescript
export async function updatePool(poolId: string, updates: UpdatePoolInput): Promise<Pool | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }

  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }

  if (updates.current_round !== undefined) {
    fields.push(`current_round = $${paramIndex++}`);
    values.push(updates.current_round);
  }

  if (updates.tournament_type !== undefined) {
    fields.push(`tournament_type = $${paramIndex++}`);
    values.push(updates.tournament_type);
  }

  if (updates.entry_fee !== undefined) {
    fields.push(`entry_fee = $${paramIndex++}`);
    values.push(updates.entry_fee);
  }

  if (updates.override_date !== undefined) {
    fields.push(`override_date = $${paramIndex++}`);
    values.push(updates.override_date);
  }

  if (updates.current_round_locked !== undefined) {
    fields.push(`current_round_locked = $${paramIndex++}`);
    values.push(updates.current_round_locked);
  }

  if (fields.length === 0) {
    const pool = await getPool(poolId);
    return pool;
  }

  values.push(poolId);

  const result = await query(
    `UPDATE pools SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToPool(result.rows[0]);
}
```

**Step 3: Update mapRowToPool helper**

Modify `mapRowToPool` in `src/march-madness/models/pool.ts`:

```typescript
function mapRowToPool(row: any): Pool {
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    status: row.status,
    current_round: row.current_round,
    tournament_type: row.tournament_type || 'march_madness', // Add this line
    entry_fee: row.entry_fee ? parseFloat(row.entry_fee) : null,
    slack_channel_id: row.slack_channel_id,
    admin_slack_id: row.admin_slack_id,
    created_at: new Date(row.created_at),
    started_at: row.started_at ? new Date(row.started_at) : null,
    completed_at: row.completed_at ? new Date(row.completed_at) : null,
    override_date: row.override_date ? new Date(row.override_date) : null,
    current_round_locked: row.current_round_locked || false,
  };
}
```

**Step 4: Commit**

```bash
git add src/march-madness/models/pool.ts
git commit -m "feat: update pool model to support tournament_type"
```

---

## Task 6: Update Pick Manager - Handle NBA Playoffs Deadline Check

**Files:**
- Modify: `src/march-madness/services/pickManager.ts`

**Step 1: Import NBA Playoffs service**

Add to top of `src/march-madness/services/pickManager.ts`:

```typescript
import { hasRoundStarted as nbaPlayoffsRoundStarted } from './nbaPlayoffsService';
import { hasRoundStarted as ncaaRoundStarted } from './ncaaService';
```

**Step 2: Update deadline check to route by tournament type**

Modify the deadline validation logic in `submitPick` function:

```typescript
// Inside submitPick function, replace the hasRoundStarted call:

// Check if round has started (deadline enforcement)
let roundStarted = false;
if (pool.tournament_type === 'nba_playoffs') {
  roundStarted = await nbaPlayoffsRoundStarted(poolId, pool.current_round);
} else {
  roundStarted = await ncaaRoundStarted(poolId, pool.current_round);
}

if (roundStarted) {
  // Lock the round immediately
  await updatePool(poolId, { current_round_locked: true });

  throw new Error(
    `The deadline has passed for ${pool.current_round}. The first game has already started. Picks are now locked.`
  );
}
```

**Step 3: Commit**

```bash
git add src/march-madness/services/pickManager.ts
git commit -m "feat: add NBA Playoffs deadline check to pick manager"
```

---

## Task 7: Update Admin Console - Add Tournament Type Selection

**Files:**
- Modify: `src/march-madness/admin/public/dashboard.html`
- Modify: `src/march-madness/admin/public/js/dashboard.js`

**Step 1: Add tournament type dropdown to pool settings**

Modify `src/march-madness/admin/public/dashboard.html` in the Pool Settings section:

```html
<!-- In Pool Settings section, add after sport field -->
<div class="form-group">
  <label for="pool-tournament-type">Tournament Type:</label>
  <select id="pool-tournament-type">
    <option value="march_madness">March Madness</option>
    <option value="nba_playoffs">NBA Playoffs</option>
  </select>
</div>
```

**Step 2: Add tournament type to create pool modal**

Modify the Create Pool modal in `src/march-madness/admin/public/dashboard.html`:

```html
<!-- In Create Pool modal, add after entry fee field -->
<div class="form-group">
  <label for="create-tournament-type">Tournament Type:</label>
  <select id="create-tournament-type" required>
    <option value="march_madness">March Madness</option>
    <option value="nba_playoffs">NBA Playoffs</option>
  </select>
</div>
```

**Step 3: Update dashboard.js to handle tournament type**

Modify `src/march-madness/admin/public/js/dashboard.js`:

```javascript
// Update loadPoolSettings function
async function loadPoolSettings() {
  const pool = await api.getPool();

  if (!pool) {
    document.getElementById('pool-name').value = '';
    document.getElementById('pool-sport').value = '';
    document.getElementById('pool-tournament-type').value = 'march_madness';
    document.getElementById('pool-current-round').value = '';
    document.getElementById('pool-status-select').value = 'setup';
    document.getElementById('pool-entry-fee').value = '';
    return;
  }

  document.getElementById('pool-name').value = pool.name || '';
  document.getElementById('pool-sport').value = pool.sport || '';
  document.getElementById('pool-tournament-type').value = pool.tournament_type || 'march_madness';
  document.getElementById('pool-current-round').value = pool.current_round || '';
  document.getElementById('pool-status-select').value = pool.status || 'setup';
  document.getElementById('pool-entry-fee').value = pool.entry_fee || '';

  // Update round dropdown based on tournament type
  updateRoundOptions(pool.tournament_type || 'march_madness');

  // ... rest of function
}

// Add new function to update round options
function updateRoundOptions(tournamentType) {
  const roundSelect = document.getElementById('pool-current-round');
  roundSelect.innerHTML = '';

  let rounds = [];
  if (tournamentType === 'nba_playoffs') {
    rounds = [
      'First Round',
      'Conference Semifinals',
      'Conference Finals',
      'NBA Finals'
    ];
  } else {
    rounds = [
      'Round of 64',
      'Round of 32',
      'Sweet Sixteen',
      'Elite Eight',
      'Final Four',
      'Championship'
    ];
  }

  roundSelect.innerHTML = '<option value="">-- Select Round --</option>';
  rounds.forEach(round => {
    const option = document.createElement('option');
    option.value = round;
    option.textContent = round;
    roundSelect.appendChild(option);
  });
}

// Update savePoolSettings function
async function savePoolSettings() {
  const poolId = currentPool?.id;
  if (!poolId) {
    alert('No pool found. Please create a pool first.');
    return;
  }

  const updates = {
    name: document.getElementById('pool-name').value,
    status: document.getElementById('pool-status-select').value,
    current_round: document.getElementById('pool-current-round').value || null,
    tournament_type: document.getElementById('pool-tournament-type').value,
    entry_fee: parseFloat(document.getElementById('pool-entry-fee').value) || null,
  };

  await api.updatePool(poolId, updates);
  alert('Pool settings saved!');
  await loadDashboard();
}

// Update handleCreatePool function
async function handleCreatePool() {
  const name = document.getElementById('create-pool-name').value;
  const sport = document.getElementById('create-pool-sport').value;
  const tournamentType = document.getElementById('create-tournament-type').value;
  const channelId = document.getElementById('create-channel-id').value;
  const entryFee = parseFloat(document.getElementById('create-entry-fee').value) || null;

  if (!name || !sport || !channelId || !tournamentType) {
    alert('Please fill in all required fields');
    return;
  }

  try {
    await api.createPool({
      name,
      sport,
      tournament_type: tournamentType,
      slack_channel_id: channelId,
      admin_slack_id: 'admin', // placeholder
      entry_fee: entryFee,
    });

    document.getElementById('create-pool-modal').style.display = 'none';
    await loadDashboard();
    alert('Pool created successfully!');
  } catch (error) {
    alert('Error creating pool: ' + error.message);
  }
}

// Add listener for tournament type change
document.getElementById('pool-tournament-type').addEventListener('change', (e) => {
  updateRoundOptions(e.target.value);
});
```

**Step 4: Commit**

```bash
git add src/march-madness/admin/public/dashboard.html src/march-madness/admin/public/js/dashboard.js
git commit -m "feat: add tournament type selection to admin console"
```

---

## Task 8: Update Scheduler - Route by Tournament Type

**Files:**
- Modify: `src/march-madness/scheduler/tournamentScheduler.ts`

**Step 1: Update scheduler to call correct service**

Modify `src/march-madness/scheduler/tournamentScheduler.ts`:

```typescript
import { processResults } from '../services/resultsProcessor';

// Update the cron job function
async function checkTournamentResults() {
  console.log('⏰ Checking tournament results...');

  try {
    const { getActivePool } = await import('../models/pool');
    const pool = await getActivePool();

    if (!pool) {
      console.log('No active pool found');
      return;
    }

    console.log(`Processing results for pool: ${pool.name} (${pool.tournament_type})`);

    // processResults will route to appropriate handler based on tournament_type
    await processResults(pool.id);

    console.log('✅ Tournament results check complete');
  } catch (error) {
    console.error('Error checking tournament results:', error);
  }
}
```

**Step 2: Commit**

```bash
git add src/march-madness/scheduler/tournamentScheduler.ts
git commit -m "feat: update scheduler to support both tournament types"
```

---

## Task 9: Documentation

**Files:**
- Create: `docs/plans/2026-04-13-nba-playoffs-implementation-complete.md`

**Step 1: Create implementation completion document**

Create `docs/plans/2026-04-13-nba-playoffs-implementation-complete.md`:

```markdown
# NBA Playoffs Pool Support - Implementation Complete

**Completed:** [Date]
**Status:** ✅ Ready for Testing

---

## Summary

Successfully extended march-madness mode to support NBA Playoffs survivor pools with series-based elimination (best-of-7).

## Key Features Delivered

### Database
- ✅ Added `tournament_type` column to pools table ('march_madness' | 'nba_playoffs')
- ✅ Migration script created and tested

### Backend
- ✅ NBA Playoffs round constants (First Round → Conference Semifinals → Conference Finals → NBA Finals)
- ✅ ESPN NBA Playoffs API service for series tracking
- ✅ Series result processing (team eliminated when they lose 4 games)
- ✅ Updated results processor to route by tournament type
- ✅ Pick deadline enforcement using NBA Playoffs API
- ✅ Claude-generated elimination DMs for series losses
- ✅ Claude-generated celebration DMs for series wins
- ✅ Channel announcements for series completions

### Admin Console
- ✅ Tournament type dropdown in pool settings
- ✅ Tournament type selection in create pool modal
- ✅ Dynamic round options based on tournament type

### Shared Logic Reused
- ✅ Pick submission via DM
- ✅ Team fuzzy matching (Claude Haiku)
- ✅ Payment tracking
- ✅ Participant management
- ✅ Admin console infrastructure
- ✅ Slack messaging
- ✅ Cron scheduler

## How It Works

1. Admin creates pool with `tournament_type: 'nba_playoffs'`
2. Participants submit picks via DM (same as March Madness)
3. Scheduler polls ESPN every 30 minutes for series data
4. When a team loses 4 games in a series:
   - Team marked as eliminated
   - Picks for that team marked as 'lost'
   - Participants eliminated and receive roast DM
   - Channel announcement posted
5. When a team wins 4 games in a series:
   - Picks for that team marked as 'won'
   - Participants receive congrats DM
6. Round advances when all expected series complete

## Testing Checklist

### Local Testing
- [ ] Run migration on local database
- [ ] Create NBA Playoffs pool via admin console
- [ ] Verify tournament type appears in pool settings
- [ ] Add tournament teams (16 NBA teams)
- [ ] Submit picks via DM
- [ ] Test ESPN API series fetching (during live playoffs)
- [ ] Simulate series completion (manual DB update)
- [ ] Verify elimination messages sent
- [ ] Verify celebration messages sent
- [ ] Verify round advancement

### Production Testing
- [ ] Deploy to Railway
- [ ] Run migration on production database
- [ ] Create test NBA Playoffs pool
- [ ] Full end-to-end test during live playoffs

## Future Enhancements

- Series progress tracking (show "Lakers lead 3-2" in status messages)
- Admin ability to manually complete series (testing tool)
- Support for other best-of-7 tournaments (NHL Playoffs, etc.)

---

**Implementation Plan:** docs/plans/2026-04-13-nba-playoffs-support.md
```

**Step 2: Commit**

```bash
git add docs/plans/2026-04-13-nba-playoffs-implementation-complete.md
git commit -m "docs: add NBA Playoffs implementation completion document"
```

---

## Task 10: Testing & Verification

**Files:**
- N/A (testing only)

**Step 1: Build TypeScript**

Run:
```bash
npm run build
```

Expected: No TypeScript errors

**Step 2: Start local server**

Run:
```bash
BETTY_MODE=march_madness npm start
```

Expected: Both servers start (port 3000 and 3001)

**Step 3: Access admin console**

Navigate to: `http://localhost:3001/admin`

Expected: Admin console loads successfully

**Step 4: Create NBA Playoffs pool**

1. Click "Create Pool"
2. Fill in name, sport, channel ID
3. Select "NBA Playoffs" as tournament type
4. Save

Expected: Pool created with tournament_type='nba_playoffs'

**Step 5: Verify round options**

1. Go to Pool Settings
2. Check Current Round dropdown

Expected: Shows NBA Playoffs rounds (First Round, Conference Semifinals, etc.)

**Step 6: Manual database verification**

Run:
```bash
psql $DATABASE_URL -c "SELECT id, name, tournament_type FROM pools;"
```

Expected: Shows pool with tournament_type='nba_playoffs'

**Step 7: Commit final changes**

```bash
git add -A
git commit -m "test: verify NBA Playoffs pool creation and admin console"
```

---

## Deployment

**Step 1: Run migration on production database**

Connect to Supabase SQL Editor and run:
```sql
-- From database/migrations/004_add_tournament_type.sql
ALTER TABLE pools
ADD COLUMN tournament_type VARCHAR(50) NOT NULL DEFAULT 'march_madness';

ALTER TABLE pools
ADD CONSTRAINT pools_tournament_type_check
CHECK (tournament_type IN ('march_madness', 'nba_playoffs'));

CREATE INDEX idx_pools_tournament_type ON pools(tournament_type);
```

**Step 2: Deploy to Railway**

Run:
```bash
git push origin main
```

Expected: Railway auto-deploys new version

**Step 3: Verify production deployment**

1. Access production admin console
2. Create test NBA Playoffs pool
3. Verify tournament type saved correctly

---

## Complete! 🎉

NBA Playoffs pool support is now fully implemented and ready for use. The system can now handle both March Madness (single-game elimination) and NBA Playoffs (series elimination) tournaments.

**Key Differences from March Madness:**
- Elimination based on series loss (4 games) instead of single game
- Round names: First Round → Conference Semifinals → Conference Finals → NBA Finals
- 16 teams instead of 64
- ESPN NBA Playoffs API instead of NCAA API

**Reused Components:**
- All participant/pick/team management
- Admin console infrastructure
- Slack messaging
- Claude fuzzy matching
- Payment tracking
- Cron scheduler
