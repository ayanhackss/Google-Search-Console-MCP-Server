import { getDb } from './database';

export async function pruneOldData() {
  const db = getDb();
  
  // Calculate date 90 days ago
  const dateOffset = new Date();
  dateOffset.setDate(dateOffset.getDate() - 90);
  const cutoffDate = dateOffset.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`🧹 Pruning Google Search Console data older than ${cutoffDate}...`);

  try {
    const result = await db.execute({
      sql: `DELETE FROM page_keywords WHERE date < ?`,
      args: [cutoffDate],
    });

    console.log(`✅ Successfully pruned ${result.rowsAffected} old records from page_keywords.`);
  } catch (error: any) {
    console.error('❌ Failed to prune old data:', error.message);
  }
}
