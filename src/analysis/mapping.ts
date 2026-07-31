import { getDb } from '../db/database';

export async function getPageKeywords(userId: number, siteUrl: string, pageUrl: string) {
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT 
        k.query as keyword,
        SUM(pk.clicks) as total_clicks,
        SUM(pk.impressions) as total_impressions,
        AVG(pk.ctr) as avg_ctr,
        AVG(pk.position) as avg_position
      FROM page_keywords pk
      JOIN pages p ON pk.page_id = p.id
      JOIN keywords k ON pk.keyword_id = k.id
      JOIN sites s ON p.site_id = s.id
      WHERE s.site_url = ? AND s.user_id = ? AND p.url = ?
      GROUP BY k.query
      ORDER BY total_clicks DESC, total_impressions DESC
    `,
    args: [siteUrl, userId, pageUrl],
  });
  return result.rows;
}

export async function getKeywordPages(userId: number, siteUrl: string, keyword: string) {
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT 
        p.url as page_url,
        SUM(pk.clicks) as total_clicks,
        SUM(pk.impressions) as total_impressions,
        AVG(pk.ctr) as avg_ctr,
        AVG(pk.position) as avg_position
      FROM page_keywords pk
      JOIN pages p ON pk.page_id = p.id
      JOIN keywords k ON pk.keyword_id = k.id
      JOIN sites s ON p.site_id = s.id
      WHERE s.site_url = ? AND s.user_id = ? AND k.query = ?
      GROUP BY p.url
      ORDER BY total_clicks DESC, total_impressions DESC
    `,
    args: [siteUrl, userId, keyword],
  });

  const pages = result.rows;
  const cannibalization = pages.length > 1;

  return {
    cannibalization_detected: cannibalization,
    pages,
  };
}
