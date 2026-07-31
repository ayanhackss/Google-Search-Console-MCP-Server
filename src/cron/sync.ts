import cron from 'node-cron';
import { getDb } from '../db/database';
import { syncProperty } from '../api/gsc';
import { pruneOldData } from '../db/prune';

export function startCronJobs() {
  // Run every night at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('🔄 Starting nightly Google Search Console background sync...');
    
    const db = getDb();
    
    try {
      // 1. Prune old data first to save space
      await pruneOldData();

      // 2. Find all users who have an active auth state
      const usersRes = await db.execute('SELECT user_id FROM auth_state');
      const users = usersRes.rows as any[];

      // 3 days ago is generally safe for GSC data to be fully populated
      const syncDate = new Date();
      syncDate.setDate(syncDate.getDate() - 3);
      const targetDateStr = syncDate.toISOString().split('T')[0];

      for (const user of users) {
        const userId = user.user_id;

        // Find all verified sites for this user
        const sitesRes = await db.execute({
          sql: 'SELECT site_url FROM sites WHERE user_id = ? AND verified = 1',
          args: [userId]
        });

        for (const site of sitesRes.rows as any[]) {
          try {
            console.log(`Syncing ${site.site_url} for user ${userId} for date ${targetDateStr}...`);
            const result = await syncProperty(userId, site.site_url, targetDateStr, targetDateStr);
            console.log(`✅ Synced ${result.syncedRows} rows for ${site.site_url}.`);
          } catch (err: any) {
            console.error(`❌ Failed to sync ${site.site_url} for user ${userId}:`, err.message);
          }
        }
      }
      
      console.log('🏁 Nightly background sync complete.');
    } catch (err: any) {
      console.error('❌ Nightly background sync failed completely:', err.message);
    }
  });

  console.log('⏰ Cron jobs initialized. Nightly sync scheduled for 2:00 AM.');
}
