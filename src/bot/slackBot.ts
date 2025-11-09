import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { parseBetIntent, extractAllUserMentions } from '../services/claudeService';
import { normalizeTeamName, findGameForTeam, getOpponentTeam } from '../services/nbaService';
import {
  createPendingBet,
  updateBetMessageTs,
  formatConfirmationMessage,
  getBetByMessageTs,
  updateBetStatus,
  checkDuplicateBet,
} from '../services/betManager';
import { BetDetails, SlackContext } from '../types/bet';

dotenv.config();

// Initialize Slack app
export const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false, // We'll use HTTP mode with ngrok
});

// Handle @betty mentions
app.event('app_mention', async ({ event, say, client }) => {
  try {
    console.log('📩 Received mention:', {
      user: event.user,
      channel: event.channel,
      text: event.text,
    });

    // Extract thread timestamp for replying
    const threadTs = event.ts;
    const messageText = event.text;
    const currentDate = new Date();

    // Parse the bet intent using Claude
    console.log('🤖 Parsing bet with Claude...');
    const parsedBet = await parseBetIntent(messageText, currentDate, event.user);

    console.log('📊 Parsed bet:', parsedBet);

    // Handle different confidence levels
    if (parsedBet.missing_info.includes('no_bet_intent')) {
      // User is just chatting, not making a bet
      await say({
        text: `Hey there! 👋 I'm Betty, your betting bot for NBA games!\n\nTo make a bet, mention me with something like:\n"@betty I bet @friend that the Lakers win tonight for $5"\n\nOr just:\n"I bet @friend Lakers win tonight"`,
        thread_ts: threadTs,
      });
      return;
    }

    // Extract mentioned users
    const mentionedUsers = extractAllUserMentions(messageText);
    console.log('👥 Mentioned users:', mentionedUsers);

    // Filter out Betty's own user ID
    const bettyUserId = await getBettyUserId(client);
    const otherUsers = mentionedUsers.filter(userId => userId !== bettyUserId && userId !== event.user);

    if (parsedBet.confidence === 'unclear' || parsedBet.confidence === 'low') {
      // Need clarification
      const clarificationMessage = parsedBet.clarifying_question ||
        "I'm not quite sure I understand. Who are you betting with, and which team are you betting on?";

      await say({
        text: `🤔 ${clarificationMessage}`,
        thread_ts: threadTs,
      });
      return;
    }

    // High confidence - create the bet
    if (parsedBet.team) {
      const normalizedTeam = normalizeTeamName(parsedBet.team);
      console.log(`🏀 Normalized team: ${parsedBet.team} → ${normalizedTeam}`);

      // Determine opponent ID
      let opponentId: string | null = null;
      if (otherUsers.length > 0) {
        opponentId = otherUsers[0];
      }

      if (!opponentId) {
        await say({
          text: `🤔 I need to know who you're betting against. Please @mention your opponent!`,
          thread_ts: threadTs,
        });
        return;
      }

      // Parse timing to determine game date
      const estimatedGameDate = parseTimingToDate(parsedBet.timing || 'tonight');

      // Look up the actual game from ESPN API
      console.log(`🔍 Looking up game for ${normalizedTeam} on ${estimatedGameDate.toDateString()}...`);
      const actualGame = await findGameForTeam(normalizedTeam, estimatedGameDate);

      // Determine opponent team and actual game time
      let opponentTeam: string;
      let gameDate: Date;

      if (actualGame) {
        // Use actual game data from ESPN
        opponentTeam = getOpponentTeam(actualGame, normalizedTeam);
        gameDate = actualGame.start_time;
        console.log(`✅ Found game: ${actualGame.away_team} @ ${actualGame.home_team} at ${gameDate.toLocaleString()}`);
      } else {
        // Fallback if no game found
        if (parsedBet.opponent_team) {
          opponentTeam = normalizeTeamName(parsedBet.opponent_team);
        } else {
          opponentTeam = 'Opponent Team';
        }
        gameDate = estimatedGameDate;
        console.log(`⚠️  No game found in ESPN API, using fallback data`);
      }

      // Fetch user names from Slack
      const initiatorName = await getUserName(client, event.user as string);
      const opponentName = await getUserName(client, opponentId);

      // Create bet details
      const betDetails: BetDetails = {
        initiator_id: event.user as string,
        initiator_name: initiatorName,
        opponent_id: opponentId,
        opponent_name: opponentName,
        initiator_team: normalizedTeam,
        opponent_team: opponentTeam,
        game_date: gameDate,
        stakes: parsedBet.stakes || 'bragging rights',
      };

      const slackContext: SlackContext = {
        channel_id: event.channel as string,
        thread_ts: threadTs as string,
        user_id: event.user as string,
        message_text: messageText,
      };

      // Check for duplicate bets
      const isDuplicate = await checkDuplicateBet(
        betDetails.initiator_id,
        betDetails.opponent_id,
        betDetails.game_date
      );

      if (isDuplicate) {
        await say({
          text: `⚠️ You already have an active or pending bet with <@${betDetails.opponent_id}> for a game on ${gameDate.toLocaleDateString()}!\n\nCheck your existing bets before creating a new one.`,
          thread_ts: threadTs,
        });
        return;
      }

      // Create pending bet in database
      console.log('💾 Creating pending bet in database...');
      const bet = await createPendingBet(betDetails, slackContext);

      // Post confirmation message
      const confirmationText = formatConfirmationMessage(bet);
      const confirmationMessage = await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: confirmationText,
      });

      console.log('📬 Posted confirmation message:', confirmationMessage.ts);

      // Add reactions for acceptance/decline
      await client.reactions.add({
        channel: event.channel,
        timestamp: confirmationMessage.ts!,
        name: '+1', // 👍
      });

      await client.reactions.add({
        channel: event.channel,
        timestamp: confirmationMessage.ts!,
        name: 'x', // ❌
      });

      // Update bet with message timestamp
      await updateBetMessageTs(bet.id, confirmationMessage.ts!);

      console.log('✅ Bet confirmation posted successfully');
    }

    console.log('✅ Response sent successfully');
  } catch (error) {
    console.error('❌ Error handling mention:', error);

    // Try to send user-friendly error message
    try {
      let errorMessage = `😅 Oops! I ran into a problem processing that bet.\n\n`;

      // Provide helpful error details
      if (error instanceof Error) {
        if (error.message.includes('database') || error.message.includes('connection')) {
          errorMessage += `It looks like I'm having trouble connecting to my database. Please try again in a moment!`;
        } else if (error.message.includes('API') || error.message.includes('fetch')) {
          errorMessage += `I'm having trouble reaching the game data service. Please try again shortly!`;
        } else {
          errorMessage += `Something unexpected happened. Please try again, and if the problem continues, let your admin know!`;
        }
      } else {
        errorMessage += `Something unexpected happened. Please try again later!`;
      }

      await say({
        text: errorMessage,
        thread_ts: event.ts,
      });
    } catch (sayError) {
      console.error('Failed to send error message:', sayError);
    }
  }
});

