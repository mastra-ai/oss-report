import { MastraClient } from '@mastra/client-js';

export const WORKFLOW_ID = 'ossReportWorkflow';

export const MASTRA_BASE_URL =
  (import.meta.env.VITE_MASTRA_API_URL as string | undefined) ?? 'http://localhost:4115';

export const mastraClient = new MastraClient({
  baseUrl: MASTRA_BASE_URL,
});

export const ossReportWorkflow = mastraClient.getWorkflow(WORKFLOW_ID);
