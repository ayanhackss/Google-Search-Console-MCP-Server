import { getDb } from './database';
import dotenv from 'dotenv';

dotenv.config();

async function resetDb() {
  const db = getDb();
  console.log('Dropping all tables...');
  
  await db.executeMultiple(`
    DROP TABLE IF EXISTS auth_state;
    DROP TABLE IF EXISTS snapshots;
    DROP TABLE IF EXISTS page_keywords;
    DROP TABLE IF EXISTS keywords;
    DROP TABLE IF EXISTS pages;
    DROP TABLE IF EXISTS sites;
    DROP TABLE IF EXISTS users;
  `);

  console.log('All tables dropped. You can now start the server and initDb() will recreate them.');
}

resetDb().catch(console.error);
