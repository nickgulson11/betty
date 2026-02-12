export type TeamStatus = 'active' | 'eliminated';

export interface TournamentTeam {
  id: string;
  pool_id: string;
  team_name: string;
  seed: number | null;
  region: string | null; // East, West, South, Midwest
  status: TeamStatus;
  eliminated_round: string | null;
  created_at: Date;
}

export interface CreateTeamInput {
  team_name: string;
  seed?: number;
  region?: string;
}

export interface BulkImportInput {
  teams: CreateTeamInput[];
}

export interface UpdateTeamInput {
  team_name?: string;
  seed?: number | null;
  region?: string | null;
}
