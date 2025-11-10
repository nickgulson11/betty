import Anthropic from '@anthropic-ai/sdk';
import { Bet } from '../types/bet';

/**
 * Check if personality mode is enabled
 */
export function isPersonalityModeEnabled(): boolean {
  return process.env.PERSONALITY_MODE === 'true';
}

/**
 * Get random item from array
 */
function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Get or create the Anthropic client instance
 */
let anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropic;
}

// ============================================================================
// BET CONFIRMATION MESSAGES (Templates)
// ============================================================================

const CONFIRMATION_TEMPLATES = [
  (bet: Bet) => `👀 *Youngblood's got a bet!*

<@${bet.initiator_slack_id}> is riding with the *${bet.initiator_team}* to beat the *${bet.opponent_team}*
That means <@${bet.opponent_slack_id}> gets the *${bet.opponent_team}*

📅 Game: ${bet.initiator_team} vs ${bet.opponent_team}, ${formatGameTime(bet.game_date)}
💰 Stakes: ${bet.stakes}

<@${bet.opponent_slack_id}> - Hit 👍 if you're taking the ${bet.opponent_team}, ❌ if you're folding 😏`,

  (bet: Bet) => `🎲 *Playa wants smoke!*

<@${bet.initiator_slack_id}> says the *${bet.initiator_team}* got this over the *${bet.opponent_team}*
<@${bet.opponent_slack_id}>, that makes you Team ${bet.opponent_team}

📅 Game: ${bet.initiator_team} vs ${bet.opponent_team}, ${formatGameTime(bet.game_date)}
💰 Stakes: ${bet.stakes}

<@${bet.opponent_slack_id}> - 👍 to lock in the ${bet.opponent_team}, ❌ to back out`,

  (bet: Bet) => `💰 *Bet on the table, fam*

<@${bet.initiator_slack_id}> is betting on the *${bet.initiator_team}* to take down the *${bet.opponent_team}*
<@${bet.opponent_slack_id}> would be repping the *${bet.opponent_team}*

📅 Game: ${bet.initiator_team} vs ${bet.opponent_team}, ${formatGameTime(bet.game_date)}
💰 Stakes: ${bet.stakes}

<@${bet.opponent_slack_id}> - 👍 = you got the ${bet.opponent_team} | ❌ = no faith`,

  (bet: Bet) => `🎯 *Bet incoming, chief*

<@${bet.initiator_slack_id}> backing the *${bet.initiator_team}* to win against the *${bet.opponent_team}*
<@${bet.opponent_slack_id}> gets the *${bet.opponent_team}* side

📅 Game: ${bet.initiator_team} vs ${bet.opponent_team}, ${formatGameTime(bet.game_date)}
💰 Stakes: ${bet.stakes}

We'll see who knows ball 🏀 <@${bet.opponent_slack_id}> - 👍 or ❌?`,
];

export function getPersonalityConfirmationMessage(bet: Bet): string {
  const template = getRandomItem(CONFIRMATION_TEMPLATES);
  return template(bet);
}

// ============================================================================
// BET ACCEPTANCE MESSAGES (Templates)
// ============================================================================

const ACCEPTANCE_TEMPLATES = [
  (bet: Bet) => `✅ *IT'S LOCKED, FAM!*

<@${bet.initiator_slack_id}> vs <@${bet.opponent_slack_id}> - somebody's about to take an L 💀

Game's ${formatGameTime(bet.game_date)}. I'll be back with the results... and the receipts 📸🔥`,

  (bet: Bet) => `🔒 *Bet's official, youngbloods!*

<@${bet.initiator_slack_id}> and <@${bet.opponent_slack_id}> really doing this. One of y'all is getting COOKED ${formatGameTime(bet.game_date)} 🔥

See you after the game to break some ankles 🏀💸`,

  (bet: Bet) => `✅ *Locked in, no backing out now!*

<@${bet.initiator_slack_id}> vs <@${bet.opponent_slack_id}> - winner takes all, loser takes the roast 😤

I'll be watching this one, playa. Can't wait to see who's eating ${formatGameTime(bet.game_date)} 👀`,

  (bet: Bet) => `🎲 *BET CONFIRMED*

<@${bet.initiator_slack_id}> and <@${bet.opponent_slack_id}> got money on the line. One of y'all knows ball, one of y'all is about to learn 📚💀

Results coming after the game ${formatGameTime(bet.game_date)} - stay tuned, fam 🍿`,
];

