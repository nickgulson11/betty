import { TournamentRound } from '../types/pool';

export type GameStatus = 'final' | 'in_progress' | 'scheduled';

export interface TournamentGame {
  id: string;
  homeTeam: string;   // ESPN displayName e.g. "Auburn Tigers"
  awayTeam: string;
  winner: string | null;  // displayName of winner, null if not final
  loser: string | null;   // displayName of loser, null if not final
  round: TournamentRound | null;  // mapped to our DB enum, null if unrecognized
  roundRaw: string;               // raw ESPN string for logging
  status: GameStatus;
}

const ESPN_BASE_URL =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100';

/**
 * Build today's ESPN URL with an explicit date — prevents the API from
 * returning historical tournament games when no games are scheduled today.
 */
function getTodayUrl(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${ESPN_BASE_URL}&dates=${year}${month}${day}`;
}

// Map ESPN round label (from notes headline) → our TournamentRound enum
const ROUND_MAP: Record<string, TournamentRound> = {
  '1st Round': 'Round of 64',
  'First Round': 'Round of 64',
  '2nd Round': 'Round of 32',
  'Second Round': 'Round of 32',
  'Sweet 16': 'Sweet Sixteen',
  'Sweet Sixteen': 'Sweet Sixteen',
  'Elite Eight': 'Elite Eight',
  'Elite 8': 'Elite Eight',
  'Final Four': 'Final Four',
  'Championship': 'Championship',
  'National Championship': 'Championship',
};

/**
 * Parse round from ESPN notes headline.
 * Example: "Men's Basketball Championship - South Region - 2nd Round"
 * Returns the last segment after splitting on " - "
 */
function parseRound(headline: string): { round: TournamentRound | null; roundRaw: string } {
  const parts = headline.split(' - ');
  const lastPart = parts[parts.length - 1].trim();

  // Direct match
  if (ROUND_MAP[lastPart]) {
    return { round: ROUND_MAP[lastPart], roundRaw: lastPart };
  }

  // Partial match (handles variations)
  for (const [key, value] of Object.entries(ROUND_MAP)) {
    if (lastPart.toLowerCase().includes(key.toLowerCase())) {
      return { round: value, roundRaw: lastPart };
    }
  }

  return { round: null, roundRaw: lastPart };
}

function parseStatus(statusName: string): GameStatus {
  if (
    statusName === 'STATUS_FINAL' ||
    statusName === 'STATUS_FINAL_OT' ||
    statusName === 'STATUS_FINAL_2OT'
  ) {
    return 'final';
  }
  if (
    statusName === 'STATUS_IN_PROGRESS' ||
    statusName === 'STATUS_HALFTIME' ||
    statusName === 'STATUS_END_PERIOD'
  ) {
    return 'in_progress';
  }
  return 'scheduled';
}

/**
 * Fetch today's NCAA tournament games from ESPN.
 * Returns all statuses (final, in_progress, scheduled) — caller decides what to process.
 * Never throws — returns [] on any error so the scheduler cannot crash.
 */
export async function fetchTodaysGames(): Promise<TournamentGame[]> {
  try {
    const response = await fetch(getTodayUrl());

    if (!response.ok) {
      console.error(`[ncaaService] ESPN API returned HTTP ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const events: any[] = data.events || [];
    const games: TournamentGame[] = [];

    for (const event of events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      // Only tournament games
      if (competition.type?.abbreviation !== 'TRNMNT') continue;

      const statusName: string = competition.status?.type?.name || '';
      const status = parseStatus(statusName);

      const notesHeadline: string = competition.notes?.[0]?.headline || '';
      const { round, roundRaw } = notesHeadline
        ? parseRound(notesHeadline)
        : { round: null, roundRaw: 'Unknown' };

      const competitors: any[] = competition.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === 'home') ?? competitors[0];
      const away = competitors.find((c: any) => c.homeAway === 'away') ?? competitors[1];

      if (!home || !away) continue;

      const homeTeam: string = home.team?.displayName || '';
      const awayTeam: string = away.team?.displayName || '';

      let winner: string | null = null;
      let loser: string | null = null;

      if (status === 'final') {
        const winnerComp = competitors.find((c: any) => c.winner === true);
        const loserComp = competitors.find((c: any) => c.winner === false);
        winner = winnerComp?.team?.displayName ?? null;
        loser = loserComp?.team?.displayName ?? null;
      }

      games.push({
        id: competition.id || event.id,
        homeTeam,
        awayTeam,
        winner,
        loser,
        round,
        roundRaw,
        status,
      });
    }

    console.log(`[ncaaService] Fetched ${games.length} tournament game(s) today`);
    return games;
  } catch (error) {
    console.error('[ncaaService] Error fetching ESPN scoreboard:', error);
    return [];
  }
}
