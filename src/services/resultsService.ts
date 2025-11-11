import { GameResult, Bet } from '../types/bet';
import { normalizeTeamName } from './nbaService';

/**
 * Check the result of a game using ESPN API
 * @param bet - The bet to check
 * @returns Game result with winner information
 */
export async function checkGameResult(bet: Bet): Promise<GameResult> {
  try {
    console.log(`🔍 Checking game result for ${bet.initiator_team} vs ${bet.opponent_team}`);

    // Format date for ESPN API (YYYYMMDD)
    // ESPN indexes games by Eastern Time, not UTC
    const gameDate = new Date(bet.game_date);

    // Convert to Eastern Time (America/New_York) to match ESPN's indexing
    const etDateString = gameDate.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    // Parse the ET date string (format: "MM/DD/YYYY, HH:MM:SS AM/PM")
    const [datePart] = etDateString.split(', ');
    const [month, day, year] = datePart.split('/');
    const dateString = `${year}${month}${day}`;

    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateString}`;

    console.log(`📡 Fetching game results from ESPN: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`ESPN API returned status ${response.status}`);
      return {
        status: 'not_found',
        is_final: false,
      };
    }

    const data: any = await response.json();

    if (!data.events || data.events.length === 0) {
      console.log('No games found for this date');
      return {
        status: 'not_found',
        is_final: false,
      };
    }

    // Normalize team names for comparison
    const normalizedInitiatorTeam = normalizeTeamName(bet.initiator_team);
    const normalizedOpponentTeam = normalizeTeamName(bet.opponent_team);

    // Find the game matching these two teams
    const gameEvent = data.events.find((event: any) => {
      const competition = event.competitions[0];
      const homeTeam = competition.competitors.find((c: any) => c.homeAway === 'home');
      const awayTeam = competition.competitors.find((c: any) => c.homeAway === 'away');

      const homeTeamName = normalizeTeamName(homeTeam.team.displayName);
      const awayTeamName = normalizeTeamName(awayTeam.team.displayName);

      const teamsMatch =
        (homeTeamName === normalizedInitiatorTeam && awayTeamName === normalizedOpponentTeam) ||
        (homeTeamName === normalizedOpponentTeam && awayTeamName === normalizedInitiatorTeam);

      return teamsMatch;
    });

    if (!gameEvent) {
      console.log(`Game not found for ${bet.initiator_team} vs ${bet.opponent_team}`);
      return {
        status: 'not_found',
        is_final: false,
      };
    }

    const competition = gameEvent.competitions[0];
    const status = gameEvent.status;

    // Check if game is completed
    if (!status.type.completed) {
      console.log(`Game is not completed yet (status: ${status.type.state})`);
      return {
        status: 'in_progress',
        is_final: false,
      };
    }

    // Check if game was postponed/cancelled
    if (status.type.name === 'STATUS_POSTPONED' || status.type.name === 'STATUS_CANCELED') {
      console.log('Game was postponed or cancelled');
      return {
        status: 'postponed',
        is_final: false,
      };
    }

    // Game is final - determine winner
    const homeTeam = competition.competitors.find((c: any) => c.homeAway === 'home');
    const awayTeam = competition.competitors.find((c: any) => c.homeAway === 'away');

    const homeScore = parseInt(homeTeam.score);
    const awayScore = parseInt(awayTeam.score);

    const homeTeamName = homeTeam.team.displayName;
    const awayTeamName = awayTeam.team.displayName;

    const finalScore = `${awayTeamName} ${awayScore} - ${homeScore} ${homeTeamName}`;

    let winner: string;
    let loser: string;

    if (homeScore > awayScore) {
      winner = homeTeamName;
      loser = awayTeamName;
    } else {
      winner = awayTeamName;
      loser = homeTeamName;
    }

    console.log(`✅ Game final: ${finalScore}`);
    console.log(`🏆 Winner: ${winner}`);

    return {
      status: 'completed',
      winner,
      loser,
      final_score: finalScore,
      is_final: true,
    };

  } catch (error) {
    console.error('Error checking game result:', error);
    return {
      status: 'not_found',
      is_final: false,
    };
  }
}

/**
 * Determine which user won the bet based on game result
 * @param bet - The bet
 * @param result - The game result
 * @returns Slack user ID of the winner, or null if tie/error
 */
export function determineWinner(bet: Bet, result: GameResult): string | null {
  if (!result.winner) {
    return null;
  }

  const normalizedWinner = normalizeTeamName(result.winner);
  const normalizedInitiatorTeam = normalizeTeamName(bet.initiator_team);

  // If initiator's team won, initiator wins the bet
  if (normalizedWinner === normalizedInitiatorTeam) {
    return bet.initiator_slack_id;
  } else {
    // Otherwise opponent wins
    return bet.opponent_slack_id;
  }
}
