# Phase 4 Track 2 — ESPN API Integration & Results Processing

**Created:** 2026-02-15
**Status:** Approved, ready for implementation
**Goal:** Automatically fetch tournament game results from ESPN, process team eliminations, update participant picks, and send Slack announcements

---

## Overview

Track 2 closes the loop on tournament automation. When a game completes, Betty:
1. Detects it via ESPN API (or admin manually triggers via Teams tab / Simulate Game)
2. **Loser:** marks affected picks as `lost`, marks affected participants as `eliminated`, sends roast DMs + channel announcement
3. **Winner:** marks affected picks as `won`, sends congrats DMs to surviving participants
4. Posts end-of-round summary when all expected eliminations for the round are recorded

No new DB tables. No schema changes. The existing `tournament_teams.status`, `picks.result`, and `participants.status` fields are sufficient.

---

## ESPN API

**Endpoint:**
```
GET https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100
```

No API key required. Returns today's games. Called every 30 minutes by the scheduler.

**Filtering tournament games:**
- `competitions[0].type.abbreviation === "TRNMNT"` — tournament game
- `competitions[0].status.type.name === "STATUS_FINAL"` — game is over
- `competitions[0].status.type.name === "STATUS_IN_PROGRESS"` — game has started

**Round name** parsed from `competitions[0].notes[0].headline`:
```
"Men's Basketball Championship - South Region - 2nd Round"
→ "2nd Round"
```

**Round name values:** `1st Round`, `2nd Round`, `Sweet 16`, `Elite Eight`, `Final Four`, `Championship`

**Loser detection:** competitor where `winner === false`

**Team name handling:** ESPN names include nickname (e.g. `"Gonzaga Bulldogs"`). Use existing `teamMatcher.ts` Claude fuzzy matching to map to canonical DB name.

---

## Processing Logic

### Scheduler poll cycle (every 30 min)

For each round present in today's games:

**1. Round-start sweep (no-pick auto-elimination)**

Trigger condition: any game in Round X is `IN_PROGRESS` or `FINAL`, AND no teams in DB are yet eliminated with `eliminated_round === 'Round X'`.

Action: find all active participants with no pick submitted → mark them `eliminated` → send roast DMs + channel message.

This fires once per round (the first time the scheduler sees Round X has begun), using the existing `tournament_teams` eliminated data as the detection signal. No new tracking table needed.

**2. Per-game processing (completed games)**

For each `STATUS_FINAL` tournament game:

*Loser:*
1. Extract losing team name from ESPN, fuzzy-match via `teamMatcher.ts`
2. If no match → log warning, skip (admin can manually eliminate via Teams tab)
3. If team already `eliminated` → skip (idempotent)
4. Mark team `eliminated` with round name
5. Find all picks for that team with `result === 'pending'` → mark `lost`
6. Find participants with those picks → mark `eliminated`
7. Send roast DMs + mid-round channel announcement

*Winner:*
1. Extract winning team name from ESPN, fuzzy-match via `teamMatcher.ts`
2. Find all picks for that team with `result === 'pending'` → mark `won`
3. Send congrats DMs to those participants

**3. End-of-round summary**

Trigger condition: all games for Round X in today's results are `STATUS_FINAL` **AND** elimination count for Round X in DB equals `ROUND_ELIMINATION_COUNTS[round]` (32/16/8/4/2/1).

This replaces the old hardcoded `ROUND_END_DATES` map — no date dependencies, works for any tournament year.

Action: send end-of-round summary to main channel — how many participants eliminated this round, how many still standing.

---

## Slack Notifications

All messages use `personalityService.ts` + Claude for tone. Betty's personality applied to all messages.

| Trigger | Message Type | Destination |
|---------|-------------|-------------|
| No-pick participant at round start | Roast DM | Individual participant |
| No-pick sweep | Channel announcement | Main channel |
| Team eliminated mid-round | Roast DM per affected participant | Individual participant |
| Team eliminated mid-round | Roast announcement | Main channel |
| Team wins mid-round | Congrats DM per participant who picked them | Individual participant |
| All expected round eliminations recorded | End-of-round summary | Main channel |

**Mid-round channel message:** Betty roasts eliminated participants by name. Personality-driven, fun.

**End-of-round channel message:** Clean summary — N eliminated this round, N still standing.

---

## Admin UI Changes

**Dashboard Quick Actions:**
1. **"Force Sync Now"** — triggers immediate ESPN fetch + `processGames()`, returns summary
2. **"Simulate Round End"** — runs end-of-round pipeline bypassing elimination count check, for testing
3. **"Simulate Game Result"** — modal accepting winner + loser + round; builds mock `TournamentGame` and calls `processGames()` end-to-end. Primary local testing tool for winner/loser pipeline.

