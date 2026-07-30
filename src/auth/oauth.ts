import { google } from 'googleapis';
import dotenv from 'dotenv';
import { getDb } from '../db/database';

dotenv.config();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
// For serverless deployment, use the hosted redirect URI
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('Warning: CLIENT_ID and CLIENT_SECRET are not set in environment variables.');
}

export const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Load tokens from DB on startup (async)
export async function loadTokens(): Promise<void> {
  try {
    const db = getDb();
    const result = await db.execute('SELECT * FROM auth_state WHERE id = 1');
    const row = result.rows[0] as any;
    if (row && row.refresh_token) {
      oauth2Client.setCredentials({
        refresh_token: row.refresh_token as string,
        access_token: row.access_token as string,
        expiry_date: row.expiry_date as number,
      });
    }
  } catch (err) {
    console.error('Could not load tokens from DB:', err);
  }
}

// Save tokens to DB (async)
export async function saveTokens(tokens: {
  refresh_token?: string | null;
  access_token?: string | null;
  expiry_date?: number | null;
}): Promise<void> {
  const db = getDb();
  if (tokens.refresh_token) {
    await db.execute({
      sql: `INSERT INTO auth_state (id, refresh_token, access_token, expiry_date)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              refresh_token = excluded.refresh_token,
              access_token = excluded.access_token,
              expiry_date = excluded.expiry_date`,
      args: [tokens.refresh_token, tokens.access_token ?? null, tokens.expiry_date ?? null],
    });
  } else {
    await db.execute({
      sql: `UPDATE auth_state SET access_token = ?, expiry_date = ? WHERE id = 1`,
      args: [tokens.access_token ?? null, tokens.expiry_date ?? null],
    });
  }
}

// Automatically save tokens when the OAuth client refreshes them
oauth2Client.on('tokens', async (tokens) => {
  await saveTokens(tokens);
});

export function getAuthUrl(): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    prompt: 'consent',
  });
}

export async function submitAuthCode(code: string): Promise<void> {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  await saveTokens(tokens);
}
