# Allow Next Round Picks - Feature Requirements

**Date:** April 19, 2026
**Status:** 📋 Design Complete - Not Yet Implemented
**Priority:** Medium
**Tournament Type:** NBA Playoffs (but works for both)

---

## Problem Statement

### Current Limitation

Betty's survivor pool system only accepts picks for one round at a time (`pool.current_round`). The round automatically advances when all expected eliminations complete (e.g., all 8 First Round series finish).

**Issue for NBA Playoffs:**
- Conference Semifinals games can start BEFORE First Round is fully complete
- Some series go 7 games (slow), others end in 4-5 games (fast)
- Participants miss the deadline to submit Conference Semifinals picks because First Round hasn't officially "ended" yet

**Example Timeline:**
- Day 14: Last First Round series still at Game 6
- Day 15: First Conference Semifinals game begins
- Day 16: First Round series finishes
- **Problem:** Participants couldn't submit Conference Semifinals picks on Day 15 because pool was still on "First Round"

### Current Workaround
None. Participants must wait until current round fully completes.

---

## Solution Overview

### "Allow Next Round Picks" Feature

Admin can manually enable a flag that:
1. **Opens picks for the NEXT round** (e.g., Conference Semifinals)
2. **Closes picks for the CURRENT round** (e.g., First Round)
3. **Results processor continues tracking current round** until it completes
4. **Auto-advances when current round finishes** and resets the flag

**Key Principle:** Betty only accepts picks for ONE round at a time (current OR next, never both)

---

## Functional Requirements

### FR-1: Admin Can Enable Next Round Picks

**Location:** Admin Console > Pool Settings tab

**UI Element:** Button labeled "Allow [Next Round Name] Picks"
- Example: "Allow Conference Semifinals Picks"
- Dynamically shows next round name based on `current_round`

**Conditions to Show Button:**
- Pool status is `active`
- Not on final round (NBA Finals / Championship)
- `allow_next_round_picks` is currently `false`

**When Clicked:**
1. Updates `pools.allow_next_round_picks = true`
2. Sends Slack channel announcement:
   ```
   🏀 Picks are now open for the Conference Semifinals!

   The First Round is still in progress, but you can start submitting your picks for the next round.

   DM me your team to lock in your pick.
   ```
3. Button disappears, replaced with status indicator: "Accepting picks for: Conference Semifinals (next round override)"

### FR-2: Pick Submission Logic Changes

**Current Behavior:**
- Accepts picks for `pool.current_round` only

**New Behavior:**
```typescript
let acceptingPicksForRound;

if (pool.allow_next_round_picks === true) {
  acceptingPicksForRound = getNextRound(pool.current_round);
} else {
  acceptingPicksForRound = pool.current_round;
}

// All pick validation happens against acceptingPicksForRound
```

**User Experience:**
- Participant DMs: "Lakers"
- Betty responds: "Pick submitted: Lakers for Conference Semifinals!" (not First Round)
- Pick is stored with `round = "Conference Semifinals"`
- Betty enforces all normal rules (no team reuse, team must be active, etc.)

### FR-3: Results Processing Continues Normally

**No changes to results processing logic** except:

1. **Bug Fix (Critical):**
   - Line 1141 in `resultsProcessor.ts` currently passes `pool.current_round` to `processSeriesResult()`
   - Must change to `series.round` to process series from any round correctly
   - This allows First Round series to process even after pool advances to Conference Semifinals

2. **Void Future Picks When Participant Eliminated:**
   - When a participant is eliminated in current round, check for pending picks in future rounds
   - Mark any future picks as `result = 'lost'` (no additional roast DMs)
   - Example: Participant eliminated in First Round → their Conference Semifinals pick marked as 'lost'

**Processing Flow:**
- First Round series complete → participants eliminated → roast DMs sent
- Conference Semifinals picks are NOT affected by First Round results
- When all First Round series complete → auto-advance to Conference Semifinals

### FR-4: Auto-Advance Resets Flag

**When results processor advances rounds** (lines 1536-1545 in resultsProcessor.ts):

```typescript
await poolModel.updatePool(poolId, {
  current_round: nextRound,
  current_round_locked: false,
  allow_next_round_picks: false, // ✅ RESET FLAG
});
```

**Effect:**
- Pool advances to Conference Semifinals
- Flag resets to `false`
- Betty now accepts picks for Conference Semifinals normally
- Participants who submitted early are already set

---

## Technical Implementation

### Database Changes

**Manual Column Addition Required:**
- Table: `pools`
- Column: `allow_next_round_picks` (BOOLEAN, default FALSE)

**No other schema changes needed** - picks already have `round` field, 'lost' is already a valid pick result.

### Backend Changes

#### 1. Update Types (`src/march-madness/types/pool.ts`)

