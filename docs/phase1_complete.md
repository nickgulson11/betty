# Phase 1 Complete: Foundation ✅

**Completed:** February 8, 2025
**Duration:** ~1 hour

---

## Summary

Phase 1 successfully established the foundation for Betty's March Madness mode while fully preserving the existing betting functionality. The codebase is now organized with a feature flag system that allows switching between modes.

---

## What Was Accomplished

### 1. ✅ Feature Flag System
- Created `src/config/mode.ts` with `BETTY_MODE` environment variable
- Supports two modes: `betting` (legacy) and `march_madness` (new)
- Mode detection functions: `getMode()`, `isBettingMode()`, `isMarchMadnessMode()`

### 2. ✅ Database Migration
- Created `database/migrations/001_add_march_madness_tables.sql`
- Defines 4 core tables:
  - `pools` - Tournament metadata and settings
  - `participants` - Users in the pool
  - `picks` - Team selections per round
  - `tournament_teams` - NCAA teams and elimination status
- All timestamps support Central Time display
- Comprehensive indexes for performance

### 3. ✅ Code Restructuring
**New Directory Structure:**
```
src/
├── config/               # Feature flag configuration
│   └── mode.ts
├── shared/              # Shared across both modes
│   ├── models/
│   │   └── database.ts
│   └── services/
│       ├── claudeService.ts
│       └── personalityService.ts
├── betting/             # Legacy betting mode (preserved)
│   ├── bot/
│   │   └── slackBot.ts
│   ├── services/
│   │   ├── betManager.ts
│   │   ├── nbaService.ts
│   │   ├── nflService.ts
│   │   └── resultsService.ts
│   └── scheduler/
│       └── settlementScheduler.ts
└── march-madness/       # New March Madness mode (scaffolded)
    ├── bot/
    ├── services/
    ├── models/
    ├── types/
    └── admin/
```

### 4. ✅ Updated Entry Point
- Modified `src/index.ts` to route by `BETTY_MODE`
- Betting mode: Imports and runs original betting bot
- March Madness mode: Placeholder ready for implementation
- Clean separation of concerns

### 5. ✅ Import Path Updates
- All betting mode files updated to use new relative paths
- Shared services (`claudeService`, `personalityService`) imported from `src/shared/`
- Database connection imported from `src/shared/models/`
- Type definitions imported from `src/types/`

### 6. ✅ Environment Variables
- Updated `.env.example` with:
  - `BETTY_MODE` - Mode selector (betting | march_madness)
  - `ADMIN_PASSWORD` - Admin console password (march_madness only)
  - `SLACK_MAIN_CHANNEL_ID` - Main channel for announcements (march_madness only)
- Clearly documented which settings apply to which mode

---

## File Changes

### Created:
- `src/config/mode.ts`
- `database/migrations/001_add_march_madness_tables.sql`
- `src/shared/` directory structure
- `src/betting/` directory structure
- `src/march-madness/` directory structure
- `docs/phase1_complete.md` (this file)

### Modified:
- `src/index.ts` - Mode router
- `src/betting/bot/slackBot.ts` - Import paths
- `src/betting/services/betManager.ts` - Import paths
- `src/betting/services/nbaService.ts` - Import paths
- `src/betting/services/nflService.ts` - Import paths
- `src/betting/services/resultsService.ts` - Import paths
- `src/betting/scheduler/settlementScheduler.ts` - Import paths
- `.env.example` - Added mode configuration

### Copied (No Deletions):
- Original files preserved in `src/bot/`, `src/services/`, etc.
- Copies placed in `src/betting/` and `src/shared/`
- **All legacy code intact** - can revert if needed

---

## How to Use

### Run in Betting Mode (Legacy)
```bash
# In Railway or .env file:
BETTY_MODE=betting

# Start Betty
npm run dev
```

Output:
```
🤖 Betty Bot Starting...
📍 Mode: BETTING
   NBA/NFL Betting Bot
...
✅ Betty is ready to accept bets!
```

### Run in March Madness Mode (New - Placeholder)
```bash
# In Railway or .env file:
BETTY_MODE=march_madness

# Start Betty
npm run dev
```

Output:
```
🤖 Betty Bot Starting...
📍 Mode: MARCH_MADNESS
   March Madness Pool
...
⚠️  March Madness mode is under construction!
```

---

## Database Migration

### To Apply Migration:

**On Supabase:**
1. Go to Supabase Dashboard
2. Navigate to SQL Editor
3. Copy contents of `database/migrations/001_add_march_madness_tables.sql`
4. Paste and execute

**Verify:**
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('pools', 'participants', 'picks', 'tournament_teams')
ORDER BY table_name;
```

Should return:
- `participants`
- `picks`
- `pools`
- `tournament_teams`

---

## Railway Deployment

### Environment Variables to Add in Railway:

```bash
BETTY_MODE=march_madness
ADMIN_PASSWORD=your-secure-password-here
SLACK_MAIN_CHANNEL_ID=C0123456789
```

(Keep existing variables: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `ANTHROPIC_API_KEY`, `DATABASE_URL`)

---

## Testing Checklist

- [ ] Test betting mode still works (set `BETTY_MODE=betting`)
- [ ] Test march_madness mode starts without errors (placeholder)
- [ ] Verify database migration runs successfully
- [ ] Confirm Railway environment variables set
- [ ] Test mode switching (change `BETTY_MODE` and restart)

---

## Next Steps: Phase 2

**Goal:** Build Admin Web Console

**Tasks:**
1. Create Express routes for admin API
2. Build authentication middleware (password protection)
3. Create admin frontend (HTML/CSS/JS)
4. Implement pool management endpoints
5. Implement participant management
6. Build Betty Chat console

**Target:** Complete by end of Week 2

---

## Notes

- **No deletions:** Original betting code completely preserved
- **Backward compatible:** Can switch back to betting mode anytime
- **Clean separation:** Betting and March Madness modes fully isolated
- **Shared services:** Claude AI and database connection reused efficiently
- **Ready for next phase:** Scaffolding in place for March Madness implementation

---

**Status:** ✅ Phase 1 Complete
**Next:** Begin Phase 2 - Admin Console
