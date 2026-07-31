import { google } from 'googleapis';
import { getOAuthClient } from '../auth/oauth';
import { getDb } from '../db/database';
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 300,
});

// ─── List Properties ─────────────────────────────────────────────────────
export async function listProperties(userId: number) {
  const db = getDb();
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const response = await limiter.schedule(() => webmasters.sites.list());
  const sites = response.data.siteEntry || [];

  for (const site of sites) {
    await db.execute({
      sql: `INSERT INTO sites (user_id, site_url, permission, verified, updated_at)
            VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, site_url) DO UPDATE SET
              permission = excluded.permission,
              updated_at = CURRENT_TIMESTAMP`,
      args: [userId, site.siteUrl ?? '', site.permissionLevel ?? null],
    });
  }

  return sites;
}

// ─── Get Site Details ────────────────────────────────────────────────────
export async function getSiteDetails(userId: number, siteUrl: string) {
  const db = getDb();
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const [siteResponse, dbResult] = await Promise.all([
    limiter.schedule(() => webmasters.sites.get({ siteUrl })),
    db.execute({ sql: 'SELECT * FROM sites WHERE user_id = ? AND site_url = ?', args: [userId, siteUrl] }),
  ]);

  const pageCount = await db.execute({ sql: 'SELECT COUNT(*) as count FROM pages WHERE user_id = ? AND site_id = (SELECT id FROM sites WHERE user_id = ? AND site_url = ?)', args: [userId, userId, siteUrl] });

  return {
    siteUrl,
    permissionLevel: siteResponse.data.permissionLevel,
    verified: true,
    dbRecord: dbResult.rows[0] ?? null,
    totalPagesTracked: (pageCount.rows[0] as any)?.count ?? 0,
  };
}

// ─── Search Analytics ─────────────────────────────────────────────────────
export async function getSearchAnalytics(
  userId: number,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[] = ['query', 'page'],
  rowLimit = 50
) {
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const response = await limiter.schedule(() =>
    webmasters.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions, rowLimit },
    })
  );

  const rows = (response.data.rows || []).map((r: any) => ({
    keys: r.keys,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: parseFloat((r.ctr * 100).toFixed(2)),
    position: parseFloat((r.position).toFixed(1)),
  }));

  return { siteUrl, startDate, endDate, rowCount: rows.length, rows };
}

// ─── Performance Overview ─────────────────────────────────────────────────
export async function getPerformanceOverview(userId: number, siteUrl: string, startDate: string, endDate: string) {
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const response = await limiter.schedule(() =>
    webmasters.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions: ['date'], rowLimit: 1000 },
    })
  );

  const rows = response.data.rows || [];
  const totalClicks = rows.reduce((s: number, r: any) => s + (r.clicks || 0), 0);
  const totalImpressions = rows.reduce((s: number, r: any) => s + (r.impressions || 0), 0);
  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const avgPosition = rows.length > 0
    ? rows.reduce((s: number, r: any) => s + (r.position || 0), 0) / rows.length
    : 0;

  // Top days
  const sorted = [...rows].sort((a: any, b: any) => (b.clicks || 0) - (a.clicks || 0));

  return {
    siteUrl,
    startDate,
    endDate,
    totalClicks,
    totalImpressions,
    avgCtr: parseFloat((avgCtr * 100).toFixed(2)),
    avgPosition: parseFloat(avgPosition.toFixed(1)),
    topDays: sorted.slice(0, 5).map((r: any) => ({ date: r.keys?.[0], clicks: r.clicks, impressions: r.impressions })),
    daysWithData: rows.length,
  };
}

