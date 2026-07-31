import { google } from 'googleapis';
import { oauth2Client } from '../auth/oauth';
import { getDb } from '../db/database';

const webmasters = google.webmasters({
  version: 'v3',
  auth: oauth2Client,
});

export async function listProperties() {
  const db = getDb();
  const response = await webmasters.sites.list();
  const sites = response.data.siteEntry || [];

  for (const site of sites) {
    await db.execute({
      sql: `INSERT INTO sites (site_url, permission, verified, updated_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(site_url) DO UPDATE SET
              permission = excluded.permission,
              updated_at = CURRENT_TIMESTAMP`,
      args: [site.siteUrl ?? '', site.permissionLevel ?? null],
    });
  }

  return sites;
}

export async function syncProperty(siteUrl: string, startDate: string, endDate: string) {
  const db = getDb();

  const response = await webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['query', 'page', 'device', 'country'],
      rowLimit: 5000,
    },
  });

  const rows = response.data.rows || [];

  // Get site_id
  const siteResult = await db.execute({
    sql: 'SELECT id FROM sites WHERE site_url = ?',
    args: [siteUrl],
  });
  const siteRow = siteResult.rows[0] as any;
  if (!siteRow) throw new Error(`Site ${siteUrl} not found. Run list_properties first.`);
  const siteId = siteRow.id;

  // --- Fix: guard against missing keys, collect unique pages/keywords ---
  const validRows = rows.filter(r => r.keys && r.keys.length >= 4);

  const uniquePageUrls = [...new Set(validRows.map(r => r.keys![1]))];
  const uniqueQueries  = [...new Set(validRows.map(r => r.keys![0]))];

  // Batch upsert pages
  for (const url of uniquePageUrls) {
    await db.execute({
      sql: `INSERT INTO pages (site_id, url) VALUES (?, ?) ON CONFLICT(site_id, url) DO NOTHING`,
      args: [siteId, url],
    });
  }

  // Batch upsert keywords
  for (const query of uniqueQueries) {
    await db.execute({
      sql: `INSERT INTO keywords (query) VALUES (?) ON CONFLICT(query) DO NOTHING`,
      args: [query],
    });
  }

  // Load all page IDs at once into a map
  const pageRows = await db.execute({
    sql: `SELECT id, url FROM pages WHERE site_id = ? AND url IN (${uniquePageUrls.map(() => '?').join(',')})`,
    args: [siteId, ...uniquePageUrls],
  });
  const pageIdMap = new Map<string, number>();
  for (const r of pageRows.rows as any[]) pageIdMap.set(r.url, r.id);

  // Load all keyword IDs at once into a map
  const kwRows = await db.execute({
    sql: `SELECT id, query FROM keywords WHERE query IN (${uniqueQueries.map(() => '?').join(',')})`,
    args: uniqueQueries,
  });
  const kwIdMap = new Map<string, number>();
  for (const r of kwRows.rows as any[]) kwIdMap.set(r.query, r.id);

  // Upsert page_keywords using the cached IDs (1 query per row, no sub-selects)
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

export async function syncAllProperties(startDate: string, endDate: string) {
  const db = getDb();
  const sitesResult = await db.execute('SELECT site_url FROM sites WHERE verified = 1');

  if (sitesResult.rows.length === 0) {
    throw new Error('No verified properties found. Run list_properties first.');
  }

  let totalRows = 0;
  for (const site of sitesResult.rows) {
    try {
      const result = await syncProperty((site as any).site_url, startDate, endDate);
      totalRows += result.syncedRows;
    } catch (err: any) {
      console.error(`Failed to sync ${(site as any).site_url}: ${err.message}`);
    }
  }

  return { syncedRows: totalRows, propertiesCount: sitesResult.rows.length };
}
