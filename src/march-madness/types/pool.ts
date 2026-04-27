export type TournamentType = 'march_madness' | 'nba_playoffs';

export type PoolStatus = 'setup' | 'active' | 'completed';

export type TournamentRound =
  // March Madness
  | 'Round of 64'
  | 'Round of 32'
  | 'Sweet Sixteen'
  | 'Elite Eight'
  | 'Final Four'
  | 'Championship'
  // NBA Playoffs
  | 'First Round'
  | 'Conference Semifinals'
  | 'Conference Finals'
  | 'NBA Finals';

export interface Pool {
  id: string;
  name: string;
  sport: string;
  tournament_type: TournamentType;
  status: PoolStatus;
  current_round: TournamentRound | null;
  entry_fee: number | null;
  slack_channel_id: string;
  admin_slack_id: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  override_date: Date | null; // Testing only: manually set date for ESPN API
  current_round_locked: boolean; // TRUE when current round games started, picks locked
  allow_next_round_picks: boolean; // TRUE when admin enables accepting picks for next round while current in progress
}

export interface CreatePoolInput {
  name: string;
  sport?: string;
  tournament_type: TournamentType;
  entry_fee?: number;
  slack_channel_id: string;
  admin_slack_id: string;
}

export interface UpdatePoolInput {
  name?: string;
  status?: PoolStatus;
  tournament_type?: TournamentType;
  current_round?: TournamentRound | null;
  entry_fee?: number;
  override_date?: Date | null;
  current_round_locked?: boolean;
  allow_next_round_picks?: boolean;
}
