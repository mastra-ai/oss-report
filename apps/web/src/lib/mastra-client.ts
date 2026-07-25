import { MastraClient } from '@mastra/client-js';

export const WORKFLOW_ID = 'ossReportWorkflow';

export const MASTRA_BASE_URL =
  (import.meta.env.VITE_MASTRA_API_URL as string | undefined) ??
  // In production the app is served by the Mastra server itself, so use same-origin.
  (import.meta.env.DEV ? 'http://localhost:4115' : window.location.origin);

export const mastraClient = new MastraClient({
  baseUrl: MASTRA_BASE_URL,
});

export const ossReportWorkflow = mastraClient.getWorkflow(WORKFLOW_ID);
