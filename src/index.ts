import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { getAuthUrl, submitAuthCode, loadTokens } from './auth/oauth';
import {
  listProperties, getSiteDetails, syncProperty, syncAllProperties,
  getSearchAnalytics, getPerformanceOverview, compareSearchPeriods,
  getSearchByPageQuery, getAdvancedSearchAnalytics,
} from './api/gsc';
import { initDb, getDb } from './db/database';
import { getPageKeywords, getKeywordPages } from './analysis/mapping';
import { getSeoOpportunities } from './analysis/opportunity';
import {
  inspectUrl, inspectUrlEnhanced, batchUrlInspection, checkIndexingIssues,
} from './api/inspection';
import {
  listSitemaps, listSitemapsEnhanced, submitSitemap, deleteSitemap, manageSitemap,
} from './api/sitemaps';
import { generateAlerts } from './analysis/alerts';
import { getCached, setCached, invalidateUserCache } from './api/cache';
import { checkRateLimit, resetRateLimit } from './api/rateLimit';

// ─── User Settings Helpers ────────────────────────────────────────────────
async function getCustomInstructions(userId: number): Promise<string | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT custom_instructions FROM user_settings WHERE user_id = ?',
    args: [userId],
  });
  if (result.rows.length === 0) return null;
  return (result.rows[0] as any).custom_instructions as string | null;
}

