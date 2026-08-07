import { MASTRA_BASE_URL, ossReportWorkflow } from '@/lib/mastra-client';
import type { Report, ReportIndexEntry } from '@/types/report';

class MastraApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MastraApiError';
  }
}

// When the app is hosted behind Mastra platform auth, API calls fail with 401
// once the session cookie is missing/expired. Mirror Studio's behavior: try a
// silent token refresh first, otherwise send the browser to the sign-in page
// with a redirect back to the current URL.
let handlingUnauthorized = false;
async function handleUnauthorized(): Promise<void> {
  if (handlingUnauthorized) return;
  handlingUnauthorized = true;
  try {
    const refresh = await fetch(`${MASTRA_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (refresh.ok) {
      window.location.reload();
      return;
    }
    const params = new URLSearchParams({ redirect_uri: window.location.href });
    const res = await fetch(`${MASTRA_BASE_URL}/api/auth/sso/login?${params}`, {
      credentials: 'include',
    });
    if (res.ok) {
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
    }
  } catch {
    // No auth endpoints available (e.g. local dev) — leave the error visible.
  }
  handlingUnauthorized = false;
}

function wrapError(err: unknown, fallback: string): never {
  // Network/fetch errors from the SDK look like generic TypeErrors when the
  // server is unreachable. Surface a friendlier message to the UI.
  const message = err instanceof Error ? err.message : String(err);
  if (/status:\s*401\b/.test(message)) {
    void handleUnauthorized();
    throw new MastraApiError('Your session has expired — redirecting to sign-in…');
  }
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

// Evented-engine runs (used since the report schedule was added) store the
// workflow result as a step envelope with the report under `output`; older
// runs store the report directly.
function unwrapRunResult(result: unknown): unknown {
  if (
    result &&
    typeof result === 'object' &&
    'output' in result &&
    'status' in result &&
    'payload' in result
  ) {
    return (result as { output: unknown }).output;
  }
  return result;
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
    comparison: report.comparison,
    takeaways: report.takeaways,
    briefing: report.briefing ?? null,
    summary: {
      issuesOpened: report.summary.issuesOpened,
      issuesClosed: report.summary.issuesClosed,
      pullRequests: report.summary.pullRequests,
      discordSentiment: report.summary.discordSentiment.overall,
      analysisCount: report.summary.analysisCount,
      bugSeverityCounts: report.summary.bugSeverityCounts,
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
    const result = unwrapRunResult(snapshot?.result);
    if (!isReport(result)) continue;
    entries.push(reportToIndexEntry(run.runId, result));
  }

  entries.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return entries;
}

export async function startReportRun(params: {
  start: string;
  end: string;
}): Promise<{ runId: string }> {
  try {
    const run = await ossReportWorkflow.createRun();
    await run.start({
      inputData: { start: params.start, end: params.end },
      initialState: {},
    });
    return { runId: run.runId };
  } catch (err) {
    wrapError(err, 'Failed to start workflow run');
  }
}

export type RunStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'suspended'
  | 'waiting'
  | 'pending'
  | 'canceled'
  | 'tripwire'
  | 'bailed'
  | 'paused';

export interface ActiveRun {
  runId: string;
  status: RunStatus;
  createdAt: string;
  period?: { start: string; end: string };
}

export async function listActiveRuns(): Promise<ActiveRun[]> {
  let response;
  try {
    response = await ossReportWorkflow.runs({ perPage: 20 });
  } catch (err) {
    wrapError(err, 'Failed to list workflow runs');
  }

  const active: ActiveRun[] = [];
  for (const run of response.runs) {
    const snapshot = parseSnapshot(run.snapshot);
    const status = (snapshot?.status ?? 'pending') as RunStatus;
    if (status === 'success' || status === 'canceled' || status === 'failed') continue;

    const context = snapshot?.context as Record<string, unknown> | undefined;
    const input = context?.input as Record<string, unknown> | undefined;
    const period =
      input && typeof input.start === 'string' && typeof input.end === 'string'
        ? { start: input.start, end: input.end }
        : undefined;

    active.push({
      runId: run.runId,
      status,
      createdAt:
        typeof run.createdAt === 'string'
          ? run.createdAt
          : new Date().toISOString(),
      period,
    });
  }
  return active;
}

export async function getRunStatus(runId: string): Promise<RunStatus> {
  try {
    const state = await ossReportWorkflow.runById(runId, { fields: [] });
    return state.status as RunStatus;
  } catch (err) {
    wrapError(err, `Failed to load run ${runId}`);
  }
}

export async function deleteRun(runId: string): Promise<void> {
  try {
    await ossReportWorkflow.deleteRunById(runId);
  } catch (err) {
    wrapError(err, `Failed to delete run ${runId}`);
  }
}

export type IssueEdit = {
  issueNumber: number;
  severity?: 'MINOR' | 'MAJOR' | 'CRITICAL';
  type?: 'Bug' | 'Feature Request' | 'Question';
  summary?: string;
};

export interface RebriefResponse {
  runId: string;
  status: string;
  correctionsApplied: Array<{
    issueNumber: number;
    changed: Array<'severity' | 'type' | 'summary'>;
  }>;
}

export async function rebriefRun(
  runId: string,
  edits: IssueEdit[],
): Promise<RebriefResponse> {
  const url = `${MASTRA_BASE_URL}/runs/${encodeURIComponent(runId)}/rebrief`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ edits }),
    });
  } catch (err) {
    wrapError(err, 'Failed to submit rebrief');
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      void handleUnauthorized();
      throw new MastraApiError('Your session has expired — redirecting to sign-in…');
    }
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new MastraApiError(`Rebrief failed: ${message}`);
  }

  return data as RebriefResponse;
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
  const result = unwrapRunResult(state.result);
  if (!isReport(result)) {
    throw new MastraApiError(`Workflow run ${runId} did not produce a valid report.`);
  }
  return result;
}
