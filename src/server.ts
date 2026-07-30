import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from './index';
import { getAuthUrl, submitAuthCode } from './auth/oauth';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Store SSE transports by session ID (in-memory, per Vercel instance)
const transports: Map<string, SSEServerTransport> = new Map();

// GET /api/mcp — Opens SSE stream
app.get('/api/mcp', async (req, res) => {
  const transport = new SSEServerTransport('/api/mcp', res);
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);

  res.on('close', () => {
    transports.delete(sessionId);
  });

  const server = await createMcpServer();
  await server.connect(transport);
});

// POST /api/mcp — Receives tool call messages
app.post('/api/mcp', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(400).json({ error: 'No active SSE session found. Open GET /api/mcp first.' });
    return;
  }

  await transport.handlePostMessage(req, res);
});

// GET /api/auth/login — Redirects to Google OAuth
app.get('/api/auth/login', (req, res) => {
  res.redirect(getAuthUrl());
});

// GET /api/auth/callback — Handles OAuth redirect from Google
app.get('/api/auth/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send('Missing authorization code.');
    return;
  }
  try {
    await submitAuthCode(code);
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>GSC MCP Server — Authorized!</title></head>
        <body style="font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;">
          <h1>✅ Successfully Authorized!</h1>
          <p>Your Google Search Console MCP Server is now authenticated.</p>
          <p>You can close this tab and start using the MCP server in your AI client.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    res.status(500).send(`Authorization failed: ${error.message}`);
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

export default app;
