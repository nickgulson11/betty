import Anthropic from '@anthropic-ai/sdk';
import { ParsedBet, ConversationState } from '../types/bet';

let anthropic: Anthropic | null = null;

/**
 * Get or create the Anthropic client instance (lazy initialization)
 */
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

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a Claude API call with exponential backoff
 */
async function retryClaudeCall<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on certain errors
      if (error instanceof Error && error.message.includes('API_KEY')) {
        throw error; // Auth errors shouldn't be retried
      }

      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.log(`⚠️  Claude API call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      }
    }
  }

  throw lastError || new Error('Claude API call failed after retries');
}

/**
 * Parse a betting message using Claude AI
 * @param messageText - The raw Slack message text
 * @param currentDate - Current date for context (helps with "tonight", "tomorrow", etc.)
 * @param initiatorUserId - The Slack user ID of the person who sent the message (the bet initiator)
 * @param conversationContext - Optional context from previous clarification attempts
 * @returns Parsed bet details with confidence level
 */
export async function parseBetIntent(
  messageText: string,
  currentDate: Date,
  initiatorUserId?: string,
  conversationContext?: string
): Promise<ParsedBet> {
  const contextPrompt = conversationContext
    ? `\n\nPrevious conversation context:\n${conversationContext}`
    : '';

  const initiatorPrompt = initiatorUserId
    ? `\n\nIMPORTANT: The person who sent this message (Slack user ID: ${initiatorUserId}) is the BET INITIATOR. They are making the bet. You don't need to determine who the initiator is - it's the message sender.`
    : '';

  // Convert to US Eastern Time for NBA game context
  const etDate = new Date(currentDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dateStr = etDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York'
  });
  const timeStr = etDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York'
  });

  const prompt = `You are analyzing a message from a Slack betting bot conversation. Extract betting details from this message.

Message: "${messageText}"
Current date and time in US Eastern Time: ${dateStr} at ${timeStr}
IMPORTANT: When interpreting "tonight" or "today", use the date ${etDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}. When interpreting "tomorrow", use ${new Date(etDate.getTime() + 24*60*60*1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}.${initiatorPrompt}${contextPrompt}

The bot supports both NBA Basketball and NFL Football bets.

Analyze the message and extract:
1. Who they're betting against (opponent) - look for @mentions or names (NOT the initiator!)
2. Which team the initiator is betting on (can be NBA or NFL team)
3. When the game is ("tonight", "tomorrow", "Sunday", specific date) - OPTIONAL for NFL teams
4. What the stakes are (money amount, "bragging rights", etc.)

IMPORTANT: You do NOT need to determine which team the opponent gets. The opponent automatically gets the other team in the game. Only extract the team the INITIATOR is betting on.

IMPORTANT: For NFL teams, timing is OPTIONAL. If no timing is specified, the system will automatically find the team's next upcoming game. Do NOT mark timing as missing_info for NFL teams.

NOTE: "ML" stands for "MoneyLine" in gambling terminology - it just means a standard bet on who wins. Ignore "ML" when parsing - it doesn't affect the bet details.

Return a JSON object with this exact structure:
{
  "confidence": "high" | "low" | "unclear",
  "opponent_name": string or null,
  "team": string or null,
  "opponent_team": string or null,
  "timing": string or null,
  "stakes": string or null,
  "missing_info": string[],
  "clarifying_question": string or null
}

Guidelines:
- confidence "high": All critical info present (opponent, team). Timing and stakes are OPTIONAL.
- confidence "low": Missing critical info (opponent or team) but bet intent is clear
- confidence "unclear": Not enough info to understand the bet, or no bet intent detected
- missing_info: Array of what's missing (e.g., ["opponent", "team"]). Do NOT include "timing" or "stakes" in missing_info - they are always optional.
- clarifying_question: If confidence is not "high", provide a natural question to ask in Slack. NEVER ask which team the opponent gets - they automatically get the opposing team. NEVER ask about timing.
- For team names, preserve the exact text from the message (e.g., "Lakers", "Warriors", "Chiefs", "Bears")
- If timing is provided, normalize it (e.g., "tonight", "tomorrow", "Sunday", "2024-11-07")
- Leave opponent_team as null - it will be determined automatically from the game matchup

Special cases:
- If message doesn't seem to be about betting at all, return confidence "unclear" with missing_info ["no_bet_intent"]
- Look for @mentions in format <@U12345> or @username for opponent
- If stakes are not mentioned, leave stakes as null - they will default to "bragging rights"
- If timing is not mentioned, leave timing as null - the system will find the next game automatically
- DO NOT try to determine the initiator - we already know it's the message sender
- DO NOT ask which team the opponent gets - they automatically get the other team in the matchup
- DO NOT ask about timing - it's always optional

Return ONLY the JSON object, no other text.`;

  try {
    const client = getAnthropicClient();

    // Wrap Claude API call with retry logic
    const message = await retryClaudeCall(async () => {
      return await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });
    });

    // Extract text content
    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Parse JSON response (handle markdown code blocks)
    let jsonText = content.text.trim();

    // Remove markdown code block formatting if present
    if (jsonText.startsWith('```')) {
      // Remove opening ```json or ```
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '');
      // Remove closing ```
      jsonText = jsonText.replace(/\n?```$/, '');
      jsonText = jsonText.trim();
    }

    const parsedResponse = JSON.parse(jsonText);

    // Validate response structure
    const validatedResponse: ParsedBet = {
      confidence: parsedResponse.confidence || 'unclear',
      opponent_name: parsedResponse.opponent_name || undefined,
      team: parsedResponse.team || undefined,
      opponent_team: parsedResponse.opponent_team || undefined,
      timing: parsedResponse.timing || undefined,
      stakes: parsedResponse.stakes || undefined,
      missing_info: parsedResponse.missing_info || [],
      clarifying_question: parsedResponse.clarifying_question || undefined,
    };

    return validatedResponse;

  } catch (error) {
    console.error('Error parsing bet intent with Claude:', error);

    // Return a safe fallback
    return {
      confidence: 'unclear',
      missing_info: ['parsing_error'],
      clarifying_question: "Sorry, I had trouble understanding that. Could you rephrase your bet? For example: 'I bet @john that the Lakers win tonight for $10'",
    };
  }
}

/**
 * Extract Slack user ID from mention format
 * @param mention - Slack mention in format <@U12345> or <@U12345|username>
 * @returns User ID or null
 */
export function extractSlackUserId(mention: string): string | null {
  const match = mention.match(/<@([A-Z0-9]+)(\|[^>]+)?>/);
  return match ? match[1] : null;
}

/**
 * Parse all user mentions from a message
 * @param messageText - Raw Slack message text
 * @returns Array of user IDs
 */
export function extractAllUserMentions(messageText: string): string[] {
  const mentionRegex = /<@([A-Z0-9]+)(\|[^>]+)?>/g;
  const matches = messageText.matchAll(mentionRegex);
  return Array.from(matches).map(match => match[1]);
}

/**
 * Parse a bet with conversation context from previous clarifications
 * @param messageText - The current message (user's response to clarification)
 * @param conversationState - Previous conversation state
 * @param currentDate - Current date for context
 * @returns Updated parsed bet
 */
export async function parseBetWithContext(
  messageText: string,
  conversationState: ConversationState,
  currentDate: Date
): Promise<ParsedBet> {
  // Build conversation history for context
  const conversationHistory = conversationState.conversation_history.join('\n');

  const contextString = `Previous conversation:
${conversationHistory}

What we've understood so far:
${JSON.stringify(conversationState.parsed_so_far, null, 2)}

User's latest response: "${messageText}"`;

  // Parse with full context
  return parseBetIntent(messageText, currentDate, contextString);
}

/**
 * Build a conversation state object for tracking multi-turn clarifications
 * @param originalMessage - The first message that started the bet
 * @param parsedBet - The initially parsed bet
 * @returns ConversationState object
 */
export function buildConversationState(
  originalMessage: string,
  parsedBet: ParsedBet
): ConversationState {
  return {
    original_message: originalMessage,
    clarification_needed: parsedBet.missing_info,
    clarification_attempts: 1,
    parsed_so_far: parsedBet,
    conversation_history: [
      `User: ${originalMessage}`,
      parsedBet.clarifying_question ? `Betty: ${parsedBet.clarifying_question}` : ''
    ].filter(msg => msg.length > 0)
  };
}

/**
 * Update conversation state with new message
 * @param state - Current conversation state
 * @param userMessage - User's response
 * @param bettyResponse - Betty's response (if any)
 * @returns Updated conversation state
 */
export function updateConversationState(
  state: ConversationState,
  userMessage: string,
  bettyResponse?: string
): ConversationState {
  const updatedHistory = [...state.conversation_history, `User: ${userMessage}`];

  if (bettyResponse) {
    updatedHistory.push(`Betty: ${bettyResponse}`);
  }

  return {
    ...state,
    clarification_attempts: state.clarification_attempts + 1,
    conversation_history: updatedHistory
  };
}

/**
 * Query intent types
 */
export interface QueryIntent {
  type: 'list_bets' | 'bet_creation' | 'general_chat' | 'unknown';
  scope?: 'self' | 'specific_user' | 'channel';
  mentioned_users?: string[];
}

/**
 * Detect if user is asking to list bets (vs creating a new bet)
 * @param messageText - The raw Slack message text
 * @returns Query intent
 */
export async function detectQueryIntent(messageText: string): Promise<QueryIntent> {
  const prompt = `You are analyzing a message to a Slack betting bot named Betty. Determine if the user is:
1. Asking to LIST/VIEW existing bets
2. Creating a NEW bet
3. Just chatting/asking general questions

Message: "${messageText}"

Analyze the message and return a JSON object with this structure:
{
  "type": "list_bets" | "bet_creation" | "general_chat" | "unknown",
  "scope": "self" | "specific_user" | "channel" | null,
  "mentioned_users": string[]
}

Guidelines:
- type "list_bets": User is asking to see/list/check existing bets
  Examples: "what bets do I have?", "show my bets", "does @user have any bets?", "what bets are open?", "list all bets", "what bets does this group have", "show all open bets"

- type "bet_creation": User is creating a new bet
  Examples: "I bet @user that Lakers win", "I'll bet $10 on the Knicks"

- type "general_chat": User is asking general questions or chatting
  Examples: "hello", "how are you?", "what can you do?"

- scope "self": Asking about their own bets ("my bets", "do I have", "what are my bets")
- scope "specific_user": Asking about a specific user's bets ("does @user have", "@user's bets", "show @user's bets")
- scope "channel": Asking about all bets in the channel/group/everyone ("what bets does this group have", "what bets does everyone have", "list all bets", "what's open", "what are the open bets", "show all bets", "group bets", "channel bets")

IMPORTANT: If the user mentions "group", "everyone", "all bets", "channel", or asks generically about "open bets" without specifying themselves or another user, set scope to "channel".

- mentioned_users: Extract @mentions in format <@U12345> as an array of user IDs

Return ONLY the JSON object, no other text.`;

  try {
    const client = getAnthropicClient();

    const message = await retryClaudeCall(async () => {
      return await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let jsonText = content.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '');
      jsonText = jsonText.replace(/\n?```$/, '');
      jsonText = jsonText.trim();
    }

    const parsed = JSON.parse(jsonText);

    return {
      type: parsed.type || 'unknown',
      scope: parsed.scope || undefined,
      mentioned_users: parsed.mentioned_users || []
    };

  } catch (error) {
    console.error('Error detecting query intent:', error);
    // Default to bet creation to maintain backward compatibility
    return {
      type: 'bet_creation',
      mentioned_users: []
    };
  }
}
