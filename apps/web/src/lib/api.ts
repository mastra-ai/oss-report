import { MASTRA_BASE_URL, ossReportWorkflow } from '@/lib/mastra-client';
import type { Report, ReportIndexEntry } from '@/types/report';

class MastraApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MastraApiError';
  }
}

function wrapError(err: unknown, fallback: string): never {
  // Network/fetch errors from the SDK look like generic TypeErrors when the
  // server is unreachable. Surface a friendlier message to the UI.
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch|network|ECONNREFUSED|Failed to fetch/i.test(message)) {
    throw new MastraApiError(
      `Could not reach the Mastra server at ${MASTRA_BASE_URL}. Is it running? (\`pnpm dev:mastra\`)`,
    );
  }
  throw new MastraApiError(`${fallback}: ${message}`);
}

function parseSnapshot(snapshot: unknown): Record<string, unknown> | null {
  if (!snapshot) return null;
  if (typeof snapshot === 'string') {
    try {
      return JSON.parse(snapshot) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof snapshot === 'object') {
    return snapshot as Record<string, unknown>;
  }
  return null;
}

function isReport(value: unknown): value is Report {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.generatedAt === 'string' &&
    typeof v.repo === 'object' &&
    typeof v.period === 'object' &&
    typeof v.summary === 'object' &&
    Array.isArray(v.issueAnalyses)
  );
}

function reportToIndexEntry(runId: string, report: Report): ReportIndexEntry {
  return {
    id: runId,
    generatedAt: report.generatedAt,
    repo: report.repo,
    period: report.period,
    summary: {
      stars: report.summary.stars,
      issuesOpened: report.summary.issuesOpened,
      issuesClosed: report.summary.issuesClosed,
      npmDownloadsTotal: report.summary.npmDownloads.total,
      discordSentiment: report.summary.discordSentiment.overall,
      issueAnalysisCount: report.issueAnalyses.length,
    },
  };
}

export async function fetchReportIndex(): Promise<ReportIndexEntry[]> {
  let response;
  try {
    response = await ossReportWorkflow.runs({ status: 'success', perPage: 50 });
  } catch (err) {
    wrapError(err, 'Failed to list workflow runs');
  }

  const entries: ReportIndexEntry[] = [];
  for (const run of response.runs) {
    const snapshot = parseSnapshot(run.snapshot);
    const result = snapshot?.result;
    if (!isReport(result)) continue;
    entries.push(reportToIndexEntry(run.runId, result));
  }

  entries.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return entries;
}

export async function fetchReport(runId: string): Promise<Report> {
  let state;
  try {
    state = await ossReportWorkflow.runById(runId, { fields: ['result'] });
  } catch (err) {
    wrapError(err, `Failed to load report ${runId}`);
  }

  if (state.status !== 'success') {
    throw new MastraApiError(
      `Workflow run ${runId} is not successful (status: ${state.status}).`,
    );
  }
  if (!isReport(state.result)) {
    throw new MastraApiError(`Workflow run ${runId} did not produce a valid report.`);
  }
  return state.result;
}
