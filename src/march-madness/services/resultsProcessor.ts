import Anthropic from '@anthropic-ai/sdk';
import { TournamentGame } from './ncaaService';
import { TournamentRound } from '../types/pool';
import { pool as dbPool } from '../../shared/models/database';
import * as poolModel from '../models/pool';
import * as teamModel from '../models/tournamentTeam';
import * as participantModel from '../models/participant';
import { matchTeamName } from './teamMatcher';
import { sendDM, sendMainChannelMessage } from './slackMessaging';
import { Participant } from '../types/participant';
import { getCompletedSeries } from './nbaPlayoffsService';
import { SeriesResult } from '../types/nbaPlayoffs';
import { NBA_PLAYOFFS_ELIMINATION_COUNTS, NBA_PLAYOFFS_NEXT_ROUND } from '../constants/nbaPlayoffs';

// ============================================================================
// Tournament round constants
// ============================================================================

// Number of teams eliminated when a round is fully complete.
// When DB elimination count for a round reaches this number, the round is done.
// March Madness rounds only - NBA Playoffs uses NBA_PLAYOFFS_ELIMINATION_COUNTS
const ROUND_ELIMINATION_COUNTS: Partial<Record<TournamentRound, number>> = {
  'Round of 64':   32,
  'Round of 32':   16,
  'Sweet Sixteen':  8,
  'Elite Eight':    4,
  'Final Four':     2,
  'Championship':   1,
};

// Maps each round to the next — null means the tournament is over
const NEXT_ROUND: Partial<Record<TournamentRound, TournamentRound | null>> = {
  'Round of 64':   'Round of 32',
  'Round of 32':   'Sweet Sixteen',
  'Sweet Sixteen': 'Elite Eight',
  'Elite Eight':   'Final Four',
  'Final Four':    'Championship',
  'Championship':  null,
};

// ============================================================================
// Types
// ============================================================================

export interface EliminationResult {
  teamName: string;
  round: TournamentRound;
  picksMarkedLost: number;
  participantsEliminated: string[]; // slack_user_ids
  alreadyEliminated: boolean;
  teamNotFound: boolean;
}

export interface ProcessorResult {
  gamesProcessed: number;
  teamsEliminated: string[];
  participantsEliminated: string[];
  picksMarkedWon: number;
  noPickSweepRounds: string[];
  endOfRoundSummariesSent: string[];
}

// ============================================================================
// Claude client (lazy init)
// ============================================================================

let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

// ============================================================================
// Betty personality message generators
// ============================================================================

/**
 * Generate a roast DM for an eliminated participant (team lost).
 */
async function generateEliminationDM(
  username: string,
  teamName: string,
  round: string,
  tournamentType: 'march_madness' | 'nba_playoffs' = 'march_madness'
): Promise<string> {
  const tournamentName = tournamentType === 'nba_playoffs' ? 'NBA Playoffs' : 'March Madness';
  const prompt = `You are Betty, a sassy, confident, no-filter ${tournamentName} pool bot for Slack.
Send a DM to a participant whose team just got eliminated.

Participant username: ${username}
Their team: ${teamName}
Round: ${round}

Your personality:
- Sassy, fun, playful trash talk — not mean-spirited
- Uses slang: "youngblood", "honey", "chief", "fam", "playa", "guurl"
- Basketball slang: "taking an L", "got bounced", "packed up their bags", "sent packing", "eliminated", "done", "finished"
- VARY your word choice — don't repeat the same slang every time
- Keep it SHORT — 2-4 sentences max
- End with a sympathetic but funny sign-off

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings. It's all about bragging rights.

Generate ONLY the DM message, no other text.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude DM generation failed:', error);
  }

  // Fallback
  return `😬 Rough one, ${username}. ${teamName} got bounced in the ${round} — pack your bags, you're out of the pool. Better luck next year, youngblood 💀`;
}

/**
 * Generate a roast DM for a participant eliminated for not picking.
 */
async function generateNoPickDM(
  username: string,
  round: string,
  tournamentType: 'march_madness' | 'nba_playoffs' = 'march_madness'
): Promise<string> {
  const tournamentName = tournamentType === 'nba_playoffs' ? 'NBA Playoffs' : 'March Madness';
  const prompt = `You are Betty, a sassy, confident, no-filter ${tournamentName} pool bot for Slack.
Send a DM to a participant who forgot to submit a pick before the round started and is now eliminated.

Participant username: ${username}
Round: ${round}

Your personality:
- Savage but fun — they had ONE job
- Uses slang: "youngblood", "honey", "chief", "fam", "playa"
- Keep it SHORT — 2-4 sentences max
- Mock them for forgetting but keep it playful

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings.

Generate ONLY the DM message, no other text.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude no-pick DM generation failed:', error);
  }

  return `⏰ You had ONE job, ${username}. No pick submitted for the ${round} — you're automatically eliminated. This is why we can't have nice things 💀`;
}

/**
 * Generate a congrats DM for a participant whose team just won.
 */
async function generateWinDM(
  username: string,
  teamName: string,
  round: string,
  tournamentType: 'march_madness' | 'nba_playoffs' = 'march_madness'
): Promise<string> {
  const tournamentName = tournamentType === 'nba_playoffs' ? 'NBA Playoffs' : 'March Madness';
  const prompt = `You are Betty, a sassy, confident, no-filter ${tournamentName} pool bot for Slack.
Send a DM to a participant whose team just won their game and they're moving on.

Participant username: ${username}
Their team: ${teamName}
Round: ${round}

Your personality:
- Hype them up but keep it playful — a little smug, like you knew they'd make it
- Uses slang: "youngblood", "honey", "chief", "fam", "playa"
- Basketball slang: "locked in", "moving on", "staying alive", "still breathing"
- Keep it SHORT — 2-3 sentences max
- Pump them up for the next round without giving them too much credit

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings.

Generate ONLY the DM message, no other text.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude win DM generation failed:', error);
  }

  // Fallback
  return `🎉 ${teamName} stays alive, ${username}! Nice pick — you're moving on. Don't get too comfortable yet, youngblood 🏀`;
}

/**
 * Generate mid-round channel announcement when a team is eliminated.
 */
