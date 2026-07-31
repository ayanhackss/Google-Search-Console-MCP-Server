import { google } from 'googleapis';
import { getOAuthClient } from '../auth/oauth';
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({ maxConcurrent: 2, minTime: 300 });

// ─── Basic list ───────────────────────────────────────────────────────────
export async function listSitemaps(userId: number, siteUrl: string) {
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });
  const response = await limiter.schedule(() => webmasters.sitemaps.list({ siteUrl }));
  return response.data.sitemap || [];
}

// ─── Enhanced list ────────────────────────────────────────────────────────
export async function listSitemapsEnhanced(userId: number, siteUrl: string) {
  const raw = await listSitemaps(userId, siteUrl);
  return raw.map((s: any) => ({
    path: s.path,
    type: s.type,
    lastSubmitted: s.lastSubmitted,
    isPending: s.isPending,
    isSitemapsIndex: s.isSitemapsIndex,
    lastDownloaded: s.lastDownloaded,
    warnings: s.warnings,
    errors: s.errors,
    contents: s.contents?.map((c: any) => ({ type: c.type, submitted: c.submitted, indexed: c.indexed })) || [],
    _hasErrors: Number(s.errors || 0) > 0,
    _hasWarnings: Number(s.warnings || 0) > 0,
  }));
}

// ─── Submit ───────────────────────────────────────────────────────────────
export async function submitSitemap(userId: number, siteUrl: string, feedpath: string) {
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });
  await limiter.schedule(() => webmasters.sitemaps.submit({ siteUrl, feedpath }));
  return { success: true, message: `Sitemap submitted: ${feedpath}` };
}

// ─── Delete ───────────────────────────────────────────────────────────────
export async function deleteSitemap(userId: number, siteUrl: string, feedpath: string) {
  const client = await getOAuthClient(userId);
  const webmasters = google.webmasters({ version: 'v3', auth: client });
  await limiter.schedule(() => webmasters.sitemaps.delete({ siteUrl, feedpath }));
  return { success: true, message: `Sitemap deleted: ${feedpath}` };
}

// ─── Manage (submit or delete) ────────────────────────────────────────────
export async function manageSitemap(userId: number, siteUrl: string, action: 'submit' | 'delete', feedpath: string) {
  if (action === 'submit') return submitSitemap(userId, siteUrl, feedpath);
  if (action === 'delete') return deleteSitemap(userId, siteUrl, feedpath);
  return { success: false, message: `Unknown action: ${action}. Use "submit" or "delete".` };
}