// ─── Compare Search Periods ───────────────────────────────────────────────
export async function compareSearchPeriods(
  userId: number,
  siteUrl: string,
  period1Start: string, period1End: string,
  period2Start: string, period2End: string
) {
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const [r1, r2] = await Promise.all([
    limiter.schedule(() =>
      webmasters.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: period1Start, endDate: period1End, dimensions: ['query'], rowLimit: 100 },
      })
    ),
    limiter.schedule(() =>
      webmasters.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: period2Start, endDate: period2End, dimensions: ['query'], rowLimit: 100 },
      })
    ),
  ]);

  const p1Rows = r1.data.rows || [];
  const p2Rows = r2.data.rows || [];

  const p1Totals = { clicks: p1Rows.reduce((s: number, r: any) => s + (r.clicks || 0), 0), impressions: p1Rows.reduce((s: number, r: any) => s + (r.impressions || 0), 0) };
  const p2Totals = { clicks: p2Rows.reduce((s: number, r: any) => s + (r.clicks || 0), 0), impressions: p2Rows.reduce((s: number, r: any) => s + (r.impressions || 0), 0) };

  const clicksDelta = p2Totals.clicks - p1Totals.clicks;
  const clicksPct = p1Totals.clicks > 0 ? ((clicksDelta / p1Totals.clicks) * 100).toFixed(1) : 'N/A';
  const impressionsDelta = p2Totals.impressions - p1Totals.impressions;

  // Build keyword map for comparison
  const kwMap = new Map<string, { p1: any; p2: any }>();
  for (const r of p1Rows as any[]) kwMap.set(r.keys[0], { p1: r, p2: null });
  for (const r of p2Rows as any[]) {
    const kw = r.keys[0];
    if (kwMap.has(kw)) kwMap.get(kw)!.p2 = r;
    else kwMap.set(kw, { p1: null, p2: r });
  }

  const movers = Array.from(kwMap.entries())
    .filter(([, v]) => v.p1 && v.p2)
    .map(([kw, v]) => ({
      keyword: kw,
      clickChange: (v.p2.clicks || 0) - (v.p1.clicks || 0),
      positionChange: parseFloat(((v.p1.position || 0) - (v.p2.position || 0)).toFixed(1)), // positive = improved
    }))
    .sort((a, b) => Math.abs(b.clickChange) - Math.abs(a.clickChange))
    .slice(0, 10);

  return {
    siteUrl,
    period1: { start: period1Start, end: period1End, ...p1Totals },
    period2: { start: period2Start, end: period2End, ...p2Totals },
    delta: {
      clicks: clicksDelta,
      clicksPercentChange: `${clicksPct}%`,
      impressions: impressionsDelta,
    },
    topMovingKeywords: movers,
  };
}

// ─── Get Search by Page + Query ───────────────────────────────────────────
export async function getSearchByPageQuery(userId: number, siteUrl: string, pageUrl: string, startDate: string, endDate: string) {
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const response = await limiter.schedule(() =>
    webmasters.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query'],
        dimensionFilterGroups: [{
          filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }],
        }],
        rowLimit: 100,
      },
    })
  );

  return {
    pageUrl,
    siteUrl,
    startDate,
    endDate,
    queries: (response.data.rows || []).map((r: any) => ({
      query: r.keys?.[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: parseFloat(((r.ctr || 0) * 100).toFixed(2)),
      position: parseFloat((r.position || 0).toFixed(1)),
    })),
  };
}

// ─── Advanced Search Analytics ────────────────────────────────────────────
export async function getAdvancedSearchAnalytics(
  userId: number,
  siteUrl: string,
  startDate: string,
  endDate: string,
  options: {
    country?: string;
    device?: string;
    query?: string;
    page?: string;
    dimensions?: string[];
    rowLimit?: number;
  } = {}
) {
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const filters: any[] = [];
  if (options.country) filters.push({ dimension: 'country', operator: 'equals', expression: options.country });
  if (options.device) filters.push({ dimension: 'device', operator: 'equals', expression: options.device });
  if (options.query) filters.push({ dimension: 'query', operator: 'contains', expression: options.query });
  if (options.page) filters.push({ dimension: 'page', operator: 'equals', expression: options.page });

  const requestBody: any = {
    startDate,
    endDate,
    dimensions: options.dimensions || ['query', 'page'],
    rowLimit: options.rowLimit || 100,
  };
  if (filters.length > 0) requestBody.dimensionFilterGroups = [{ filters }];

  const response = await limiter.schedule(() =>
    webmasters.searchanalytics.query({ siteUrl, requestBody })
  );

  return {
    siteUrl,
    startDate,
    endDate,
    filters: options,
    rowCount: (response.data.rows || []).length,
    rows: (response.data.rows || []).map((r: any) => ({
      keys: r.keys,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: parseFloat(((r.ctr || 0) * 100).toFixed(2)),
      position: parseFloat((r.position || 0).toFixed(1)),
    })),
  };
}