/**
 * Get Betty's user ID from Slack
 */
let cachedBettyUserId: string | null = null;
async function getBettyUserId(client: any): Promise<string> {
  if (cachedBettyUserId) {
    return cachedBettyUserId;
  }

  try {
    const authResult = await client.auth.test();
    cachedBettyUserId = authResult.user_id;
    return authResult.user_id;
  } catch (error) {
    console.error('Failed to get Betty user ID:', error);
    return 'UNKNOWN';
  }
}

/**
 * Get user's display name from Slack
 */
async function getUserName(client: any, userId: string): Promise<string | undefined> {
  try {
    const result = await client.users.info({ user: userId });
    // Prefer display_name, fall back to real_name
    return result.user?.profile?.display_name || result.user?.profile?.real_name || result.user?.name;
  } catch (error) {
    console.error(`Failed to get user name for ${userId}:`, error);
    return undefined;
  }
}

/**
 * Parse timing string to Date (using US Eastern Time for NBA games)
 * @param timing - "tonight", "tomorrow", or date string
 * @returns Date object
 */
function parseTimingToDate(timing: string): Date {
  // Get current time in US Eastern Time (NBA's timezone)
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const normalizedTiming = timing.toLowerCase().trim();

  if (normalizedTiming === 'tonight' || normalizedTiming === 'today') {
    // Set to 8 PM today (typical game time) in Eastern Time
    const today = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate(), 20, 0, 0);
    return today;
  } else if (normalizedTiming === 'tomorrow') {
    // Set to 8 PM tomorrow in Eastern Time
    const tomorrow = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate() + 1, 20, 0, 0);
    return tomorrow;
  } else {
    // Try to parse as date string
    try {
      const parsed = new Date(timing);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    } catch (e) {
      // Fall through to default
    }

    // Default to tonight in Eastern Time
    return new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate(), 20, 0, 0);
  }
}

