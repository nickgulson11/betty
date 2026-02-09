import { TournamentRound } from './pool';

export type PickResult = 'won' | 'lost' | 'pending';

export interface Pick {
  id: string;
  participant_id: string;
  pool_id: string;
  round: TournamentRound;
  team_name: string;
  result: PickResult | null;
  submitted_at: Date;
  updated_at: Date;
}

export interface CreatePickInput {
  participant_id: string;
  pool_id: string;
  round: TournamentRound;
  team_name: string;
}

export interface UpdatePickInput {
  team_name?: string;
  result?: PickResult;
}
