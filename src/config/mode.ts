/**
 * Betty Mode Configuration
 *
 * Controls which version of Betty is running:
 * - 'betting': Original NBA/NFL betting bot (legacy)
 * - 'march_madness': March Madness survivor pool (new)
 */

export type BettyMode = 'betting' | 'march_madness';

/**
 * Get the current Betty mode from environment variable
 * Defaults to 'march_madness' if not set or invalid
 */
export function getMode(): BettyMode {
  const mode = process.env.BETTY_MODE?.toLowerCase().trim();

  if (mode === 'betting' || mode === 'march_madness') {
    return mode as BettyMode;
  }

  console.warn(`⚠️  Invalid BETTY_MODE: "${mode}". Defaulting to march_madness.`);
  return 'march_madness';
}

/**
 * Check if running in betting mode
 */
export function isBettingMode(): boolean {
  return getMode() === 'betting';
}

/**
 * Check if running in March Madness mode
 */
export function isMarchMadnessMode(): boolean {
  return getMode() === 'march_madness';
}

/**
 * Get mode display name
 */
export function getModeName(): string {
  const mode = getMode();
  return mode === 'betting' ? 'NBA/NFL Betting Bot' : 'March Madness Pool';
}
