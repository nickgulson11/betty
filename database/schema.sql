-- Betty Database Schema
-- Create the bets table

CREATE TABLE IF NOT EXISTS bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL, -- pending, active, settled, declined, cancelled
  initiator_slack_id TEXT NOT NULL,
  initiator_name TEXT,
  opponent_slack_id TEXT NOT NULL,
  opponent_name TEXT,
  initiator_team TEXT NOT NULL,
  opponent_team TEXT NOT NULL,
  game_date TIMESTAMP NOT NULL,
  stakes TEXT DEFAULT 'bragging rights',
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  slack_message_ts TEXT, -- for the confirmation message
  winner_slack_id TEXT,
  final_score TEXT,
  settled_at TIMESTAMP,
  conversation_state JSONB, -- for multi-turn clarification
  settlement_attempts INTEGER DEFAULT 0,
  last_settlement_check TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_settlement ON bets(status, game_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bets_message_ts ON bets(slack_message_ts);
