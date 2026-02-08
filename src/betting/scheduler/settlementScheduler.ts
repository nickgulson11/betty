import cron from 'node-cron';
import { getPool } from '../../shared/models/database';
import { Bet } from '../../types/bet';
import { checkGameResult, determineWinner } from '../services/resultsService';
import { settleBet, cancelBet, getExpiredPendingBets } from '../services/betManager';
import { app } from '../bot/slackBot';
import {
  isPersonalityModeEnabled,
  generatePersonalitySettlementMessage
} from '../../shared/services/personalityService';

/**
 * Start the settlement scheduler
 * Runs every 30 minutes to check for games that need settlement
 */
export function startSettlementScheduler() {
  // Run every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏰ Running bet settlement check...');

    try {
      // First, cancel any pending bets where the game has already started
      await cleanupExpiredPendingBets();

      // Get active bets ready for settlement
      const bets = await getActiveBetsReadyForSettlement();

      if (bets.length === 0) {
        console.log('No bets ready for settlement');
        return;
      }

      console.log(`Found ${bets.length} bet(s) ready for settlement`);

      for (const bet of bets) {
        await attemptSettlement(bet);
      }

      console.log('✅ Settlement check complete');
    } catch (error) {
      console.error('❌ Error in settlement scheduler:', error);
    }
  });

  console.log('⏰ Settlement scheduler started (runs every 30 minutes)');
}

/**
 * Cancel pending bets where the game has already started
 */
async function cleanupExpiredPendingBets(): Promise<void> {
  try {
    const expiredBets = await getExpiredPendingBets();

    if (expiredBets.length === 0) {
      console.log('No expired pending bets to clean up');
      return;
    }

    console.log(`Found ${expiredBets.length} expired pending bet(s) to cancel`);

    for (const bet of expiredBets) {
      console.log(`❌ Cancelling expired pending bet ${bet.id} (game started at ${bet.game_date})`);

      // Cancel the bet
      await cancelBet(bet.id, 'Game started before bet was accepted');

      // Post cancellation message to Slack
      await postExpiredBetMessage(bet);
    }

    console.log('✅ Expired pending bets cleanup complete');
  } catch (error) {
    console.error('❌ Error cleaning up expired pending bets:', error);
  }
}

/**
 * Post message about expired pending bet
 */
async function postExpiredBetMessage(bet: Bet): Promise<void> {
  try {
    const sportEmoji = bet.sport === 'NFL Football' ? '🏈' : '🏀';

    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: bet.slack_channel_id,
      thread_ts: bet.slack_thread_ts,
      text: `⏰ *Bet Expired*

This bet was never accepted and the game has already started.

<@${bet.initiator_slack_id}> vs <@${bet.opponent_slack_id}>
${bet.initiator_team} vs ${bet.opponent_team}

Better luck next time! ${sportEmoji}`
    });

    console.log(`✅ Posted expired bet message for bet ${bet.id}`);
  } catch (error) {
    console.error(`Error posting expired bet message for bet ${bet.id}:`, error);
  }
}

/**
 * Get active bets that are ready for settlement
 * Sport-specific timing:
 * - NBA Basketball: game time + 90 minutes
 * - NFL Football: game time + 180 minutes (3 hours)
 */
async function getActiveBetsReadyForSettlement(): Promise<Bet[]> {
  const pool = getPool();

  const query = `
    SELECT * FROM bets
    WHERE status = 'active'
    AND game_date + (
      CASE
        WHEN sport = 'NBA Basketball' THEN INTERVAL '90 minutes'
        WHEN sport = 'NFL Football' THEN INTERVAL '180 minutes'
        ELSE INTERVAL '90 minutes'
      END
    ) < NOW()
    AND settled_at IS NULL
    ORDER BY game_date ASC
  `;

  try {
    const result = await pool.query(query);

    return result.rows.map(row => ({
      id: row.id,
      created_at: row.created_at,
      status: row.status,
      sport: row.sport,
      initiator_slack_id: row.initiator_slack_id,
      opponent_slack_id: row.opponent_slack_id,
      initiator_team: row.initiator_team,
      opponent_team: row.opponent_team,
      game_date: row.game_date,
      stakes: row.stakes,
      slack_channel_id: row.slack_channel_id,
      slack_thread_ts: row.slack_thread_ts,
      slack_message_ts: row.slack_message_ts,
      winner_slack_id: row.winner_slack_id,
      final_score: row.final_score,
      settled_at: row.settled_at,
      conversation_state: row.conversation_state,
      settlement_attempts: row.settlement_attempts,
      last_settlement_check: row.last_settlement_check,
    }));
  } catch (error) {
    console.error('Error getting active bets:', error);
    return [];
  }
}

/**
 * Attempt to settle a bet
 * @param bet - The bet to settle
 */
