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
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      site_url TEXT NOT NULL,
      permission TEXT,
      verified INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, site_url),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      clicks INTEGER,
      impressions INTEGER,
      ctr REAL,
      position REAL,
      total_keywords INTEGER,
      last_synced DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(site_id, url),
      FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
      PRIMARY KEY (page_id, keyword_id, device, country, search_type, date),
      FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE,
      FOREIGN KEY(keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      date TEXT NOT NULL,
      page_id INTEGER,
      keyword_id INTEGER,
      clicks INTEGER,
      impressions INTEGER,
      ctr REAL,
      position REAL,
      PRIMARY KEY (date, page_id, keyword_id),
      FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE,
      FOREIGN KEY(keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_state (
      user_id INTEGER PRIMARY KEY,
      refresh_token TEXT,
      access_token TEXT,
      expiry_date INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oauth_sessions (
      id TEXT PRIMARY KEY,
      redirect_uri TEXT,
      state TEXT,
      code_challenge TEXT,
      code_challenge_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      code TEXT PRIMARY KEY,
      api_key TEXT,
      code_challenge TEXT,
      code_challenge_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      custom_instructions TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}
