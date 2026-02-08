# NFL Betting Support Design

**Date:** 2025-11-13
**Status:** Approved
**Goal:** Extend Betty to support NFL bets alongside existing NBA bets

## Overview

Betty currently supports NBA bets only. This design adds NFL betting support while maintaining the existing NBA functionality. The design sets up a multi-sport architecture that will accommodate future NCAA Basketball and NCAA Football support.

## Design Decisions

### Sport Detection
- **Approach:** Implicit detection from team names
- Users don't need to specify sport - Betty infers from team mentioned
- If team name is unrecognized: reject with clear message asking user to mention "NFL" or "NBA"

### Betting Features
- **Phase 1:** Winner-takes-all only (same as NBA)
- **Future:** Structure code to support point spreads later
- Consistent UX across sports for now

### Settlement Timing
- **NBA:** 90 minutes after game start
- **NFL:** 3 hours after game start (180 minutes)
- Scheduler runs every 30 minutes, so overtime games get retried automatically

## Database Schema

### Sport Column (Already Added)

```sql
ALTER TABLE bets
ADD COLUMN sport VARCHAR(50) NOT NULL DEFAULT 'NBA Basketball';

ALTER TABLE bets
ADD CONSTRAINT valid_sport CHECK (
  sport IN ('NBA Basketball', 'NFL Football', 'NCAA Basketball', 'NCAA Football')
);

CREATE INDEX idx_bets_sport ON bets(sport);
```

**Valid Sport Values:**
- `'NBA Basketball'`
- `'NFL Football'`
- `'NCAA Basketball'` (future)
- `'NCAA Football'` (future)

**Migration Impact:**
- All existing bets default to 'NBA Basketball'
- No data loss or manual updates needed

## Architecture Changes

### 1. New NFL Service (`src/services/nflService.ts`)

Mirrors the structure of `nbaService.ts`:

**NFL Team Mappings:**
- All 32 NFL teams with common nicknames and abbreviations
- Examples:
  - "chiefs", "kc", "kansas city" → "Kansas City Chiefs"
  - "49ers", "niners", "san francisco" → "San Francisco 49ers"
  - "eagles", "philly", "philadelphia" → "Philadelphia Eagles"

**Functions:**

```typescript
// Normalize user input to official team name
normalizeNFLTeamName(teamName: string): string | null

// Get all NFL games for a specific date
getTodaysNFLGames(date: Date): Promise<NFLGame[]>

// Find specific game for a team on a date
findGameForNFLTeam(teamName: string, gameDate: Date): Promise<NFLGame | null>
```