async function saveCustomInstructions(userId: number, instructions: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO user_settings (user_id, custom_instructions, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            custom_instructions = excluded.custom_instructions,
            updated_at = CURRENT_TIMESTAMP`,
    args: [userId, instructions],
  });
}

async function revokeAccess(userId: number): Promise<void> {
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM auth_state WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM sites WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM pages WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM user_settings WHERE user_id = ?', args: [userId] });
  await invalidateUserCache(userId);
  resetRateLimit(userId);
}

// ─── All tool definitions ─────────────────────────────────────────────────
const ALL_TOOLS = [
  {
    name: 'get_capabilities',
    description: 'Lists all available tools with their descriptions and required inputs. Call this first if unsure what to do.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_properties',
    description: 'Shows all Google Search Console properties (websites) verified for this account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_site_details',
    description: 'Returns detailed information about a specific GSC property, including permission level and total tracked pages.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' } }, required: ['siteUrl'] },
  },
  {
    name: 'get_search_analytics',
    description: 'Fetches top queries and pages from GSC Search Analytics with clicks, impressions, CTR and position.',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        dimensions: { type: 'array', items: { type: 'string' }, description: 'e.g. ["query","page"] — defaults to query+page' },
        rowLimit: { type: 'number', description: 'Max rows to return (default 50)' },
      },
      required: ['siteUrl', 'startDate', 'endDate'],
    },
  },
  {
    name: 'get_performance_overview',
    description: 'Returns a summary of site search performance: total clicks, impressions, average CTR and position for a time period.',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['siteUrl', 'startDate', 'endDate'],
    },
  },
  {
    name: 'compare_search_periods',
    description: 'Compares search performance between two date ranges and returns deltas and top moving keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        period1Start: { type: 'string', description: 'YYYY-MM-DD' },
        period1End: { type: 'string', description: 'YYYY-MM-DD' },
        period2Start: { type: 'string', description: 'YYYY-MM-DD' },
        period2End: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['siteUrl', 'period1Start', 'period1End', 'period2Start', 'period2End'],
    },
  },
  {
    name: 'get_search_by_page_query',
    description: 'Returns all search queries driving traffic to a specific page URL.',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        pageUrl: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['siteUrl', 'pageUrl', 'startDate', 'endDate'],
    },
  },
  {
    name: 'get_advanced_search_analytics',
    description: 'Advanced search analytics with optional filters by country, device, query substring, or page URL.',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        country: { type: 'string', description: '3-letter country code, e.g. USA, GBR' },
        device: { type: 'string', description: 'MOBILE, DESKTOP, or TABLET' },
        query: { type: 'string', description: 'Filter to queries containing this substring' },
        page: { type: 'string', description: 'Filter to a specific page URL' },
        dimensions: { type: 'array', items: { type: 'string' }, description: 'Dimensions to group by' },
        rowLimit: { type: 'number' },
      },
      required: ['siteUrl', 'startDate', 'endDate'],
    },
  },
  {
    name: 'inspect_url_enhanced',
    description: 'Returns detailed crawl and index status for a URL, including mobile usability, rich results, AMP, and canonical info.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, inspectionUrl: { type: 'string' } }, required: ['siteUrl', 'inspectionUrl'] },
  },
  {
    name: 'batch_url_inspection',
    description: 'Inspects up to 10 URLs at once and returns their indexing status.',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        urls: { type: 'array', items: { type: 'string' }, description: 'List of up to 10 URLs to inspect' },
      },
      required: ['siteUrl', 'urls'],
    },
  },
  {
    name: 'check_indexing_issues',
    description: 'Checks multiple URLs for indexing problems and returns a summary of which URLs have issues.',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        urls: { type: 'array', items: { type: 'string' }, description: 'List of up to 10 URLs to check' },
      },
      required: ['siteUrl', 'urls'],
    },
  },
  {
    name: 'get_sitemaps',
    description: 'Lists all sitemaps submitted for a site. Results are cached for 1 hour.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' } }, required: ['siteUrl'] },
  },
  {
    name: 'list_sitemaps_enhanced',
    description: 'Returns detailed sitemap info including errors, warnings, indexed vs submitted page counts.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' } }, required: ['siteUrl'] },
  },
  {
    name: 'manage_sitemaps',
    description: 'Submit or delete a sitemap. Set action to "submit" or "delete".',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        action: { type: 'string', description: '"submit" or "delete"' },
        feedpath: { type: 'string', description: 'Full URL of the sitemap, e.g. https://example.com/sitemap.xml' },
      },
      required: ['siteUrl', 'action', 'feedpath'],
    },
  },
  {
    name: 'sync_property',
    description: 'Import Search Analytics data for a specific property into the local database for advanced analysis.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' } }, required: ['siteUrl', 'startDate', 'endDate'] },
  },
  {
    name: 'sync_all_properties',
    description: 'Import Search Analytics for ALL verified properties into the local database.',
    inputSchema: { type: 'object', properties: { startDate: { type: 'string' }, endDate: { type: 'string' } }, required: ['startDate', 'endDate'] },
  },
  {
    name: 'get_page_keywords',
    description: 'Get all keywords driving traffic to a specific page (from synced data).',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, pageUrl: { type: 'string' } }, required: ['siteUrl', 'pageUrl'] },
  },
  {
    name: 'get_keyword_pages',
    description: 'Get all pages ranking for a keyword and detect cannibalization (from synced data).',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, keyword: { type: 'string' } }, required: ['siteUrl', 'keyword'] },
  },
  {
    name: 'get_seo_opportunities',
    description: 'Find actionable SEO opportunities: low CTR pages, striking distance keywords, page 2 rankings, and zero-click queries.',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: { type: 'string' },
        category: { type: 'string', description: 'all | low_ctr | striking_distance | page_two | zero_click' },
        brandName: { type: 'string' },
      },
      required: ['siteUrl'],
    },
  },
  {
    name: 'check_alerts',
    description: 'Check for keyword cannibalization and wasted impression alerts (from synced data).',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' } }, required: ['siteUrl'] },
  },
  {
    name: 'update_instructions',
    description: 'Save custom AI instructions for this user (e.g. "Always focus on mobile CTR"). The AI will follow them in all future analyses.',
    inputSchema: { type: 'object', properties: { instructions: { type: 'string' } }, required: ['instructions'] },
  },
  {
    name: 'reauthenticate',
    description: 'Re-run the Google OAuth login flow to switch accounts or refresh permissions. Returns the login URL.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'revoke_access',
    description: 'Completely disconnect this AI from your Google Search Console. Deletes all tokens and data. Cannot be undone.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * Creates and configures the MCP Server instance for a specific user.
 */
export async function createMcpServer(userId: number): Promise<Server> {
  await initDb();

  const server = new Server(
    { name: 'google-search-console-mcp-server', version: '2.0.0' },
    { capabilities: { tools: {}, prompts: {}, resources: {} } }
  );

  // -------- RESOURCES --------
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'searchconsole://properties',
        name: 'GSC Properties',
        description: 'All verified properties in the database.',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === 'searchconsole://properties') {
      const db = getDb();
      const result = await db.execute({ sql: 'SELECT * FROM sites WHERE verified = 1 AND user_id = ?', args: [userId] });
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result.rows, null, 2) }] };
    }
    const matchAlerts = uri.match(/^searchconsole:\/\/(.+)\/alerts$/);
    if (matchAlerts) {
      const alerts = await generateAlerts(userId, decodeURIComponent(matchAlerts[1]));
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(alerts, null, 2) }] };
    }
    const matchOpps = uri.match(/^searchconsole:\/\/(.+)\/opportunities$/);
    if (matchOpps) {
      const opps = await getSeoOpportunities(userId, decodeURIComponent(matchOpps[1]), 'all');
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(opps, null, 2) }] };
    }
    throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
  });

  // -------- TOOLS --------
  const customInstructions = await getCustomInstructions(userId);
  const instrSuffix = customInstructions ? `\n\n[USER PREFERENCES — always follow these]: ${customInstructions}` : '';

  // Inject custom instructions into relevant tools
  const tools = ALL_TOOLS.map(t => {
    if (t.name === 'get_seo_opportunities' || t.name === 'check_alerts') {
      return { ...t, description: t.description + instrSuffix };
    }
    return t;
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments as any;

    // ---- Rate Limiting ----
    const { allowed, remaining, resetInMs } = checkRateLimit(userId);
    if (!allowed) {
      const resetMins = Math.ceil(resetInMs / 60000);
      return {
        content: [{ type: 'text', text: `⚠️ Rate limit reached (200 calls/hour). Please wait ${resetMins} minute(s) before making more requests.` }],
        isError: true,
      };
    }

    try {
      switch (request.params.name) {

        // ── Meta ──
        case 'get_capabilities':
          return {
            content: [{
              type: 'text', text: JSON.stringify({
                description: 'Google Search Console MCP Server v2.0 — AI-powered SEO analytics',
                totalTools: ALL_TOOLS.length,
                rateLimit: `${remaining} calls remaining this hour`,
                customInstructions: customInstructions || 'None set',
                tools: ALL_TOOLS.map(t => ({ name: t.name, description: t.description.split('\n')[0] })),
              }, null, 2),
            }],
          };

        // ── Properties ──
        case 'list_properties':
          return { content: [{ type: 'text', text: JSON.stringify(await listProperties(userId), null, 2) }] };

        case 'get_site_details':
          return { content: [{ type: 'text', text: JSON.stringify(await getSiteDetails(userId, args.siteUrl), null, 2) }] };

        // ── Analytics ──
        case 'get_search_analytics':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(await getSearchAnalytics(userId, args.siteUrl, args.startDate, args.endDate, args.dimensions, args.rowLimit), null, 2),
            }],
          };

        case 'get_performance_overview':
          return { content: [{ type: 'text', text: JSON.stringify(await getPerformanceOverview(userId, args.siteUrl, args.startDate, args.endDate), null, 2) }] };

        case 'compare_search_periods':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(await compareSearchPeriods(userId, args.siteUrl, args.period1Start, args.period1End, args.period2Start, args.period2End), null, 2),
            }],
          };

        case 'get_search_by_page_query':
          return { content: [{ type: 'text', text: JSON.stringify(await getSearchByPageQuery(userId, args.siteUrl, args.pageUrl, args.startDate, args.endDate), null, 2) }] };

        case 'get_advanced_search_analytics':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(await getAdvancedSearchAnalytics(userId, args.siteUrl, args.startDate, args.endDate, {
                country: args.country, device: args.device, query: args.query, page: args.page,
                dimensions: args.dimensions, rowLimit: args.rowLimit,
              }), null, 2),
            }],
          };

        // ── Syncing ──
        case 'sync_property': {
          const r = await syncProperty(userId, args.siteUrl, args.startDate, args.endDate);
          return { content: [{ type: 'text', text: `Synced ${r.syncedRows} rows for ${args.siteUrl}.` }] };
        }

        case 'sync_all_properties': {
          const r = await syncAllProperties(userId, args.startDate, args.endDate);
          return { content: [{ type: 'text', text: `Synced ${r.syncedRows} rows across ${r.propertiesCount} properties.` }] };
        }

        // ── DB Analysis ──
        case 'get_page_keywords':
          return { content: [{ type: 'text', text: JSON.stringify(await getPageKeywords(userId, args.siteUrl, args.pageUrl), null, 2) }] };

        case 'get_keyword_pages':
          return { content: [{ type: 'text', text: JSON.stringify(await getKeywordPages(userId, args.siteUrl, args.keyword), null, 2) }] };

        case 'get_seo_opportunities':
          return { content: [{ type: 'text', text: JSON.stringify(await getSeoOpportunities(userId, args.siteUrl, args.category, args.brandName), null, 2) }] };

        case 'check_alerts':
          return { content: [{ type: 'text', text: JSON.stringify(await generateAlerts(userId, args.siteUrl), null, 2) }] };

        // ── URL Inspection ──
        case 'inspect_url_enhanced': {
          const cacheKey = `user:${userId}:inspect_enh:${args.siteUrl}:${args.inspectionUrl}`;
          const cached = await getCached<any>(cacheKey);
          if (cached) return { content: [{ type: 'text', text: JSON.stringify({ ...cached, _cached: true }, null, 2) }] };
          const data = await inspectUrlEnhanced(userId, args.siteUrl, args.inspectionUrl);
          await setCached(cacheKey, data, 60 * 60 * 24);
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'batch_url_inspection':
          return { content: [{ type: 'text', text: JSON.stringify(await batchUrlInspection(userId, args.siteUrl, args.urls), null, 2) }] };

        case 'check_indexing_issues':
          return { content: [{ type: 'text', text: JSON.stringify(await checkIndexingIssues(userId, args.siteUrl, args.urls), null, 2) }] };

        // ── Sitemaps ──
        case 'get_sitemaps': {
          const cacheKey = `user:${userId}:sitemaps:${args.siteUrl}`;
          const cached = await getCached<any>(cacheKey);
          if (cached) return { content: [{ type: 'text', text: JSON.stringify({ sitemaps: cached, _cached: true }, null, 2) }] };
          const data = await listSitemaps(userId, args.siteUrl);
          await setCached(cacheKey, data, 60 * 60);
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'list_sitemaps_enhanced': {
          const cacheKey = `user:${userId}:sitemaps_enh:${args.siteUrl}`;
          const cached = await getCached<any>(cacheKey);
          if (cached) return { content: [{ type: 'text', text: JSON.stringify({ sitemaps: cached, _cached: true }, null, 2) }] };
          const data = await listSitemapsEnhanced(userId, args.siteUrl);
          await setCached(cacheKey, data, 60 * 60);
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'manage_sitemaps': {
          const result = await manageSitemap(userId, args.siteUrl, args.action, args.feedpath);
          // Bust cache
          await setCached(`user:${userId}:sitemaps:${args.siteUrl}`, null, 0);
          await setCached(`user:${userId}:sitemaps_enh:${args.siteUrl}`, null, 0);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // ── Settings & Auth ──
        case 'update_instructions': {
          await saveCustomInstructions(userId, args.instructions);
          return { content: [{ type: 'text', text: `✅ Custom instructions saved! The AI will follow them in all future analyses.\n\n"${args.instructions}"` }] };
        }

        case 'reauthenticate': {
          // Fetch the user's API key from DB to build a valid login URL
          const db = getDb();
          const userRow = await db.execute({ sql: 'SELECT api_key FROM users WHERE id = ?', args: [userId] });
          if (userRow.rows.length === 0) {
            return { content: [{ type: 'text', text: '❌ Could not find your user record. Please try revoking and re-registering.' }], isError: true };
          }
          // The stored key is hashed — reauthentication requires going through the web dashboard
          const baseUrl = process.env.BASE_URL || 'https://gscmcp.ayanhacks.in';
          return {
            content: [{
              type: 'text',
              text: `🔐 To switch accounts or refresh permissions, please visit the dashboard and click "Sign in with Google":\n\n${baseUrl}\n\nAfter logging in again, restart your MCP connection with the new URL provided.`,
            }],
          };
        }

        case 'revoke_access': {
          await revokeAccess(userId);
          return { content: [{ type: 'text', text: '🗑️ Access fully revoked. All tokens and data have been deleted. To reconnect, visit the dashboard and log in again.' }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }
    } catch (error: any) {
      if (error instanceof McpError) throw error;
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // -------- PROMPTS --------
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      { name: 'analyze_page', description: 'AI SEO analysis for a specific page.', arguments: [{ name: 'siteUrl', required: true }, { name: 'pageUrl', required: true }] },
      { name: 'seo_report', description: 'Generate an SEO executive summary report.', arguments: [{ name: 'siteUrl', required: true }] },
      { name: 'detect_cannibalization', description: 'Detect keyword cannibalization.', arguments: [{ name: 'siteUrl', required: true }, { name: 'keyword', required: true }] },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const a = request.params.arguments ?? {};
    switch (request.params.name) {
      case 'analyze_page':
        return {
          description: 'Analyze page SEO',
          messages: [{
            role: 'user',
            content: { type: 'text', text: `Analyze SEO for page: ${a.pageUrl} on site: ${a.siteUrl}.\n1. Use 'get_search_by_page_query' to get live keyword data.\n2. Use 'inspect_url_enhanced' to check indexing and crawl status.\n3. Summarize the page's search intent.\n4. Suggest an optimized Title and Meta Description.\n5. Suggest FAQs for 'striking distance' keywords.` }
          }],
        };
      case 'seo_report':
        return {
          description: 'SEO Executive Report',
          messages: [{
            role: 'user',
            content: { type: 'text', text: `Generate an SEO Executive Summary for ${a.siteUrl}.\n1. Use 'get_performance_overview' for the last 28 days.\n2. Use 'get_seo_opportunities' for striking_distance and low_ctr.\n3. Analyze top 5 opportunities.\n4. Check for sitemap errors with 'list_sitemaps_enhanced'.\n5. Output a Markdown report with an executive summary.` }
          }],
        };
      case 'detect_cannibalization':
        return {
          description: 'Keyword Cannibalization',
          messages: [{
            role: 'user',
            content: { type: 'text', text: `Check cannibalization for keyword: "${a.keyword}" on ${a.siteUrl}.\n1. Use 'get_keyword_pages' to fetch all ranking pages.\n2. Identify the "best" page by CTR and position.\n3. Recommend a fix: canonical tags, 301 redirect, or content consolidation.` }
          }],
        };
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${request.params.name}`);
    }
  });

  return server;
}
