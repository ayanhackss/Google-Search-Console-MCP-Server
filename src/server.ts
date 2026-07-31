import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from './index';
import { getAuthUrl, submitAuthCode } from './auth/oauth';
import dotenv from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { rateLimit } from 'express-rate-limit';

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

dotenv.config();

const app = express();
app.use(express.json());

import { getDb } from './db/database';
import crypto from 'crypto';

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Cache MCP servers per user ID
const mcpServers: Map<number, Server> = new Map();
async function getMcpServer(userId: number): Promise<Server> {
  if (!mcpServers.has(userId)) {
    const server = await createMcpServer(userId);
    mcpServers.set(userId, server);
  }
  return mcpServers.get(userId)!;
}

// Store SSE transports by session ID (in-memory, per server instance)
const transports: Map<string, SSEServerTransport> = new Map();

function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

// Helper to validate API key
async function getUserIdFromApiKey(apiKey: string): Promise<number | null> {
  const db = getDb();
  const hashedKey = hashApiKey(apiKey);
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE api_key = ?',
    args: [hashedKey],
  });
  return res.rows.length > 0 ? (res.rows[0].id as number) : null;
}

// POST /api/register — Generates a new API Key for a new user
app.post('/api/register', async (req, res) => {
  const db = getDb();
  
  // Fallback for older Node.js versions on VPS that might not have crypto.randomUUID()
  const apiKey = typeof crypto.randomUUID === 'function' 
    ? crypto.randomUUID() 
    : crypto.randomBytes(16).toString('hex');
    
  const hashedKey = hashApiKey(apiKey);
  try {
    await db.execute({
      sql: 'INSERT INTO users (api_key) VALUES (?)',
      args: [hashedKey]
    });
    res.json({ success: true, apiKey, message: "Save this API Key. You will need it to login and connect to the MCP server." });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to create user', details: error.message || String(error) });
  }
});

// GET /api/mcp — Opens SSE stream
app.get('/api/mcp', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const apiKey = (req.query.apiKey as string) || bearerToken;
    
    if (!apiKey) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Missing apiKey query parameter or Bearer token.' });
      return;
    }
    const userId = await getUserIdFromApiKey(apiKey);
    if (!userId) {
      res.status(403).json({ error: 'Invalid apiKey.' });
      return;
    }

    const transport = new SSEServerTransport('/api/mcp', res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    res.on('close', () => {
      transports.delete(sessionId);
    });

    const server = await getMcpServer(userId);
    await server.connect(transport);
  } catch (error: any) {
    console.error('MCP GET error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'MCP connection failed', details: error.message });
  }
});

// OAuth 2.1 Configuration and Endpoints
import { handleAuthorize, handleToken } from './auth/oauth2';

// 1. Protected Resource Metadata (RFC 9728)
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const host = `${req.protocol}://${req.get('host')}`;
  res.json({
    resource: host,
    authorization_servers: [host]
  });
});

// 2. Authorization Server Metadata
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const host = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: host,
    authorization_endpoint: `${host}/oauth/authorize`,
    token_endpoint: `${host}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"]
  });
});

// 3. Authorization and Token Endpoints
app.get('/oauth/authorize', handleAuthorize);
app.post('/oauth/token', express.urlencoded({ extended: true }), express.json(), handleToken);

// POST /api/mcp — Receives tool call messages
app.post('/api/mcp', async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const apiKey = (req.query.apiKey as string) || bearerToken; // Required for POST as well for security, though session ID is checked
    
    if (!apiKey) {
      res.status(401).json({ error: 'Missing apiKey query parameter or Bearer token.' });
      return;
    }
    const userId = await getUserIdFromApiKey(apiKey);
    if (!userId) {
      res.status(403).json({ error: 'Invalid apiKey.' });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: 'No active SSE session found. Open GET /api/mcp first.' });
      return;
    }

    await transport.handlePostMessage(req, res);
  } catch (error: any) {
    console.error('MCP POST error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to handle MCP message', details: error.message });
  }
});

// GET /api/auth/login — Redirects to Google OAuth
app.get('/api/auth/login', async (req, res) => {
  try {
    const apiKey = req.query.apiKey as string;
    if (!apiKey) {
      res.status(400).send('Missing apiKey query parameter. Create one via POST /api/register first.');
      return;
    }
    const userId = await getUserIdFromApiKey(apiKey);
    if (!userId) {
      res.status(403).send('Invalid apiKey.');
      return;
    }

    // Check if already authenticated
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM auth_state WHERE user_id = ? AND refresh_token IS NOT NULL',
      args: [userId]
    });
    
    if (result.rows.length > 0) {
      // User already authenticated — skip Google and show success UI directly
      // Generate a cryptographically secure nonce (not guessable)
      const bypassNonce = crypto.randomBytes(32).toString('hex');
      // Store it briefly in DB so the callback can verify it is legitimate
      const db2 = getDb();
      await db2.execute({
        sql: `INSERT INTO api_cache (cache_key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
        args: [`bypass_nonce:${bypassNonce}`, apiKey, Date.now() + 60000] // valid for 60 seconds
      });
      res.redirect(`/api/auth/callback?code=BYPASS:${bypassNonce}&state=${apiKey}`);
      return;
    }

    res.redirect(getAuthUrl(apiKey));
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).send(`Login failed: ${error.message}`);
  }
});

