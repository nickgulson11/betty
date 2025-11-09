import { Bet, BetDetails, SlackContext } from '../types/bet';
import { getPool } from '../models/database';

/**
 * Check if a similar active bet already exists
 * @param initiatorId - Initiator user ID
 * @param opponentId - Opponent user ID
 * @param gameDate - Game date
 * @returns True if duplicate exists
 */
export async function checkDuplicateBet(
  initiatorId: string,
  opponentId: string,
  gameDate: Date
): Promise<boolean> {
  const pool = getPool();

  const query = `
    SELECT COUNT(*) as count
    FROM bets
    WHERE (
      (initiator_slack_id = $1 AND opponent_slack_id = $2)
      OR (initiator_slack_id = $2 AND opponent_slack_id = $1)
    )
    AND status IN ('pending', 'active')
    AND DATE(game_date) = DATE($3)
  `;

  try {
    const result = await pool.query(query, [initiatorId, opponentId, gameDate]);
    const count = parseInt(result.rows[0].count);
    return count > 0;
  } catch (error) {
    console.error('Error checking for duplicate bet:', error);
    return false; // Allow bet creation if check fails
  }
}

/**
 * Create a pending bet in the database
 * @param betDetails - Parsed bet details
 * @param slackContext - Slack channel/thread context
 * @returns Created bet record
 */
