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

// ============================================================================
// Tournament round constants
// ============================================================================

// Number of teams eliminated when a round is fully complete.
// When DB elimination count for a round reaches this number, the round is done.
const ROUND_ELIMINATION_COUNTS: Record<TournamentRound, number> = {
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
  round: string
): Promise<string> {
  const prompt = `You are Betty, a sassy, confident, no-filter March Madness pool bot for Slack.
Send a DM to a participant whose team just got eliminated.

Participant username: ${username}
Their team: ${teamName}
Round: ${round}

Your personality:
- Sassy, fun, playful trash talk — not mean-spirited
- Uses slang: "youngblood", "honey", "chief", "fam", "playa", "guurl"
- Basketball slang: "cooked", "taking an L", "got bounced", "packed up their bags"
- Keep it SHORT — 2-4 sentences max
- End with a sympathetic but funny sign-off

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
async function generateNoPickDM(username: string, round: string): Promise<string> {
  const prompt = `You are Betty, a sassy, confident, no-filter March Madness pool bot for Slack.
Send a DM to a participant who forgot to submit a pick before the round started and is now eliminated.

Participant username: ${username}
Round: ${round}

Your personality:
- Savage but fun — they had ONE job
- Uses slang: "youngblood", "honey", "chief", "fam", "playa"
- Keep it SHORT — 2-4 sentences max
- Mock them for forgetting but keep it playful

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
  round: string
): Promise<string> {
  const prompt = `You are Betty, a sassy, confident, no-filter March Madness pool bot for Slack.
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
  eliminatedUsernames: string[]
): Promise<string> {
  const participantsList =
    eliminatedUsernames.length > 0
      ? eliminatedUsernames.map((u) => `@${u}`).join(', ')
      : null;

  const prompt = `You are Betty, a sassy, confident, no-filter March Madness pool bot for Slack.
Post a channel message announcing that a team just lost and some participants are now eliminated.

Team eliminated: ${teamName}
Round: ${round}
Eliminated participants: ${participantsList || 'none'}

Your personality:
- Sassy and fun, roast the eliminated participants by name
- If no participants were eliminated, still announce the team loss dramatically
- Uses slang: "youngblood", "honey", "chief", "fam", "playa", "guurl"
- Basketball slang: "cooked", "bounced", "packed up", "L szn"
- Keep it punchy — 3-5 sentences max
- Use Slack @mention format for usernames

Generate ONLY the channel message, no other text.`;

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
  eliminatedUsernames: string[]
): Promise<string> {
  const participantsList = eliminatedUsernames.map((u) => `@${u}`).join(', ');

  const prompt = `You are Betty, a sassy March Madness pool bot for Slack.
The ${round} has started and some participants forgot to submit picks. They are now eliminated.

Eliminated for no pick: ${participantsList}

Roast them publicly for forgetting. Keep it fun, 2-4 sentences. Use Slack @mention format.

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
  survivorCount: number
): Promise<string> {
  const prompt = `You are Betty, a sassy March Madness pool bot for Slack.
The ${round} is complete. Post a round summary.

Eliminated this round: ${eliminatedCount}
Still alive: ${survivorCount}

Keep it concise and dramatic. 2-4 sentences. Betty style.

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

  return `📊 ${round} is a wrap! ${eliminatedCount} participant(s) eliminated, ${survivorCount} still standing. Who's next? 👀`;
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
      round
    );
    await sendDM(participant.slack_user_id, dmText);
  }

  // Send mid-round channel announcement only if someone was actually eliminated
  if (eliminatedUsernames.length > 0) {
    const channelMsg = await generateMidRoundChannelMessage(
      team.team_name,
      round,
      eliminatedUsernames
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
 * Run the no-pick sweep for a round.
 * Called when the first game of a round begins (IN_PROGRESS or FINAL) and
 * no eliminations exist yet for that round.
 */
async function runNoPickSweep(poolId: string, round: TournamentRound): Promise<string[]> {
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
    const dmText = await generateNoPickDM(participant.slack_username || 'friend', round);
    await sendDM(participant.slack_user_id, dmText);
  }

  // Channel announcement for no-pick sweep
  if (eliminatedUsernames.length > 0) {
    const channelMsg = await generateNoPickChannelMessage(round, eliminatedUsernames);
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
      round
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
  const activeTeams = await teamModel.getActiveTeams(poolId);

  for (const game of games) {
    if (game.status !== 'final') continue;
    if (!game.loser || !game.round) {
      console.log(`[resultsProcessor] Skipping game ${game.id} — missing loser or round`);
      continue;
    }

    result.gamesProcessed++;

    // Fuzzy-match ESPN loser name to our DB canonical name and eliminate
    const loserCanonical = await matchTeamName(game.loser, activeTeams);
    if (!loserCanonical) {
      console.warn(`[resultsProcessor] Could not match ESPN loser "${game.loser}" to any DB team — skipping`);
      continue;
    }

    const elimination = await eliminateTeam(loserCanonical, game.round);

    if (!elimination.alreadyEliminated && !elimination.teamNotFound) {
      result.teamsEliminated.push(loserCanonical);
      result.participantsEliminated.push(...elimination.participantsEliminated);
    }

    // Fuzzy-match ESPN winner name and mark those picks as won
    if (game.winner) {
      const winnerCanonical = await matchTeamName(game.winner, activeTeams);
      if (winnerCanonical) {
        const wonCount = await celebrateWinner(poolId, winnerCanonical, game.round);
        result.picksMarkedWon += wonCount;
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

    // Only send end-of-round summary when all expected eliminations for the round are recorded
    const eliminationCount = await getEliminationCountForRound(poolId, round);
    const expectedEliminations = ROUND_ELIMINATION_COUNTS[round];
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

    const summaryMsg = await generateEndOfRoundMessage(round, eliminatedThisRound, survivors);
    await sendMainChannelMessage(summaryMsg);
    result.endOfRoundSummariesSent.push(round);

    console.log(`[resultsProcessor] End-of-round summary sent for ${round}`);

    // Advance pool to next round
    const nextRound = NEXT_ROUND[round];
    if (nextRound === undefined) {
      console.warn(`[resultsProcessor] No next round mapping for ${round}`);
    } else if (nextRound === null) {
      // Championship is over — mark pool completed
      await poolModel.updatePool(currentPool.id, { status: 'completed' });
      await sendMainChannelMessage(`🏆 The tournament is over! Thanks for playing everyone. Betty out. 🎉`);
      console.log(`[resultsProcessor] Tournament complete — pool marked completed`);
    } else {
      // Advance to next round
      await poolModel.updatePool(currentPool.id, { current_round: nextRound });
      await sendMainChannelMessage(`🏀 Picks are now open for the *${nextRound}*! DM me your team to lock in your pick.`);
      console.log(`[resultsProcessor] Advanced pool to ${nextRound}`);
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

  const summaryMsg = await generateEndOfRoundMessage(round, eliminatedThisRound, survivors);
  await sendMainChannelMessage(summaryMsg);
  console.log(`[resultsProcessor] simulateRoundEnd: summary sent for ${round}`);

  const nextRound = NEXT_ROUND[round];
  if (nextRound === undefined) {
    console.warn(`[resultsProcessor] No next round mapping for ${round}`);
    return { round, nextRound: null };
  } else if (nextRound === null) {
    await poolModel.updatePool(currentPool.id, { status: 'completed' });
    await sendMainChannelMessage(`🏆 The tournament is over! Thanks for playing everyone. Betty out. 🎉`);
    console.log(`[resultsProcessor] simulateRoundEnd: tournament complete — pool marked completed`);
    return { round, nextRound: null };
  } else {
    await poolModel.updatePool(currentPool.id, { current_round: nextRound });
    await sendMainChannelMessage(`🏀 Picks are now open for the *${nextRound}*! DM me your team to lock in your pick.`);
    console.log(`[resultsProcessor] simulateRoundEnd: pool advanced to ${nextRound}`);
    return { round, nextRound };
  }
}
