import { getDb } from '../db/database';

export async function generateAlerts(siteUrl: string) {
  const db = getDb();
  const alerts: any[] = [];

  // 1. Cannibalization Alert: keywords with >1 ranking page that have clicks
  const cannResult = await db.execute({
    sql: `
      SELECT 
        k.query as keyword,
        COUNT(DISTINCT p.url) as page_count,
        SUM(pk.clicks) as total_clicks
      FROM page_keywords pk
      JOIN pages p ON pk.page_id = p.id
      JOIN keywords k ON pk.keyword_id = k.id
      JOIN sites s ON p.site_id = s.id
      WHERE s.site_url = ?
      GROUP BY k.query
      HAVING page_count > 1 AND total_clicks > 10
    `,
    args: [siteUrl],
  });

  if (cannResult.rows.length > 0) {
    alerts.push({
      type: 'Keyword Cannibalization',
      severity: 'Medium',
      message: `Found ${cannResult.rows.length} keywords with multiple pages competing for clicks.`,
      details: cannResult.rows,
    });
  }

  // 2. Zero Click High Impression Pages Alert
  const zeroClickResult = await db.execute({
    sql: `
      SELECT 
        p.url as page,
        SUM(pk.impressions) as total_impressions
      FROM page_keywords pk
      JOIN pages p ON pk.page_id = p.id
      JOIN sites s ON p.site_id = s.id
      WHERE s.site_url = ?
      GROUP BY p.url
      HAVING SUM(pk.clicks) = 0 AND total_impressions > 500
    `,
    args: [siteUrl],
  });

  if (zeroClickResult.rows.length > 0) {
    alerts.push({
      type: 'Zero Click Waste',
      severity: 'Low',
      message: `Found ${zeroClickResult.rows.length} pages with >500 impressions but 0 clicks.`,
      details: zeroClickResult.rows,
    });
  }

  if (alerts.length === 0) {
    return [{ type: 'Info', message: 'No critical SEO alerts found.' }];
  }

  return alerts;
}