```typescript
export interface Pool {
  // ... existing fields
  allow_next_round_picks: boolean; // NEW
}

export interface UpdatePoolInput {
  // ... existing fields
  allow_next_round_picks?: boolean; // NEW
}
```

#### 2. Update Pool Model (`src/march-madness/models/pool.ts`)

Add support for `allow_next_round_picks` in:
- `updatePool()` function (add to parameterized updates)

#### 3. Fix Bug in Results Processor (`src/march-madness/services/resultsProcessor.ts`)

**Line 1141:**
```typescript
// BEFORE (BUG):
await processSeriesResult(poolId, series, pool.current_round);

// AFTER (FIXED):
await processSeriesResult(poolId, series, series.round);
```

**Add new helper function:**
```typescript
/**
 * Mark any pending picks as lost for rounds after the elimination round
 * Called when a participant is eliminated to clean up early-submitted picks
 */
async function voidFuturePicks(
  participantId: string,
  eliminatedRound: TournamentRound
): Promise<void> {
  const result = await dbPool.query(
    `UPDATE picks
     SET result = 'lost', updated_at = NOW()
     WHERE participant_id = $1
       AND result = 'pending'
       AND round != $2`,
    [participantId, eliminatedRound]
  );

  if (result.rowCount && result.rowCount > 0) {
    console.log(`[resultsProcessor] Marked ${result.rowCount} future pick(s) as lost for eliminated participant ${participantId}`);
  }
}
```

**Call voidFuturePicks() in two places:**

1. In `processSeriesResult()` after eliminating participant (around line 1200):
```typescript
await participantModel.updateParticipant(pick.participant_id, {
  status: 'eliminated',
  eliminated_round: currentRound,
  eliminated_team: losingTeam,
});

// NEW: Void any future picks
await voidFuturePicks(pick.participant_id, currentRound);
```

2. In `runNoPickSweep()` after eliminating participant (around line 800):
```typescript
await participantModel.updateParticipant(participant.id, {
  status: 'eliminated',
  eliminated_round: round,
});

// NEW: Void any future picks
await voidFuturePicks(participant.id, round);
```

**Update auto-advance logic** (around line 1540):
```typescript
await poolModel.updatePool(poolId, {
  current_round: nextRound as TournamentRound,
  current_round_locked: false,
  allow_next_round_picks: false, // ✅ ADD THIS
});
```

#### 4. Update Pick Manager (`src/march-madness/services/pickManager.ts`)

**Add helper function:**
```typescript
function getNextRound(
  currentRound: TournamentRound,
  tournamentType: TournamentType
): TournamentRound | null {
  if (tournamentType === 'nba_playoffs') {
    return NBA_PLAYOFFS_NEXT_ROUND[currentRound] || null;
  } else {
    return NEXT_ROUND[currentRound] || null;
  }
}
```

**Modify `submitPick()` function** (around line 88):
```typescript
// Get current round
const currentRound = pool.current_round;

if (!currentRound) {
  return {
    success: false,
    message: 'No round is currently active. Please wait for the tournament to start.',
    error: 'NO_CURRENT_ROUND',
  };
}

// NEW: Determine which round is accepting picks
let acceptingPicksForRound: TournamentRound;

if (pool.allow_next_round_picks) {
  const nextRound = getNextRound(currentRound, pool.tournament_type);
  if (!nextRound) {
    return {
      success: false,
      message: 'No next round available.',
      error: 'NO_NEXT_ROUND',
    };
  }
  acceptingPicksForRound = nextRound;
} else {
  acceptingPicksForRound = currentRound;
}

// Use acceptingPicksForRound for all subsequent validation and pick creation
```

**Update all references from `currentRound` to `acceptingPicksForRound`:**
- Round locked check (line 100)
- Round started check (line 108-126)
- Existing pick check (line 166)
- Pick creation (line 172-177)
- Confirmation messages (line 180-190)

#### 5. Add Admin API Endpoint (`src/march-madness/admin/routes/pool.ts`)

```typescript
/**
 * POST /api/pool/allow-next-round-picks
 * Enable accepting picks for the next round while current round is in progress
 */
router.post('/allow-next-round-picks', async (req, res) => {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      return res.status(404).json({ error: 'No active pool found' });
    }

    if (pool.status !== 'active') {
      return res.status(400).json({ error: 'Pool must be active to allow next round picks' });
    }

    if (pool.allow_next_round_picks) {
      return res.status(400).json({ error: 'Next round picks already allowed' });
    }

    // Get next round
    const nextRoundMap = pool.tournament_type === 'nba_playoffs'
      ? NBA_PLAYOFFS_NEXT_ROUND
      : NEXT_ROUND;
    const nextRound = nextRoundMap[pool.current_round];

    if (!nextRound) {
      return res.status(400).json({ error: 'Already on final round' });
    }

    // Update pool
    await poolModel.updatePool(pool.id, { allow_next_round_picks: true });

    // Send Slack announcement
    const message = `🏀 Picks are now open for the *${nextRound}*!\n\nThe ${pool.current_round} is still in progress, but you can start submitting your picks for the next round.\n\nDM me your team to lock in your pick.`;
    await sendMainChannelMessage(message);

    res.json({
      success: true,
      nextRound,
      message: `Next round picks enabled for ${nextRound}`
    });
  } catch (error) {
    console.error('Error enabling next round picks:', error);
    res.status(500).json({ error: 'Failed to enable next round picks' });
  }
});
```

