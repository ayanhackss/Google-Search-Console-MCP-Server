import { google } from 'googleapis';
import { oauth2Client } from '../auth/oauth';

const webmasters = google.webmasters({
  version: 'v3',
  auth: oauth2Client
});

export async function listSitemaps(siteUrl: string) {
  const response = await webmasters.sitemaps.list({ siteUrl });
  return response.data.sitemap || [];
}

export async function submitSitemap(siteUrl: string, feedpath: string) {
  await webmasters.sitemaps.submit({ siteUrl, feedpath });
  return { success: true, message: `Sitemap submitted: ${feedpath}` };
}

export async function deleteSitemap(siteUrl: string, feedpath: string) {
  await webmasters.sitemaps.delete({ siteUrl, feedpath });
  return { success: true, message: `Sitemap deleted: ${feedpath}` };
}
