import { NFLGame } from '../types/bet';

/**
 * NFL team name mappings for normalization
 * Maps common nicknames and variations to official team names
 */
const NFL_TEAM_MAPPINGS: { [key: string]: string } = {
  // AFC East
  'bills': 'Buffalo Bills',
  'buffalo': 'Buffalo Bills',
  'buffalo bills': 'Buffalo Bills',

  'dolphins': 'Miami Dolphins',
  'miami': 'Miami Dolphins',
  'miami dolphins': 'Miami Dolphins',
  'phins': 'Miami Dolphins',

  'patriots': 'New England Patriots',
  'pats': 'New England Patriots',
  'new england': 'New England Patriots',
  'new england patriots': 'New England Patriots',

  'jets': 'New York Jets',
  'ny jets': 'New York Jets',
  'new york jets': 'New York Jets',

  // AFC North
  'ravens': 'Baltimore Ravens',
  'baltimore': 'Baltimore Ravens',
  'baltimore ravens': 'Baltimore Ravens',

  'bengals': 'Cincinnati Bengals',
  'cincinnati': 'Cincinnati Bengals',
  'cincinnati bengals': 'Cincinnati Bengals',

  'browns': 'Cleveland Browns',
  'cleveland': 'Cleveland Browns',
  'cleveland browns': 'Cleveland Browns',

  'steelers': 'Pittsburgh Steelers',
  'pittsburgh': 'Pittsburgh Steelers',
  'pittsburgh steelers': 'Pittsburgh Steelers',

  // AFC South
  'texans': 'Houston Texans',
  'houston': 'Houston Texans',
  'houston texans': 'Houston Texans',

  'colts': 'Indianapolis Colts',
  'indianapolis': 'Indianapolis Colts',
  'indianapolis colts': 'Indianapolis Colts',
  'indy': 'Indianapolis Colts',

  'jaguars': 'Jacksonville Jaguars',
  'jags': 'Jacksonville Jaguars',
  'jacksonville': 'Jacksonville Jaguars',
  'jacksonville jaguars': 'Jacksonville Jaguars',

  'titans': 'Tennessee Titans',
  'tennessee': 'Tennessee Titans',
  'tennessee titans': 'Tennessee Titans',

  // AFC West
  'broncos': 'Denver Broncos',
  'denver': 'Denver Broncos',
  'denver broncos': 'Denver Broncos',

  'chiefs': 'Kansas City Chiefs',
  'kc': 'Kansas City Chiefs',
  'kansas city': 'Kansas City Chiefs',
  'kansas city chiefs': 'Kansas City Chiefs',

  'raiders': 'Las Vegas Raiders',
  'vegas': 'Las Vegas Raiders',
  'las vegas': 'Las Vegas Raiders',
  'las vegas raiders': 'Las Vegas Raiders',
  'lv raiders': 'Las Vegas Raiders',

  'chargers': 'Los Angeles Chargers',
  'la chargers': 'Los Angeles Chargers',
  'l.a. chargers': 'Los Angeles Chargers',
  'los angeles chargers': 'Los Angeles Chargers',
  'bolts': 'Los Angeles Chargers',

  // NFC East
  'cowboys': 'Dallas Cowboys',
  'dallas': 'Dallas Cowboys',
  'dallas cowboys': 'Dallas Cowboys',

  'giants': 'New York Giants',
  'ny giants': 'New York Giants',
  'new york giants': 'New York Giants',

  'eagles': 'Philadelphia Eagles',
  'philly': 'Philadelphia Eagles',
  'philadelphia': 'Philadelphia Eagles',
  'philadelphia eagles': 'Philadelphia Eagles',

  'commanders': 'Washington Commanders',
  'washington': 'Washington Commanders',
  'washington commanders': 'Washington Commanders',

  // NFC North
  'bears': 'Chicago Bears',
  'chicago': 'Chicago Bears',
  'chicago bears': 'Chicago Bears',

  'lions': 'Detroit Lions',
  'detroit': 'Detroit Lions',
  'detroit lions': 'Detroit Lions',

  'packers': 'Green Bay Packers',
  'gb': 'Green Bay Packers',
  'green bay': 'Green Bay Packers',
  'green bay packers': 'Green Bay Packers',
  'pack': 'Green Bay Packers',

  'vikings': 'Minnesota Vikings',
  'minnesota': 'Minnesota Vikings',
  'minnesota vikings': 'Minnesota Vikings',
  'vikes': 'Minnesota Vikings',

  // NFC South
  'falcons': 'Atlanta Falcons',
  'atlanta': 'Atlanta Falcons',
  'atlanta falcons': 'Atlanta Falcons',

  'panthers': 'Carolina Panthers',
  'carolina': 'Carolina Panthers',
  'carolina panthers': 'Carolina Panthers',

  'saints': 'New Orleans Saints',
  'new orleans': 'New Orleans Saints',
  'new orleans saints': 'New Orleans Saints',
  'nola': 'New Orleans Saints',

  'buccaneers': 'Tampa Bay Buccaneers',
  'bucs': 'Tampa Bay Buccaneers',
  'tampa': 'Tampa Bay Buccaneers',
  'tampa bay': 'Tampa Bay Buccaneers',
  'tampa bay buccaneers': 'Tampa Bay Buccaneers',

  // NFC West
  'cardinals': 'Arizona Cardinals',
  'arizona': 'Arizona Cardinals',
  'arizona cardinals': 'Arizona Cardinals',
  'cards': 'Arizona Cardinals',

  'rams': 'Los Angeles Rams',
  'la rams': 'Los Angeles Rams',
  'l.a. rams': 'Los Angeles Rams',
  'los angeles rams': 'Los Angeles Rams',

  '49ers': 'San Francisco 49ers',
  'niners': 'San Francisco 49ers',
  'san francisco': 'San Francisco 49ers',
  'san francisco 49ers': 'San Francisco 49ers',
  'sf': 'San Francisco 49ers',

  'seahawks': 'Seattle Seahawks',
  'seattle': 'Seattle Seahawks',
  'seattle seahawks': 'Seattle Seahawks',
  'hawks': 'Seattle Seahawks',
};

