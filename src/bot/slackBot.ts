import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { parseBetIntent, extractAllUserMentions, detectQueryIntent } from '../services/claudeService';
import { normalizeTeamName, findGameForTeam, getOpponentTeam } from '../services/nbaService';
import { normalizeNFLTeamName, findGameForNFLTeam, findNextNFLGame, getOpponentTeam as getNFLOpponentTeam } from '../services/nflService';
import {
  createPendingBet,
  updateBetMessageTs,
  formatConfirmationMessage,
  getBetByMessageTs,
  updateBetStatus,
  checkDuplicateBet,
  getOpenBetsByUsers,
  formatOpenBetsList,
} from '../services/betManager';
import {
  isPersonalityModeEnabled,
  getPersonalityWelcomeMessage,
  getPersonalityAcceptanceMessage,
  getPersonalityDeclineMessage,
  getPersonalityDuplicateBetMessage,
  getPersonalityGameStartedMessage,
  getPersonalityErrorMessage,
  getPersonalityClarifyingQuestion
} from '../services/personalityService';
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

    // First, detect what type of query this is
    console.log('🔍 Detecting query intent...');
    const queryIntent = await detectQueryIntent(messageText);
    console.log('📊 Query intent:', queryIntent);

    // Handle bet listing queries
    if (queryIntent.type === 'list_bets') {
      console.log('📋 Handling bet listing query...');
      console.log('   Scope:', queryIntent.scope);
      let userIdsToQuery: string[] = [];

      if (queryIntent.scope === 'self') {
        // User asking about their own bets
        userIdsToQuery = [event.user as string];
        console.log('   Querying for self:', userIdsToQuery);
      } else if (queryIntent.scope === 'specific_user' && queryIntent.mentioned_users && queryIntent.mentioned_users.length > 0) {
        // User asking about specific user(s)
        const bettyUserId = await getBettyUserId(client);
        const mentionedUsers = queryIntent.mentioned_users || [];
        userIdsToQuery = mentionedUsers.filter(id => id !== bettyUserId);
        console.log('   Querying for specific users:', userIdsToQuery);
      } else if (queryIntent.scope === 'channel') {
        // User asking about all bets in the channel
        userIdsToQuery = await getChannelMembers(client, event.channel as string);
        console.log('   Querying for channel members:', userIdsToQuery);

        // If channel members is empty or failed, fall back to just the requester
        if (userIdsToQuery.length === 0) {
          console.log('   ⚠️ No channel members found, falling back to requester');
          userIdsToQuery = [event.user as string];
        }
      } else {
        // Default to requester's bets
        userIdsToQuery = [event.user as string];
        console.log('   Querying for self (default):', userIdsToQuery);
      }

      // Fetch and display open bets
      console.log('   Final user IDs to query:', userIdsToQuery);
      let openBets = await getOpenBetsByUsers(userIdsToQuery);
      console.log(`   Found ${openBets.length} open bets`);

      // Get channel members to filter bets
      const channelMembers = await getChannelMembers(client, event.channel as string);
      const channelMemberSet = new Set(channelMembers);

      // Filter to only show bets where BOTH initiator AND opponent are in the channel
      const filteredBets = openBets.filter(bet =>
        channelMemberSet.has(bet.initiator_slack_id) &&
        channelMemberSet.has(bet.opponent_slack_id)
      );

      console.log(`   After filtering for channel members: ${filteredBets.length} bets`);
      const formattedList = formatOpenBetsList(filteredBets);

      await client.chat.postMessage({
        channel: event.channel,
        text: formattedList,
      });

      return;
    }

    // Handle general chat
    if (queryIntent.type === 'general_chat') {
      const welcomeMessage = isPersonalityModeEnabled()
        ? getPersonalityWelcomeMessage()
        : `Hey there! 👋 I'm Betty, your betting bot for NBA and NFL games!\n\n**Examples:**\n🏀 NBA: "@betty I bet @friend that the Lakers win tonight for $5"\n🏈 NFL: "@betty I bet @friend on the Chiefs game"\n\n**Check your bets:**\n"@betty what bets do I have open?"\n\nLet's get betting! 🏀🏈`;

      await client.chat.postMessage({
        channel: event.channel,
        text: welcomeMessage,
      });
      return;
    }

    // Parse the bet intent using Claude
    console.log('🤖 Parsing bet with Claude...');
    const parsedBet = await parseBetIntent(messageText, currentDate, event.user);

    console.log('📊 Parsed bet:', parsedBet);

    // Handle different confidence levels
    if (parsedBet.missing_info.includes('no_bet_intent')) {
      // User is just chatting, not making a bet
      const welcomeMessage = isPersonalityModeEnabled()
        ? getPersonalityWelcomeMessage()
        : `Hey there! 👋 I'm Betty, your betting bot for NBA and NFL games!\n\n**Examples:**\n🏀 NBA: "@betty I bet @friend that the Lakers win tonight for $5"\n🏈 NFL: "@betty I bet @friend on the Chiefs game"\n\nNo date needed for NFL - I'll find their next game!`;

      await client.chat.postMessage({
        channel: event.channel,
        text: welcomeMessage,
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
      let clarificationMessage: string;

      if (isPersonalityModeEnabled() && parsedBet.missing_info.length > 0) {
        // Use personality clarifying question
        clarificationMessage = getPersonalityClarifyingQuestion(parsedBet.missing_info);
      } else {
        // Use Claude's clarifying question or default
        clarificationMessage = parsedBet.clarifying_question ||
          "I'm not quite sure I understand. Who are you betting with, and which team are you betting on?";
        clarificationMessage = `🤔 ${clarificationMessage}`;
      }

      await say({
        text: clarificationMessage,
        thread_ts: threadTs,
      });
      return;
    }

    // High confidence - create the bet
    if (parsedBet.team) {
      // Determine sport by trying to normalize team name for both NBA and NFL
      const nbaTeam = normalizeTeamName(parsedBet.team);
      const nflTeam = normalizeNFLTeamName(parsedBet.team);

      let sport: 'NBA Basketball' | 'NFL Football' | null = null;
      let normalizedTeam: string;

      // Check which sport this team belongs to
      if (nbaTeam !== parsedBet.team) {
        // NBA team found (normalizeTeamName returns original if not found)
        sport = 'NBA Basketball';
        normalizedTeam = nbaTeam;
        console.log(`🏀 NBA team detected: ${parsedBet.team} → ${normalizedTeam}`);
      } else if (nflTeam !== null) {
        // NFL team found
        sport = 'NFL Football';
        normalizedTeam = nflTeam;
        console.log(`🏈 NFL team detected: ${parsedBet.team} → ${normalizedTeam}`);
      } else {
        // Team not recognized in either sport
        await say({
          text: `🤔 I couldn't determine which sport. Please mention 'NFL' or 'NBA' in your bet, or use a recognized team name.`,
          thread_ts: threadTs,
        });
        return;
      }

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

      // Look up the actual game from ESPN API based on sport
      let actualGame;

      if (sport === 'NBA Basketball') {
        // NBA: Use timing to determine game date
        const estimatedGameDate = parseTimingToDate(parsedBet.timing || 'tonight');
        console.log(`🔍 Looking up NBA game for ${normalizedTeam} on ${estimatedGameDate.toDateString()}...`);
        actualGame = await findGameForTeam(normalizedTeam, estimatedGameDate);
      } else {
        // NFL: For most cases, just find next upcoming game
        // Only use specific date lookup if user provides an actual date
        const timing = (parsedBet.timing || '').toLowerCase().trim();

        console.log(`🔍 Detected timing for NFL: "${timing}"`);

        // Check if it's a specific date format (YYYY-MM-DD, MM/DD/YYYY, etc)
        const hasSpecificDate = timing && (
          /^\d{4}-\d{2}-\d{2}/.test(timing) ||  // YYYY-MM-DD
          /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(timing) ||  // MM/DD/YYYY
          /^(january|february|march|april|may|june|july|august|september|october|november|december)/.test(timing) // Month name
        );

        // For NFL, default to finding next game unless there's a very specific date
        if (!hasSpecificDate) {
          console.log(`🔍 Looking up next NFL game for ${normalizedTeam}...`);
          actualGame = await findNextNFLGame(normalizedTeam);
        } else {
          // Very specific date provided, use it
          const estimatedGameDate = parseTimingToDate(parsedBet.timing || 'tonight');
          console.log(`🔍 Looking up NFL game for ${normalizedTeam} on ${estimatedGameDate.toDateString()}...`);
          actualGame = await findGameForNFLTeam(normalizedTeam, estimatedGameDate);
        }
      }

      // Determine opponent team and actual game time
      let opponentTeam: string;
      let gameDate: Date;

      if (actualGame) {
        // Use actual game data from ESPN
        opponentTeam = sport === 'NBA Basketball'
          ? getOpponentTeam(actualGame, normalizedTeam)
          : getNFLOpponentTeam(actualGame, normalizedTeam);
        gameDate = actualGame.start_time;
        console.log(`✅ Found game: ${actualGame.away_team} @ ${actualGame.home_team} at ${gameDate.toLocaleString()}`);
      } else {
        // No game found - reject the bet
        const timing = (parsedBet.timing || '').toLowerCase().trim();
        const hasSpecificDate = timing && (
          /^\d{4}-\d{2}-\d{2}/.test(timing) ||
          /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(timing) ||
          /^(january|february|march|april|may|june|july|august|september|october|november|december)/.test(timing)
        );

        const timingText = sport === 'NFL Football' && !hasSpecificDate
          ? 'in the next 14 days'
          : parsedBet.timing || 'tonight';

        console.log(`❌ No game found for ${normalizedTeam}`);
        await say({
          text: `😏 Nice try, but the ${normalizedTeam} aren't playing ${timingText}. Can't bet on a game that doesn't exist, genius. Check the schedule and come back when you've got a real game!`,
          thread_ts: threadTs,
        });
        return;
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
        betDetails.game_date,
        betDetails.initiator_team,
        betDetails.opponent_team
      );

      if (isDuplicate) {
        const duplicateMessage = isPersonalityModeEnabled()
          ? getPersonalityDuplicateBetMessage(betDetails.opponent_id, betDetails.initiator_team, betDetails.opponent_team)
          : `⚠️ You already have an active or pending bet with <@${betDetails.opponent_id}> for ${betDetails.initiator_team} vs ${betDetails.opponent_team}!\n\nYou can't bet on the same game twice.`;

        await say({
          text: duplicateMessage,
          thread_ts: threadTs,
        });
        return;
      }

      // Create pending bet in database
      console.log('💾 Creating pending bet in database...');
      const bet = await createPendingBet(betDetails, slackContext, sport);

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
      let errorMessage: string;

      if (isPersonalityModeEnabled()) {
        errorMessage = getPersonalityErrorMessage();
      } else {
        errorMessage = `😅 Oops! I ran into a problem processing that bet.\n\n`;

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
 * Get all members in a Slack channel (for group bet queries)
 */
async function getChannelMembers(client: any, channelId: string): Promise<string[]> {
  try {
    console.log(`   Fetching members for channel: ${channelId}`);
    const result = await client.conversations.members({ channel: channelId });
    console.log(`   Raw members from Slack:`, result.members);
    const bettyUserId = await getBettyUserId(client);
    console.log(`   Betty's user ID: ${bettyUserId}`);
    // Filter out Betty from the list
    const filteredMembers = result.members.filter((id: string) => id !== bettyUserId);
    console.log(`   Filtered members (without Betty):`, filteredMembers);
    return filteredMembers;
  } catch (error) {
    console.error(`Failed to get channel members for ${channelId}:`, error);
    return [];
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

    // Check if game has already started (skip check in testing mode)
    const now = new Date();
    const gameDate = new Date(bet.game_date);

    if (gameDate <= now && !isTestingMode) {
      console.log(`⚠️  Game has already started - cannot accept bet ${bet.id}`);
      const gameStartedMessage = isPersonalityModeEnabled()
        ? getPersonalityGameStartedMessage()
        : `⚠️ Sorry, the game has already started! Bets can only be accepted before kickoff.`;

      await client.chat.postMessage({
        channel: bet.slack_channel_id,
        thread_ts: bet.slack_thread_ts,
        text: gameStartedMessage,
      });
      // Update bet to cancelled
      await updateBetStatus(bet.id, 'cancelled');
      return;
    }

    if (isTestingMode && gameDate <= now) {
      console.log('🧪 Testing mode: Allowing bet on live/past game');
    }

    // Handle acceptance (thumbs up)
    if (event.reaction === '+1') {
      console.log(`✅ Bet ${bet.id} accepted by opponent`);

      // Update bet status to active
      await updateBetStatus(bet.id, 'active');

      // Post acceptance message
      const acceptanceMessage = isPersonalityModeEnabled()
        ? getPersonalityAcceptanceMessage(bet)
        : `✅ *Bet locked in!* <@${bet.initiator_slack_id}> vs <@${bet.opponent_slack_id}>\n\nMay the best predictor win! 🏀\n\nI'll check the results after the game and let you know who won.`;

      await client.chat.postMessage({
        channel: bet.slack_channel_id,
        thread_ts: bet.slack_thread_ts,
        text: acceptanceMessage,
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
      const declineMessage = isPersonalityModeEnabled()
        ? getPersonalityDeclineMessage(bet.initiator_slack_id, bet.opponent_slack_id, decliner)
        : `❌ Bet declined by <@${decliner}>. Maybe next time!`;

      await client.chat.postMessage({
        channel: bet.slack_channel_id,
        thread_ts: bet.slack_thread_ts,
        text: declineMessage,
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
