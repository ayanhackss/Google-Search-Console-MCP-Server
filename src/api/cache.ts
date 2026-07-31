import { getDb } from '../db/database';

/**
 * Get a cached value from the database.
 * Returns null if not found or expired.
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const db = getDb();
  const now = Date.now();
  const result = await db.execute({
    sql: 'SELECT value FROM api_cache WHERE cache_key = ? AND expires_at > ?',
    args: [key, now],
  });
  if (result.rows.length === 0) return null;
  return JSON.parse((result.rows[0] as any).value) as T;
}

/**
 * Store a value in the cache with a TTL in seconds.
 */
export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const db = getDb();
  // If ttl <= 0, treat as an explicit cache bust (delete the entry)
  if (ttlSeconds <= 0) {
    await db.execute({ sql: `DELETE FROM api_cache WHERE cache_key = ?`, args: [key] });
    return;
  }
  const expiresAt = Date.now() + ttlSeconds * 1000;
  await db.execute({
    sql: `INSERT INTO api_cache (cache_key, value, expires_at)
          VALUES (?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    args: [key, JSON.stringify(value), expiresAt],
  });
}

/**
 * Delete all cache entries for a given user (e.g., on revoke).
 */
export async function invalidateUserCache(userId: number): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM api_cache WHERE cache_key LIKE ?`,
    args: [`user:${userId}:%`],
  });
}
