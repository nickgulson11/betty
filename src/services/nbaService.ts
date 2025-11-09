import { NBAGame } from '../types/bet';

/**
 * NBA team name mappings for normalization
 * Maps common nicknames and variations to official team names
 */
const TEAM_MAPPINGS: { [key: string]: string } = {
  // Lakers
  'lakers': 'Los Angeles Lakers',
  'la lakers': 'Los Angeles Lakers',
  'l.a. lakers': 'Los Angeles Lakers',
  'los angeles lakers': 'Los Angeles Lakers',

  // Clippers
  'clippers': 'Los Angeles Clippers',
  'la clippers': 'Los Angeles Clippers',
  'l.a. clippers': 'Los Angeles Clippers',
  'los angeles clippers': 'Los Angeles Clippers',

  // Warriors
  'warriors': 'Golden State Warriors',
  'golden state': 'Golden State Warriors',
  'golden state warriors': 'Golden State Warriors',
  'gsw': 'Golden State Warriors',
  'dubs': 'Golden State Warriors',

  // Celtics
  'celtics': 'Boston Celtics',
  'boston': 'Boston Celtics',
  'boston celtics': 'Boston Celtics',
  'c\'s': 'Boston Celtics',

  // Heat
  'heat': 'Miami Heat',
  'miami': 'Miami Heat',
  'miami heat': 'Miami Heat',

  // Bucks
  'bucks': 'Milwaukee Bucks',
  'milwaukee': 'Milwaukee Bucks',
  'milwaukee bucks': 'Milwaukee Bucks',

  // Nets
  'nets': 'Brooklyn Nets',
  'brooklyn': 'Brooklyn Nets',
  'brooklyn nets': 'Brooklyn Nets',

  // Knicks
  'knicks': 'New York Knicks',
  'new york': 'New York Knicks',
  'new york knicks': 'New York Knicks',
  'ny knicks': 'New York Knicks',

  // 76ers
  '76ers': 'Philadelphia 76ers',
  'sixers': 'Philadelphia 76ers',
  'philadelphia': 'Philadelphia 76ers',
  'philadelphia 76ers': 'Philadelphia 76ers',
  'philly': 'Philadelphia 76ers',

  // Raptors
  'raptors': 'Toronto Raptors',
  'toronto': 'Toronto Raptors',
  'toronto raptors': 'Toronto Raptors',

  // Bulls
  'bulls': 'Chicago Bulls',
  'chicago': 'Chicago Bulls',
  'chicago bulls': 'Chicago Bulls',

  // Cavaliers
  'cavaliers': 'Cleveland Cavaliers',
  'cavs': 'Cleveland Cavaliers',
  'cleveland': 'Cleveland Cavaliers',
  'cleveland cavaliers': 'Cleveland Cavaliers',

  // Pistons
  'pistons': 'Detroit Pistons',
  'detroit': 'Detroit Pistons',
  'detroit pistons': 'Detroit Pistons',

  // Pacers
  'pacers': 'Indiana Pacers',
  'indiana': 'Indiana Pacers',
  'indiana pacers': 'Indiana Pacers',

  // Hornets
  'hornets': 'Charlotte Hornets',
  'charlotte': 'Charlotte Hornets',
  'charlotte hornets': 'Charlotte Hornets',

  // Hawks
  'hawks': 'Atlanta Hawks',
  'atlanta': 'Atlanta Hawks',
  'atlanta hawks': 'Atlanta Hawks',

  // Wizards
  'wizards': 'Washington Wizards',
  'washington': 'Washington Wizards',
  'washington wizards': 'Washington Wizards',

  // Magic
  'magic': 'Orlando Magic',
  'orlando': 'Orlando Magic',
  'orlando magic': 'Orlando Magic',

  // Mavericks
  'mavericks': 'Dallas Mavericks',
  'mavs': 'Dallas Mavericks',
  'dallas': 'Dallas Mavericks',
  'dallas mavericks': 'Dallas Mavericks',

  // Rockets
  'rockets': 'Houston Rockets',
  'houston': 'Houston Rockets',
  'houston rockets': 'Houston Rockets',

  // Grizzlies
  'grizzlies': 'Memphis Grizzlies',
  'memphis': 'Memphis Grizzlies',
  'memphis grizzlies': 'Memphis Grizzlies',

  // Pelicans
  'pelicans': 'New Orleans Pelicans',
  'new orleans': 'New Orleans Pelicans',
  'new orleans pelicans': 'New Orleans Pelicans',
  'nola': 'New Orleans Pelicans',

  // Spurs
  'spurs': 'San Antonio Spurs',
  'san antonio': 'San Antonio Spurs',
  'san antonio spurs': 'San Antonio Spurs',

  // Thunder
  'thunder': 'Oklahoma City Thunder',
  'okc': 'Oklahoma City Thunder',
  'oklahoma city': 'Oklahoma City Thunder',
  'oklahoma city thunder': 'Oklahoma City Thunder',

  // Timberwolves
  'timberwolves': 'Minnesota Timberwolves',
  'wolves': 'Minnesota Timberwolves',
  'twolves': 'Minnesota Timberwolves',
  'minnesota': 'Minnesota Timberwolves',
  'minnesota timberwolves': 'Minnesota Timberwolves',

  // Nuggets
  'nuggets': 'Denver Nuggets',
  'denver': 'Denver Nuggets',
  'denver nuggets': 'Denver Nuggets',

  // Trail Blazers
  'trail blazers': 'Portland Trail Blazers',
  'blazers': 'Portland Trail Blazers',
  'portland': 'Portland Trail Blazers',
  'portland trail blazers': 'Portland Trail Blazers',

  // Jazz
  'jazz': 'Utah Jazz',
  'utah': 'Utah Jazz',
  'utah jazz': 'Utah Jazz',

  // Suns
  'suns': 'Phoenix Suns',
  'phoenix': 'Phoenix Suns',
  'phoenix suns': 'Phoenix Suns',

  // Kings
  'kings': 'Sacramento Kings',
  'sacramento': 'Sacramento Kings',
  'sacramento kings': 'Sacramento Kings',
};

