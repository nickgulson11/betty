/**
 * NBA Playoffs series data from ESPN API
 */
export interface PlayoffsSeries {
  seriesId: string;
  round: string;
  team1: string;
  team2: string;
  team1Wins: number;
  team2Wins: number;
  status: 'scheduled' | 'in_progress' | 'completed';
  winner?: string;
  loser?: string;
}

/**
 * Processed series result for elimination
 */
export interface SeriesResult {
  losingTeam: string;
  winningTeam: string;
  finalRecord: string; // e.g., "4-2"
  round: string;
}