**Add imports at top of file:**
```typescript
import { NBA_PLAYOFFS_NEXT_ROUND } from '../../constants/nbaPlayoffs';
import { sendMainChannelMessage } from '../../services/slackMessaging';

// For March Madness rounds
const NEXT_ROUND: Partial<Record<TournamentRound, TournamentRound | null>> = {
  'Round of 64': 'Round of 32',
  'Round of 32': 'Sweet Sixteen',
  'Sweet Sixteen': 'Elite Eight',
  'Elite Eight': 'Final Four',
  'Final Four': 'Championship',
  'Championship': null,
};
```

### Admin Console Changes

#### 1. Update Dashboard HTML (`src/march-madness/admin/public/dashboard.html`)

**Add to Pool Settings tab** (after current round dropdown, around line 180):

```html
<!-- Allow Next Round Picks Section -->
<div class="form-group" id="allowNextRoundPicksSection" style="display: none;">
  <label>Next Round Picks</label>
  <div id="nextRoundPicksStatus" style="margin-bottom: 10px;">
    <!-- Dynamically populated -->
  </div>
  <button
    type="button"
    id="allowNextRoundPicksBtn"
    class="btn btn-warning"
    style="display: none;"
  >
    Allow Next Round Picks
  </button>
</div>
```

#### 2. Update Dashboard JavaScript (`src/march-madness/admin/public/js/dashboard.js`)

**Add to `loadPool()` function** (around line 150):

```javascript
// Show/hide allow next round picks button
const allowNextRoundSection = document.getElementById('allowNextRoundPicksSection');
const allowNextRoundBtn = document.getElementById('allowNextRoundPicksBtn');
const nextRoundStatus = document.getElementById('nextRoundPicksStatus');

if (pool.status === 'active' && pool.current_round) {
  allowNextRoundSection.style.display = 'block';

  // Determine next round
  const nextRoundMap = pool.tournament_type === 'nba_playoffs'
    ? {
        'First Round': 'Conference Semifinals',
        'Conference Semifinals': 'Conference Finals',
        'Conference Finals': 'NBA Finals',
        'NBA Finals': null
      }
    : {
        'Round of 64': 'Round of 32',
        'Round of 32': 'Sweet Sixteen',
        'Sweet Sixteen': 'Elite Eight',
        'Elite Eight': 'Final Four',
        'Final Four': 'Championship',
        'Championship': null
      };

  const nextRound = nextRoundMap[pool.current_round];

  if (pool.allow_next_round_picks) {
    // Show status, hide button
    nextRoundStatus.innerHTML = `<span class="badge badge-warning">Accepting picks for: ${nextRound} (next round override)</span>`;
    allowNextRoundBtn.style.display = 'none';
  } else if (nextRound) {
    // Show button
    nextRoundStatus.innerHTML = '';
    allowNextRoundBtn.textContent = `Allow ${nextRound} Picks`;
    allowNextRoundBtn.style.display = 'inline-block';
  } else {
    // Final round, hide everything
    allowNextRoundSection.style.display = 'none';
  }
} else {
  allowNextRoundSection.style.display = 'none';
}
```

**Add button click handler** (around line 400):

```javascript
// Allow Next Round Picks button
document.getElementById('allowNextRoundPicksBtn').addEventListener('click', async () => {
  if (!confirm('Allow participants to submit picks for the next round?\n\nThe current round will continue processing normally.')) {
    return;
  }

  try {
    const response = await fetch('/api/pool/allow-next-round-picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();

    if (response.ok) {
      alert(`Success! Picks are now open for ${data.nextRound}`);
      loadPool(); // Reload pool to update UI
    } else {
      alert('Error: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error enabling next round picks:', error);
    alert('Failed to enable next round picks');
  }
});
```

---

## User Flows

### Flow 1: Admin Enables Next Round Picks

1. Admin opens admin console
2. Navigates to Pool Settings tab
3. Sees: "Current Round: First Round"
4. Sees button: "Allow Conference Semifinals Picks"
5. Clicks button
6. Confirms dialog
7. Success message: "Picks are now open for Conference Semifinals"
8. Button disappears, replaced with badge: "Accepting picks for: Conference Semifinals (next round override)"
9. Slack channel receives announcement