/**
 * Normalize team name to official NBA team name
 * @param teamName - User-provided team name (e.g., "Lakers", "Warriors")
 * @returns Normalized team name or original if not found
 */
export function normalizeTeamName(teamName: string): string {
  const normalized = teamName.toLowerCase().trim();
  return TEAM_MAPPINGS[normalized] || teamName;
}

/**
 * Validate that a team exists and is playing on a given date
 * @param teamName - Team name to validate
 * @param _timing - When the game is ("tonight", "tomorrow", date string) - reserved for Phase 5
 * @returns Validation result with game info if found
 */
export async function validateTeamAndGame(
  teamName: string,
  _timing: string
): Promise<{
  valid: boolean;
  error?: string;
  game?: NBAGame;
  normalizedTeam?: string;
}> {
  // Normalize the team name
  const normalizedTeam = normalizeTeamName(teamName);

  // For now, we'll return a simple validation
  // In a full implementation, this would call ESPN API or NBA Stats API
  // For Phase 3, we'll use a simplified approach

  // Check if team name is recognized
  if (normalizedTeam === teamName && !isOfficialTeamName(teamName)) {
    return {
      valid: false,
      error: `I don't recognize the team "${teamName}". Could you use the full team name or common nickname? (e.g., "Lakers", "Warriors", "Celtics")`
    };
  }

  // For now, assume the game exists
  // TODO: Implement actual API calls to verify games
  return {
    valid: true,
    normalizedTeam,
    game: {
      id: 'mock-game-id',
      home_team: normalizedTeam,
      away_team: 'TBD', // Would be determined by actual API
      game_date: new Date(),
      start_time: new Date(),
      status: 'scheduled'
    }
  };
}