/**
 * Normalize team name to official NFL team name
 * @param teamName - User-provided team name (e.g., "Chiefs", "49ers")
 * @returns Normalized team name or null if not found
 */
export function normalizeNFLTeamName(teamName: string): string | null {
  const normalized = teamName.toLowerCase().trim();
  return NFL_TEAM_MAPPINGS[normalized] || null;
}

/**
 * Get today's NFL games from ESPN API
 * @param date - Date to get games for
 * @returns Array of games
 */
export async function getTodaysNFLGames(date: Date): Promise<NFLGame[]> {
  try {
    // Format date as YYYYMMDD for ESPN API
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}${month}${day}`;

    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateString}`;

    console.log(`📡 Fetching NFL games from ESPN API: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`ESPN API returned status ${response.status}`);
      return [];
    }

    const data: any = await response.json();

    if (!data.events || data.events.length === 0) {
      console.log('No NFL games found for this date');
      return [];
    }

    const games: NFLGame[] = data.events.map((event: any) => {
      const competition = event.competitions[0];
      const homeTeam = competition.competitors.find((c: any) => c.homeAway === 'home');
      const awayTeam = competition.competitors.find((c: any) => c.homeAway === 'away');

      return {
        id: event.id,
        home_team: homeTeam.team.displayName,
        away_team: awayTeam.team.displayName,
        game_date: new Date(event.date),
        start_time: new Date(event.date),
        status: event.status.type.completed ? 'completed' :
                event.status.type.state === 'in' ? 'in_progress' : 'scheduled'
      };
    });

    console.log(`✅ Found ${games.length} NFL games`);
    return games;
  } catch (error) {
    console.error('Error fetching NFL games from ESPN API:', error);
    return [];
  }
}

/**
 * Find a game for a specific NFL team on a date
 * @param teamName - Team name (will be normalized)
 * @param date - Date to search
 * @returns Game if found, null otherwise
 */
export async function findGameForNFLTeam(
  teamName: string,
  date: Date
): Promise<NFLGame | null> {
  const normalizedTeam = normalizeNFLTeamName(teamName);

  if (!normalizedTeam) {
    console.log(`❌ Team "${teamName}" not recognized as NFL team`);
    return null;
  }

  const games = await getTodaysNFLGames(date);

  // Find a game where this team is playing
  const game = games.find(g =>
    normalizeNFLTeamName(g.home_team) === normalizedTeam ||
    normalizeNFLTeamName(g.away_team) === normalizedTeam
  );

  if (game) {
    console.log(`🏈 Found game: ${game.away_team} @ ${game.home_team} at ${game.start_time.toLocaleTimeString()}`);
  } else {
    console.log(`❌ No game found for ${normalizedTeam} on ${date.toDateString()}`);
  }

  return game || null;
}

/**
 * Find the next upcoming game for an NFL team (searches up to 14 days ahead)
 * @param teamName - Team name (will be normalized)
 * @returns Next game if found, null otherwise
 */
export async function findNextNFLGame(teamName: string): Promise<NFLGame | null> {
  const normalizedTeam = normalizeNFLTeamName(teamName);

  if (!normalizedTeam) {
    console.log(`❌ Team "${teamName}" not recognized as NFL team`);
    return null;
  }

  // Search the next 14 days for this team's next game
  const today = new Date();

  for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
    const searchDate = new Date(today);
    searchDate.setDate(today.getDate() + daysAhead);

    const game = await findGameForNFLTeam(teamName, searchDate);

    if (game) {
      // Check if game hasn't started yet (or if in testing mode, any game is ok)
      const now = new Date();
      const isTestingMode = process.env.TESTING_MODE === 'true';

      if (game.start_time > now || isTestingMode) {
        console.log(`🏈 Found next NFL game for ${normalizedTeam} on ${game.start_time.toDateString()}`);
        return game;
      }
    }
  }

  console.log(`❌ No upcoming NFL game found for ${normalizedTeam} in the next 14 days`);
  return null;
}

/**
 * Get the opponent team from a matchup
 * @param game - NFL game object
 * @param userTeam - The team the user is betting on
 * @returns The opponent team name
 */
export function getOpponentTeam(game: NFLGame, userTeam: string): string {
  const normalizedUserTeam = normalizeNFLTeamName(userTeam);

  if (normalizeNFLTeamName(game.home_team) === normalizedUserTeam) {
    return game.away_team;
  } else {
    return game.home_team;
  }
}
