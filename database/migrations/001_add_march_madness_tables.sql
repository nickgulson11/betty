-- Migration: Add March Madness Pool Tables
-- Created: 2025-02-08
-- Description: Creates 4 core tables for March Madness survivor pool functionality

-- =============================================================================
-- Table 1: pools
-- Stores tournament pool instances (metadata, current round, status)
-- =============================================================================

CREATE TABLE IF NOT EXISTS pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  sport VARCHAR(50) NOT NULL DEFAULT 'NCAA Basketball',
  status VARCHAR(20) NOT NULL CHECK (status IN ('setup', 'active', 'completed')),
  current_round VARCHAR(50), -- 'Round of 64', 'Round of 32', 'Sweet Sixteen', 'Elite Eight', 'Final Four', 'Championship'
  entry_fee DECIMAL(10,2),
  slack_channel_id TEXT NOT NULL,
  admin_slack_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

COMMENT ON TABLE pools IS 'March Madness tournament pool instances';
COMMENT ON COLUMN pools.status IS 'Pool lifecycle: setup (before tournament), active (during), completed (finished)';
COMMENT ON COLUMN pools.current_round IS 'Which round is currently accepting picks or in progress';

-- =============================================================================
-- Table 2: participants
-- Stores users participating in the pool
-- =============================================================================

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  slack_username TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'eliminated', 'withdrawn')),
  eliminated_round VARCHAR(50), -- Which round they were eliminated in
  eliminated_team TEXT, -- Which team caused their elimination
  paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMP,
  tiebreaker_prediction INTEGER, -- Championship game total points prediction
  joined_at TIMESTAMP DEFAULT NOW(),
  eliminated_at TIMESTAMP,

  UNIQUE(pool_id, slack_user_id)
);

COMMENT ON TABLE participants IS 'Users participating in March Madness pool';
COMMENT ON COLUMN participants.status IS 'active (still in), eliminated (knocked out), withdrawn (quit early)';
COMMENT ON COLUMN participants.tiebreaker_prediction IS 'Total points in championship game (for tiebreaker if multiple survivors)';

CREATE INDEX idx_participants_pool ON participants(pool_id);
CREATE INDEX idx_participants_status ON participants(pool_id, status);
CREATE INDEX idx_participants_slack_user ON participants(slack_user_id);

-- =============================================================================
-- Table 3: picks
-- Stores team selections per participant per round
-- =============================================================================

CREATE TABLE IF NOT EXISTS picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  round VARCHAR(50) NOT NULL,
  team_name TEXT NOT NULL,
  result VARCHAR(20) CHECK (result IN ('won', 'lost', 'pending')), -- NULL = not started, pending = in progress, won/lost = final
  submitted_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraint: One pick per participant per round
  UNIQUE(participant_id, round)
);

COMMENT ON TABLE picks IS 'Team selections for each round by each participant';
COMMENT ON COLUMN picks.result IS 'NULL = round not started, pending = games in progress, won = team won (advance), lost = team lost (eliminated)';
COMMENT ON COLUMN picks.updated_at IS 'Tracks when pick was last changed (users can update before deadline)';

CREATE INDEX idx_picks_participant ON picks(participant_id);
CREATE INDEX idx_picks_round ON picks(pool_id, round);
CREATE INDEX idx_picks_result ON picks(pool_id, round, result);

-- =============================================================================
-- Table 4: tournament_teams
-- Stores all teams in the NCAA tournament and their elimination status
-- =============================================================================

CREATE TABLE IF NOT EXISTS tournament_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  seed INTEGER, -- 1-16 seed (optional)
  region VARCHAR(50), -- East, West, South, Midwest (optional)
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'eliminated')),
  eliminated_round VARCHAR(50), -- Which round they were eliminated in
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(pool_id, team_name)
);

COMMENT ON TABLE tournament_teams IS 'All 68 teams in NCAA tournament with elimination tracking';
COMMENT ON COLUMN tournament_teams.status IS 'active = still in tournament, eliminated = knocked out';
COMMENT ON COLUMN tournament_teams.eliminated_round IS 'Round where team was eliminated (if eliminated)';

CREATE INDEX idx_teams_pool ON tournament_teams(pool_id);
CREATE INDEX idx_teams_status ON tournament_teams(pool_id, status);
CREATE INDEX idx_teams_name ON tournament_teams(pool_id, team_name);

-- =============================================================================
-- Verification Query
-- Run this after migration to confirm tables were created
-- =============================================================================

-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN ('pools', 'participants', 'picks', 'tournament_teams')
-- ORDER BY table_name;
