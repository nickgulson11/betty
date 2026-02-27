export type PoolStatus = 'setup' | 'active' | 'completed';

export type TournamentRound =
  | 'Round of 64'
  | 'Round of 32'
  | 'Sweet Sixteen'
  | 'Elite Eight'
  | 'Final Four'
  | 'Championship';

export interface Pool {
  id: string;
  name: string;
  sport: string;
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
}

export interface CreatePoolInput {
  name: string;
  sport?: string;
  entry_fee?: number;
  slack_channel_id: string;
  admin_slack_id: string;
}

export interface UpdatePoolInput {
  name?: string;
  status?: PoolStatus;
  current_round?: TournamentRound | null;
  entry_fee?: number;
  override_date?: Date | null;
  current_round_locked?: boolean;
}
