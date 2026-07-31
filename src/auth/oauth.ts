import { google } from 'googleapis';
import dotenv from 'dotenv';
import { getDb } from '../db/database';

dotenv.config();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('Warning: CLIENT_ID and CLIENT_SECRET are not set in environment variables.');
}

// Cache of OAuth clients per user to maintain event listeners
const oauthClients = new Map<number, any>();

export async function getOAuthClient(userId: number) {
  if (oauthClients.has(userId)) {
    return oauthClients.get(userId);
  }

  const client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

  // Automatically save tokens when the OAuth client refreshes them
  client.on('tokens', async (tokens) => {
    await saveTokens(userId, tokens);
  });

  // Load existing tokens if any
  try {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM auth_state WHERE user_id = ?',
      args: [userId],
    });
    const row = result.rows[0] as any;
    if (row && row.refresh_token) {
      client.setCredentials({
        refresh_token: row.refresh_token as string,
        access_token: row.access_token as string,
        expiry_date: row.expiry_date as number,
      });
    }
  } catch (err) {
    console.error(`Could not load tokens for user ${userId}:`, err);
  }

  oauthClients.set(userId, client);
  return client;
}

// Ensure loadTokens still exists as a no-op if called from index, or remove it.
export async function loadTokens(): Promise<void> {
  // Now handled lazily per user via getOAuthClient
}

// Save tokens to DB (async)
export async function saveTokens(userId: number, tokens: {
  refresh_token?: string | null;
  access_token?: string | null;
  expiry_date?: number | null;
}): Promise<void> {
  const db = getDb();
  if (tokens.refresh_token) {
    await db.execute({
      sql: `INSERT INTO auth_state (user_id, refresh_token, access_token, expiry_date)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              refresh_token = excluded.refresh_token,
              access_token = excluded.access_token,
              expiry_date = excluded.expiry_date`,
      args: [userId, tokens.refresh_token, tokens.access_token ?? null, tokens.expiry_date ?? null],
    });
  } else {
    await db.execute({
      sql: `UPDATE auth_state SET access_token = ?, expiry_date = ? WHERE user_id = ?`,
      args: [tokens.access_token ?? null, tokens.expiry_date ?? null, userId],
    });
  }
}

export function getAuthUrl(apiKey: string): string {
  const tempClient = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  return tempClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    prompt: 'consent',
    state: apiKey, // Pass apiKey through the OAuth flow to identify the user on callback
  });
}

export async function submitAuthCode(userId: number, code: string): Promise<void> {
  const client = await getOAuthClient(userId);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  await saveTokens(userId, tokens);
}
