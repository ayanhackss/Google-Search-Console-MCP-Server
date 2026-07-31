import { google } from 'googleapis';
import { getOAuthClient } from '../auth/oauth';
import { getDb } from '../db/database';
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({ maxConcurrent: 2, minTime: 300 });

// ─── Inspect URL (basic) ───────────────────────────────────────────────────
export async function inspectUrl(userId: number, siteUrl: string, inspectionUrl: string) {
  const client = await getOAuthClient(userId);
  const sc = google.searchconsole({ version: 'v1', auth: client });
  const response = await limiter.schedule(() =>
    sc.urlInspection.index.inspect({ requestBody: { inspectionUrl, siteUrl } })
  );
  return response.data.inspectionResult;
}

// ─── Inspect URL Enhanced ─────────────────────────────────────────────────
export async function inspectUrlEnhanced(userId: number, siteUrl: string, inspectionUrl: string) {
  const raw = await inspectUrl(userId, siteUrl, inspectionUrl);
  if (!raw) return { error: 'No inspection result returned.' };

  const indexStatus = (raw as any).indexStatusResult;
  const mobileStatus = (raw as any).mobileUsabilityResult;
  const richResult = (raw as any).richResultsResult;
  const ampResult = (raw as any).ampResult;

  return {
    url: inspectionUrl,
    verdict: indexStatus?.verdict,
    coverageState: indexStatus?.coverageState,
    robotsTxtState: indexStatus?.robotsTxtState,
    indexingState: indexStatus?.indexingState,
    lastCrawledTime: indexStatus?.lastCrawlTime,
    pageFetchState: indexStatus?.pageFetchState,
    crawledAs: indexStatus?.crawledAs,
    googleCanonical: indexStatus?.googleCanonical,
    userCanonical: indexStatus?.userCanonical,
    sitemap: indexStatus?.sitemap,
    referringUrls: indexStatus?.referringUrls,
    mobileUsabilityVerdict: mobileStatus?.verdict,
    mobileIssues: mobileStatus?.issues?.map((i: any) => i.issueType) || [],
    richResultsVerdict: richResult?.verdict,
    richResultsItems: richResult?.detectedItems?.map((d: any) => d.richResultType) || [],
    ampVerdict: ampResult?.verdict,
    ampIssues: ampResult?.issues?.map((i: any) => ({ type: i.issueMessage, severity: i.severity })) || [],
    _raw: raw,
  };
}

// ─── Batch URL Inspection ─────────────────────────────────────────────────
export async function batchUrlInspection(userId: number, siteUrl: string, urls: string[]) {
  const limited = urls.slice(0, 10); // hard cap at 10
  const results: any[] = [];

  for (const url of limited) {
    try {
      const result = await inspectUrlEnhanced(userId, siteUrl, url);
      results.push({ url, ...result });
    } catch (err: any) {
      results.push({ url, error: err.message });
    }
  }

  return results;
}

// ─── Check Indexing Issues ───────────────────────────────────────────────
export async function checkIndexingIssues(userId: number, siteUrl: string, urls: string[]) {
  const limited = urls.slice(0, 10);
  const issues: any[] = [];

  for (const url of limited) {
    try {
      const result = await inspectUrlEnhanced(userId, siteUrl, url);
      const hasIssue = result.verdict !== 'PASS' && result.verdict !== 'NEUTRAL';
      issues.push({
        url,
        verdict: result.verdict,
        coverageState: result.coverageState,
        hasIssue,
        indexingState: result.indexingState,
        mobileIssues: result.mobileIssues,
      });
    } catch (err: any) {
      issues.push({ url, hasIssue: true, error: err.message });
    }
  }

  const problemUrls = issues.filter(i => i.hasIssue);
  return {
    total: limited.length,
    withIssues: problemUrls.length,
    clean: limited.length - problemUrls.length,
    urls: issues,
  };
}