async function attemptSettlement(bet: Bet): Promise<void> {
  const pool = getPool();

  try {
    console.log(`🔍 Attempting to settle bet ${bet.id}...`);
    console.log(`   ${bet.initiator_team} vs ${bet.opponent_team}`);

    // Increment attempt counter and update last check time
    await pool.query(
      `UPDATE bets
       SET settlement_attempts = settlement_attempts + 1,
           last_settlement_check = NOW()
       WHERE id = $1`,
      [bet.id]
    );

    // Check game result from ESPN API
    const result = await checkGameResult(bet);

    if (result.status === 'completed' && result.is_final) {
      // Game is final - settle the bet
      const winnerId = determineWinner(bet, result);

      if (!winnerId) {
        console.error(`Could not determine winner for bet ${bet.id}`);
        await cancelBet(bet.id, 'Unable to determine winner');
        await postCancellationMessage(bet, 'Unable to determine winner from game result');
        return;
      }

      // Update bet in database
      await settleBet(bet.id, winnerId, result.final_score || 'Score not available');

      // Post settlement message to Slack
      await postSettlementMessage(bet, winnerId, result.final_score || '');

      console.log(`✅ Bet ${bet.id} settled successfully`);

    } else if (result.status === 'postponed') {
      // Game was postponed - cancel the bet
      await cancelBet(bet.id, 'Game was postponed');
      await postCancellationMessage(bet, 'Game was postponed');

      console.log(`❌ Bet ${bet.id} cancelled (game postponed)`);

    } else if (result.status === 'in_progress') {
      // Game still in progress - check again later
      console.log(`⏳ Bet ${bet.id}: Game still in progress, will check again in 30 min`);

    } else {
      // Game not found or other issue
      console.log(`⚠️  Bet ${bet.id}: Game result not found (attempt ${bet.settlement_attempts + 1}/8)`);

      // After 8 attempts (4 hours), give up and cancel
      if (bet.settlement_attempts + 1 >= 8) {
        console.error(`Bet ${bet.id} exceeded max settlement attempts`);
        await cancelBet(bet.id, 'Unable to verify game result after multiple attempts');
        await postCancellationMessage(bet, 'Unable to verify game result');
      }
    }

  } catch (error) {
    console.error(`Error settling bet ${bet.id}:`, error);

    // After 8 attempts, give up
    if (bet.settlement_attempts >= 8) {
      await cancelBet(bet.id, 'Error during settlement');
      await postCancellationMessage(bet, 'Technical error during settlement');
    }
  }
}

/**
 * Post settlement message to Slack
 */
async function postSettlementMessage(
  bet: Bet,
  winnerId: string,
  finalScore: string
): Promise<void> {
  try {
    const loserId = winnerId === bet.initiator_slack_id
      ? bet.opponent_slack_id
      : bet.initiator_slack_id;

    let settlementMessage: string;

    // Use personality-driven Claude-generated message if enabled
    if (isPersonalityModeEnabled()) {
      console.log('🎭 Generating personality settlement message with Claude...');
      settlementMessage = await generatePersonalitySettlementMessage(bet, winnerId, finalScore);
    } else {
      // Default neutral message
      settlementMessage = `🏆 *Bet Settled!*

Final Score: ${finalScore}

<@${winnerId}> wins the bet! 🎉
<@${loserId}>, time to pay up those ${bet.stakes}! 💸`;
    }

    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: bet.slack_channel_id,
      thread_ts: bet.slack_thread_ts,
      reply_broadcast: true,  // Also send to main channel
      text: settlementMessage
    });

    console.log(`✅ Posted settlement message for bet ${bet.id}`);
  } catch (error) {
    console.error(`Error posting settlement message for bet ${bet.id}:`, error);
  }
}

/**
 * Post cancellation message to Slack
 */
async function postCancellationMessage(bet: Bet, reason: string): Promise<void> {
  try {
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: bet.slack_channel_id,
      thread_ts: bet.slack_thread_ts,
      reply_broadcast: true,  // Also send to main channel
      text: `❌ *Bet Cancelled*

Reason: ${reason}

No money changes hands. Better luck next time! 🤷`
    });

    console.log(`❌ Posted cancellation message for bet ${bet.id}`);
  } catch (error) {
    console.error(`Error posting cancellation message for bet ${bet.id}:`, error);
  }
}

/**
 * Stop the settlement scheduler (for graceful shutdown)
 */
export function stopSettlementScheduler() {
  cron.getTasks().forEach(task => task.stop());
  console.log('⏰ Settlement scheduler stopped');
}

/**
 * Manually trigger settlement (for testing)
 * Runs the settlement logic immediately instead of waiting for cron
 */
export async function manuallyTriggerSettlement(): Promise<void> {
  console.log('🧪 Manual settlement triggered!');

  try {
    // First, cancel any pending bets where the game has already started
    await cleanupExpiredPendingBets();

    // Get active bets ready for settlement
    const bets = await getActiveBetsReadyForSettlement();

    if (bets.length === 0) {
      console.log('No bets ready for settlement');
      return;
    }

    console.log(`Found ${bets.length} bet(s) ready for settlement`);

    for (const bet of bets) {
      await attemptSettlement(bet);
    }

    console.log('✅ Manual settlement complete');
  } catch (error) {
    console.error('❌ Error in manual settlement:', error);
    throw error;
  }
}
