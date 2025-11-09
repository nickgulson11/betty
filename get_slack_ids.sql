-- First, let's see if you have any existing bets to grab IDs from
SELECT
  initiator_slack_id,
  opponent_slack_id,
  slack_channel_id,
  slack_thread_ts
FROM bets
ORDER BY created_at DESC
LIMIT 1;