async function generateMidRoundChannelMessage(
  teamName: string,
  round: string,
  eliminatedUserIds: string[],
  tournamentType: 'march_madness' | 'nba_playoffs' = 'march_madness'
): Promise<string> {
  const participantsList =
    eliminatedUserIds.length > 0
      ? eliminatedUserIds.map((id) => `<@${id}>`).join(', ')
      : null;

  const tournamentName = tournamentType === 'nba_playoffs' ? 'NBA Playoffs' : 'March Madness';
  const prompt = `You are Betty, a sassy, confident, no-filter ${tournamentName} pool bot for Slack.
Post a channel message announcing that a team just lost and some participants are now eliminated.

Team eliminated: ${teamName}
Round: ${round}
Eliminated participants: ${participantsList || 'none'}

Your personality:
- Sassy and fun, roast the eliminated participants
- If no participants were eliminated, still announce the team loss dramatically
- Uses slang: "youngblood", "honey", "chief", "fam", "playa", "guurl", "my guy", "homie", "boss"
- Basketball slang: "bounced", "packed up", "L szn", "toast", "washed", "done for", "got smoked", "caught the bus", "see ya", "sent packing", "eliminated", "out", "finished"
- VARY YOUR WORD CHOICE: Don't repeat the same slang terms in every message — mix it up!
- Keep it punchy — 3-5 sentences max
- VARY YOUR OPENING: Don't always start the same way. Mix it up with different reactions, commentary, or dramatic announcements
- The participant mentions are already formatted as <@USER_ID> - use them as-is, don't modify them

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings.

Generate ONLY the channel message, no other text. Make it UNIQUE and DIFFERENT from previous messages.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude channel message generation failed:', error);
  }

  const names = participantsList ? ` ${participantsList} — you're out!` : '';
  return `🏀 ${teamName} just got BOUNCED in the ${round}!${names} 💀`;
}

/**
 * Generate no-pick sweep channel announcement.
 */
async function generateNoPickChannelMessage(
  round: string,
  eliminatedUserIds: string[],
  tournamentType: 'march_madness' | 'nba_playoffs' = 'march_madness'
): Promise<string> {
  const participantsList = eliminatedUserIds.map((id) => `<@${id}>`).join(', ');

  const tournamentName = tournamentType === 'nba_playoffs' ? 'NBA Playoffs' : 'March Madness';
  const prompt = `You are Betty, a sassy ${tournamentName} pool bot for Slack.
The ${round} has started and some participants forgot to submit picks. They are now eliminated.

Eliminated for no pick: ${participantsList}

Roast them publicly for forgetting. Keep it fun, 2-4 sentences.
The participant mentions are already formatted as <@USER_ID> - use them as-is in your message.

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings.

Generate ONLY the message.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude no-pick channel message failed:', error);
  }

  return `⏰ The ${round} has started and ${participantsList} never submitted picks. They're OUT. Should've set a reminder, chief 💀`;
}

/**
 * Generate end-of-round summary channel message.
 */
async function generateEndOfRoundMessage(
  round: string,
  eliminatedCount: number,
  survivorCount: number,
  tournamentType: 'march_madness' | 'nba_playoffs' = 'march_madness'
): Promise<string> {
  const tournamentName = tournamentType === 'nba_playoffs' ? 'NBA Playoffs' : 'March Madness';
  const prompt = `You are Betty, a sassy ${tournamentName} pool bot for Slack.
The ${round} is complete. Post a round summary.

Participants eliminated this round: ${eliminatedCount}
Participants still alive: ${survivorCount}

Important: Refer to players as "participants" NOT "teams". The survivor count is accurate - use that exact number.

Keep it concise and dramatic. 2-4 sentences. Betty style.

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings.

Generate ONLY the message.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude end-of-round message failed:', error);
  }

  return `📊 ${round} is a wrap! ${eliminatedCount} participant(s) eliminated, ${survivorCount} participant(s) still standing. Who's next? 👀`;
}

/**
 * Generate tournament winner announcement message.
 */