export function getPersonalityAcceptanceMessage(bet: Bet): string {
  const template = getRandomItem(ACCEPTANCE_TEMPLATES);
  return template(bet);
}

// ============================================================================
// BET DECLINE MESSAGES (Templates)
// ============================================================================

const DECLINE_TEMPLATES = [
  (initiatorId: string, _opponentId: string, declinerId: string) => `❌ *YOUNGBLOOD FOLDED* ❌

<@${declinerId}> really said "nah I'm good" 💀 Guurl, we saw that cold feet energy from a mile away 🧊

<@${initiatorId}>, you'll find someone with actual confidence next time, honey 😘`,

  (initiatorId: string, _opponentId: string, declinerId: string) => `🚫 *<@${declinerId}> DECLINED* 🚫

Playa really backed out?? It's giving scared 😬 That's embarrassing, chief.

<@${initiatorId}>, find yourself someone who's actually about that life 💅`,

  (initiatorId: string, _opponentId: string, declinerId: string) => `❌ *<@${declinerId}> said NAH* ❌

Out here declining bets now? Cap. Straight cap 🧢

<@${initiatorId}>, this one's clearly not ready for the big leagues. Try again with someone who's got game 🏀`,

  (initiatorId: string, _opponentId: string, declinerId: string) => `🚫 *Bet declined by <@${declinerId}>* 🚫

Probably for the best, youngblood clearly doesn't know ball anyway 💀

<@${initiatorId}>, find someone who actually watches the games 🏀📺`,
];

export function getPersonalityDeclineMessage(initiatorId: string, opponentId: string, declinerId: string): string {
  const template = getRandomItem(DECLINE_TEMPLATES);
  return template(initiatorId, opponentId, declinerId);
}

// ============================================================================
// DUPLICATE BET WARNING (Templates)
// ============================================================================

const DUPLICATE_BET_TEMPLATES = [
  (opponentId: string, _initiatorTeam: string, _opponentTeam: string) => `🛑 *HOLD UP, CHIEF* 🛑

You already got a bet with <@${opponentId}> on this exact game. What, you trying to double down on that L? 💀

One humiliation per game, honey. That's the rule 😘`,

  (opponentId: string, initiatorTeam: string, opponentTeam: string) => `⚠️ *Youngblood, we've been through this*

You and <@${opponentId}> already got money on ${initiatorTeam} vs ${opponentTeam}. Can't bet the same game twice, that's desperate behavior 📉

Wait for the results before you stack more Ls, fam 🤚`,

  (opponentId: string, _initiatorTeam: string, _opponentTeam: string) => `🚫 *Not so fast, playa*

Already got an active bet with <@${opponentId}> for this exact matchup. You can't bet the same game twice - that's just greedy 💀

Let's see how this one plays out first, chief 🏀`,
];

export function getPersonalityDuplicateBetMessage(opponentId: string, initiatorTeam: string, opponentTeam: string): string {
  const template = getRandomItem(DUPLICATE_BET_TEMPLATES);
  return template(opponentId, initiatorTeam, opponentTeam);
}

// ============================================================================
// GAME ALREADY STARTED WARNING (Templates)
// ============================================================================