// Handle reaction additions (for bet confirmations)
app.event('reaction_added', async ({ event, client }) => {
  try {
    console.log('👍 Reaction added:', {
      user: event.user,
      reaction: event.reaction,
      item_type: event.item.type,
    });

    // Only process message reactions
    if (event.item.type !== 'message') {
      return;
    }

    const messageTs = event.item.ts;

    // Find the bet associated with this message
    const bet = await getBetByMessageTs(messageTs, 'pending');

    if (!bet) {
      console.log('No pending bet found for this message');
      return;
    }

    // Verify the reactor is the opponent (or initiator in testing mode)
    const isTestingMode = process.env.TESTING_MODE === 'true';
    const isOpponent = event.user === bet.opponent_slack_id;
    const isInitiator = event.user === bet.initiator_slack_id;

    if (!isOpponent && !(isTestingMode && isInitiator)) {
      console.log(`Reaction from ${event.user}, but opponent is ${bet.opponent_slack_id} (testing mode: ${isTestingMode}) - ignoring`);
      return;
    }

    if (isTestingMode && isInitiator) {
      console.log('🧪 Testing mode: Allowing initiator to react');
    }

    // Check if game has already started
    const now = new Date();
    const gameDate = new Date(bet.game_date);

    if (gameDate <= now) {
      console.log(`⚠️  Game has already started - cannot accept bet ${bet.id}`);
      await client.chat.postMessage({
        channel: bet.slack_channel_id,
        thread_ts: bet.slack_thread_ts,
        text: `⚠️ Sorry, the game has already started! Bets can only be accepted before kickoff.`,
      });
      // Update bet to cancelled
      await updateBetStatus(bet.id, 'cancelled');
      return;
    }

    // Handle acceptance (thumbs up)
    if (event.reaction === '+1') {
      console.log(`✅ Bet ${bet.id} accepted by opponent`);

      // Update bet status to active
      await updateBetStatus(bet.id, 'active');

      // Post acceptance message
      await client.chat.postMessage({
        channel: bet.slack_channel_id,
        thread_ts: bet.slack_thread_ts,
        text: `✅ *Bet locked in!* <@${bet.initiator_slack_id}> vs <@${bet.opponent_slack_id}>\n\nMay the best predictor win! 🏀\n\nI'll check the results after the game and let you know who won.`,
      });

      console.log('✅ Bet activated successfully');
    }

    // Handle decline (red X)
    if (event.reaction === 'x') {
      console.log(`❌ Bet ${bet.id} declined by opponent`);

      // Update bet status to declined
      await updateBetStatus(bet.id, 'declined');

      // Determine who declined
      const decliner = isOpponent ? bet.opponent_slack_id : bet.initiator_slack_id;

      // Post decline message
      await client.chat.postMessage({
        channel: bet.slack_channel_id,
        thread_ts: bet.slack_thread_ts,
        text: `❌ Bet declined by <@${decliner}>. Maybe next time!`,
      });

      console.log('❌ Bet declined');
    }
  } catch (error) {
    console.error('❌ Error handling reaction:', error);
  }
});

// Handle errors
app.error(async (error) => {
  console.error('⚠️  Slack app error:', error);
});

// Start the Slack app
export const startSlackBot = async (port: number = 3000) => {
  try {
    await app.start(port);
    console.log(`⚡️ Betty Slack bot is running on port ${port}`);
    console.log(`🔗 Make sure to expose this port with ngrok for Slack events`);
    return app;
  } catch (error) {
    console.error('Failed to start Slack bot:', error);
    throw error;
  }
};

// Graceful shutdown
export const stopSlackBot = async () => {
  try {
    await app.stop();
    console.log('🛑 Slack bot stopped');
  } catch (error) {
    console.error('Error stopping Slack bot:', error);
  }
};