async function generateWinnerMessage(
  winners: Array<{ slack_user_id: string; slack_username: string | null; seed_sum: number }>,
  tournamentType: 'march_madness' | 'nba_playoffs' = 'march_madness',
  previousRound?: string
): Promise<string> {
  const winnerMentions = winners.map(w => `<@${w.slack_user_id}>`).join(', ');
  const winnerNames = winners.map(w => w.slack_username || w.slack_user_id).join(', ');
  const isTiebreaker = winners.length === 1 && winners[0].seed_sum > 0;
  const seedSumInfo = winners.length === 1 ? `Seed Sum: ${winners[0].seed_sum}` : '';
  const previousRoundInfo = previousRound ? ` (all participants were eliminated in the ${previousRound}, so we went to tiebreaker)` : '';

  const tournamentName = tournamentType === 'nba_playoffs' ? 'NBA Playoffs' : 'March Madness';
  const prompt = `You are Betty, a sassy ${tournamentName} pool bot for Slack.
The tournament is OVER and we have ${winners.length === 1 ? 'a WINNER' : 'winners (tied)'}!

Winner(s): ${winnerNames}
${seedSumInfo}
${previousRoundInfo}

Your personality:
- HUGE energy — this is the BIG moment
- Congratulate the winner(s) dramatically
- ${isTiebreaker ? 'Mention they won on the tiebreaker (highest seed sum)' : ''}
- The winner mentions are already formatted as <@USER_ID> - use them as-is: ${winnerMentions}
- Keep it to 3-5 sentences
- End with a Betty sign-off

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings. Focus on bragging rights and glory.

Generate ONLY the winner announcement message.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude winner message generation failed:', error);
  }

  const poolName = tournamentType === 'nba_playoffs' ? 'NBA Playoffs pool' : 'March Madness pool';
  return `🏆 WE HAVE A WINNER! ${winnerMentions} just won the ${poolName}! Congrats, champ. Betty out. 🎉`;
}

// ============================================================================
// DB helpers
// ============================================================================

/**
 * Get active participants with no pick for a given round.
 */
async function getActiveParticipantsWithNoPick(
  poolId: string,
  round: TournamentRound
): Promise<Participant[]> {
  const result = await dbPool.query(
    `SELECT p.* FROM participants p
     WHERE p.pool_id = $1
       AND p.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM picks pk
         WHERE pk.participant_id = p.id
           AND pk.round = $2
       )`,
    [poolId, round]
  );
  return result.rows;
}

/**
 * Get pending picks for a given team in a given round (across all participants in a pool).
 */
async function getPendingPicksForTeam(
  poolId: string,
  teamName: string,
  round: TournamentRound
): Promise<Array<{ pick_id: string; participant_id: string }>> {
  const result = await dbPool.query(
    `SELECT pk.id AS pick_id, pk.participant_id
     FROM picks pk
     WHERE pk.pool_id = $1
       AND LOWER(pk.team_name) = LOWER($2)
       AND pk.round = $3
       AND (pk.result = 'pending' OR pk.result IS NULL)`,
    [poolId, teamName, round]
  );
  return result.rows;
}

/**
 * Mark a pick as lost.
 */
async function markPickLost(pickId: string): Promise<void> {
  await dbPool.query(
    `UPDATE picks SET result = 'lost', updated_at = NOW() WHERE id = $1`,
    [pickId]
  );
}

/**
 * Mark a pick as won.
 */
async function markPickWon(pickId: string): Promise<void> {
  await dbPool.query(
    `UPDATE picks SET result = 'won', updated_at = NOW() WHERE id = $1`,
    [pickId]
  );
}

/**
 * Check if any teams are already eliminated for a given round.
 */
async function hasEliminationsForRound(poolId: string, round: TournamentRound): Promise<boolean> {
  const result = await dbPool.query(
    `SELECT 1 FROM tournament_teams
     WHERE pool_id = $1 AND eliminated_round = $2 AND status = 'eliminated'
     LIMIT 1`,
    [poolId, round]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Count how many teams have been eliminated in a given round.
 * When this equals ROUND_ELIMINATION_COUNTS[round], the round is complete.
 */
async function getEliminationCountForRound(poolId: string, round: TournamentRound): Promise<number> {
  const result = await dbPool.query(
    `SELECT COUNT(*) FROM tournament_teams
     WHERE pool_id = $1 AND eliminated_round = $2 AND status = 'eliminated'`,
    [poolId, round]
  );
  return parseInt(result.rows[0].count, 10);
}

// ============================================================================
// Core pipeline functions
// ============================================================================

/**
 * Eliminate a single team by canonical name and process all downstream effects.
 * Called by both the admin Eliminate button and the scheduler.
 */
export async function eliminateTeam(
  teamName: string,
  round: TournamentRound
): Promise<EliminationResult> {
  const currentPool = await poolModel.getCurrentPool();
  if (!currentPool) {
    console.warn('[resultsProcessor] eliminateTeam: no active pool found');
    return {
      teamName,
      round,
      picksMarkedLost: 0,
      participantsEliminated: [],
      alreadyEliminated: false,
      teamNotFound: true,
    };
  }

  const poolId = currentPool.id;

  // Find team in DB (exact case-insensitive)
  const team = await teamModel.getTeamByName(poolId, teamName);
  if (!team) {
    console.warn(`[resultsProcessor] Team not found in DB: "${teamName}"`);
    return {
      teamName,
      round,
      picksMarkedLost: 0,
      participantsEliminated: [],
      alreadyEliminated: false,
      teamNotFound: true,
    };
  }

  // Idempotency check — already eliminated
  if (team.status === 'eliminated') {
    console.log(`[resultsProcessor] Team "${team.team_name}" already eliminated — skipping`);
    return {
      teamName: team.team_name,
      round,
      picksMarkedLost: 0,
      participantsEliminated: [],
      alreadyEliminated: true,
      teamNotFound: false,
    };
  }

  // Mark team eliminated
  await teamModel.markTeamEliminated(team.id, round);
  console.log(`[resultsProcessor] Marked "${team.team_name}" eliminated in ${round}`);

  // Find pending picks for this team in this round
  const picks = await getPendingPicksForTeam(poolId, team.team_name, round);

  const eliminatedUserIds: string[] = [];
  const eliminatedUsernames: string[] = [];

  for (const pick of picks) {
    // Mark pick lost
    await markPickLost(pick.pick_id);

    // Get participant
    const participant = await participantModel.getParticipantById(pick.participant_id);
    if (!participant || participant.status === 'eliminated') continue;

    // Mark participant eliminated
    await participantModel.updateParticipant(participant.id, {
      status: 'eliminated',
      eliminated_round: round,
      eliminated_team: team.team_name,
    });

    eliminatedUserIds.push(participant.slack_user_id);
    eliminatedUsernames.push(participant.slack_username || participant.slack_user_id);

    // Send individual roast DM
    const dmText = await generateEliminationDM(
      participant.slack_username || 'friend',
      team.team_name,
      round,
      currentPool.tournament_type
    );
    await sendDM(participant.slack_user_id, dmText);
  }

  // Send mid-round channel announcement only if someone was actually eliminated
  if (eliminatedUserIds.length > 0) {
    const channelMsg = await generateMidRoundChannelMessage(
      team.team_name,
      round,
      eliminatedUserIds,
      currentPool.tournament_type
    );
    await sendMainChannelMessage(channelMsg);
  }

  return {
    teamName: team.team_name,
    round,
    picksMarkedLost: picks.length,
    participantsEliminated: eliminatedUserIds,
    alreadyEliminated: false,
    teamNotFound: false,
  };
}

/**
 * Calculate and update seed_sum for participants whose picks WON in this round.
 * Called at END of round when advancing to next round — ONLY counts winning picks.
 * This is the tiebreaker: higher seed sum = picked higher seeds = harder path.
 */
async function updateSeedSumsForWinningPicks(poolId: string, round: TournamentRound): Promise<void> {
  console.log(`[resultsProcessor] Updating seed_sum for WINNING picks in ${round}...`);

  // Get all WINNING picks for this round (result = 'won')
  const picksResult = await dbPool.query(
    `SELECT pk.participant_id, pk.team_name, p.seed_sum
     FROM picks pk
     JOIN participants p ON p.id = pk.participant_id
     WHERE pk.pool_id = $1 AND pk.round = $2 AND pk.result = 'won'`,
    [poolId, round]
  );

  if (picksResult.rows.length === 0) {
    console.log(`[resultsProcessor] No winning picks found for ${round} — skipping seed_sum update`);
    return;
  }

  for (const row of picksResult.rows) {
    const { participant_id, team_name, seed_sum } = row;

    // Look up the team's seed
    const teamResult = await dbPool.query(
      `SELECT seed FROM tournament_teams
       WHERE pool_id = $1 AND LOWER(team_name) = LOWER($2)
       LIMIT 1`,
      [poolId, team_name]
    );

    if (teamResult.rows.length === 0 || teamResult.rows[0].seed == null) {
      console.warn(`[resultsProcessor] No seed found for team "${team_name}" — skipping seed_sum update for this pick`);
      continue;
    }

    const teamSeed = parseInt(teamResult.rows[0].seed, 10);
    const newSeedSum = (seed_sum || 0) + teamSeed;

    // Update participant's seed_sum
    await participantModel.updateParticipant(participant_id, { seed_sum: newSeedSum });
    console.log(`[resultsProcessor] Updated participant ${participant_id}: seed_sum ${seed_sum} + ${teamSeed} = ${newSeedSum} (won with ${team_name})`);
  }

  console.log(`[resultsProcessor] seed_sum updated for ${picksResult.rows.length} winning participant(s) in ${round}`);
}

/**
 * Determine the winner(s) from a list of participants using seed_sum tiebreaker.
 * Returns the participant(s) with the highest seed_sum.
 * If multiple participants have the same highest seed_sum, all are returned (tie).
 */
function determineWinner(
  participants: Array<{ id: string; slack_user_id: string; slack_username: string | null; seed_sum: number }>
): Array<{ slack_user_id: string; slack_username: string | null; seed_sum: number }> {
  if (participants.length === 0) {
    return [];
  }

  if (participants.length === 1) {
    return participants.map(p => ({
      slack_user_id: p.slack_user_id,
      slack_username: p.slack_username,
      seed_sum: p.seed_sum || 0,
    }));
  }

  // Find highest seed_sum
  const maxSeedSum = Math.max(...participants.map(p => p.seed_sum || 0));

  // Return all participants with that seed_sum (handles ties)
  return participants
    .filter(p => (p.seed_sum || 0) === maxSeedSum)
    .map(p => ({
      slack_user_id: p.slack_user_id,
      slack_username: p.slack_username,
      seed_sum: p.seed_sum || 0,
    }));
}

/**
 * Check if tournament should end and declare winner(s).
 * Tournament ends when:
 * 1. 0 or 1 participants remain active after any round, OR
 * 2. Championship completes with multiple participants
 *
 * Winner determination:
 * - 1 active participant = they win
 * - Multiple active participants = highest seed_sum wins (can tie)
 * - 0 active participants = look at last round's eliminated, highest seed_sum wins
 *
 * Returns true if tournament ended, false otherwise.
 */
async function checkForTournamentEnd(
  poolId: string,
  currentRound: TournamentRound,
  allParticipants: Participant[]
): Promise<boolean> {
  const pool = await poolModel.getPool(poolId);
  if (!pool) return false;

  const activeSurvivors = allParticipants.filter(p => p.status === 'active');
  const isChampionshipComplete = currentRound === 'Championship';

  // Tournament ends if:
  // - 0 or 1 survivors after any round, OR
  // - Championship complete with multiple survivors (tiebreaker by seed_sum)
  const shouldEnd = activeSurvivors.length <= 1 || (isChampionshipComplete && activeSurvivors.length > 1);

  if (!shouldEnd) {
    return false;
  }

  console.log(`[resultsProcessor] Tournament ending condition met: ${activeSurvivors.length} survivor(s) after ${currentRound}`);

  let winners: Array<{ slack_user_id: string; slack_username: string | null; seed_sum: number }> = [];
  let previousRound: string | undefined;

  if (activeSurvivors.length === 1) {
    // Single survivor = automatic winner
    const survivor = activeSurvivors[0];
    winners = [{
      slack_user_id: survivor.slack_user_id,
      slack_username: survivor.slack_username,
      seed_sum: survivor.seed_sum || 0,
    }];
    console.log(`[resultsProcessor] Single survivor: ${survivor.slack_username} (seed_sum: ${survivor.seed_sum})`);
  } else if (activeSurvivors.length > 1) {
    // Multiple survivors = tiebreaker by seed_sum
    winners = determineWinner(activeSurvivors);
    console.log(`[resultsProcessor] Multiple survivors, tiebreaker by seed_sum: ${winners.map(w => w.slack_username).join(', ')} (seed_sum: ${winners[0].seed_sum})`);
  } else {
    // 0 survivors = look at previous round's eliminated, tiebreaker by seed_sum
    const lastRoundEliminated = allParticipants.filter(p => p.eliminated_round === currentRound);
    if (lastRoundEliminated.length > 0) {
      winners = determineWinner(lastRoundEliminated);
      previousRound = currentRound;
      console.log(`[resultsProcessor] 0 survivors, winner from ${currentRound} eliminated: ${winners.map(w => w.slack_username).join(', ')} (seed_sum: ${winners[0].seed_sum})`);
    } else {
      console.error(`[resultsProcessor] 0 survivors and no one eliminated in ${currentRound} — cannot determine winner`);
      await sendMainChannelMessage(`🤔 Uh... everyone's eliminated and I can't figure out who won. Someone check the database. Betty confused. 💀`);
      return true;
    }
  }

  // Send winner announcement
  const winnerMsg = await generateWinnerMessage(winners, pool.tournament_type, previousRound);
  await sendMainChannelMessage(winnerMsg);

  // Mark pool completed
  await poolModel.updatePool(poolId, { status: 'completed' });
  console.log(`[resultsProcessor] Tournament complete — pool marked completed`);

  return true;
}

/**
 * Run the no-pick sweep for a round.
 * Called when the first game of a round begins (IN_PROGRESS or FINAL) and
 * no eliminations exist yet for that round.
 */
async function runNoPickSweep(poolId: string, round: TournamentRound): Promise<string[]> {
  // Lock the round immediately when games start
  const currentPool = await poolModel.getCurrentPool();
  if (currentPool && !currentPool.current_round_locked) {
    await poolModel.updatePool(poolId, { current_round_locked: true });
    console.log(`[resultsProcessor] Round ${round} locked - games have started`);
  }

  const noPickers = await getActiveParticipantsWithNoPick(poolId, round);
  if (noPickers.length === 0) {
    console.log(`[resultsProcessor] No-pick sweep for ${round}: no participants to eliminate`);
    return [];
  }

  console.log(`[resultsProcessor] No-pick sweep for ${round}: eliminating ${noPickers.length} participant(s)`);

  const eliminatedUserIds: string[] = [];
  const eliminatedUsernames: string[] = [];

  for (const participant of noPickers) {
    await participantModel.updateParticipant(participant.id, {
      status: 'eliminated',
      eliminated_round: round,
    });
    eliminatedUserIds.push(participant.slack_user_id);
    eliminatedUsernames.push(participant.slack_username || participant.slack_user_id);

    // Individual roast DM
    const dmText = await generateNoPickDM(participant.slack_username || 'friend', round, currentPool?.tournament_type);
    await sendDM(participant.slack_user_id, dmText);
  }

  // Channel announcement for no-pick sweep
  if (eliminatedUserIds.length > 0) {
    const channelMsg = await generateNoPickChannelMessage(round, eliminatedUserIds, currentPool?.tournament_type);
    await sendMainChannelMessage(channelMsg);
  }

  return eliminatedUserIds;
}

/**
 * Mark winning picks as won and send congrats DMs to participants.
 * Called for each game winner after the loser has been eliminated.
 * Returns the number of picks marked as won.
 */
async function celebrateWinner(
  poolId: string,
  canonicalName: string,
  round: TournamentRound
): Promise<number> {
  const pool = await poolModel.getPool(poolId);
  const picks = await getPendingPicksForTeam(poolId, canonicalName, round);
  if (picks.length === 0) return 0;

  console.log(`[resultsProcessor] Marking ${picks.length} pick(s) won for "${canonicalName}" in ${round}`);

  for (const pick of picks) {
    await markPickWon(pick.pick_id);

    const participant = await participantModel.getParticipantById(pick.participant_id);
    if (!participant || participant.status !== 'active') continue;

    const dmText = await generateWinDM(
      participant.slack_username || 'friend',
      canonicalName,
      round,
      pool?.tournament_type
    );
    await sendDM(participant.slack_user_id, dmText);
  }

  return picks.length;
}

/**
 * Process a batch of today's tournament games from ESPN.
 * Handles round-start sweeps, per-game eliminations, and end-of-round summaries.
 */
export async function processGames(games: TournamentGame[]): Promise<ProcessorResult> {
  const result: ProcessorResult = {
    gamesProcessed: 0,
    teamsEliminated: [],
    participantsEliminated: [],
    picksMarkedWon: 0,
    noPickSweepRounds: [],
    endOfRoundSummariesSent: [],
  };

  if (games.length === 0) {
    console.log('[resultsProcessor] No tournament games to process');
    return result;
  }

  const currentPool = await poolModel.getCurrentPool();
  if (!currentPool) {
    console.warn('[resultsProcessor] processGames: no active pool found');
    return result;
  }

  // Skip processing if tournament is already completed
  if (currentPool.status === 'completed') {
    console.log('[resultsProcessor] Tournament is completed — skipping game processing');
    return result;
  }

  const poolId = currentPool.id;

  // Collect all rounds present in today's games
  const roundsWithActivity = new Set<TournamentRound>();
  for (const game of games) {
    if (game.round && (game.status === 'in_progress' || game.status === 'final')) {
      roundsWithActivity.add(game.round);
    }
  }

  // Round-start sweep: for each round with activity, check if this is the first result
  for (const round of roundsWithActivity) {
    const alreadyStarted = await hasEliminationsForRound(poolId, round);
    if (!alreadyStarted) {
      console.log(`[resultsProcessor] First activity for ${round} — running no-pick sweep`);
      const swept = await runNoPickSweep(poolId, round);
      if (swept.length > 0) {
        result.noPickSweepRounds.push(round);
        result.participantsEliminated.push(...swept);
      }
    }
  }

  // Process completed games
  const allTeams = await teamModel.getTeamsByPool(poolId);

  for (const game of games) {
    if (game.status !== 'final') continue;
    if (!game.loser || !game.round) {
      console.log(`[resultsProcessor] Skipping game ${game.id} — missing loser or round`);
      continue;
    }

    result.gamesProcessed++;

    // STEP 1: Match ESPN loser name against ALL teams (active + eliminated)
    // This prevents fuzzy matcher from incorrectly matching "Tennessee" when looking for "Tennessee State"
    const loserCanonical = await matchTeamName(game.loser, allTeams);
    if (!loserCanonical) {
      console.warn(`[resultsProcessor] Could not match ESPN loser "${game.loser}" to any DB team — skipping`);
      continue;
    }

    // STEP 2: Check if losing team is already eliminated (idempotency check)
    const loserTeam = allTeams.find(t => t.team_name.toLowerCase() === loserCanonical.toLowerCase());
    if (loserTeam && loserTeam.status === 'eliminated') {
      console.log(`[resultsProcessor] ⏭️  ${loserCanonical} already eliminated (${loserTeam.eliminated_round}) — skipping game ${game.id}`);
      continue; // Game already processed, skip to next
    }

    // STEP 3: Team is active, proceed with elimination
    const elimination = await eliminateTeam(loserCanonical, game.round);

    if (!elimination.alreadyEliminated && !elimination.teamNotFound) {
      result.teamsEliminated.push(loserCanonical);
      result.participantsEliminated.push(...elimination.participantsEliminated);
    }

    // Fuzzy-match ESPN winner name and mark those picks as won
    if (game.winner) {
      const winnerCanonical = await matchTeamName(game.winner, allTeams);
      if (winnerCanonical) {
        // Only celebrate if winner is still active (sanity check)
        const winnerTeam = allTeams.find(t => t.team_name.toLowerCase() === winnerCanonical.toLowerCase());
        if (winnerTeam && winnerTeam.status === 'active') {
          const wonCount = await celebrateWinner(poolId, winnerCanonical, game.round);
          result.picksMarkedWon += wonCount;
        } else {
          console.log(`[resultsProcessor] Winner "${winnerCanonical}" is not active — skipping celebration`);
        }
      } else {
        console.warn(`[resultsProcessor] Could not match ESPN winner "${game.winner}" to any DB team — skipping win celebration`);
      }
    }
  }

  // End-of-round check: if all games for a round are final, send summary
  const roundGameMap = new Map<TournamentRound, TournamentGame[]>();
  for (const game of games) {
    if (!game.round) continue;
    if (!roundGameMap.has(game.round)) roundGameMap.set(game.round, []);
    roundGameMap.get(game.round)!.push(game);
  }

  for (const [round, roundGames] of roundGameMap) {
    const allFinal = roundGames.every((g) => g.status === 'final');
    if (!allFinal) continue;

    // Only process end-of-round if this round is still the current round in the pool
    // (prevents re-processing rounds that have already been completed and advanced)
    if (round !== currentPool.current_round) {
      console.log(`[resultsProcessor] ${round} is complete but pool has already advanced to ${currentPool.current_round} — skipping end-of-round processing`);
      continue;
    }

    // Only send end-of-round summary when all expected eliminations for the round are recorded
    const eliminationCount = await getEliminationCountForRound(poolId, round);
    const expectedEliminations = ROUND_ELIMINATION_COUNTS[round];
    if (!expectedEliminations) {
      console.log(`[resultsProcessor] No expected elimination count for ${round} — skipping summary`);
      continue;
    }
    if (eliminationCount < expectedEliminations) {
      console.log(`[resultsProcessor] ${round}: ${eliminationCount}/${expectedEliminations} eliminations recorded — round not complete yet, skipping summary`);
      continue;
    }

    // Get current participant counts for summary
    const allParticipants = await participantModel.getParticipantsByPool(poolId);
    const survivors = allParticipants.filter((p) => p.status === 'active').length;
    const eliminatedThisRound = allParticipants.filter(
      (p) => p.status === 'eliminated' && p.eliminated_round === round
    ).length;

    const summaryMsg = await generateEndOfRoundMessage(round, eliminatedThisRound, survivors, currentPool.tournament_type);
    await sendMainChannelMessage(summaryMsg);
    result.endOfRoundSummariesSent.push(round);

    console.log(`[resultsProcessor] End-of-round summary sent for ${round}`);

    // Update seed_sum for all participants whose picks WON this round
    await updateSeedSumsForWinningPicks(poolId, round);

    // Check if tournament should end (0-1 survivors, or Championship complete with multiple)
    const tournamentEnded = await checkForTournamentEnd(poolId, round, allParticipants);

    if (tournamentEnded) {
      // Tournament over — winner announced and pool marked completed by checkForTournamentEnd()
      console.log(`[resultsProcessor] Tournament ended after ${round}`);
    } else {
      // Tournament continues — advance to next round
      const nextRound = NEXT_ROUND[round];
      if (nextRound === undefined) {
        console.warn(`[resultsProcessor] No next round mapping for ${round}`);
      } else if (nextRound === null) {
        // This shouldn't happen now that we check for tournament end
        console.warn(`[resultsProcessor] Reached null next round without tournament ending — this is unexpected`);
      } else {
        // Advance to next round and unlock picks
        await poolModel.updatePool(currentPool.id, { current_round: nextRound, current_round_locked: false });
        await sendMainChannelMessage(`🏀 Picks are now open for the *${nextRound}*! DM me your team to lock in your pick.`);
        console.log(`[resultsProcessor] Advanced pool to ${nextRound} and unlocked picks`);
      }
    }
  }

  console.log(`[resultsProcessor] Done. Games: ${result.gamesProcessed}, Teams eliminated: ${result.teamsEliminated.length}, Participants eliminated: ${result.participantsEliminated.length}, Picks marked won: ${result.picksMarkedWon}`);
  return result;
}

/**
 * Directly run the end-of-round pipeline for the pool's current round.
 * Bypasses the isTodayRoundEndDate() check — for local testing only.
 * Sends end-of-round summary, advances pool to next round (or marks completed).
 */
export async function simulateRoundEnd(): Promise<{ round: string; nextRound: string | null }> {
  const currentPool = await poolModel.getCurrentPool();
  if (!currentPool) {
    throw new Error('No active pool found');
  }

  const round = currentPool.current_round as TournamentRound;
  if (!round) {
    throw new Error('Pool has no current_round set');
  }

  console.log(`[resultsProcessor] simulateRoundEnd: running end-of-round for ${round}`);

  const poolId = currentPool.id;

  // Lock the round if not already locked
  if (!currentPool.current_round_locked) {
    await poolModel.updatePool(poolId, { current_round_locked: true });
    console.log(`[resultsProcessor] simulateRoundEnd: locked ${round}`);
  }

  // Eliminate any active participants who never submitted a pick for this round
  const swept = await runNoPickSweep(poolId, round);
  if (swept.length > 0) {
    console.log(`[resultsProcessor] simulateRoundEnd: no-pick sweep eliminated ${swept.length} participant(s)`);
  }

  const allParticipants = await participantModel.getParticipantsByPool(poolId);
  const survivors = allParticipants.filter((p) => p.status === 'active').length;
  const eliminatedThisRound = allParticipants.filter(
    (p) => p.status === 'eliminated' && p.eliminated_round === round
  ).length;

  const summaryMsg = await generateEndOfRoundMessage(round, eliminatedThisRound, survivors, currentPool.tournament_type);
  await sendMainChannelMessage(summaryMsg);
  console.log(`[resultsProcessor] simulateRoundEnd: summary sent for ${round}`);

  // Update seed_sum for all participants whose picks WON this round
  await updateSeedSumsForWinningPicks(poolId, round);

  // Refresh participants to get latest seed_sum values
  const allParticipantsRefreshed = await participantModel.getParticipantsByPool(poolId);

  // Check if tournament should end (0-1 survivors, or Championship complete with multiple)
  const tournamentEnded = await checkForTournamentEnd(poolId, round, allParticipantsRefreshed);

  if (tournamentEnded) {
    console.log(`[resultsProcessor] simulateRoundEnd: tournament ended after ${round}`);
    return { round, nextRound: null };
  }

  // Tournament continues — advance to next round
  const nextRound = NEXT_ROUND[round];
  if (nextRound === undefined) {
    console.warn(`[resultsProcessor] No next round mapping for ${round}`);
    return { round, nextRound: null };
  } else if (nextRound === null) {
    // This shouldn't happen now that we check for tournament end
    console.warn(`[resultsProcessor] simulateRoundEnd: reached null next round without tournament ending`);
    return { round, nextRound: null };
  } else {
    await poolModel.updatePool(currentPool.id, { current_round: nextRound, current_round_locked: false });
    await sendMainChannelMessage(`🏀 Picks are now open for the *${nextRound}*! DM me your team to lock in your pick.`);
    console.log(`[resultsProcessor] simulateRoundEnd: pool advanced to ${nextRound} and unlocked picks`);
    return { round, nextRound };
  }
}

// ============================================================================
// NBA Playoffs Processing
// ============================================================================

/**
 * Process NBA Playoffs series results and eliminate losing teams
 * Uses series completion (team loses 4 games) instead of individual games
 */
async function processNBAPlayoffsSeries(poolId: string): Promise<void> {
  console.log('[resultsProcessor] 🏀 Processing NBA Playoffs series results...');

  const pool = await poolModel.getPool(poolId);
  if (!pool) {
    console.error('[resultsProcessor] Pool not found');
    return;
  }

  if (!pool.current_round) {
    console.log('[resultsProcessor] No current round set');
    return;
  }

  // Fetch completed series (teams that lost 4 games)
  const completedSeries = await getCompletedSeries(poolId);

  if (completedSeries.length === 0) {
    console.log('[resultsProcessor] No completed series found');
    return;
  }

  console.log(`[resultsProcessor] Found ${completedSeries.length} completed series`);

  for (const series of completedSeries) {
    await processSeriesResult(poolId, series, pool.current_round);
  }
}

/**
 * Process a single series result (team lost the series)
 */
async function processSeriesResult(
  poolId: string,
  series: SeriesResult,
  currentRound: string
): Promise<void> {
  const { losingTeam, winningTeam, finalRecord } = series;

  console.log(`[resultsProcessor] Processing series: ${winningTeam} defeats ${losingTeam} (${finalRecord})`);

  // Check if team is already marked as eliminated
  const team = await teamModel.getTeamByName(poolId, losingTeam);
  if (!team) {
    console.log(`[resultsProcessor] Team not found: ${losingTeam}`);
    return;
  }

  if (team.status === 'eliminated') {
    console.log(`[resultsProcessor] Team already eliminated: ${losingTeam}`);
    return;
  }

  // Mark team as eliminated
  await teamModel.markTeamEliminated(team.id, currentRound as TournamentRound);
  console.log(`[resultsProcessor] ✅ Team eliminated: ${losingTeam} in ${currentRound}`);

  // Find all picks for this team in current round
  const picksQuery = await dbPool.query(
    `SELECT p.*, pa.slack_user_id, pa.slack_username, pa.status as participant_status
     FROM picks p
     JOIN participants pa ON p.participant_id = pa.id
     WHERE p.pool_id = $1 AND p.team_name = $2 AND p.round = $3`,
    [poolId, losingTeam, currentRound]
  );
  const picksForTeam = picksQuery.rows;

  console.log(`[resultsProcessor] Found ${picksForTeam.length} picks for losing team ${losingTeam} in ${currentRound}`);

  if (picksForTeam.length === 0) {
    console.log(`[resultsProcessor] No picks found for ${losingTeam} in ${currentRound}`);
    return;
  }

  const eliminatedUsernames: string[] = [];

  for (const pick of picksForTeam) {
    // Update pick result
    await dbPool.query(
      `UPDATE picks SET result = 'lost', updated_at = NOW() WHERE id = $1`,
      [pick.id]
    );

    // Eliminate participant if still active
    if (pick.participant_status === 'active') {
      await participantModel.updateParticipant(pick.participant_id, {
        status: 'eliminated',
        eliminated_round: currentRound as TournamentRound,
        eliminated_team: losingTeam,
      });
      eliminatedUsernames.push(pick.slack_username);

      // Send elimination DM
      await sendEliminationMessage(
        { slack_user_id: pick.slack_user_id, slack_username: pick.slack_username },
        losingTeam,
        winningTeam,
        finalRecord
      );

      console.log(`[resultsProcessor] ❌ Eliminated participant: ${pick.slack_username}`);
    }
  }

  // Send channel announcement if anyone was eliminated
  if (eliminatedUsernames.length > 0) {
    await sendChannelElimination(poolId, eliminatedUsernames, losingTeam, winningTeam, finalRecord);
  }

  // Also celebrate winners (people who picked the winning team)
  console.log(`[resultsProcessor] Celebrating winners for ${winningTeam} in ${currentRound}`);
  await celebrateSeriesWinner(poolId, winningTeam, finalRecord, currentRound);
}

/**
 * Celebrate participants who picked the winning team in a series
 */
async function celebrateSeriesWinner(
  poolId: string,
  winningTeam: string,
  finalRecord: string,
  currentRound: string
): Promise<void> {
  console.log(`[resultsProcessor] Looking for winning picks: poolId=${poolId}, team=${winningTeam}, round=${currentRound}`);

  const winningPicksQuery = await dbPool.query(
    `SELECT p.*, pa.slack_user_id, pa.slack_username, pa.status as participant_status
     FROM picks p
     JOIN participants pa ON p.participant_id = pa.id
     WHERE p.pool_id = $1 AND p.team_name = $2 AND p.round = $3`,
    [poolId, winningTeam, currentRound]
  );
  const winningPicks = winningPicksQuery.rows;

  console.log(`[resultsProcessor] Found ${winningPicks.length} picks for winning team ${winningTeam} in ${currentRound}`);

  for (const pick of winningPicks) {
    console.log(`[resultsProcessor] Marking pick ${pick.id} as won for ${pick.slack_username}`);

    // Update pick result
    await dbPool.query(
      `UPDATE picks SET result = 'won', updated_at = NOW() WHERE id = $1`,
      [pick.id]
    );

    // Send congrats DM only to active participants
    if (pick.participant_status === 'active') {
      const congratsMessage = await generateSeriesWinDM(
        pick.slack_username,
        winningTeam,
        finalRecord
      );
      await sendDM(pick.slack_user_id, congratsMessage);

      console.log(`[resultsProcessor] 🎉 Celebrated winner: ${pick.slack_username} (picked ${winningTeam})`);
    } else {
      console.log(`[resultsProcessor] Skipped DM for inactive participant: ${pick.slack_username}`);
    }
  }
}

/**
 * Send elimination DM for series loss
 */
async function sendEliminationMessage(
  participant: { slack_user_id: string; slack_username: string },
  losingTeam: string,
  winningTeam: string,
  finalRecord: string
): Promise<void> {
  const roastMessage = await generateSeriesLossDM(
    participant.slack_username,
    losingTeam,
    winningTeam,
    finalRecord
  );
  await sendDM(participant.slack_user_id, roastMessage);
}

/**
 * Send channel announcement for series eliminations - SAVAGE ROAST EDITION
 */
async function sendChannelElimination(
  poolId: string,
  eliminatedUsernames: string[],
  losingTeam: string,
  winningTeam: string,
  finalRecord: string
): Promise<void> {
  const pool = await poolModel.getPool(poolId);
  if (!pool) return;

  // Get slack user IDs for mentions (need to look them up from usernames)
  const eliminatedUserIds: string[] = [];
  for (const username of eliminatedUsernames) {
    const participant = await participantModel.getParticipantByUsername(poolId, username);
    if (participant) {
      eliminatedUserIds.push(participant.slack_user_id);
    }
  }

  // Generate savage roast message
  const roastMessage = await generateNBASeriesChannelRoast(
    losingTeam,
    winningTeam,
    finalRecord,
    eliminatedUserIds,
    pool.current_round || 'NBA Playoffs'
  );

  await sendMainChannelMessage(roastMessage);
}

/**
 * Generate savage channel roast for NBA series elimination
 */
async function generateNBASeriesChannelRoast(
  losingTeam: string,
  winningTeam: string,
  finalRecord: string,
  eliminatedUserIds: string[],
  round: string
): Promise<string> {
  const participantsList =
    eliminatedUserIds.length > 0
      ? eliminatedUserIds.map((id) => `<@${id}>`).join(', ')
      : 'nobody (lucky y\'all)';

  const prompt = `You are Betty, a sassy, confident, no-filter NBA Playoffs pool bot for Slack.
