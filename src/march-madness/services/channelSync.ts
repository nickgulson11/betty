import { WebClient } from '@slack/web-api';
import * as participantModel from '../models/participant';
import { getUserInfo } from './slackMessaging';

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export interface SyncResult {
  totalMembers: number;
  newParticipants: number;
  existingParticipants: number;
  errors: string[];
}

/**
 * Sync all members from a Slack channel to the pool as unpaid participants
 * Only adds new members, doesn't remove existing participants
 */
export async function syncChannelMembers(
  poolId: string,
  channelId: string
): Promise<SyncResult> {
  const result: SyncResult = {
    totalMembers: 0,
    newParticipants: 0,
    existingParticipants: 0,
    errors: [],
  };

  try {
    // Get all members from the Slack channel
    const response = await slackClient.conversations.members({
      channel: channelId,
    });

    if (!response.members) {
      throw new Error('No members found in channel');
    }

    result.totalMembers = response.members.length;

    // Get Betty's user ID to exclude
    const authResult = await slackClient.auth.test();
    const bettyUserId = authResult.user_id;

    // Process each member
    for (const userId of response.members) {
      try {
        // Skip Betty herself
        if (userId === bettyUserId) {
          continue;
        }

        // Check if participant already exists
        const existing = await participantModel.getParticipantBySlackId(poolId, userId);

        if (existing) {
          result.existingParticipants++;
          continue; // Skip, already in pool
        }

        // Get user info from Slack
        const userInfo = await getUserInfo(userId);

        // Add as unpaid participant (paid defaults to false in database)
        await participantModel.createParticipant({
          pool_id: poolId,
          slack_user_id: userId,
          slack_username: userInfo?.realName || userInfo?.name || 'Unknown',
        });

        result.newParticipants++;
        console.log(`✅ Added new participant: ${userId} (${userInfo?.name})`);
      } catch (error) {
        console.error(`Error adding participant ${userId}:`, error);
        result.errors.push(`Failed to add ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return result;
  } catch (error) {
    console.error('Error syncing channel members:', error);
    throw error;
  }
}