// ─── Sync Property (batch import) ────────────────────────────────────────
export async function syncProperty(userId: number, siteUrl: string, startDate: string, endDate: string) {
  const db = getDb();
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const response = await limiter.schedule(() => webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['query', 'page', 'device', 'country'],
      rowLimit: 5000,
    },
  }));

  const rows = response.data.rows || [];

  const siteResult = await db.execute({
    sql: 'SELECT id FROM sites WHERE user_id = ? AND site_url = ?',
    args: [userId, siteUrl],
  });
  const siteRow = siteResult.rows[0] as any;
  if (!siteRow) throw new Error(`Site ${siteUrl} not found. Run list_properties first.`);
  const siteId = siteRow.id;

  const validRows = rows.filter(r => r.keys && r.keys.length >= 4);
  const uniquePageUrls = [...new Set(validRows.map(r => r.keys![1]))];
  const uniqueQueries  = [...new Set(validRows.map(r => r.keys![0]))];

  for (const url of uniquePageUrls) {
    await db.execute({
      sql: `INSERT INTO pages (user_id, site_id, url) VALUES (?, ?, ?) ON CONFLICT(site_id, url) DO NOTHING`,
      args: [userId, siteId, url],
    });
  }

  for (const query of uniqueQueries) {
    await db.execute({
      sql: `INSERT INTO keywords (query) VALUES (?) ON CONFLICT(query) DO NOTHING`,
      args: [query],
    });
  }

  const pageRows = await db.execute({
    sql: `SELECT id, url FROM pages WHERE user_id = ? AND site_id = ? AND url IN (${uniquePageUrls.map(() => '?').join(',')})`,
    args: [userId, siteId, ...uniquePageUrls],
  });
  const pageIdMap = new Map<string, number>();
  for (const r of pageRows.rows as any[]) pageIdMap.set(r.url, r.id);

  const kwRows = await db.execute({
    sql: `SELECT id, query FROM keywords WHERE query IN (${uniqueQueries.map(() => '?').join(',')})`,
    args: uniqueQueries,
  });
  const kwIdMap = new Map<string, number>();
  for (const r of kwRows.rows as any[]) kwIdMap.set(r.query, r.id);

  for (const row of validRows) {
    const [query, pageUrl, device, country] = row.keys!;
    const pageId = pageIdMap.get(pageUrl);
    const keywordId = kwIdMap.get(query);
    if (!pageId || !keywordId) continue;

    await db.execute({
      sql: `INSERT INTO page_keywords (page_id, keyword_id, clicks, impressions, ctr, position, device, country, search_type, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web', ?)
            ON CONFLICT(page_id, keyword_id, device, country, search_type, date) DO UPDATE SET
              clicks = excluded.clicks,
              impressions = excluded.impressions,
              ctr = excluded.ctr,
              position = excluded.position`,
      args: [pageId, keywordId, row.clicks ?? 0, row.impressions ?? 0, row.ctr ?? 0, row.position ?? 0, device, country, endDate],
    });
  }

  return { syncedRows: validRows.length };
}

// ─── Sync All Properties ──────────────────────────────────────────────────
export async function syncAllProperties(userId: number, startDate: string, endDate: string) {
  const db = getDb();
  const sitesResult = await db.execute({
    sql: 'SELECT site_url FROM sites WHERE user_id = ? AND verified = 1',
    args: [userId]
  });

  if (sitesResult.rows.length === 0) {
    throw new Error('No verified properties found. Run list_properties first.');
  }

  let totalRows = 0;
  for (const site of sitesResult.rows) {
    try {
      const result = await syncProperty(userId, (site as any).site_url, startDate, endDate);
      totalRows += result.syncedRows;
    } catch (err: any) {
      console.error(`Failed to sync ${(site as any).site_url}: ${err.message}`);
    }
  }

  return { syncedRows: totalRows, propertiesCount: sitesResult.rows.length };
}