const GAME_STARTED_TEMPLATES = [
  `🛑 *TOO LATE, CHIEF* 🛑

Game already started, you can't accept this bet now. Should've moved faster, honey 😘

That's what we call "caught lacking" 💀`,

  `⚠️ *Nah youngblood, we don't do that here*

Game's already tipping off - no late bets allowed. You snooze, you lose 🏀⏰

Better luck next time, fam 💅`,

  `🚫 *Clock ran out, playa*

Game's already underway - can't accept bets after tip-off. That's the rules 🤷

Should've been quicker on that thumbs up, chief 👍⚡`,
];

export function getPersonalityGameStartedMessage(): string {
  return getRandomItem(GAME_STARTED_TEMPLATES);
}

// ============================================================================
// HELP/WELCOME MESSAGE (Templates)
// ============================================================================

const WELCOME_TEMPLATES = [
  `👋 *What's good, youngblood?*

I'm Betty, and I run the bets around here 💰🏀

**Want to make a bet?** Hit me with:
"@betty I bet @friend that the Lakers win tonight for $5"

**Check your bets:**
"@betty what bets do I have open?"

**Fair warning:** I don't hold back when it's time to announce results. We'll find out real quick who knows ball and who's just talking 😏🔥`,

  `👋 *Hey there, playa*

I'm Betty - your NBA betting bot with ZERO filter 💅🏀

**Make a bet like:**
"@betty I bet @friend the Warriors win tomorrow"

**Check your action:**
"@betty show my bets"

**Heads up:** When results drop, I'm coming with the roasts. You've been warned, fam 🔥😘`,
];

export function getPersonalityWelcomeMessage(): string {
  return getRandomItem(WELCOME_TEMPLATES);
}

// ============================================================================
// ERROR MESSAGES (Templates)
// ============================================================================

const ERROR_TEMPLATES = [
  `😬 *Oop, my bad fam*

My database is acting up right now - not me, it's the tech 💀 Give me a sec and try again, youngblood.`,

  `🚫 *Well this is embarrassing*

Something broke on my end (not you, it's me). Try that bet again in a minute, playa. I'll get it together 😤`,

  `⚠️ *Technical difficulties, chief*

My systems are being dramatic right now 💅 Circle back in a moment and we'll get this bet locked in, honey.`,
];

export function getPersonalityErrorMessage(): string {
  return getRandomItem(ERROR_TEMPLATES);
}

// ============================================================================
// CLARIFYING QUESTIONS (Templates)
// ============================================================================

export function getPersonalityClarifyingQuestion(missingInfo: string[]): string {
  if (missingInfo.includes('opponent')) {
    const questions = [
      `👀 Hold up, youngblood - who are you betting AGAINST? @ mention them so I know who's about to catch this bet 🎲`,
      `Guurl, I need to know who you're betting with. @ mention your opponent, chief 🏀`,
      `Playa, who's taking the other side of this bet? @ mention them so we can get this locked in 💰`,
    ];
    return getRandomItem(questions);
  }

  if (missingInfo.includes('team')) {
    const questions = [
      `Guurl, I need more info. Which team you backing? Lakers? Warriors? Spill it, chief 🏀`,
      `Hold up - which team are you riding with, youngblood? Give me that team name 👀`,
      `Okay playa, but WHO you betting on? Need that team name, fam 🎯`,
    ];
    return getRandomItem(questions);
  }

  if (missingInfo.includes('timing')) {
    const questions = [
      `Okay playa, I got most of it but when's this game? Tonight? Tomorrow? Help me out here 📅`,
      `When's this going down, chief? Tonight? Tomorrow? Next week? 📆🏀`,
      `Cool cool, but WHEN youngblood? Need to know if this game is tonight, tomorrow, or what 🗓️`,
    ];
    return getRandomItem(questions);
  }

  // Default clarification
  return `🤔 Hold up, I'm missing some details here. Who you betting with, which team you got, and when's the game? Break it down for me, fam 🏀`;
}

// ============================================================================
// OPEN BETS LIST (No bets found)
// ============================================================================

