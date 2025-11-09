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
Current date and time in US Eastern Time (NBA schedule timezone): ${dateStr} at ${timeStr}
IMPORTANT: When interpreting "tonight" or "today", use the date ${etDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}. When interpreting "tomorrow", use ${new Date(etDate.getTime() + 24*60*60*1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}.${initiatorPrompt}${contextPrompt}

Analyze the message and extract:
1. Who they're betting against (opponent) - look for @mentions or names (NOT the initiator!)
2. Which team the initiator is betting on
3. Which team the opponent would get (if specified or can be inferred)
4. When the game is ("tonight", "tomorrow", specific date)
5. What the stakes are (money amount, "bragging rights", etc.)

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
- confidence "high": All critical info present (opponent, at least one team, timing)
- confidence "low": Some info missing but bet intent is clear
- confidence "unclear": Not enough info to understand the bet, or no bet intent detected
- missing_info: Array of what's missing (e.g., ["opponent", "team", "timing"])
- clarifying_question: If confidence is not "high", provide a natural question to ask in Slack
- For team names, preserve the exact text from the message (e.g., "Lakers", "Warriors")
- Timing should be normalized (e.g., "tonight", "tomorrow", "2024-11-07")
- If only one team is mentioned, opponent_team can be inferred from the matchup context

Special cases:
- If message doesn't seem to be about betting at all, return confidence "unclear" with missing_info ["no_bet_intent"]
- Look for @mentions in format <@U12345> or @username for opponent
- Stakes default to "bragging rights" if not specified but bet is otherwise clear
- DO NOT try to determine the initiator - we already know it's the message sender

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
