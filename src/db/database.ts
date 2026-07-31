import { createClient, Client } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

let _client: Client | null = null;

export function getDb(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error('TURSO_DATABASE_URL environment variable is not set.');
    }

    _client = createClient({
      url,
      authToken,
    });
  }
  return _client;
}

export async function initDb(): Promise<void> {
  const db = getDb();

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_url TEXT UNIQUE NOT NULL,
      permission TEXT,
      verified INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      clicks INTEGER,
      impressions INTEGER,
      ctr REAL,
      position REAL,
      total_keywords INTEGER,
      last_synced DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(site_id, url)
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT UNIQUE NOT NULL,
      intent TEXT,
      priority INTEGER
    );

    CREATE TABLE IF NOT EXISTS page_keywords (
      page_id INTEGER NOT NULL,
      keyword_id INTEGER NOT NULL,
      clicks INTEGER,
      impressions INTEGER,
      ctr REAL,
      position REAL,
      device TEXT,
      country TEXT,
      search_type TEXT,
      date TEXT,
      PRIMARY KEY (page_id, keyword_id, device, country, search_type, date)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      date TEXT NOT NULL,
      page_id INTEGER,
      keyword_id INTEGER,
      clicks INTEGER,
      impressions INTEGER,
      ctr REAL,
      position REAL,
      PRIMARY KEY (date, page_id, keyword_id)
    );

    CREATE TABLE IF NOT EXISTS auth_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      refresh_token TEXT,
      access_token TEXT,
      expiry_date INTEGER
    );
  `);

  // Migration: add unique index for existing DBs that predate the PK fix
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique
    ON snapshots (date, page_id, keyword_id)
  `);
}
