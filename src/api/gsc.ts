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

  for (const row of rows) {
    const query = row.keys![0];
    const pageUrl = row.keys![1];
    const device = row.keys![2];
    const country = row.keys![3];

    // Upsert page
    await db.execute({
      sql: `INSERT INTO pages (site_id, url) VALUES (?, ?)
            ON CONFLICT(site_id, url) DO NOTHING`,
      args: [siteId, pageUrl],
    });
    const pageResult = await db.execute({
      sql: 'SELECT id FROM pages WHERE site_id = ? AND url = ?',
      args: [siteId, pageUrl],
    });
    const pageId = (pageResult.rows[0] as any).id;

    // Upsert keyword
    await db.execute({
      sql: `INSERT INTO keywords (query) VALUES (?)
            ON CONFLICT(query) DO NOTHING`,
      args: [query],
    });
    const keywordResult = await db.execute({
      sql: 'SELECT id FROM keywords WHERE query = ?',
      args: [query],
    });
    const keywordId = (keywordResult.rows[0] as any).id;

    // Upsert page_keyword
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

  return { syncedRows: rows.length };
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