Post a channel message announcing that ${losingTeam} just lost their series to ${winningTeam} (${finalRecord}) and some participants are now eliminated.

Team eliminated: ${losingTeam}
Winning team: ${winningTeam}
Series score: ${finalRecord}
Round: ${round}
Eliminated participants: ${participantsList}

Your personality:
- SAVAGE and fun — this is playoff basketball, roast them HARD
- If participants were eliminated, CALL THEM OUT by name (they're already formatted as <@USER_ID>, use as-is)
- Uses slang: "youngblood", "honey", "chief", "fam", "playa", "guurl", "my guy", "homie", "boss"
- NBA slang: "bounced", "packed up", "sent home", "see ya", "gentleman's sweep", "got swept", "took the L", "in cancun", "playoff mode deactivated", "legacy points deducted", "fraud watch", "poverty franchise energy", "eliminated", "done", "finished", "sent packing"
- VARY YOUR WORD CHOICE: Don't use the same slang terms repeatedly — keep it fresh and unique each time!
- Reference the series score:
  - 4-0 = "got SWEPT" or "gentleman's swept" (brutal)
  - 4-1 = "gentleman's sweep" (quick work)
  - 4-2 = "wrapped them up" (solid)
  - 4-3 = "went the distance" or "barely survived" (close one)
- Keep it punchy — 3-5 sentences max
- VARY YOUR OPENING: Don't always start the same way. Mix it up with different reactions
- The participant mentions are already formatted as <@USER_ID> - use them as-is, don't modify them

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings.

Generate ONLY the channel message, no other text. Make it UNIQUE and SAVAGE.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude NBA channel roast generation failed:', error);
  }

  // Fallback
  return `🏀 ${losingTeam} got BOUNCED by ${winningTeam} (${finalRecord})! ${participantsList} — pack your bags, you're DONE! 💀`;
}

