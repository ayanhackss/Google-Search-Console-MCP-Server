/**
 * In-memory per-user rate limiter using a sliding window (token bucket).
 * Allows up to MAX_CALLS tool calls per WINDOW_MS milliseconds per user.
 */

const MAX_CALLS = 200;           // max calls per window
const WINDOW_MS = 60 * 60 * 1000; // 1 hour window

// userId -> array of timestamps of recent calls
const callLog = new Map<number, number[]>();

/**
 * Check if a user is within the rate limit.
 * Returns an object with `allowed` and `remaining`.
 */
export function checkRateLimit(userId: number): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Get or create a log for this user, prune old entries
  let timestamps = (callLog.get(userId) || []).filter(t => t > windowStart);
  callLog.set(userId, timestamps);

  const remaining = MAX_CALLS - timestamps.length;
  const allowed = remaining > 0;

  if (allowed) {
    timestamps.push(now);
  }

  const resetInMs = timestamps.length > 0 ? timestamps[0] + WINDOW_MS - now : WINDOW_MS;

  // remaining after this call: subtract 1 only if we consumed a slot
  return { allowed, remaining: allowed ? remaining - 1 : 0, resetInMs };
}

/**
 * Reset a user's rate limit (e.g., on revoke / reconnect).
 */
export function resetRateLimit(userId: number): void {
  callLog.delete(userId);
}
