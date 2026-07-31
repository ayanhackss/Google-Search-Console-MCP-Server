import { Request, Response } from 'express';
import crypto from 'crypto';
import base64url from 'base64url';
import { getDb } from '../db/database';
import { getAuthUrl } from './oauth';

// Endpoint: GET /oauth/authorize
export async function handleAuthorize(req: Request, res: Response) {
  const {
    client_id,
    redirect_uri,
    response_type,
    state,
    code_challenge,
    code_challenge_method
  } = req.query;

  if (response_type !== 'code') {
    res.status(400).json({ error: 'unsupported_response_type', error_description: 'Only code is supported.' });
    return;
  }

  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters: client_id, redirect_uri, or code_challenge.' });
    return;
  }

  // Generate a unique session ID prefixed with cursor_
  const sessionId = 'cursor_' + crypto.randomUUID();

  try {
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO oauth_sessions (id, redirect_uri, state, code_challenge, code_challenge_method) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, redirect_uri as string, (state as string) || null, code_challenge as string, (code_challenge_method as string) || 'plain']
    });

    // Redirect the user to Google to authenticate, passing the sessionId as the Google OAuth state
    res.redirect(getAuthUrl(sessionId));
  } catch (error) {
    console.error('Failed to create OAuth session:', error);
    res.status(500).json({ error: 'server_error', error_description: 'Failed to initialize authorization session.' });
  }
}

// Endpoint: POST /oauth/token
export async function handleToken(req: Request, res: Response) {
  const {
    grant_type,
    code,
    client_id,
    redirect_uri,
    code_verifier
  } = req.body;

  if (grant_type !== 'authorization_code') {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }

  if (!code || !client_id || !redirect_uri || !code_verifier) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Missing parameters.' });
    return;
  }

  try {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT api_key, code_challenge, code_challenge_method FROM oauth_codes WHERE code = ?`,
      args: [code]
    });

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code.' });
      return;
    }

    const row = result.rows[0];
    const apiKey = row.api_key as string;
    const challenge = row.code_challenge as string;
    const method = row.code_challenge_method as string;

    // Verify PKCE
    let isValid = false;
    if (method === 'S256') {
      const expectedChallenge = base64url(crypto.createHash('sha256').update(code_verifier).digest());
      isValid = expectedChallenge === challenge;
    } else {
      // plain
      isValid = code_verifier === challenge;
    }

    if (!isValid) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' });
      return;
    }

    // Delete the code so it cannot be reused
    await db.execute({
      sql: `DELETE FROM oauth_codes WHERE code = ?`,
      args: [code]
    });

    // Return the API key as a Bearer token
    res.json({
      access_token: apiKey,
      token_type: 'Bearer',
      expires_in: 31536000 // 1 year (or virtually never since it's an API key)
    });

  } catch (error) {
    console.error('Failed to exchange token:', error);
    res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' });
  }
}