/**
 * Generate roast DM for series loss - Betty style with NBA context
 */
async function generateSeriesLossDM(
  username: string,
  losingTeam: string,
  winningTeam: string,
  finalRecord: string
): Promise<string> {
  const prompt = `You are Betty, a sassy, confident, no-filter NBA Playoffs pool bot for Slack.
Send a DM to a participant whose team just got eliminated from the playoffs.

Participant username: ${username}
Their team: ${losingTeam}
Lost to: ${winningTeam}
Series score: ${finalRecord}

Your personality:
- Sassy, fun, playful trash talk — roast them but keep it light
- Uses slang: "youngblood", "honey", "chief", "fam", "playa", "guurl"
- NBA slang: "taking an L", "got bounced", "sent home", "in cancun now", "playoff mode over", "legacy in shambles", "eliminated", "done", "packed up", "sent packing"
- VARY YOUR LANGUAGE: Don't repeat the same words — keep each message unique!
- Reference the series score if it's notable:
  - 4-0 = got SWEPT (brutal roast)
  - 4-1 = gentleman's sweep (quick work)
  - 4-3 = at least went down fighting
- Keep it SHORT — 2-4 sentences max
- End with a sympathetic but funny sign-off

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings. It's all about bragging rights.

Generate ONLY the DM message, no other text.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude NBA loss DM generation failed:', error);
  }

  // Fallback
  return `😬 Tough break, ${username}. ${losingTeam} got sent home by ${winningTeam} (${finalRecord}) — you're out of the pool. Better luck next year, youngblood 💀`;
}

