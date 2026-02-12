import Anthropic from '@anthropic-ai/sdk';
import { TournamentTeam } from '../types/tournamentTeam';

let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

/**
 * Match a user-submitted team name against the list of active tournament teams.
 *
 * Strategy:
 * 1. Exact case-insensitive match (no Claude call needed)
 * 2. Claude fuzzy match — handles nicknames, abbreviations, typos
 *
 * Returns the canonical team_name from the DB, or null if no match found.
 */
export async function matchTeamName(
  userInput: string,
  activeTeams: TournamentTeam[]
): Promise<string | null> {
  if (activeTeams.length === 0) return null;

  const trimmed = userInput.trim();

  // Step 1: Exact case-insensitive match (free, instant)
  const exactMatch = activeTeams.find(
    (t) => t.team_name.toLowerCase() === trimmed.toLowerCase()
  );
  if (exactMatch) return exactMatch.team_name;

  // Step 2: Claude fuzzy match
  const teamList = activeTeams.map((t) => t.team_name).join(', ');

  const prompt = `You are helping match a user's input to an NCAA March Madness team name.

User typed: "${trimmed}"

Available teams: ${teamList}

Instructions:
- Return ONLY the exact team name from the list above that the user is referring to.
- Handle common nicknames (e.g. "Heels" → "North Carolina", "Zags" → "Gonzaga", "Nova" → "Villanova", "Ducks" → "Oregon").
- Handle abbreviations (e.g. "UNC" → "North Carolina", "UK" → "Kentucky", "UConn" → "Connecticut").
- Handle minor typos (e.g. "Dook" → "Duke").
- If you are not confident the user means a specific team, return exactly: null

Return ONLY the team name or the word null. No explanation, no punctuation, no quotes.`;

  try {
    const client = getAnthropicClient();

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') return null;

    const response = content.text.trim();

    // Claude returned "null" or empty
    if (!response || response.toLowerCase() === 'null') return null;

    // Verify the returned name actually exists in our team list (prevent hallucination)
    const verified = activeTeams.find(
      (t) => t.team_name.toLowerCase() === response.toLowerCase()
    );

    return verified ? verified.team_name : null;
  } catch (error) {
    console.error('Error in Claude team matching:', error);
    return null;
  }
}