### Flow 2: Participant Submits Pick for Next Round

1. Participant sees Slack announcement
2. DMs Betty: "Lakers"
3. Betty responds: "Pick submitted: Lakers for Conference Semifinals!" ✅
4. Participant can view pick in their status

### Flow 3: Participant Eliminated Before Their Next Round Pick Used

1. Participant submits "Lakers" for Conference Semifinals (next round)
2. Their First Round pick "Warriors" loses series 4-2
3. Betty DMs elimination roast for Warriors
4. Background: Betty marks Conference Semifinals "Lakers" pick as `result = 'lost'`
5. NO second roast DM sent (silent cleanup)
6. Admin can see pick is marked 'lost' in admin console

### Flow 4: Round Auto-Advances

1. All 8 First Round series complete
2. Results processor sends end-of-round summary
3. Auto-advances: `current_round = "Conference Semifinals"`
4. Resets: `allow_next_round_picks = false`
5. Sends channel message: "Picks are now open for Conference Semifinals"
6. Participants who submitted early are ready, others can now submit

---

## Edge Cases & Validation

### Edge Case 1: Admin Tries to Enable on Final Round
**Validation:** Button hidden when `current_round` is final round (NBA Finals / Championship)

### Edge Case 2: Participant Submits Same Team for Next Round They Used Before
**Validation:** Existing team reuse check applies - pick rejected

### Edge Case 3: Next Round Games Start Before Admin Enables Flag
**Impact:** Participants might miss deadline - this is admin's responsibility to enable in time

### Edge Case 4: Admin Enables Flag After Some Next Round Series Complete
**Behavior:** Works fine - results processor will process those completed series and eliminate participants normally

### Edge Case 5: Pool Advances While Picks Are Being Submitted
**Behavior:** Pick submission checks `allow_next_round_picks` and `current_round` atomically - should handle gracefully

### Edge Case 6: Participant Eliminated in Current Round Has No Future Picks
**Behavior:** `voidFuturePicks()` query returns 0 rows - harmless, logs "0 future picks marked as lost"

---

## Testing Checklist

### Unit Testing
- [ ] `voidFuturePicks()` marks pending picks as lost, ignores current round
- [ ] `getNextRound()` returns correct next round for both tournament types
- [ ] Pick submission uses next round when flag enabled
- [ ] Auto-advance resets flag to false

### Integration Testing
- [ ] Create NBA Playoffs pool, set to First Round
- [ ] Enable "Allow Conference Semifinals Picks"
- [ ] Verify Slack channel announcement sent
- [ ] Submit Conference Semifinals picks via DM
- [ ] Verify picks stored with `round = "Conference Semifinals"`
- [ ] Simulate First Round series completion
- [ ] Verify participants eliminated in First Round have Conference Semifinals picks marked as 'lost'
- [ ] Verify when 8 First Round series complete, pool advances to Conference Semifinals
- [ ] Verify flag resets to false after auto-advance
- [ ] Verify button reappears for Conference Finals

### Regression Testing
- [ ] March Madness pools still work without flag
- [ ] NBA Playoffs pools work without flag (normal behavior)
- [ ] Admin console loads without errors
- [ ] Build succeeds (`npm run build`)

---

## Deployment Plan

### 1. Database Update
- Manually add `allow_next_round_picks` column to `pools` table in Supabase

### 2. Code Deployment
- Merge to main branch
- Railway auto-deploys
- Verify build succeeds

### 3. Smoke Testing
- Open admin console
- Create test pool
- Verify button appears and works
- Delete test pool

---

## Future Enhancements

### Optional: Disable Next Round Picks Button
- Admin can manually disable flag before round completes
- Use case: Admin enabled by mistake

### Optional: Auto-Enable Based on Schedule
- Query ESPN API for next round start times
- Auto-enable flag 24 hours before first next-round game

### Optional: Notification When Flag Should Be Enabled
- Slack DM to admin: "Conference Semifinals starts tomorrow - consider enabling next round picks"

---

## Questions for Product Owner

1. Should there be a way to disable the flag once enabled? (e.g., admin enabled by mistake)
2. Should we send a reminder DM to admin when next round is about to start?
3. Should admin console show warning if next round games have started but flag not enabled?

---

## References

- **Related Docs:**
  - `docs/nba-playoffs-implementation.md` - NBA Playoffs feature overview
  - `docs/implementation_architecture.md` - System architecture

- **Key Files:**
  - `src/march-madness/services/resultsProcessor.ts` - Results processing logic
  - `src/march-madness/services/pickManager.ts` - Pick submission logic
  - `src/march-madness/models/pool.ts` - Pool data model

---

**End of Requirements Document**