const NO_BETS_TEMPLATES = [
  `👀 *No bets, youngblood?*

Your record is looking EMPTY right now. What, you scared to put your predictions on the line?

Time to step up, fam 🎲🏀`,

  `🦗 *Crickets...*

Not a single open bet, chief? That's giving "all talk, no action" energy 💀

Let's see if you can actually back up that basketball knowledge 😏`,

  `📭 *Nothing here, playa*

No open bets? Guurl, you can't win if you don't play 💅

Time to put your money where your mouth is 🏀💰`,
];

export function getPersonalityNoBetsMessage(): string {
  return getRandomItem(NO_BETS_TEMPLATES);
}

// ============================================================================
// SETTLEMENT MESSAGES (Claude-Generated)
// ============================================================================

/**
 * Generate a personality-driven settlement message using Claude
 */
export async function generatePersonalitySettlementMessage(
  bet: Bet,
  winnerId: string,
  finalScore: string
): Promise<string> {
  const winnerName = winnerId === bet.initiator_slack_id ? bet.initiator_name : bet.opponent_name;
  const loserName = winnerId === bet.initiator_slack_id ? bet.opponent_name : bet.initiator_name;
  const winnerTeam = winnerId === bet.initiator_slack_id ? bet.initiator_team : bet.opponent_team;
  const loserTeam = winnerId === bet.initiator_slack_id ? bet.opponent_team : bet.initiator_team;

  const prompt = `You are Betty, a sassy, confident, flirty, no-filter NBA betting bot for Slack. You're announcing the results of a bet and you need to be HARSH to the loser while celebrating the winner.

**Bet Details:**
- Winner: <@${winnerId}> (${winnerName}) - had ${winnerTeam}
- Loser: <@${winnerId === bet.initiator_slack_id ? bet.opponent_slack_id : bet.initiator_slack_id}> (${loserName}) - had ${loserTeam}
- Final Score: ${finalScore}
- Stakes: ${bet.stakes}
- Game: ${winnerTeam} vs ${loserTeam}

**Your Personality:**
- Sassy, confident, flirty, no filter
- Harsh to losers - this is the moment to roast them hard
- Uses slang: "youngblood", "guurl", "playa", "honey", "chief", "fam", "knows ball", "doesn't know ball", "breaking ankles", "cooked", "burnt", "down bad", "taking Ls", "ate", "folded", "cap", etc.
- Reference the actual score and make contextual jokes
- Be genuinely mean to the loser but keep it fun/entertaining
- Celebrate winner confidently

**Requirements:**
1. Start with an attention-grabbing header with emojis
2. Announce the winner and that they "broke ankles" or similar
3. Show the final score
4. Roast the loser HARD - question their basketball knowledge, call them out
5. Mention the stakes and celebrate the winner
6. Use slang naturally throughout
7. Keep it under 150 words
8. Use Slack mention format: <@${winnerId}> for winner, <@${winnerId === bet.initiator_slack_id ? bet.opponent_slack_id : bet.initiator_slack_id}> for loser

Generate ONLY the settlement message, no other text or explanation.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    return content.text.trim();
  } catch (error) {
    console.error('Error generating personality settlement message:', error);
    // Fallback to a template if Claude fails
    return `🏆 *WINNER: <@${winnerId}>* 🏆

${winnerTeam} came through! Final: ${finalScore}

<@${winnerId === bet.initiator_slack_id ? bet.opponent_slack_id : bet.initiator_slack_id}> really thought ${loserTeam} had this? That's embarrassing, honey 💀

<@${winnerId}> knows ball. <@${winnerId === bet.initiator_slack_id ? bet.opponent_slack_id : bet.initiator_slack_id}> doesn't. Simple as that 🏀🔥`;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format game date/time for display (imported logic from betManager)
 */
function formatGameTime(gameDate: Date): string {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const gameDateET = new Date(gameDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const today = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate());
  const gameDay = new Date(gameDateET.getFullYear(), gameDateET.getMonth(), gameDateET.getDate());

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
      day: 'numeric',
      timeZone: 'America/New_York'
    });
  }
}
