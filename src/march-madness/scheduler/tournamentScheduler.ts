import { schedule, ScheduledTask } from 'node-cron';
import { fetchTodaysGames } from '../services/ncaaService';
import { processGames } from '../services/resultsProcessor';

// Track last sync time for admin UI display
let lastSyncTime: Date | null = null;
let schedulerTask: ScheduledTask | null = null;

/**
 * Get the timestamp of the last successful sync (for admin UI).
 */
export function getLastSyncTime(): Date | null {
  return lastSyncTime;
}

/**
 * Run a single poll cycle: fetch today's games and process results.
 * Called by the cron job and by the manual Force Sync endpoint.
 */
export async function runSyncCycle(): Promise<void> {
  console.log('[tournamentScheduler] Running ESPN sync cycle...');
  try {
    const games = await fetchTodaysGames();
    await processGames(games);
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

  console.log('[tournamentScheduler] Scheduler started');
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
}