/**
 * Check if a team name is an official NBA team name
 * @param teamName - Team name to check
 * @returns true if official team name
 */
function isOfficialTeamName(teamName: string): boolean {
  const officialNames = [
    'Los Angeles Lakers', 'Los Angeles Clippers', 'Golden State Warriors',
    'Boston Celtics', 'Miami Heat', 'Milwaukee Bucks', 'Brooklyn Nets',
    'New York Knicks', 'Philadelphia 76ers', 'Toronto Raptors',
    'Chicago Bulls', 'Cleveland Cavaliers', 'Detroit Pistons',
    'Indiana Pacers', 'Charlotte Hornets', 'Atlanta Hawks',
    'Washington Wizards', 'Orlando Magic', 'Dallas Mavericks',
    'Houston Rockets', 'Memphis Grizzlies', 'New Orleans Pelicans',
    'San Antonio Spurs', 'Oklahoma City Thunder', 'Minnesota Timberwolves',
    'Denver Nuggets', 'Portland Trail Blazers', 'Utah Jazz',
    'Phoenix Suns', 'Sacramento Kings'
  ];

  return officialNames.includes(teamName);
}

/**
 * Get the opponent team from a matchup
 * @param game - NBA game object
 * @param userTeam - The team the user is betting on
 * @returns The opponent team name
 */
export function getOpponentTeam(game: NBAGame, userTeam: string): string {
  const normalizedUserTeam = normalizeTeamName(userTeam);

  if (normalizeTeamName(game.home_team) === normalizedUserTeam) {
    return game.away_team;
  } else {
    return game.home_team;
  }
}

/**
 * Find a game between two specific teams
 * @param team1 - First team name
 * @param team2 - Second team name
 * @param date - Date to search for
 * @returns Game if found, null otherwise
 */
export async function findGameBetweenTeams(
  team1: string,
  team2: string,
  date: Date
): Promise<NBAGame | null> {
  // TODO: Implement actual API call
  // For now, return a mock game
  const normalizedTeam1 = normalizeTeamName(team1);
  const normalizedTeam2 = normalizeTeamName(team2);

  return {
    id: 'mock-game-id',
    home_team: normalizedTeam1,
    away_team: normalizedTeam2,
    game_date: date,
    start_time: date,
    status: 'scheduled'
  };
}

/**
 * Get today's NBA games from ESPN API
 * @param date - Date to get games for
 * @returns Array of games
 */
export async function getTodaysGames(date: Date): Promise<NBAGame[]> {
  try {
    // Format date as YYYYMMDD for ESPN API
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}${month}${day}`;

    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateString}`;

    console.log(`📡 Fetching NBA games from ESPN API: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`ESPN API returned status ${response.status}`);
      return [];
    }

    const data: any = await response.json();

    if (!data.events || data.events.length === 0) {
      console.log('No NBA games found for this date');
      return [];
    }

    const games: NBAGame[] = data.events.map((event: any) => {
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

    console.log(`✅ Found ${games.length} NBA games`);
    return games;
  } catch (error) {
    console.error('Error fetching games from ESPN API:', error);
    return [];
  }
}

/**
 * Find a game for a specific team on a date
 * @param teamName - Team name (will be normalized)
 * @param date - Date to search
 * @returns Game if found, null otherwise
 */
export async function findGameForTeam(
  teamName: string,
  date: Date
): Promise<NBAGame | null> {
  const normalizedTeam = normalizeTeamName(teamName);
  const games = await getTodaysGames(date);

  // Find a game where this team is playing
  const game = games.find(g =>
    normalizeTeamName(g.home_team) === normalizedTeam ||
    normalizeTeamName(g.away_team) === normalizedTeam
  );

  if (game) {
    console.log(`🏀 Found game: ${game.away_team} @ ${game.home_team} at ${game.start_time.toLocaleTimeString()}`);
  } else {
    console.log(`❌ No game found for ${normalizedTeam} on ${date.toDateString()}`);
  }

  return game || null;
}
