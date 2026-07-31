import { getDb } from '../db/database';

export async function getSeoOpportunities(userId: number, siteUrl: string, category: string = 'all', brandName?: string) {
  const db = getDb();

  let havingClause = '';

  switch (category) {
    case 'low_ctr':
      havingClause = 'HAVING total_impressions > 500 AND avg_ctr < 0.02';
      break;
    case 'striking_distance':
      havingClause = 'HAVING avg_position >= 4 AND avg_position <= 10 AND total_impressions > 100';
      break;
    case 'page_two':
      havingClause = 'HAVING avg_position > 10 AND avg_position <= 20 AND total_impressions > 100';
      break;
    case 'zero_click':
      havingClause = 'HAVING total_clicks = 0 AND total_impressions > 100';
      break;
    default:
      havingClause = 'HAVING total_impressions > 10';
      break;
  }

  const args: any[] = [siteUrl, userId];
  let brandFilter = '';
  if (brandName) {
    brandFilter = `AND k.query NOT LIKE '%' || ? || '%'`;
    args.push(brandName);
  }

  const result = await db.execute({
    sql: `
      SELECT 
        k.query as keyword,
        SUM(pk.clicks) as total_clicks,
        SUM(pk.impressions) as total_impressions,
        AVG(pk.ctr) as avg_ctr,
        AVG(pk.position) as avg_position,
        COUNT(DISTINCT p.url) as ranking_pages
      FROM page_keywords pk
      JOIN pages p ON pk.page_id = p.id
      JOIN keywords k ON pk.keyword_id = k.id
      JOIN sites s ON p.site_id = s.id
      WHERE s.site_url = ? AND s.user_id = ? ${brandFilter}
      GROUP BY k.query
      ${havingClause}
      ORDER BY total_impressions DESC
      LIMIT 100
    `,
    args,
  });

  return result.rows;
}