// GET /api/auth/callback — Handles OAuth redirect from Google
app.get('/api/auth/callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string; 

    if (!code || !state) {
      res.status(400).send('Missing authorization code or state.');
      return;
    }

    // IDE OAuth Flow
    if (state.startsWith('cursor_')) {
      const db = getDb();
      const sessionRes = await db.execute({
        sql: 'SELECT * FROM oauth_sessions WHERE id = ?',
        args: [state]
      });

      if (sessionRes.rows.length === 0) {
        res.status(400).send('Invalid or expired OAuth session.');
        return;
      }
      const session = sessionRes.rows[0];

      // 1. Generate a new API Key for this IDE user
      const apiKey = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      const hashedKey = hashApiKey(apiKey);
      
      // 2. Upsert user — avoid duplicate if they re-authenticate with same key
      await db.execute({
        sql: 'INSERT INTO users (api_key) VALUES (?) ON CONFLICT(api_key) DO NOTHING',
        args: [hashedKey]
      });
      const userRes = await db.execute({
        sql: 'SELECT id FROM users WHERE api_key = ?',
        args: [hashedKey]
      });
      const userId = userRes.rows[0].id as number;

      // 3. Submit auth code to Google to get tokens for this user
      await submitAuthCode(userId, code);

      // 4. Generate short-lived auth code for Cursor
      const authCode = crypto.randomBytes(32).toString('hex');
      await db.execute({
        sql: 'INSERT INTO oauth_codes (code, api_key, code_challenge, code_challenge_method) VALUES (?, ?, ?, ?)',
        args: [authCode, apiKey, session.code_challenge as string, session.code_challenge_method as string]
      });

      // 5. Delete session
      await db.execute({ sql: 'DELETE FROM oauth_sessions WHERE id = ?', args: [state] });

      // 6. Redirect back to Cursor
      const redirectUri = new URL(session.redirect_uri as string);
      redirectUri.searchParams.append('code', authCode);
      if (session.state) {
        redirectUri.searchParams.append('state', session.state as string);
      }
      res.redirect(redirectUri.toString());
      return;
    }

    // Traditional Web Dashboard Flow
    const apiKey = state;
    const userId = await getUserIdFromApiKey(apiKey);
    if (!userId) {
      res.status(403).send('Invalid apiKey in state parameter.');
      return;
    }

    let isAlreadyAuthed = false;
    if (code.startsWith('BYPASS:')) {
      // Verify the nonce is legitimate and was created by the server, not forged
      const nonce = code.slice(7);
      const db3 = getDb();
      const nonceRes = await db3.execute({
        sql: `SELECT value FROM api_cache WHERE cache_key = ? AND expires_at > ?`,
        args: [`bypass_nonce:${nonce}`, Date.now()]
      });
      if (nonceRes.rows.length === 0 || (nonceRes.rows[0] as any).value !== apiKey) {
        res.status(403).send('Invalid or expired bypass token.');
        return;
      }
      // Consume the nonce so it cannot be replayed
      await db3.execute({ sql: `DELETE FROM api_cache WHERE cache_key = ?`, args: [`bypass_nonce:${nonce}`] });
      isAlreadyAuthed = true;
    } else {
      await submitAuthCode(userId, code);
    }
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GSC MCP Server — Authorized</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body { 
            font-family: 'Outfit', sans-serif;
            background: radial-gradient(circle at top, #13182b, #050505 80%);
            color: #fafafa; 
            overflow: hidden;
          }
          /* Background Glows */
          .glow-bg {
            position: absolute;
            width: 600px;
            height: 600px;
            background: radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(0,0,0,0) 70%);
            top: -200px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 0;
            pointer-events: none;
          }
          .glass-card { 
            background: rgba(20, 24, 39, 0.6); 
            backdrop-filter: blur(20px); 
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08); 
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.1);
            position: relative;
            z-index: 10;
          }
          .animate-fade-up { 
            animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; 
          }
          .animate-pulse-slow {
            animation: pulseGlow 3s infinite alternate;
          }
          @keyframes fadeUp { 
            from { opacity: 0; transform: translateY(30px); } 
            to { opacity: 1; transform: translateY(0); } 
          }
          @keyframes pulseGlow {
            0% { box-shadow: 0 0 20px rgba(16,185,129,0.2); }
            100% { box-shadow: 0 0 40px rgba(16,185,129,0.5); }
          }
        </style>
      </head>
      <body class="min-h-screen flex items-center justify-center p-4 relative">
        <div class="glow-bg"></div>
        
        <div class="glass-card max-w-xl w-full p-10 rounded-[2rem] text-center space-y-8 animate-fade-up">
          
          <div class="mx-auto w-20 h-20 bg-gradient-to-br from-emerald-400 to-green-600 rounded-2xl flex items-center justify-center shadow-lg animate-pulse-slow transform rotate-3 hover:rotate-0 transition-transform duration-500">
            <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
          </div>
          
          <div class="space-y-3">
            <h1 class="text-4xl font-bold tracking-tight text-white">${isAlreadyAuthed ? 'Already Authenticated' : 'Connection Established'}</h1>
            <p class="text-gray-400 text-lg font-light leading-relaxed">Your Google Search Console is ${isAlreadyAuthed ? 'already' : 'now'} securely linked. Your AI is ready to fetch live SEO data.</p>
          </div>
          
          <div class="text-left bg-[#0a0a0c]/80 p-5 rounded-2xl border border-gray-800/80 space-y-3 shadow-inner relative overflow-hidden group">
            <div class="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/5 to-emerald-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
            
            <label class="text-[11px] text-gray-500 uppercase tracking-[0.2em] font-semibold flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Your MCP Server URL
            </label>
            
            <div class="flex items-center gap-3 bg-black/50 p-2 pl-4 rounded-xl border border-gray-800 focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/50 transition-all">
              <input type="text" id="mcpUrl" readonly value="${req.protocol}://${req.get('host')}/api/mcp?apiKey=${apiKey}" class="flex-1 bg-transparent border-none outline-none text-emerald-400 font-mono text-sm w-full selection:bg-emerald-900/50" />
              <button onclick="copyUrl(this)" class="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-sm font-medium rounded-lg transition-all duration-200 focus:outline-none flex items-center gap-2" title="Copy to clipboard">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                <span id="btnText">Copy</span>
              </button>
            </div>
          </div>
          
          <p class="text-sm text-gray-500 font-light">
            Paste this URL into <span class="text-gray-300 font-medium">mcp_config.json</span> or your IDE's MCP settings to complete the setup.
          </p>
        </div>

        <script>
          function copyUrl(btn) {
            const urlInput = document.getElementById('mcpUrl');
            const btnText = document.getElementById('btnText');
            const icon = btn.querySelector('svg');
            
            navigator.clipboard.writeText(urlInput.value).then(() => {
              icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>';
              btn.classList.add('text-emerald-400', 'bg-emerald-400/10');
              btn.classList.remove('text-gray-300', 'hover:text-white', 'bg-white/5', 'hover:bg-white/10');
              btnText.textContent = 'Copied!';
              
              setTimeout(() => {
                icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>';
                btn.classList.remove('text-emerald-400', 'bg-emerald-400/10');
                btn.classList.add('text-gray-300', 'hover:text-white', 'bg-white/5', 'hover:bg-white/10');
                btnText.textContent = 'Copy';
              }, 2000);
            });
          }
        </script>
      </body>
      </html>
    `);
  } catch (error: any) {
    console.error('Callback error:', error);
    res.status(500).send(`Authorization failed: ${error.message || String(error)}`);
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

// View Engine Setup
import path from 'path';
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views')); // Because build/src is where server.js will be

// Web Dashboard Route
app.get('/', (req, res) => {
  res.render('index');
});

const PORT = parseInt(process.env.PORT || '3002', 10);

import { startCronJobs } from './cron/sync';
import { initDb } from './db/database';

app.listen(PORT, async () => {
  await initDb();
  console.log(`✅ GSC MCP Server running on port ${PORT}`);
  console.log(`🔗 MCP endpoint:   http://localhost:${PORT}/api/mcp`);
  console.log(`🔑 Auth login:     http://localhost:${PORT}/api/auth/login`);
  console.log(`❤️  Health check:   http://localhost:${PORT}/api/health`);
  console.log(`🌐 Dashboard:      http://localhost:${PORT}/`);
  
  // Start the background syncing and pruning jobs
  startCronJobs();
});

export default app;
