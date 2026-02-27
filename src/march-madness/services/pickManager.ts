import * as participantModel from '../models/participant';
import * as pickModel from '../models/pick';
import * as poolModel from '../models/pool';
import * as teamModel from '../models/tournamentTeam';
import { sendPickConfirmation, sendPickUpdateConfirmation } from './slackMessaging';
import { matchTeamName } from './teamMatcher';
import { hasRoundStarted } from './ncaaService';

export interface PickSubmissionResult {
  success: boolean;
  message: string;
  pick?: any;
  error?: string;
}

/**
 * Submit or update a pick for a participant
 */
export async function submitPick(
  slackUserId: string,
  teamName: string
): Promise<PickSubmissionResult> {
  try {
    // Get current pool
    const pool = await poolModel.getCurrentPool();

    if (!pool) {
      return {
        success: false,
        message: 'No active pool found',
        error: 'NO_POOL',
      };
    }

    // Check if pool is accepting picks
    if (pool.status !== 'active') {
      return {
        success: false,
        message: `The pool is currently ${pool.status}. Picks can only be submitted when the pool is active.`,
        error: 'POOL_NOT_ACTIVE',
      };
    }

    // Get participant
    const participant = await participantModel.getParticipantBySlackId(pool.id, slackUserId);

    if (!participant) {
      return {
        success: false,
        message: 'You are not registered for this pool. Please contact the admin.',
        error: 'NOT_REGISTERED',
      };
    }

    // Check if participant is still active
    if (participant.status !== 'active') {
      const statusMessages: Record<string, string> = {
        eliminated: 'You have been eliminated from the pool.',
        withdrawn: 'You have withdrawn from the pool.',
      };

      return {
        success: false,
        message: statusMessages[participant.status] || 'You cannot submit picks at this time.',
        error: 'PARTICIPANT_INACTIVE',
      };
    }

    // Check if participant has paid
    if (!participant.paid) {
      return {
        success: false,
        message: 'You must pay the entry fee before submitting picks. Please contact the pool admin to complete payment.',
        error: 'PAYMENT_REQUIRED',
      };
    }

    // Get current round
    const currentRound = pool.current_round;

    if (!currentRound) {
      return {
        success: false,
        message: 'No round is currently active. Please wait for the tournament to start.',
        error: 'NO_CURRENT_ROUND',
      };
    }

    // Check if picks are locked (fast path)
    if (pool.current_round_locked) {
      return {
        success: false,
        message: `The ${currentRound} has started and picks are locked. You can no longer submit or modify picks for this round.`,
        error: 'ROUND_LOCKED',
      };
    }

    // If not locked, verify with ESPN (on-demand check)
    // This prevents the first person after games start from slipping through
    const roundStarted = await hasRoundStarted(currentRound);
    if (roundStarted) {
      // Lock the round immediately
      await poolModel.updatePool(pool.id, { current_round_locked: true });
      console.log(`[pickManager] Round ${currentRound} started - locked pool on-demand`);

      return {
        success: false,
        message: `The ${currentRound} has started and picks are now locked. You can no longer submit or modify picks for this round.`,
        error: 'ROUND_LOCKED',
      };
    }

    // Validate team against tournament_teams table
    const activeTeams = await teamModel.getActiveTeams(pool.id);

    if (activeTeams.length === 0) {
      return {
        success: false,
        message: 'Tournament teams haven\'t been loaded yet. Contact the admin.',
        error: 'NO_TEAMS_LOADED',
      };
    }

    // Match team name (exact first, then Claude fuzzy)
    const canonicalTeamName = await matchTeamName(teamName, activeTeams);

    if (!canonicalTeamName) {
      return {
        success: false,
        message: `I don't recognize "${teamName}" as a tournament team. Reply with "teams" to see all active teams.`,
        error: 'TEAM_NOT_FOUND',
      };
    }

    // Check if team has already been used by this participant
    const hasUsedTeam = await pickModel.hasParticipantUsedTeam(participant.id, canonicalTeamName);

    if (hasUsedTeam) {
      return {
        success: false,
        message: `You've already used ${canonicalTeamName} in a previous round. You cannot reuse teams!`,
        error: 'TEAM_ALREADY_USED',
      };
    }

    // TODO: Add deadline check (Phase 3 enhancement)
    // For now, we'll allow picks anytime

    // Check if participant already has a pick for current round
    const existingPick = await pickModel.getPickByParticipantAndRound(participant.id, currentRound);

    const isUpdate = !!existingPick;
    const oldTeam = existingPick?.team_name;

    // Use createOrUpdatePick (upsert) - it handles both create and update
    const pick = await pickModel.createOrUpdatePick({
      participant_id: participant.id,
      pool_id: pool.id,
      round: currentRound,
      team_name: canonicalTeamName,
    });

    // Send appropriate confirmation
    if (isUpdate && oldTeam) {
      await sendPickUpdateConfirmation(slackUserId, oldTeam, canonicalTeamName, currentRound);
    } else {
      await sendPickConfirmation(slackUserId, canonicalTeamName, currentRound);
    }

    return {
      success: true,
      message: isUpdate
        ? `Pick updated to ${canonicalTeamName} for ${currentRound}!`
        : `Pick submitted: ${canonicalTeamName} for ${currentRound}!`,
      pick,
    };
  } catch (error) {
    console.error('Error submitting pick:', error);
    return {
      success: false,
      message: 'An error occurred while submitting your pick. Please try again.',
      error: 'INTERNAL_ERROR',
    };
  }
}

/**
 * Get all teams used by a participant (to prevent reuse)
 */
export async function getUsedTeams(participantId: string): Promise<string[]> {
  const picks = await pickModel.getPicksByParticipant(participantId);
  return picks.map((pick) => pick.team_name);
}

/**
 * Get participant's current pick for active round
 */
export async function getCurrentPick(slackUserId: string): Promise<{
  pick: any | null;
  round: string | null;
}> {
  try {
    const pool = await poolModel.getCurrentPool();

    if (!pool || !pool.current_round) {
      return { pick: null, round: null };
    }

    const participant = await participantModel.getParticipantBySlackId(pool.id, slackUserId);

    if (!participant) {
      return { pick: null, round: null };
    }

    const pick = await pickModel.getPickByParticipantAndRound(participant.id, pool.current_round);

    return {
      pick,
      round: pool.current_round,
    };
  } catch (error) {
    console.error('Error getting current pick:', error);
    return { pick: null, round: null };
  }
}
