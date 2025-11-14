export type BetStatus = 'pending' | 'active' | 'settled' | 'declined' | 'cancelled';

export type Sport = 'NBA Basketball' | 'NFL Football' | 'NCAA Basketball' | 'NCAA Football';

export interface Bet {
  id: string;
  created_at: Date;
  status: BetStatus;
  sport: Sport;
  initiator_slack_id: string;
  initiator_name?: string;
  opponent_slack_id: string;
  opponent_name?: string;
  initiator_team: string;
  opponent_team: string;
  game_date: Date;
  stakes: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  slack_message_ts?: string;
  winner_slack_id?: string;
  final_score?: string;
  settled_at?: Date;
  conversation_state?: ConversationState;
  settlement_attempts: number;
  last_settlement_check?: Date;
}

export interface ConversationState {
  original_message: string;
  clarification_needed: string[];
  clarification_attempts: number;
  parsed_so_far?: ParsedBet;  // What we've extracted so far
  conversation_history: string[];  // Array of messages in the conversation
}

export interface ParsedBet {
  confidence: 'high' | 'low' | 'unclear';
  opponent_name?: string;
  team?: string;
  opponent_team?: string;
  timing?: string;
  game_time?: string; // Actual game time if found (e.g., "7:30 PM ET")
  stakes?: string;
  missing_info: string[];
  clarifying_question?: string;
}

export interface GameResult {
  status: 'completed' | 'in_progress' | 'postponed' | 'not_found';
  winner?: string;
  loser?: string;
  final_score?: string;
  is_final: boolean;
}

export interface SlackContext {
  channel_id: string;
  thread_ts: string;
  user_id: string;
  message_text: string;
}

export interface NBAGame {
  id: string;
  home_team: string;
  away_team: string;
  game_date: Date;
  start_time: Date;
  status: 'scheduled' | 'in_progress' | 'completed' | 'postponed';
}

export interface NFLGame {
  id: string;
  home_team: string;
  away_team: string;
  game_date: Date;
  start_time: Date;
  status: 'scheduled' | 'in_progress' | 'completed' | 'postponed';
}

export interface BetDetails {
  initiator_id: string;
  initiator_name?: string;
  opponent_id: string;
  opponent_name?: string;
  initiator_team: string;
  opponent_team: string;
  game_date: Date;
  stakes?: string;
}
