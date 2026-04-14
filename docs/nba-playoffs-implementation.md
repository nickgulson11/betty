# NBA Playoffs Pool Support - Implementation Summary

**Date:** April 13, 2026
**Status:** ⚠️ Implementation Complete - Testing In Progress

**Last Updated:** April 13, 2026 (Session 2)

---

## Overview

Successfully extended the march-madness mode to support NBA Playoffs survivor pools with series-based elimination (best-of-7 format).

## What Changed

### Database
- Added `tournament_type` column to `pools` table
  - Values: `'march_madness'` | `'nba_playoffs'`
  - Default: `'march_madness'`
  - Constraint ensures only valid values

### Backend Code

#### New Files Created:
- `src/march-madness/constants/nbaPlayoffs.ts` - Round constants and elimination counts
- `src/march-madness/types/nbaPlayoffs.ts` - TypeScript types for series data
- `src/march-madness/services/nbaPlayoffsService.ts` - ESPN NBA Playoffs API integration

#### Files Modified:
- `src/march-madness/types/pool.ts` - Added NBA Playoffs rounds to TournamentRound type
- `src/march-madness/models/pool.ts` - Support tournament_type in create/update
- `src/march-madness/services/resultsProcessor.ts` - Added NBA Playoffs processing logic
- `src/march-madness/services/pickManager.ts` - Route deadline check by tournament type
- `src/march-madness/scheduler/tournamentScheduler.ts` - Route sync by tournament type

#### Admin Console:
- `dashboard.html` - Tournament type dropdown, dynamic round filters, Force Sync in Pool Settings
- `dashboard.js` - Dynamic round population, tournament-aware sync routing
- `admin/routes/teams.ts` - Force Sync routes by tournament type
- `admin/routes/betty.ts` - Generic basketball pool messaging (no hardcoded "March Madness")
- `admin/routes/participants.ts` - Passes tournament_type to welcome messages

## How It Works

### March Madness (existing)
1. Scheduler fetches today's games from ESPN NCAA API
2. Processes completed games (single-game elimination)
3. Teams lose → participants eliminated → roast DMs sent
4. Round advances when expected eliminations complete

### NBA Playoffs (new)
1. Scheduler fetches series data from ESPN NBA API
2. Processes completed series (team loses 4 games = elimination)
3. Series loser → participants eliminated → roast DMs sent
4. Series winner → participants celebrated → congrats DMs sent
5. Round advances when all expected series complete (8→4→2→1)

## Key Features