**ESPN NFL API:**
- Endpoint: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYYMMDD`
- Same structure as NBA API, different sport path

### 2. Claude Service Updates (`src/services/claudeService.ts`)

**Enhanced Bet Parsing Flow:**

1. Parse bet intent (existing logic)
2. **NEW:** Determine sport from team names
   - Try normalizing against NBA teams
   - Try normalizing against NFL teams
   - If NBA match → `sport = 'NBA Basketball'`
   - If NFL match → `sport = 'NFL Football'`
   - If no match or ambiguous → reject with error message
3. Find game using appropriate service
   - NBA → `nbaService.findGameForTeam()`
   - NFL → `nflService.findGameForNFLTeam()`

**Error Message for Ambiguous Sport:**
> "I couldn't determine which sport. Please mention 'NFL' or 'NBA' in your bet."

### 3. Bet Manager Updates (`src/services/betManager.ts`)

**Minimal Changes:**

```typescript
async function createBet(betDetails: BetDetails, sport: Sport) {
  // Add sport to INSERT query
  const result = await pool.query(
    `INSERT INTO bets (
      initiator_slack_id, opponent_slack_id,
      initiator_team, opponent_team, game_date,
      stakes, slack_channel_id, slack_thread_ts,
      sport
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [...existingParams, sport]
  );
}
```

All other bet management functions remain sport-agnostic.

### 4. Results Service Updates (`src/services/resultsService.ts`)

**Sport-Aware Game Result Checking:**

```typescript
async function checkGameResult(bet: Bet): Promise<GameResult> {
  if (bet.sport === 'NBA Basketball') {
    return checkNBAGameResult(bet);
  } else if (bet.sport === 'NFL Football') {
    return checkNFLGameResult(bet);
  }
  throw new Error(`Unsupported sport: ${bet.sport}`);
}

async function checkNFLGameResult(bet: Bet): Promise<GameResult> {
  // 1. Convert bet.game_date to Eastern Time (ESPN uses ET)
  // 2. Call ESPN NFL API for that date
  // 3. Find game matching initiator_team vs opponent_team
  // 4. Check game status (completed, in_progress, postponed)
  // 5. Parse final score if completed
  // 6. Return GameResult
}
```

**NFL-Specific Considerations:**
- ESPN NFL API has same structure as NBA
- Team name normalization required for matching
- Game statuses: `completed`, `in_progress`, `postponed`, `canceled`

### 5. Settlement Scheduler Updates (`src/scheduler/settlementScheduler.ts`)

**Sport-Specific Settlement Timing:**

```typescript
const SETTLEMENT_BUFFER_MINUTES = {
  'NBA Basketball': 90,
  'NFL Football': 180,
  'NCAA Basketball': 90,    // future
  'NCAA Football': 180       // future
};
```

**Updated Settlement Query:**

```sql
SELECT * FROM bets
WHERE status = 'active'
AND game_date + (
  CASE
    WHEN sport = 'NBA Basketball' THEN INTERVAL '90 minutes'
    WHEN sport = 'NFL Football' THEN INTERVAL '180 minutes'
  END
) < NOW()
```

**Why This Works:**
- SQL CASE statement applies correct buffer per sport
- Efficient single query for all sports
- Easy to add NCAA timing later

## TypeScript Type Updates

```typescript
type Sport = 'NBA Basketball' | 'NFL Football' | 'NCAA Basketball' | 'NCAA Football';

interface Bet {
  // ... existing fields
  sport: Sport;
}

interface NFLGame {
  homeTeam: string;
  awayTeam: string;
  gameDate: Date;
  status: string;
  homeScore?: number;
  awayScore?: number;
}
```

## Testing Strategy

### 1. NFL Team Name Normalization
- Verify all 32 teams map correctly
- Test common abbreviations (KC, SF, GB, etc.)
- Test nicknames (Niners, Pack, etc.)
- Confirm invalid names return null

### 2. ESPN NFL API Integration
- Test with real upcoming NFL games
- Verify game data format matches expectations
- Test games across different days (Thursday/Sunday/Monday)

### 3. Sport Detection
- Clear NFL teams → correctly tagged as "NFL Football"
- Clear NBA teams → correctly tagged as "NBA Basketball"
- Invalid teams → rejection message
- No regression on existing NBA functionality

### 4. Settlement Timing
- NFL bets wait 3 hours before settlement attempts
- NBA bets still wait 90 minutes (no regression)
- Verify scheduler handles both sports in same run

### 5. End-to-End Flow
- Place NFL bet → acceptance → game completion → settlement
- Verify all Slack messages correct
- Verify database updates correct

## Edge Cases

### Off-Season
- NFL season: September - February
- Users attempting NFL bets in off-season → ESPN returns no games → bet rejected naturally
- No special handling needed

### Bye Weeks
- NFL teams have 1 bye week per season
- No game scheduled → ESPN returns no games → bet rejected naturally
- No special handling needed

### Game Rescheduling
- Handled by existing postponement logic in settlement
- ESPN marks games as `postponed` or `canceled`
- Settlement cancels bet with reason

## Deployment Plan

1. **Code Deployment**
   - Deploy all service changes
   - No downtime required (DB already updated)

2. **Initial Testing**
   - Test with upcoming NFL game
   - Monitor settlement of first few NFL bets

3. **Monitoring**
   - Watch scheduler logs for both NBA and NFL settlements
   - Verify no errors in sport detection

## Future Expansion Path

This design sets up clean patterns for NCAA support:

1. Create `ncaaBasketballService.ts` and `ncaaFootballService.ts`
2. Add NCAA team mappings (hundreds of teams)
3. Update sport detection logic
4. Add NCAA settlement timing to scheduler
5. Update ESPN API calls for NCAA endpoints

**No changes needed to:**
- Database schema (already supports NCAA values)
- Bet manager (sport-agnostic)
- Settlement scheduler structure (just add CASE statements)

## Success Criteria

- [ ] Users can place NFL bets using natural language
- [ ] Betty correctly identifies NFL vs NBA from team names
- [ ] NFL bets settle automatically after games complete
- [ ] Existing NBA bet functionality unchanged
- [ ] No manual intervention needed for sport classification
- [ ] Code is ready for future NCAA expansion