/**
 * Generate congrats DM for series win - Betty style with NBA hype
 */
async function generateSeriesWinDM(
  username: string,
  winningTeam: string,
  finalRecord: string
): Promise<string> {
  const prompt = `You are Betty, a sassy, confident, no-filter NBA Playoffs pool bot for Slack.
Send a DM to a participant whose team just won their playoff series and they're moving on.

Participant username: ${username}
Their team: ${winningTeam}
Series score: ${finalRecord}

Your personality:
- Hype them up but keep it playful — a little smug, like you knew they'd make it
- Uses slang: "youngblood", "honey", "chief", "fam", "playa"
- NBA slang: "locked in", "moving on", "still breathing", "advancing", "playoff mode activated", "built different", "championship DNA"
- Reference series dominance if notable:
  - 4-0 = "SWEPT the competition"
  - 4-1 = "made quick work"
  - 4-3 = "survived a battle"
- Keep it SHORT — 2-3 sentences max
- Pump them up for the next round without giving them too much credit

IMPORTANT: This is a just-for-fun pool. Do NOT mention money, prizes, cash, or winnings.

Generate ONLY the DM message, no other text.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type === 'text') return content.text.trim();
  } catch (error) {
    console.error('[resultsProcessor] Claude NBA win DM generation failed:', error);
  }

  // Fallback
  return `🎉 ${winningTeam} closed out the series (${finalRecord}), ${username}! Nice pick — you're moving on. Don't get too comfortable yet, youngblood 🏀`;
}

/**
 * Check if round is complete and advance if needed
 * Works for both tournament types
 */
async function checkRoundCompletion(poolId: string): Promise<void> {
  const pool = await poolModel.getPool(poolId);
  if (!pool || !pool.current_round) return;

  const eliminationCounts =
    pool.tournament_type === 'nba_playoffs'
      ? NBA_PLAYOFFS_ELIMINATION_COUNTS
      : ROUND_ELIMINATION_COUNTS;

  const nextRoundMap =
    pool.tournament_type === 'nba_playoffs' ? NBA_PLAYOFFS_NEXT_ROUND : NEXT_ROUND;

  const expectedEliminations = eliminationCounts[pool.current_round];
  if (!expectedEliminations) return;

  const eliminationCountQuery = await dbPool.query(
    `SELECT COUNT(*) FROM tournament_teams WHERE pool_id = $1 AND eliminated_round = $2`,
    [poolId, pool.current_round]
  );
  const actualEliminations = parseInt(eliminationCountQuery.rows[0].count);

  if (actualEliminations >= expectedEliminations) {
    console.log(
      `[resultsProcessor] 🎯 Round complete: ${actualEliminations}/${expectedEliminations} eliminations`
    );

    // Send end-of-round summary
    const allParticipants = await participantModel.getParticipantsByPool(poolId);
    const survivors = allParticipants.filter((p) => p.status === 'active').length;
    const eliminatedThisRound = allParticipants.filter(
      (p) => p.status === 'eliminated' && p.eliminated_round === pool.current_round
    ).length;

    const summaryMsg = await generateEndOfRoundMessage(
      pool.current_round,
      eliminatedThisRound,
      survivors,
      pool.tournament_type
    );
    await sendMainChannelMessage(summaryMsg);

    // Advance to next round
    const nextRound = nextRoundMap[pool.current_round];
    if (nextRound) {
      await poolModel.updatePool(poolId, {
        current_round: nextRound as TournamentRound,
        current_round_locked: false,
      });
      await sendMainChannelMessage(
        `🏀 Picks are now open for the *${nextRound}*! DM me your team to lock in your pick.`
      );
      console.log(`[resultsProcessor] Advanced pool to ${nextRound}`);
    } else {
      console.log('[resultsProcessor] 🏆 Tournament complete!');
      await poolModel.updatePool(poolId, { status: 'completed' });
    }
  }
}

// ============================================================================
// Main Entry Point - Routes by Tournament Type
// ============================================================================

/**
 * Main entry point for processing tournament results
 * Routes to appropriate processor based on tournament type
 */
export async function processResults(poolId: string): Promise<void> {
  const pool = await poolModel.getPool(poolId);
  if (!pool) {
    console.error('[resultsProcessor] Pool not found');
    return;
  }

  console.log(`[resultsProcessor] Processing results for ${pool.tournament_type} tournament`);

  if (pool.tournament_type === 'nba_playoffs') {
    // NBA Playoffs: Process series results (best-of-7)
    await processNBAPlayoffsSeries(poolId);
    await checkRoundCompletion(poolId);
  } else {
    // March Madness: Process individual games
    // This is called from the scheduler which fetches games first
    console.log('[resultsProcessor] March Madness mode - processGames should be called with games array');
  }
}
