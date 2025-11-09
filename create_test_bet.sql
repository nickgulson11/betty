-- Create a test bet for a game that already happened
-- Replace the placeholder values below with your actual IDs

-- STEP 1: Fill in your values here:
-- YOUR_USER_ID: Your Slack user ID (starts with U...)
-- CHANNEL_ID: Channel ID where you'll test (starts with C...)

INSERT INTO bets (
  status,
  initiator_slack_id,
  opponent_slack_id,
  initiator_team,
  opponent_team,
  game_date,
  stakes,
  slack_channel_id,
  slack_thread_ts,
  settlement_attempts
) VALUES (
  'active',
  'YOUR_USER_ID',           -- ⬅️ Replace with your Slack user ID
  'YOUR_USER_ID',           -- ⬅️ Same ID is fine for testing
  'Los Angeles Lakers',     -- Lakers played recently
  'Memphis Grizzlies',
  '2024-11-06 19:30:00',    -- November 6, 2024 (adjust to a real game date)
  '$10 test',
  'CHANNEL_ID',             -- ⬅️ Replace with your channel ID
  '1730000000.000000',      -- Fake thread timestamp (Betty will post here)
  0
);

-- Verify it was created
SELECT * FROM bets WHERE stakes LIKE '%test%' ORDER BY created_at DESC LIMIT 1;
