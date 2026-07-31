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
import { listProperties, syncProperty, syncAllProperties } from './api/gsc';
import { initDb, getDb } from './db/database';
import { getPageKeywords, getKeywordPages } from './analysis/mapping';
import { getSeoOpportunities } from './analysis/opportunity';
import { inspectUrl } from './api/inspection';
import { listSitemaps, submitSitemap, deleteSitemap } from './api/sitemaps';
import { generateAlerts } from './analysis/alerts';

/**
 * Creates and configures the MCP Server instance.
 * Exported as a factory so it can be used by the VPS (Express)
 * or the local stdio runner.
 */
export async function createMcpServer(): Promise<Server> {
  await initDb();
  await loadTokens();

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
      const result = await db.execute('SELECT * FROM sites WHERE verified = 1');
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result.rows, null, 2) }],
      };
    }

    const matchAlerts = uri.match(/^searchconsole:\/\/(.+)\/alerts$/);
    if (matchAlerts) {
      const alerts = await generateAlerts(decodeURIComponent(matchAlerts[1]));
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(alerts, null, 2) }] };
    }

    const matchOpps = uri.match(/^searchconsole:\/\/(.+)\/opportunities$/);
    if (matchOpps) {
      const opps = await getSeoOpportunities(decodeURIComponent(matchOpps[1]), 'all');
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(opps, null, 2) }] };
    }

    throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
  });

  // -------- TOOLS --------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'login', description: 'Get the Google OAuth 2.0 authorization URL to login.', inputSchema: { type: 'object', properties: {} } },
      { name: 'submit_auth_code', description: 'Submit the authorization code from the login URL.', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
      { name: 'list_properties', description: 'List all GSC properties for the authenticated user.', inputSchema: { type: 'object', properties: {} } },
      {
        name: 'sync_property',
        description: 'Sync Search Analytics data for a specific property.',
        inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, startDate: { type: 'string', description: 'YYYY-MM-DD' }, endDate: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['siteUrl', 'startDate', 'endDate'] },
      },
      {
        name: 'sync_all_properties',
        description: 'Sync Search Analytics for ALL verified properties.',
        inputSchema: { type: 'object', properties: { startDate: { type: 'string' }, endDate: { type: 'string' } }, required: ['startDate', 'endDate'] },
      },
      { name: 'get_page_keywords', description: 'Get all keywords driving traffic to a specific page.', inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, pageUrl: { type: 'string' } }, required: ['siteUrl', 'pageUrl'] } },
      { name: 'get_keyword_pages', description: 'Get all pages ranking for a keyword and detect cannibalization.', inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, keyword: { type: 'string' } }, required: ['siteUrl', 'keyword'] } },
      {
        name: 'get_seo_opportunities',
        description: 'Find SEO opportunities using heuristics.',
        inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, category: { type: 'string', description: 'all | low_ctr | striking_distance | page_two | zero_click' }, brandName: { type: 'string' } }, required: ['siteUrl'] },
      },
      { name: 'check_alerts', description: 'Check for keyword cannibalization and wasted impression alerts.', inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' } }, required: ['siteUrl'] } },
      { name: 'inspect_url', description: 'Inspect a URL via the GSC URL Inspection API.', inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, inspectionUrl: { type: 'string' } }, required: ['siteUrl', 'inspectionUrl'] } },
      { name: 'list_sitemaps', description: 'List sitemaps for a site.', inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' } }, required: ['siteUrl'] } },
      { name: 'submit_sitemap', description: 'Submit a sitemap.', inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, feedpath: { type: 'string' } }, required: ['siteUrl', 'feedpath'] } },
      { name: 'delete_sitemap', description: 'Delete a sitemap.', inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, feedpath: { type: 'string' } }, required: ['siteUrl', 'feedpath'] } },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments as any;
    try {
      switch (request.params.name) {
        case 'login':
          return { content: [{ type: 'text', text: `Open this URL to authorize:\n\n${getAuthUrl()}\n\nThen use 'submit_auth_code' with the code.` }] };

        case 'submit_auth_code':
          await submitAuthCode(args.code);
          return { content: [{ type: 'text', text: 'Successfully authenticated with Google Search Console.' }] };

        case 'list_properties':
          return { content: [{ type: 'text', text: JSON.stringify(await listProperties(), null, 2) }] };

        case 'sync_property': {
          const r = await syncProperty(args.siteUrl, args.startDate, args.endDate);
          return { content: [{ type: 'text', text: `Synced ${r.syncedRows} rows for ${args.siteUrl}.` }] };
        }

        case 'sync_all_properties': {
          const r = await syncAllProperties(args.startDate, args.endDate);
          return { content: [{ type: 'text', text: `Synced ${r.syncedRows} rows across ${r.propertiesCount} properties.` }] };
        }

        case 'get_page_keywords':
          return { content: [{ type: 'text', text: JSON.stringify(await getPageKeywords(args.siteUrl, args.pageUrl), null, 2) }] };

        case 'get_keyword_pages':
          return { content: [{ type: 'text', text: JSON.stringify(await getKeywordPages(args.siteUrl, args.keyword), null, 2) }] };

        case 'get_seo_opportunities':
          return { content: [{ type: 'text', text: JSON.stringify(await getSeoOpportunities(args.siteUrl, args.category, args.brandName), null, 2) }] };

        case 'check_alerts':
          return { content: [{ type: 'text', text: JSON.stringify(await generateAlerts(args.siteUrl), null, 2) }] };

        case 'inspect_url':
          return { content: [{ type: 'text', text: JSON.stringify(await inspectUrl(args.siteUrl, args.inspectionUrl), null, 2) }] };

        case 'list_sitemaps':
          return { content: [{ type: 'text', text: JSON.stringify(await listSitemaps(args.siteUrl), null, 2) }] };

        case 'submit_sitemap':
          return { content: [{ type: 'text', text: JSON.stringify(await submitSitemap(args.siteUrl, args.feedpath), null, 2) }] };

        case 'delete_sitemap':
          return { content: [{ type: 'text', text: JSON.stringify(await deleteSitemap(args.siteUrl, args.feedpath), null, 2) }] };

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
            content: { type: 'text', text: `Analyze SEO for page: ${a.pageUrl} on site: ${a.siteUrl}.\n1. Use 'get_page_keywords' to fetch keyword data.\n2. Summarize the page's search intent.\n3. Suggest an optimized Title and Meta Description.\n4. Suggest FAQs for 'striking distance' keywords.` }
          }],
        };
      case 'seo_report':
        return {
          description: 'SEO Executive Report',
          messages: [{
            role: 'user',
            content: { type: 'text', text: `Generate an SEO Executive Summary for ${a.siteUrl}.\n1. Use 'get_seo_opportunities' for 'striking_distance' and 'low_ctr'.\n2. Analyze top 5 opportunities.\n3. Output a Markdown report with an executive summary.` }
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
