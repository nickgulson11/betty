import { PlayoffsSeries, SeriesResult } from '../types/nbaPlayoffs';
import { getPool } from '../models/pool';

/**
 * ESPN NBA Playoffs API endpoint
 * Returns playoff bracket with series information
 */
const ESPN_NBA_PLAYOFFS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

/**
 * Get current date for ESPN API (respects pool override_date)
 */
async function getTodayUrl(poolId: string): Promise<string> {
  const pool = await getPool(poolId);

  let targetDate: Date;
  if (pool?.override_date) {
    targetDate = new Date(pool.override_date);
  } else {
    targetDate = new Date();
  }

  const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
  return `${ESPN_NBA_PLAYOFFS_URL}?dates=${dateStr}&seasontype=3`; // seasontype=3 is playoffs
}

/**
 * Map ESPN round name to our standard round names
 * ESPN: "East Semifinals - Game 3" or "West Finals - Game 7"
 * Our names: "First Round", "Conference Semifinals", "Conference Finals", "NBA Finals"
 */
function mapRoundName(espnRound: string): string {
  if (!espnRound) return 'Unknown';

  const lower = espnRound.toLowerCase();

  // Check for Finals variations
  if (lower.includes('nba finals') || lower === 'finals') {
    return 'NBA Finals';
  }
  if (lower.includes('conference finals') || (lower.includes('finals') && (lower.includes('east') || lower.includes('west')))) {
    return 'Conference Finals';
  }

  // Check for Semifinals
  if (lower.includes('semifinals') || lower.includes('semis')) {
    return 'Conference Semifinals';
  }

  // Check for First Round
  if (lower.includes('first round') || lower.includes('1st round') || lower.includes('round 1')) {
    return 'First Round';
  }

  // Default - return as-is if we can't map it
  console.warn(`[nbaPlayoffsService] Unable to map ESPN round name: "${espnRound}"`);
  return espnRound;
}

/**
 * Fetch playoff series data from ESPN API
 * Returns all series with current win counts
 */
export async function fetchPlayoffsSeries(poolId: string): Promise<PlayoffsSeries[]> {
  try {
    const url = await getTodayUrl(poolId);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`ESPN API error: ${response.status}`);
      return [];
    }

    const data: any = await response.json();

    if (!data.events || data.events.length === 0) {
      return [];
    }

    const seriesMap = new Map<string, PlayoffsSeries>();

    for (const event of data.events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const seriesData = competition.series;
      if (!seriesData) continue; // Not a playoff game

      // Use series summary as unique ID (e.g., "DEN leads series 2-1")
      const seriesId = seriesData.summary || event.id;

      // Map team IDs to names from competitors array
      const teamMap = new Map<string, string>();
      for (const competitor of competition.competitors) {
        teamMap.set(competitor.id, competitor.team.displayName);
      }

      // Get team names and wins from series.competitors
      const seriesCompetitors = seriesData.competitors || [];
      if (seriesCompetitors.length < 2) continue;

      const team1Id = seriesCompetitors[0].id;
      const team2Id = seriesCompetitors[1].id;
      const team1 = teamMap.get(team1Id) || 'Unknown';
      const team2 = teamMap.get(team2Id) || 'Unknown';
      const team1Wins = seriesCompetitors[0].wins || 0;
      const team2Wins = seriesCompetitors[1].wins || 0;

      // Get round name from notes
      const roundHeadline = competition.notes?.[0]?.headline || '';
      const round = mapRoundName(roundHeadline);

      let status: 'scheduled' | 'in_progress' | 'completed' = 'scheduled';
      let winner: string | undefined;
      let loser: string | undefined;

      // Series is completed when series.completed === true OR one team has 4 wins
      if (seriesData.completed || team1Wins === 4 || team2Wins === 4) {
        status = 'completed';
        if (team1Wins === 4) {
          winner = team1;
          loser = team2;
        } else if (team2Wins === 4) {
          winner = team2;
          loser = team1;
        }
      } else if (team1Wins > 0 || team2Wins > 0) {
        status = 'in_progress';
      }

      // Store in map (will overwrite if same series appears in multiple games on same day)
      seriesMap.set(seriesId, {
        seriesId,
        round,
        team1,
        team2,
        team1Wins,
        team2Wins,
        status,
        winner,
        loser,
      });
    }

    return Array.from(seriesMap.values());
  } catch (error) {
    console.error('Error fetching NBA Playoffs series:', error);
    return [];
  }
}

/**
 * Get completed series (teams that lost 4 games and are eliminated)
 */
export async function getCompletedSeries(poolId: string): Promise<SeriesResult[]> {
  const allSeries = await fetchPlayoffsSeries(poolId);

  return allSeries
    .filter((series) => series.status === 'completed' && series.loser)
    .map((series) => ({
      losingTeam: series.loser!,
      winningTeam: series.winner!,
      finalRecord: `${Math.max(series.team1Wins, series.team2Wins)}-${Math.min(series.team1Wins, series.team2Wins)}`,
      round: series.round,
    }));
}

/**
 * Check if any playoff games have started (for pick deadline enforcement)
 * A round has started if any game in that round is no longer scheduled
 */
export async function hasRoundStarted(poolId: string, round: string): Promise<boolean> {
  try {
    const url = await getTodayUrl(poolId);
    const response = await fetch(url);

    if (!response.ok) {
      return false;
    }

    const data: any = await response.json();

    if (!data.events || data.events.length === 0) {
      return false;
    }

    // Check if any game in this round has started
    for (const event of data.events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const seriesData = competition.series;
      if (!seriesData) continue; // Not a playoff game

      // Get round name from notes
      const roundHeadline = competition.notes?.[0]?.headline || '';
      const eventRound = mapRoundName(roundHeadline);

      // Check game status
      const status = competition.status?.type?.name;

      // If round matches and game is not "STATUS_SCHEDULED", games have started
      if (eventRound === round && status !== 'STATUS_SCHEDULED') {
        console.log(`[nbaPlayoffsService] Round "${round}" has started (game status: ${status})`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking if round started:', error);
    return false;
  }
}
