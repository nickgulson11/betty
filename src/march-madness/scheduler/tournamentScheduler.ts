import { schedule, ScheduledTask } from 'node-cron';
import { fetchTodaysGames } from '../services/ncaaService';
import { processGames, processResults } from '../services/resultsProcessor';
import { getCurrentPool } from '../models/pool';

// Track last sync time for admin UI display
let lastSyncTime: Date | null = null;
let schedulerTask: ScheduledTask | null = null;
let keepAliveInterval: NodeJS.Timeout | null = null;

/**
 * Get the timestamp of the last successful sync (for admin UI).
 */
export function getLastSyncTime(): Date | null {
  return lastSyncTime;
}

/**
 * Run a single poll cycle: fetch today's games/series and process results.
 * Called by the cron job and by the manual Force Sync endpoint.
 * Routes to appropriate handler based on tournament type.
 */
export async function runSyncCycle(): Promise<void> {
  console.log('[tournamentScheduler] Running ESPN sync cycle...');
  try {
    const pool = await getCurrentPool();
    if (!pool) {
      console.log('[tournamentScheduler] No active pool found');
      return;
    }

    console.log(`[tournamentScheduler] Processing ${pool.tournament_type} tournament`);

    if (pool.tournament_type === 'nba_playoffs') {
      // NBA Playoffs: processResults handles fetching and processing series
      await processResults(pool.id);
    } else {
      // March Madness: fetch games first, then process
      const games = await fetchTodaysGames();
      await processGames(games);
    }

    lastSyncTime = new Date();
    console.log(`[tournamentScheduler] Sync complete at ${lastSyncTime.toISOString()}`);
  } catch (error) {
    console.error('[tournamentScheduler] Sync cycle error:', error);
    // Never rethrow — scheduler must not crash
  }
}

/**
 * Start the tournament scheduler.
 * Polls ESPN every 30 minutes.
 * Only intended to run when BETTY_MODE === 'march_madness'.
 */
export function startTournamentScheduler(): void {
  if (schedulerTask) {
    console.log('[tournamentScheduler] Already running — skipping start');
    return;
  }

  console.log('[tournamentScheduler] Starting — polling ESPN every 30 minutes');

  // Run every 30 minutes: minute 0 and minute 30 of every hour
  schedulerTask = schedule('0,30 * * * *', () => {
    runSyncCycle().catch((err) => {
      console.error('[tournamentScheduler] Unhandled error in sync cycle:', err);
    });
  });

  // Keep-alive ping to prevent Railway from sleeping the app
  // Ping our own health endpoint every 25 minutes to generate HTTP traffic
  const port = process.env.PORT || '3000';
  keepAliveInterval = setInterval(async () => {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) {
        console.log('[tournamentScheduler] Keep-alive ping successful');
      } else {
        console.warn('[tournamentScheduler] Keep-alive ping returned non-OK status:', response.status);
      }
    } catch (err) {
      console.error('[tournamentScheduler] Keep-alive ping failed:', err);
    }
  }, 25 * 60 * 1000); // Every 25 minutes

  console.log('[tournamentScheduler] Scheduler started with keep-alive ping every 25 minutes');
}

/**
 * Stop the tournament scheduler (for graceful shutdown).
 */
export function stopTournamentScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('[tournamentScheduler] Scheduler stopped');
  }

  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('[tournamentScheduler] Keep-alive ping stopped');
  }
}
