import { TournamentRound } from '../types/pool';

/**
 * NBA Playoffs rounds in order
 */
export const NBA_PLAYOFFS_ROUNDS: TournamentRound[] = [
  'First Round',
  'Conference Semifinals',
  'Conference Finals',
  'NBA Finals',
];

/**
 * Expected number of team eliminations per round in NBA Playoffs
 * First Round: 8 series = 8 teams eliminated
 * Conference Semifinals: 4 series = 4 teams eliminated
 * Conference Finals: 2 series = 2 teams eliminated
 * NBA Finals: 1 series = 1 team eliminated
 */
export const NBA_PLAYOFFS_ELIMINATION_COUNTS: Record<string, number> = {
  'First Round': 8,
  'Conference Semifinals': 4,
  'Conference Finals': 2,
  'NBA Finals': 1,
};

/**
 * Map current round to next round in NBA Playoffs
 */
export const NBA_PLAYOFFS_NEXT_ROUND: Record<string, TournamentRound | null> = {
  'First Round': 'Conference Semifinals',
  'Conference Semifinals': 'Conference Finals',
  'Conference Finals': 'NBA Finals',
  'NBA Finals': null, // Tournament complete
};

/**
 * Number of teams in NBA Playoffs
 */
export const NBA_PLAYOFFS_TEAM_COUNT = 16;
