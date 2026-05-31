import { App, ExpressReceiver } from '@slack/bolt';
import { setupAdminRoutes } from '../admin/server';
import { submitPick, getCurrentPick } from '../services/pickManager';
import { sendErrorDM } from '../services/slackMessaging';
import * as poolModel from '../models/pool';
import * as teamModel from '../models/tournamentTeam';

export async function startMarchMadnessBot(port: number): Promise<void> {
  console.log('🏀 March Madness Bot starting...');

  // Create Express receiver so we can add custom routes
  const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  });

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
  });

  // Setup admin routes on the same Express app
  setupAdminRoutes(receiver.app);

  // Handle DM messages for pick submission
  app.message(async ({ message, say }) => {
    try {
      console.log('📩 Received message:', message);

      // Only handle direct messages
      if (message.channel_type !== 'im') {
        return;
      }

      // Ignore bot messages
      if (message.subtype === 'bot_message' || (message as any).bot_id) {
        return;
      }

      const userId = (message as any).user;
      const text = (message as any).text?.trim();

      if (!text) {
        return;
      }

      console.log(`📝 Pick submission from ${userId}: "${text}"`);

      // Check if tournament is completed
      const pool = await poolModel.getCurrentPool();
      if (pool && pool.status === 'completed') {
        await say(
          `🏆 The tournament is over! Thanks for playing. Check the channel for the final results. Betty out. 🎉`
        );
        return;
      }

      // Handle special commands
      const lowerText = text.toLowerCase();

      if (lowerText === 'help' || lowerText === 'info') {
        const pool = await poolModel.getCurrentPool();
        if (pool && pool.series_prediction_mode) {
          await say(
            `🏀 *NBA Series Prediction Mode - How to Play*\n\n` +
              `*Submit a prediction:* Just send me one of the possible options (e.g., "Knicks in 5", "Spurs in 6")\n\n` +
              `*Check your prediction:* Send \`my pick\` or \`status\`\n\n` +
              `*Possible options:*\n` +
              `• Knicks in 4, Knicks in 5, Knicks in 6, Knicks in 7\n` +
              `• Spurs in 4, Spurs in 5, Spurs in 6, Spurs in 7\n\n` +
              `Good luck! 🍀`
          );
        } else {
          await say(
            `🏀 *March Madness Pool - How to Play*\n\n` +
              `*Submit a pick:* Just send me the team name (e.g., "Duke", "North Carolina", "Heels")\n\n` +
              `*Check your pick:* Send \`my pick\` or \`status\`\n\n` +
              `*See active teams:* Send \`teams\`\n\n` +
              `*Rules:*\n` +
              `• Pick ONE team per round\n` +
              `• If your team wins, you advance\n` +
              `• If your team loses, you're eliminated\n` +
              `• You CANNOT reuse teams across rounds\n\n` +
              `Good luck! 🍀`
          );
        }
        return;
      }

      if (lowerText === 'teams' || lowerText === 'team list' || lowerText === 'show teams') {
        const pool = await poolModel.getCurrentPool();
        if (!pool) {
          await say(`No active pool found. Contact the admin.`);
          return;
        }

        if (pool.series_prediction_mode) {
          await say(
            `🏀 *NBA Series Prediction Options*\n\n` +
              `• Knicks in 4, Knicks in 5, Knicks in 6, Knicks in 7\n` +
              `• Spurs in 4, Spurs in 5, Spurs in 6, Spurs in 7`
          );
          return;
        }

        const activeTeams = await teamModel.getActiveTeams(pool.id);

        if (activeTeams.length === 0) {
          await say(`No teams have been loaded yet. The admin needs to set up the tournament teams first.`);
          return;
        }

        // Group by region if regions are set
        const hasRegions = activeTeams.some((t) => t.region);

        if (hasRegions) {
          const byRegion: Record<string, typeof activeTeams> = {};
          for (const team of activeTeams) {
            const region = team.region || 'Other';
            if (!byRegion[region]) byRegion[region] = [];
            byRegion[region].push(team);
          }

          let message = `🏀 *Active Teams (${activeTeams.length})*\n\n`;
          for (const region of ['East', 'West', 'South', 'Midwest', 'Other']) {
            if (!byRegion[region]) continue;
            message += `*${region}*\n`;
            message += byRegion[region]
              .sort((a, b) => (a.seed || 99) - (b.seed || 99))
              .map((t) => `  ${t.seed ? `(${t.seed}) ` : ''}${t.team_name}`)
              .join('\n');
            message += '\n\n';
          }
          await say(message.trim());
        } else {
          const teamList = activeTeams
            .sort((a, b) => (a.seed || 99) - (b.seed || 99) || a.team_name.localeCompare(b.team_name))
            .map((t) => (t.seed ? `(${t.seed}) ${t.team_name}` : t.team_name))
            .join('\n');
          await say(`🏀 *Active Teams (${activeTeams.length})*\n\n${teamList}`);
        }
        return;
      }

      if (lowerText === 'my pick' || lowerText === 'status') {
        const { pick, round } = await getCurrentPick(userId);

        if (!pick || !round) {
          await say(`You haven't submitted a pick for the current round yet.`);
        } else {
          await say(`Your pick for *${round}*: *${pick.team_name}*\n\nYou can change it by sending me a new team name.`);
        }
        return;
      }

      // Treat message as a team pick submission
      const result = await submitPick(userId, text);

      if (!result.success) {
        // Error occurred - send error message
        await sendErrorDM(userId, result.message);
        return;
      }

      // Success - confirmation already sent by submitPick
      console.log(`✅ Pick submitted successfully for ${userId}`);
    } catch (error) {
      console.error('❌ Error handling message:', error);

      try {
        await say(
          `❌ Oops! Something went wrong processing your pick. Please try again or contact the admin.`
        );
      } catch (sayError) {
        console.error('Failed to send error message:', sayError);
      }
    }
  });

  // Start the app
  await app.start(port);
  console.log(`⚡️ March Madness bot running on port ${port}!`);
  console.log(`🔐 Admin console available at /admin`);
}
