import { google } from 'googleapis';
import { oauth2Client } from '../auth/oauth';

const searchconsole = google.searchconsole({
  version: 'v1',
  auth: oauth2Client
});

export async function inspectUrl(siteUrl: string, inspectionUrl: string) {
  const response = await searchconsole.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl,
      siteUrl
    }
  });
  
  return response.data.inspectionResult;
}