**Picks Tab:**
4. **"Add Pick" modal** — admin override to manually enter a pick for any participant + round + team

**Existing Eliminate button** (Teams tab, no UI change) — updated backend to run the full results processor pipeline after marking the team eliminated. Makes manual elimination functionally identical to automatic.

---

## New Files

### `src/march-madness/services/ncaaService.ts`

```typescript
fetchTodaysGames(): Promise<TournamentGame[]>
```

Returns only completed and in-progress tournament games from today's ESPN scoreboard. Each `TournamentGame` includes: `homeTeam`, `awayTeam`, `winner`, `loser`, `round`, `status`.

### `src/march-madness/services/resultsProcessor.ts`

```typescript
processGames(games: TournamentGame[]): Promise<ProcessorResult>
eliminateTeam(teamName: string, round: string): Promise<EliminationResult>
```

`processGames` — full pipeline: round-start sweep + per-game elimination + end-of-round summary detection.

`eliminateTeam` — single team elimination pipeline (called by the existing admin Eliminate button endpoint). Handles picks, participants, Slack notifications.

### `src/march-madness/scheduler/tournamentScheduler.ts`

Cron job, runs every 30 minutes. Only active when `BETTY_MODE === 'march_madness'`. Calls `ncaaService.fetchTodaysGames()` → `resultsProcessor.processGames()`. Logs each run to Railway logs.

---

## Modified Files

### `src/march-madness/admin/routes/teams.ts`
- `POST /api/teams/:id/eliminate` — after DB update, call `resultsProcessor.eliminateTeam()`
- `POST /api/teams/sync` — triggers immediate scheduler run, returns summary
- Replace existing 501 ESPN placeholder with real `/sync` call

### `src/march-madness/admin/public/dashboard.html`
- Add sync status line below Teams stats bar
- Replace "Fetch from ESPN" placeholder button with "Force Sync Now" button

### `src/march-madness/admin/public/js/dashboard.js`
- Force Sync button handler — calls `/api/teams/sync`, shows result toast, updates last-synced time

### `src/march-madness/admin/public/js/api.js`
- `syncTeams()` — POST `/api/teams/sync`

### `src/index.ts`
- Wire `tournamentScheduler.start()` into startup when `BETTY_MODE === 'march_madness'`

---

## Testing Strategy

No live tournament data is available until March. Use the **existing Eliminate button** as the full end-to-end test tool:

1. Load test teams via bulk import
2. Add test participants with picks
3. Click Eliminate on a team → verify:
   - Team marked eliminated in DB
   - Affected picks marked `lost`
   - Affected participants marked `eliminated`
   - Roast DMs sent to eliminated participants
   - Channel announcement posted
4. Test no-pick auto-elimination by leaving a participant with no pick, then triggering round start via Force Sync (with mock data) or manual eliminate
5. Test Force Sync button — verify it runs without errors (no tournament games today = no-op, returns empty summary)

### Testing Checklist
- [ ] Force Sync returns clean no-op response when no tournament games today
- [ ] Eliminate button triggers full pipeline (picks, participants, DMs, channel)
- [ ] Participant with lost pick is marked eliminated
- [ ] Participant with no pick is auto-eliminated at round start
- [ ] Roast DM sent to each eliminated participant
- [ ] Mid-round channel announcement posted after each game result
- [ ] End-of-round summary posted when all round games complete
- [ ] Idempotency: eliminating already-eliminated team is a no-op
- [ ] Unknown team name from ESPN logs warning and skips gracefully
- [ ] Scheduler wires up cleanly on `npm start` in march_madness mode

---

## Key Design Decisions

- **No new DB tables** — round-start detection uses existing `tournament_teams.eliminated_round` as signal
- **Idempotency** — team already eliminated = skip, no double-processing
- **Single code path** — `resultsProcessor.eliminateTeam()` called by both scheduler and admin Eliminate button
- **ESPN team name fuzzy matching** — reuse existing `teamMatcher.ts` (Claude Haiku) to map ESPN nicknames to DB canonical names
- **Winning picks** — `celebrateWinner()` runs after each game's loser is processed; marks pending picks for the winning team as `won` and sends congrats DMs. All three `PickResult` values (`won`/`lost`/`pending`) are now actively used
- **Elimination-count round detection** — `ROUND_ELIMINATION_COUNTS` (32/16/8/4/2/1) replaces hardcoded `ROUND_END_DATES`. End-of-round summary fires when DB elimination count equals expected — no date dependencies, works for any year
- **Simulate Game Result** — admin testing tool that bypasses ESPN entirely; builds a mock `TournamentGame` and runs `processGames()` for full end-to-end testing of both winner and loser pipelines
- **Force Sync = manual override** — useful if ESPN is down or returns bad data during tournament
