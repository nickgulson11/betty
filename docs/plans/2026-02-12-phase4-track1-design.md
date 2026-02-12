# Phase 4 Track 1 — Tournament Teams Management

**Created:** 2026-02-12
**Status:** Approved, ready for implementation
**Goal:** Allow admin to manage tournament teams, validate participant picks against real teams, and use Claude AI for fuzzy team name matching

---

## Overview

Track 1 adds the tournament teams layer to Betty. Before this, participants could submit any string as a team pick — there was no validation against actual NCAA teams. After Track 1:

- Admin can load all 68 teams into the system (manually or bulk import)
- Participant picks are validated against the `tournament_teams` table
- Fuzzy matching via Claude handles nicknames, abbreviations, and typos
- Admin UI has a full Teams tab for managing team status throughout the tournament

---

## Data Layer

### New Type (`src/march-madness/types/tournamentTeam.ts`)

```typescript
export type TeamStatus = 'active' | 'eliminated';

export interface TournamentTeam {
  id: string;
  pool_id: string;
  team_name: string;
  seed: number | null;
  region: string | null; // East, West, South, Midwest
  status: TeamStatus;
  eliminated_round: string | null;
  created_at: Date;
}

export interface CreateTeamInput {
  team_name: string;
  seed?: number;
  region?: string;
}

export interface BulkImportInput {
  teams: CreateTeamInput[];
}

export interface UpdateTeamInput {
  team_name?: string;
  seed?: number;
  region?: string;
}
```

### New Model (`src/march-madness/models/tournamentTeam.ts`)

Functions:
- `getTeamsByPool(poolId)` — all teams for a pool
- `getActiveTeams(poolId)` — only status='active' teams
- `getTeamByName(poolId, teamName)` — exact case-insensitive lookup
- `createTeam(poolId, input)` — single team insert
- `bulkCreateTeams(poolId, teams)` — upsert array (safe to re-run)
- `updateTeam(id, input)` — edit name/seed/region
- `markTeamEliminated(id, round)` — set status='eliminated' + eliminated_round
- `deleteTeam(id)` — remove single team
- `clearTeams(poolId)` — wipe all teams for pool (testing tool)

---

## Pick Validation with Claude Fuzzy Matching

### New Service (`src/march-madness/services/teamMatcher.ts`)

```typescript
matchTeamName(userInput: string, activeTeams: TournamentTeam[]): Promise<string | null>
```

**Matching flow:**
1. Try exact case-insensitive match first — skip Claude if found
2. If no exact match, call Claude with user input + active team list
3. Claude returns canonical team name from the list, or `null` if ambiguous
4. Return matched name or null

**Claude prompt (tight and deterministic):**
> "The user wants to pick a March Madness team. They typed: '{input}'. Return ONLY the exact team name from this list that they mean, or the word null if unclear. List: [Duke, North Carolina, ...]"

This prevents hallucination since Claude must choose from a fixed list.

### Updated Pick Submission Flow (`pickManager.ts`)

1. Fetch active teams from `tournament_teams`
2. If no teams exist → reject: "Tournament teams haven't been loaded yet. Contact the admin."
3. Try exact case-insensitive match
4. If no exact match → call Claude via `teamMatcher`
5. If Claude returns `null` → reject: "I don't recognize that team. Reply with `teams` to see the active list."
6. If matched → use canonical team name from DB for all downstream logic
7. Continue with existing validation (team reuse, participant status, etc.)
8. Confirm pick using canonical team name

### New Slack Bot Command

Add `teams` command to the DM handler — Betty replies with the list of active teams.

---

## Admin API Routes (`src/march-madness/admin/routes/teams.ts`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/teams` | All teams for current pool |
| POST | `/api/teams` | Add single team |
| POST | `/api/teams/bulk` | Bulk import array of teams |
| POST | `/api/teams/fetch-espn` | Placeholder — 501 Not Implemented |
| PUT | `/api/teams/:id` | Edit team (name, seed, region) |
| POST | `/api/teams/:id/eliminate` | Mark eliminated + round |
| DELETE | `/api/teams/all` | Clear all teams (testing) |
| DELETE | `/api/teams/:id` | Delete single team |

**Bulk import body:**
```json
{
  "teams": [
    { "team_name": "Duke", "seed": 1, "region": "East" },
    { "team_name": "North Carolina", "seed": 2, "region": "East" }
  ]
}
```

Upsert on `(pool_id, team_name)` — safe to re-import without creating duplicates.

**ESPN placeholder response:**
```json
{ "message": "ESPN integration coming in Phase 4 Track 2", "status": "not_implemented" }
```

---

## Admin UI (Teams Tab)

### Sidebar addition
New "🏀 Teams" nav item between Picks and Betty Chat.

### Teams view layout

**Stats bar:** Total Teams | Active | Eliminated

**Action buttons:**
- ➕ Add Team
- 📋 Bulk Import
- 🏀 Fetch from ESPN *(disabled, tooltip: "Coming in Track 2")*
- 🗑️ Clear All Teams *(testing tool, destructive)*

**Teams table columns:** Team Name | Seed | Region | Status | Eliminated Round | Actions (Edit / Eliminate / Delete)

### Modals

**Add Team modal:** Team Name (required), Seed 1-16 (optional), Region dropdown East/West/South/Midwest (optional)

**Bulk Import modal:** Textarea supporting two formats:
- Simple: one team name per line
- Full JSON: array with seed/region data

**Edit Team modal:** Same fields as Add Team, pre-populated

**Eliminate modal:** Round dropdown (Round of 64 through Championship)

---

## Files to Create/Modify

### New Files
1. `src/march-madness/types/tournamentTeam.ts`
2. `src/march-madness/models/tournamentTeam.ts`
3. `src/march-madness/services/teamMatcher.ts`
4. `src/march-madness/admin/routes/teams.ts`

### Modified Files
5. `src/march-madness/services/pickManager.ts` — add team validation + Claude matching
6. `src/march-madness/bot/slackBot.ts` — add `teams` command
7. `src/march-madness/admin/server.ts` — wire in teams router
8. `src/march-madness/admin/public/dashboard.html` — add Teams tab + modals
9. `src/march-madness/admin/public/js/dashboard.js` — Teams tab logic
10. `src/march-madness/admin/public/js/api.js` — Teams API calls

---

## Testing Checklist

- [ ] Add a single team via admin UI
- [ ] Bulk import 8 test teams via paste
- [ ] Submit pick with exact team name (no Claude call)
- [ ] Submit pick with lowercase team name (case-insensitive match)
- [ ] Submit pick with team nickname (Claude fuzzy match)
- [ ] Submit pick with unknown team name (rejected with helpful message)
- [ ] Submit pick when no teams loaded (rejected with admin message)
- [ ] Type `teams` in DM to see active team list
- [ ] Eliminate a team via admin UI
- [ ] Verify eliminated team cannot be picked
- [ ] Edit team name/seed/region
- [ ] Delete a single team
- [ ] Clear all teams (testing reset)
- [ ] ESPN button shows "coming soon" toast