### Series-Based Elimination
- Tracks series wins/losses (not individual games)
- Team eliminated when they lose 4 games in a series
- Idempotent processing (won't double-eliminate)

### Dual Tournament Support
- Single codebase handles both tournament types
- Routing based on `pool.tournament_type` field
- Shared infrastructure: participants, picks, teams, admin console

### Round Structure
**NBA Playoffs:**
- First Round (8 series, 8 eliminations)
- Conference Semifinals (4 series, 4 eliminations)
- Conference Finals (2 series, 2 eliminations)
- NBA Finals (1 series, 1 elimination)

**March Madness:** (unchanged)
- Round of 64 through Championship

### Personality Messages
- Claude Haiku generates contextual messages based on tournament type
- **March Madness**: "March Madness pool bot" references
- **NBA Playoffs**: "NBA Playoffs pool bot" references
- Welcome DMs adapt round count (6 for March Madness, 4 for NBA Playoffs)
- Team examples change based on tournament (Duke/UNC vs Lakers/Celtics)
- All message generators accept `tournamentType` parameter

## Admin Usage

1. Create pool via admin console
2. Select "NBA Playoffs" as Tournament Type
3. Set current round (e.g., "First Round")
4. Bulk import 16 NBA teams (use ESPN team display names: "Indiana Pacers", not "Pacers")
5. Participants DM picks (same as March Madness)
6. Results process automatically every 30 minutes
7. Use "Force Sync Now" button on Dashboard or Pool Settings tab to manually trigger sync
8. Use date override in Pool Settings for testing with historical data

## Testing Checklist

- [ ] Run `npm run build` to verify TypeScript compiles
- [ ] Create NBA Playoffs pool in admin console
- [ ] Verify tournament type appears in pool settings
- [ ] Change tournament type → verify round options update
- [ ] Test with live NBA Playoffs data (or date override)
- [ ] Verify series completion triggers eliminations
- [ ] Verify DMs sent (roasts + celebrations)
- [ ] Verify round advancement

## Deployment Notes

### Database Migration
Run on Supabase:
```sql
ALTER TABLE pools
ADD COLUMN tournament_type VARCHAR(50) NOT NULL DEFAULT 'march_madness';

ALTER TABLE pools
ADD CONSTRAINT pools_tournament_type_check
CHECK (tournament_type IN ('march_madness', 'nba_playoffs'));
```

### Environment Variables
No new environment variables required. Uses existing ESPN API and Claude API keys.

### Production Deployment
1. Run database migration on Supabase
2. Deploy code to Railway (auto-deploys on push)
3. Verify admin console loads
4. Create test NBA Playoffs pool

## Architecture Decisions

### Why Series-Based?
NBA Playoffs are best-of-7 series, not single-elimination games. Processing series completion (4 wins) matches the real tournament format.

### Why Reuse Infrastructure?
95% of the pool logic is identical (picks, participants, payments, teams, admin). Only elimination rules differ.

### Why Separate Service?
`nbaPlayoffsService.ts` isolates NBA-specific ESPN API logic. March Madness and NBA Playoffs APIs have different response structures.

### Why Not Create New Mode?
Extending march-madness mode keeps the codebase simpler. Future pool types (NFL playoffs, NHL playoffs) can follow the same pattern.

## Recent Updates (Session 2)

### Dynamic Admin Console
- **Round Filters**: Picks tab and all modals now show correct rounds based on tournament type
- **Force Sync Button**: Added to Pool Settings tab (below date override)
- **Sync Routing**: `/api/teams/sync` endpoint routes to NBA or NCAA logic based on pool type

### Tournament-Specific Messaging
- All Betty message generators now accept `tournament_type` parameter
- Welcome DMs show correct round count and team examples
- Claude prompts use "March Madness pool bot" or "NBA Playoffs pool bot"
- Generic templates avoid hardcoded tournament references

### Enhanced Logging
- Added detailed logging to `celebrateSeriesWinner()` and `processSeriesResult()`
- Logs show: picks found, teams matched, round used for queries
- Helps debug issues with picks not being marked as won/lost

## Files Summary

**Created:** 3 new files
**Modified:** 12+ existing files
**Lines Added:** ~800
**Database Changes:** 1 column

## Known Issues

### Picks Not Being Marked as Won
**Status:** Under investigation
**Symptom:** When a series completes, losing picks are marked correctly, but winning picks stay "pending"

**Likely Cause:** Team name mismatch
- ESPN API returns full names: "Indiana Pacers", "Cleveland Cavaliers"
- Database picks might use short names: "Pacers", "Cavaliers"
- Query: `WHERE team_name = 'Indiana Pacers'` won't match picks with `team_name = 'Pacers'`

**Debugging Steps:**
1. Check Railway logs after Force Sync for:
   ```
   [resultsProcessor] Looking for winning picks: poolId=xxx, team=Indiana Pacers, round=Conference Semifinals
   [resultsProcessor] Found X picks for winning team Indiana Pacers in Conference Semifinals
   ```
2. If "Found 0 picks" but picks exist → team name mismatch
3. Verify `tournament_teams` table uses same names as ESPN API
4. Verify `picks` table team_name matches tournament_teams exactly

**Resolution:** Ensure consistent team naming:
- Use ESPN's `displayName` when bulk importing teams
- When creating picks, use exact team_name from `tournament_teams` table

## Troubleshooting

### Round Mismatch Errors
**Issue:** "No picks found for [team] in [round]"

**Check:**
1. Pool's `current_round` matches ESPN round name (after mapping)
2. ESPN returns: "East Semifinals - Game 5" → maps to "Conference Semifinals"
3. Pool `current_round` should be "Conference Semifinals"
4. Picks should have `round = 'Conference Semifinals'`

### Force Sync Not Working
**Check:**
1. Pool has `tournament_type` set correctly
2. Railway logs show: `[teams/sync] Processing nba_playoffs tournament`
3. If pool is `nba_playoffs` but logs show NCAA logic → cache issue, restart Railway

### No Series Found
**Check:**
1. Date override is set correctly (if testing historical data)
2. ESPN API URL in logs: should include `dates=YYYYMMDD&seasontype=3`
3. Verify games exist on that date: `curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20250513&seasontype=3"`

## Next Steps

1. ✅ Dynamic round filters implemented
2. ✅ Tournament-specific messaging implemented
3. ⏳ Debug and fix picks not being marked as won
4. ⏳ User runs `npm run build` to verify compilation
5. ⏳ User deploys to production
6. ⏳ User tests with live NBA Playoffs data
7. Optional: Add series progress tracking ("Lakers lead 3-2")

---

**Implementation:** Complete ✅
**Documentation:** Updated ✅
**Testing:** In Progress ⚠️
**Known Issues:** 1 (picks not marked as won - under investigation)