export async function createPendingBet(
  betDetails: BetDetails,
  slackContext: SlackContext
): Promise<Bet> {
  const pool = getPool();

  const query = `
    INSERT INTO bets (
      status,
      initiator_slack_id,
      initiator_name,
      opponent_slack_id,
      opponent_name,
      initiator_team,
      opponent_team,
      game_date,
      stakes,
      slack_channel_id,
      slack_thread_ts,
      settlement_attempts
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const values = [
    'pending',
    betDetails.initiator_id,
    betDetails.initiator_name,
    betDetails.opponent_id,
    betDetails.opponent_name,
    betDetails.initiator_team,
    betDetails.opponent_team,
    betDetails.game_date,
    betDetails.stakes || 'bragging rights',
    slackContext.channel_id,
    slackContext.thread_ts,
    0, // settlement_attempts starts at 0
  ];

  try {
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('Failed to create bet - no rows returned');
    }

    const bet = result.rows[0];
    console.log('✅ Created pending bet:', bet.id);

    return {
      id: bet.id,
      created_at: bet.created_at,
      status: bet.status,
      initiator_slack_id: bet.initiator_slack_id,
      initiator_name: bet.initiator_name,
      opponent_slack_id: bet.opponent_slack_id,
      opponent_name: bet.opponent_name,
      initiator_team: bet.initiator_team,
      opponent_team: bet.opponent_team,
      game_date: bet.game_date,
      stakes: bet.stakes,
      slack_channel_id: bet.slack_channel_id,
      slack_thread_ts: bet.slack_thread_ts,
      slack_message_ts: bet.slack_message_ts,
      winner_slack_id: bet.winner_slack_id,
      final_score: bet.final_score,
      settled_at: bet.settled_at,
      conversation_state: bet.conversation_state,
      settlement_attempts: bet.settlement_attempts,
      last_settlement_check: bet.last_settlement_check,
    };
  } catch (error) {
    console.error('❌ Error creating pending bet:', error);
    throw error;
  }
}

/**
 * Update bet with Slack message timestamp (for tracking the confirmation message)
 * @param betId - Bet ID
 * @param messageTs - Slack message timestamp
 */
export async function updateBetMessageTs(
  betId: string,
  messageTs: string
): Promise<void> {
  const pool = getPool();

  const query = `
    UPDATE bets
    SET slack_message_ts = $1
    WHERE id = $2
  `;

  try {
    await pool.query(query, [messageTs, betId]);
    console.log(`✅ Updated bet ${betId} with message timestamp`);
  } catch (error) {
    console.error('❌ Error updating bet message timestamp:', error);
    throw error;
  }
}

/**
 * Get a bet by its Slack message timestamp
 * @param messageTs - Slack message timestamp
 * @param status - Optional status filter
 * @returns Bet if found, null otherwise
 */
export async function getBetByMessageTs(
  messageTs: string,
  status?: string
): Promise<Bet | null> {
  const pool = getPool();

  let query = `
    SELECT * FROM bets
    WHERE slack_message_ts = $1
  `;

  const values: any[] = [messageTs];

  if (status) {
    query += ` AND status = $2`;
    values.push(status);
  }

  try {
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    const bet = result.rows[0];
    return {
      id: bet.id,
      created_at: bet.created_at,
      status: bet.status,
      initiator_slack_id: bet.initiator_slack_id,
      initiator_name: bet.initiator_name,
      opponent_slack_id: bet.opponent_slack_id,
      opponent_name: bet.opponent_name,
      initiator_team: bet.initiator_team,
      opponent_team: bet.opponent_team,
      game_date: bet.game_date,
      stakes: bet.stakes,
      slack_channel_id: bet.slack_channel_id,
      slack_thread_ts: bet.slack_thread_ts,
      slack_message_ts: bet.slack_message_ts,
      winner_slack_id: bet.winner_slack_id,
      final_score: bet.final_score,
      settled_at: bet.settled_at,
      conversation_state: bet.conversation_state,
      settlement_attempts: bet.settlement_attempts,
      last_settlement_check: bet.last_settlement_check,
    };
  } catch (error) {
    console.error('❌ Error getting bet by message timestamp:', error);
    throw error;
  }
}

/**
 * Update bet status
 * @param betId - Bet ID
 * @param newStatus - New status
 */
export async function updateBetStatus(
  betId: string,
  newStatus: string
): Promise<void> {
  const pool = getPool();

  const query = `
    UPDATE bets
    SET status = $1
    WHERE id = $2
  `;

  try {
    await pool.query(query, [newStatus, betId]);
    console.log(`✅ Updated bet ${betId} status to ${newStatus}`);
  } catch (error) {
    console.error('❌ Error updating bet status:', error);
    throw error;
  }
}

/**
 * Format game date/time for display
 * @param gameDate - Game date
 * @returns Formatted date string
 */
export function formatGameTime(gameDate: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const gameDay = new Date(gameDate.getFullYear(), gameDate.getMonth(), gameDate.getDate());

  const diffDays = Math.floor((gameDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'tonight';
  } else if (diffDays === 1) {
    return 'tomorrow';
  } else if (diffDays === -1) {
    return 'yesterday';
  } else {
    return gameDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }
}

/**
 * Format a confirmation message for a bet
 * @param bet - Bet to format
 * @returns Formatted Slack message
 */
export function formatConfirmationMessage(bet: Bet): string {
  const gameTime = formatGameTime(bet.game_date);

  return `🎲 *Bet Proposed!*

<@${bet.initiator_slack_id}> bets <@${bet.opponent_slack_id}> that *${bet.initiator_team}* beats *${bet.opponent_team}*

📅 Game: ${bet.initiator_team} vs ${bet.opponent_team}, ${gameTime}
💰 Stakes: ${bet.stakes}

<@${bet.opponent_slack_id}> - React with 👍 to accept or ❌ to decline`;
}

/**
 * Settle a bet with a winner
 * @param betId - Bet ID
 * @param winnerId - Slack user ID of winner
 * @param finalScore - Final score string
 */
export async function settleBet(
  betId: string,
  winnerId: string,
  finalScore: string
): Promise<void> {
  const pool = getPool();

  const query = `
    UPDATE bets
    SET status = 'settled',
        winner_slack_id = $1,
        final_score = $2,
        settled_at = NOW()
    WHERE id = $3
  `;

  try {
    await pool.query(query, [winnerId, finalScore, betId]);
    console.log(`✅ Settled bet ${betId}, winner: ${winnerId}`);
  } catch (error) {
    console.error('❌ Error settling bet:', error);
    throw error;
  }
}

/**
 * Cancel a bet (for postponed games, errors, etc.)
 * @param betId - Bet ID
 * @param reason - Reason for cancellation
 */
export async function cancelBet(betId: string, reason: string): Promise<void> {
  const pool = getPool();

  const query = `
    UPDATE bets
    SET status = 'cancelled',
        settled_at = NOW()
    WHERE id = $1
  `;

  try {
    await pool.query(query, [betId]);
    console.log(`❌ Cancelled bet ${betId}: ${reason}`);
  } catch (error) {
    console.error('❌ Error cancelling bet:', error);
    throw error;
  }
}
