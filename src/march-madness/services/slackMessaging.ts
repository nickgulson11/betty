import { WebClient } from '@slack/web-api';

// Initialize Slack Web API client
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Send a direct message to a Slack user
 */
export async function sendDM(userId: string, message: string): Promise<boolean> {
  try {
    console.log(`📬 Sending DM to ${userId}...`);

    // Open a DM channel with the user
    const dmChannel = await slackClient.conversations.open({
      users: userId,
    });

    if (!dmChannel.channel?.id) {
      console.error('Failed to open DM channel');
      return false;
    }

    // Send the message
    await slackClient.chat.postMessage({
      channel: dmChannel.channel.id,
      text: message,
    });

    console.log(`✅ DM sent to ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending DM:', error);
    return false;
  }
}

/**
 * Send a message to a Slack channel
 */
export async function sendChannelMessage(
  channelId: string,
  message: string
): Promise<boolean> {
  try {
    console.log(`📢 Sending message to channel ${channelId}...`);

    await slackClient.chat.postMessage({
      channel: channelId,
      text: message,
    });

    console.log(`✅ Message sent to channel ${channelId}`);
    return true;
  } catch (error) {
    console.error('Error sending channel message:', error);
    return false;
  }
}

/**
 * Send a message to the main March Madness channel (from current pool's slack_channel_id)
 */
export async function sendMainChannelMessage(message: string): Promise<boolean> {
  // Dynamic import to avoid circular dependency
  const poolModel = await import('../models/pool');

  const pool = await poolModel.getCurrentPool();

  if (!pool) {
    console.error('No active pool found');
    return false;
  }

  if (!pool.slack_channel_id) {
    console.error('Pool does not have a slack_channel_id configured');
    return false;
  }

  return sendChannelMessage(pool.slack_channel_id, message);
}

/**
 * Get user info from Slack
 */
export async function getUserInfo(userId: string): Promise<{
  id: string;
  name: string;
  realName: string;
} | null> {
  try {
    const result = await slackClient.users.info({ user: userId });

    if (!result.user) {
      return null;
    }

    return {
      id: result.user.id!,
      name: result.user.name || 'Unknown',
      realName: result.user.real_name || result.user.name || 'Unknown',
    };
  } catch (error) {
    console.error('Error getting user info:', error);
    return null;
  }
}

/**
 * Send welcome DM to a new participant
 */
export async function sendWelcomeDM(userId: string, poolName: string): Promise<boolean> {
  const message = `👋 Welcome to the **${poolName}**! 🏀

Here's how it works:
• Pick ONE team per round (6 rounds total)
• If your team wins, you advance to the next round
• If your team loses, you're eliminated
• You CANNOT reuse teams (once you pick Duke, Duke is unavailable for all future rounds)
• Picks are due before the first game of each round starts

**How to submit your pick:**
Just DM me the team name! For example:
\`Duke\`
\`North Carolina\`
\`Gonzaga\`

I'll confirm your pick and let you know if there are any issues.

Good luck! 🍀`;

  return sendDM(userId, message);
}

/**
 * Send pick confirmation DM
 */
export async function sendPickConfirmation(
  userId: string,
  teamName: string,
  round: string
): Promise<boolean> {
  const message = `✅ **Pick confirmed!**

**Round:** ${round}
**Your team:** ${teamName}

You can change your pick anytime before the deadline. Just send me a new team name and I'll update it.

Good luck! 🏀`;

  return sendDM(userId, message);
}

/**
 * Send pick update confirmation DM
 */
export async function sendPickUpdateConfirmation(
  userId: string,
  oldTeam: string,
  newTeam: string,
  round: string
): Promise<boolean> {
  const message = `🔄 **Pick updated!**

**Round:** ${round}
**Old pick:** ${oldTeam}
**New pick:** ${newTeam}

Your pick has been updated. You can change it again before the deadline if needed.

Good luck! 🏀`;

  return sendDM(userId, message);
}

/**
 * Send error message via DM
 */
export async function sendErrorDM(userId: string, errorMessage: string): Promise<boolean> {
  const message = `❌ **Oops!**

${errorMessage}

Need help? Contact the pool admin.`;

  return sendDM(userId, message);
}

/**
 * Send deadline reminder DM
 */
export async function sendDeadlineReminderDM(
  userId: string,
  round: string,
  deadline: Date
): Promise<boolean> {
  const deadlineStr = deadline.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const message = `⏰ **Deadline Reminder!**

**Round:** ${round}
**Deadline:** ${deadlineStr}

You haven't submitted your pick yet! Send me a team name before the deadline or you'll be automatically eliminated.

Don't wait until the last minute! 🏀`;

  return sendDM(userId, message);
}
