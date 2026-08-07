import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { briefingAgent } from '../agents/briefing';
import { discordSentimentAgent } from '../agents/discord-sentiment';
import { issueThreadAnalysisAgent } from '../agents/issue-thread-analysis';
import { fetchMessagesInWindow, fetchThreadMessages, getChannelName } from '../shared/discord';
import { cosineSimilarity, embedTexts } from '../shared/embeddings';
import {
  extractDiscordThreadId,
  fetchIssueComments,
  getGithubClient,
  getReportRepo,
} from '../shared/github';
import type { SlackCardChild, SlackCardElement } from '@chat-adapter/slack/blocks';

const ISSUE_ANALYSIS_CONCURRENCY = 5;
const RECURRING_LOOKBACK_WEEKS = 6;
const RECURRING_SIMILARITY_THRESHOLD = Number(
  process.env.OSS_REPORT_RECURRING_THRESHOLD ?? 0.82,
);
const MAX_GENERAL_MESSAGES = Number(process.env.OSS_REPORT_MAX_GENERAL_MESSAGES ?? 200);
const MAX_THREAD_MESSAGES = Number(process.env.OSS_REPORT_MAX_THREAD_MESSAGES ?? 50);

const HIDDEN_LABELS = new Set(['discord', 'triage', 'needs-triage']);

// ---- Schemas ----

const issueCountsSchema = z.object({
  total: z.number(),
  discord: z.number(),
  github: z.number(),
});

const prCountsSchema = z.object({
  opened: z.number(),
  merged: z.number(),
});

const severityCountsSchema = z.object({
  CRITICAL: z.number(),
  MAJOR: z.number(),
  MINOR: z.number(),
});

const typeCountsSchema = z.object({
  Bug: z.number(),
  'Feature Request': z.number(),
  Question: z.number(),
});

const categoryBreakdownSchema = z.object({
  category: z.string(),
  total: z.number(),
  Bug: z.number(),
  'Feature Request': z.number(),
  Question: z.number(),
});

const comparisonSchema = z.object({
  backlogDelta: z.number().nullable(),
  issuesOpenedDelta: z.number().nullable(),
  issuesClosedDelta: z.number().nullable(),
  mergedPrDelta: z.number().nullable(),
  analysisCountDelta: z.number().nullable(),
  criticalBugDelta: z.number().nullable(),
  sentimentChanged: z.boolean().nullable(),
  sentimentDeltaSummary: z.string().nullable(),
});

const takeawaysSchema = z.object({
  improved: z.array(z.string()),
  regressed: z.array(z.string()),
  watch: z.array(z.string()),
});

const actionsSchema = z.object({
  priorityIssues: z.array(z.number()),
  recommendedActions: z.array(z.string()),
  needsDocsAttention: z.array(z.string()),
  recurringPainAreas: z.array(z.string()),
});

const operationalHealthSchema = z.object({
  medianTimeToCloseDays: z.number().nullable(),
  closedWithin7Days: z.number(),
  closedWithin30Days: z.number(),
});

const briefingWinSchema = z.object({
  text: z.string(),
  evidence: z.string().nullable(),
});

const briefingRegressionSchema = z.object({
  text: z.string(),
  evidence: z.string().nullable(),
});

const briefingRelatedSignalSchema = z.object({
  source: z.enum(['github', 'discord']),
  label: z.string(),
  url: z.string().nullable(),
  periodEnd: z.string(),
});

// Shape the agent emits. Code authoritatively rewrites the recurring list
// after the agent call, attaching weeksSeen and relatedSignals from the
// deterministic clusters. The agent only phrases the cluster.
const briefingRecurringAgentSchema = z.object({
  text: z.string(),
  source: z.enum(['github', 'discord']),
  issueNumber: z.number().nullable(),
  issueUrl: z.string().nullable(),
  aspect: z.string().nullable(),
});

const briefingRecurringSchema = briefingRecurringAgentSchema.extend({
  weeksSeen: z.number(),
  relatedSignals: z.array(briefingRelatedSignalSchema),
});

const briefingCorrectionSchema = z.object({
  issueNumber: z.number(),
  changed: z.array(z.enum(['severity', 'type', 'summary'])),
});

export const briefingAgentOutputSchema = z.object({
  headline: z.string(),
  wins: z.array(briefingWinSchema),
  regressions: z.array(briefingRegressionSchema),
  recurring: z.array(briefingRecurringAgentSchema),
  recurringRequests: z.array(briefingRecurringAgentSchema),
  talkingPoints: z.array(z.string()),
});

export const briefingSchema = briefingAgentOutputSchema.extend({
  recurring: z.array(briefingRecurringSchema),
  recurringRequests: z.array(briefingRecurringSchema),
  correctionsApplied: z.array(briefingCorrectionSchema).optional(),
});

const workflowInputSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  // 'week-to-date' computes the window at run time: most recent Monday 00:00
  // UTC through now. Used by the weekly schedule, where inputData is static.
  window: z.enum(['week-to-date']).optional(),
  maxIssueAnalyses: z.number().int().positive().max(500).optional(),
});

const aspectEnum = z.enum([
  'agents',
  'workflows',
  'memory',
  'rag',
  'tools',
  'observability',
  'deployer',
  'studio',
  'docs',
  'models',
  'auth',
  'cli',
  'voice',
  'community',
  'other',
]);

const sentimentSignalSchema = z.object({
  headline: z.string(),
  detail: z.string().nullable(),
  messageIds: z.array(z.string()),
  messageUrls: z.array(z.string()),
});

const painPointSchema = sentimentSignalSchema.extend({
  // 'pain' = current friction with existing functionality
  // 'request' = wishing for new functionality / feature ask
  kind: z.enum(['pain', 'request']),
});

const aspectSentimentSchema = z.object({
  aspect: aspectEnum,
  sentiment: z.enum(['positive', 'negative', 'mixed']),
  positives: z.array(sentimentSignalSchema),
  painPoints: z.array(painPointSchema),
});

const discordSentimentSchema = z.object({
  overall: z.enum(['positive', 'neutral', 'negative', 'mixed', 'unknown']),
  summary: z.string(),
  weekOverWeek: z.string().nullable(),
  aspects: z.array(aspectSentimentSchema),
  messageCount: z.number(),
  uniqueAuthorCount: z.number(),
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
});

const lifecycleEnum = z.enum(['opened', 'closed', 'opened-and-closed']);
const closureReasonEnum = z.enum(['fixed', 'wontfix', 'duplicate', 'stale', 'unknown']);

const resolutionCountsSchema = z.object({
  fixed: z.number(),
  wontfix: z.number(),
  duplicate: z.number(),
  stale: z.number(),
  unknown: z.number(),
});

export const issueAnalysisSchema = z.object({
  issueNumber: z.number(),
  issueTitle: z.string(),
  issueUrl: z.string().url(),
  issueState: z.enum(['open', 'closed']),
  lifecycle: lifecycleEnum,
  closedAt: z.string().nullable(),
  closureReason: closureReasonEnum.nullable(),
  authorLogin: z.string().nullable(),
  createdAt: z.string(),
  commentCount: z.number(),
  labels: z.array(z.string()),
  threadUrl: z.string().url().nullable(),
  threadMessageCount: z.number(),
  source: z.enum(['discord-thread', 'github-only']),
  summary: z.string(),
  type: z.enum(['Bug', 'Feature Request', 'Question']),
  category: z.string(),
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
  correctedAt: z.string().nullable().optional(),
});

export const reportSummarySchema = z.object({
  openBacklog: z.number(),
  issuesOpened: issueCountsSchema,
  issuesClosed: issueCountsSchema,
  pullRequests: prCountsSchema,
  analysisCount: z.number(),
  typeCounts: typeCountsSchema,
  bugSeverityCounts: severityCountsSchema,
  resolutionCounts: resolutionCountsSchema,
  closedInWindowCount: z.number(),
  categoryBreakdown: z.array(categoryBreakdownSchema),
  operationalHealth: operationalHealthSchema,
  discordSentiment: discordSentimentSchema,
});

export const reportWithoutBriefingSchema = z.object({
  generatedAt: z.string(),
  repo: z.object({
    owner: z.string(),
    name: z.string(),
  }),
  period: z.object({
    start: z.string(),
    end: z.string(),
    label: z.string(),
  }),
  comparison: comparisonSchema,
  takeaways: takeawaysSchema,
  actions: actionsSchema,
  summary: reportSummarySchema,
  issueAnalyses: z.array(issueAnalysisSchema),
  signalEmbeddings: z.record(z.string(), z.array(z.number())),
});

export const generateBriefingInputSchema = reportWithoutBriefingSchema.extend({
  correctionsApplied: z.array(briefingCorrectionSchema).optional(),
});

export const reportSchema = reportWithoutBriefingSchema.extend({
  briefing: briefingSchema.nullable(),
});

const reportContextSchema = z.object({
  repo: z.object({
    owner: z.string(),
    name: z.string(),
  }),
  period: z.object({
    start: z.string(),
    end: z.string(),
    label: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  config: z.object({
    generalChannelId: z.string().nullable(),
    maxIssueAnalyses: z.number(),
  }),
});

const repoMetricsSchema = z.object({
  openBacklog: z.number(),
  issuesOpened: issueCountsSchema,
  issuesClosed: issueCountsSchema,
  pullRequests: prCountsSchema,
});

const reportMetricsSchema = reportContextSchema.extend({
  metrics: repoMetricsSchema,
});

const reportStateSchema = z.object({
  repo: reportContextSchema.shape.repo.optional(),
  period: reportContextSchema.shape.period.optional(),
  config: reportContextSchema.shape.config.optional(),
  metrics: repoMetricsSchema.optional(),
});

const issueCandidateSchema = z.object({
  issueNumber: z.number(),
  issueTitle: z.string(),
  issueUrl: z.string().url(),
  issueState: z.enum(['open', 'closed']),
  lifecycle: lifecycleEnum,
  closedAt: z.string().nullable(),
  stateReason: z.string().nullable(),
  authorLogin: z.string().nullable(),
  createdAt: z.string(),
  commentCount: z.number(),
  labels: z.array(z.string()),
  body: z.string().nullable(),
  threadId: z.string().nullable(),
});

// ---- Helpers ----

// Most recent Monday 00:00 UTC relative to `now`.
function startOfWeekUtc(now: Date): Date {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  );
}

function getWindow(input: z.infer<typeof workflowInputSchema>) {
  const end = input.end ? new Date(input.end) : new Date();
  const start = input.start
    ? new Date(input.start)
    : input.window === 'week-to-date'
      ? startOfWeekUtc(end)
      : new Date(end.getTime() - 1000 * 60 * 60 * 24 * 30);

  return { start, end };
}

// GitHub's `state_reason` is a useful signal for why an issue was closed, but
// it's coarse: `not_planned` is documented as "Won't fix, can't repro, stale"
// (all three collapsed into one value in the close dialog), so we can't
// deterministically map it. Only `completed` and `duplicate` are unambiguous;
// for `not_planned` we defer to the LLM, which has the closing comment and
// labels in context.
function closureReasonFromStateReason(
  stateReason: string | null,
): 'fixed' | 'duplicate' | null {
  switch (stateReason) {
    case 'completed':
      return 'fixed';
    case 'duplicate':
      return 'duplicate';
    default:
      return null;
  }
}

function toDateLabel(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${formatter.format(start)} → ${formatter.format(end)}`;
}

function filterLabels(labels: string[]): string[] {
  return labels
    .map(label => label.trim())
    .filter(label => label.length > 0 && !HIDDEN_LABELS.has(label.toLowerCase()));
}

function requireReportState(state: z.infer<typeof reportStateSchema>) {
  if (!state.repo || !state.period || !state.config || !state.metrics) {
    throw new Error('Report workflow state is incomplete.');
  }

  return {
    repo: state.repo,
    period: state.period,
    config: state.config,
    metrics: state.metrics,
  };
}

function isIssueAnalysis(
  issueAnalysis: z.infer<typeof issueAnalysisSchema> | null | undefined,
): issueAnalysis is z.infer<typeof issueAnalysisSchema> {
  return issueAnalysis != null;
}

function parseRunSnapshot(snapshot: unknown): Record<string, unknown> | null {
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

/**
 * Normalize a stored run's `result`. Default-engine runs store the workflow
 * output directly; evented-engine runs (used since the schedule was added)
 * store a step envelope `{ startedAt, payload, status, endedAt, output }`
 * with the report under `output`.
 */
export function unwrapRunResult(result: unknown): unknown {
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

export async function loadPreviousReport(
  mastra: { getWorkflow?: (id: string) => unknown } | undefined,
  currentPeriod: { start: Date; end: Date },
  logger?: { info?: (message: string) => void; warn?: (message: string) => void },
): Promise<z.infer<typeof reportSchema> | null> {
  try {
    const workflow = mastra?.getWorkflow?.('oss-report-workflow') as
      | { listWorkflowRuns?: (args: unknown) => Promise<{ runs: Array<{ snapshot?: unknown; createdAt?: string }> }> }
      | undefined;
    if (!workflow?.listWorkflowRuns) return null;

    const { runs } = await workflow.listWorkflowRuns({
      status: 'success',
      perPage: 50,
      page: 0,
    });

    const currentStart = currentPeriod.start.getTime();
    const currentEnd = currentPeriod.end.getTime();

    const candidates = (runs ?? [])
      .map(run => {
        const snapshot = parseRunSnapshot(run.snapshot);
        const result = unwrapRunResult(snapshot?.result) as z.infer<typeof reportSchema> | undefined;
        const createdAt = run.createdAt ? new Date(run.createdAt).getTime() : 0;
        return { result, createdAt };
      })
      .filter((entry): entry is { result: z.infer<typeof reportSchema>; createdAt: number } => {
        const result = entry.result;
        if (!result?.period?.start || !result.period.end || !result.summary?.discordSentiment) return false;

        const previousStart = new Date(result.period.start).getTime();
        const previousEnd = new Date(result.period.end).getTime();

        if (Number.isNaN(previousStart) || Number.isNaN(previousEnd)) return false;
        if (previousStart === currentStart && previousEnd === currentEnd) return false;

        return previousEnd < currentEnd;
      })
      // Most recent period first; break ties by most recently created run so
      // re-runs and rebriefs supersede stale originals covering the same week.
      .sort((a, b) => {
        const endDiff = new Date(b.result.period.end).getTime() - new Date(a.result.period.end).getTime();
        if (endDiff !== 0) return endDiff;
        return b.createdAt - a.createdAt;
      });

    // Collapse overlapping prior periods (e.g. May 14→20 and May 14→21) to a
    // single representative, preferring the most recently created run. This
    // avoids comparing against a stale duplicate whose counts were never
    // corrected.
    const deduped: Array<{ result: z.infer<typeof reportSchema>; createdAt: number }> = [];
    for (const entry of candidates) {
      const start = new Date(entry.result.period.start).getTime();
      const end = new Date(entry.result.period.end).getTime();
      const overlapIndex = deduped.findIndex(kept => {
        const keptStart = new Date(kept.result.period.start).getTime();
        const keptEnd = new Date(kept.result.period.end).getTime();
        return start < keptEnd && keptStart < end;
      });
      if (overlapIndex === -1) {
        deduped.push(entry);
      } else if (entry.createdAt > deduped[overlapIndex].createdAt) {
        deduped[overlapIndex] = entry;
      }
    }

    return deduped[0]?.result ?? null;
  } catch (error) {
    logger?.warn?.(`Failed to load previous report context: ${String(error)}`);
    return null;
  }
}

/**
 * Load the most recent stored reports (newest first, current runs included),
 * deduped so overlapping re-runs of the same week collapse to the freshest
 * run. Used by the Slack report agent to answer questions about past reports.
 */
export async function loadStoredReports(
  mastra: { getWorkflow?: (id: string) => unknown } | undefined,
  limit: number,
  logger?: { warn?: (message: string) => void },
): Promise<Array<z.infer<typeof reportSchema>>> {
  try {
    const workflow = mastra?.getWorkflow?.('oss-report-workflow') as
      | { listWorkflowRuns?: (args: unknown) => Promise<{ runs: Array<{ snapshot?: unknown; createdAt?: string }> }> }
      | undefined;
    if (!workflow?.listWorkflowRuns) return [];

    const { runs } = await workflow.listWorkflowRuns({
      status: 'success',
      perPage: 50,
      page: 0,
    });

    const candidates = (runs ?? [])
      .map(run => {
        const snapshot = parseRunSnapshot(run.snapshot);
        const result = unwrapRunResult(snapshot?.result) as z.infer<typeof reportSchema> | undefined;
        const createdAt = run.createdAt ? new Date(run.createdAt).getTime() : 0;
        return { result, createdAt };
      })
      .filter((entry): entry is { result: z.infer<typeof reportSchema>; createdAt: number } => {
        const result = entry.result;
        if (!result?.period?.start || !result.period.end || !result.summary?.discordSentiment) return false;
        return !Number.isNaN(new Date(result.period.end).getTime());
      })
      .sort((a, b) => {
        const endDiff = new Date(b.result.period.end).getTime() - new Date(a.result.period.end).getTime();
        if (endDiff !== 0) return endDiff;
        return b.createdAt - a.createdAt;
      });

    const deduped: Array<{ result: z.infer<typeof reportSchema>; createdAt: number }> = [];
    for (const entry of candidates) {
      const start = new Date(entry.result.period.start).getTime();
      const end = new Date(entry.result.period.end).getTime();
      const overlapIndex = deduped.findIndex(kept => {
        const keptStart = new Date(kept.result.period.start).getTime();
        const keptEnd = new Date(kept.result.period.end).getTime();
        return start < keptEnd && keptStart < end;
      });
      if (overlapIndex === -1) {
        deduped.push(entry);
      } else if (entry.createdAt > deduped[overlapIndex].createdAt) {
        deduped[overlapIndex] = entry;
      }
    }

    return deduped.slice(0, limit).map(entry => entry.result);
  } catch (error) {
    logger?.warn?.(`Failed to load stored reports: ${String(error)}`);
    return [];
  }
}

// ---- Recurring-theme detection (deterministic, embedding-based) ----

export type SignalSource = 'github' | 'discord';
export type SignalKind = 'pain' | 'request';

export interface WeekSignal {
  signalId: string;
  source: SignalSource;
  kind: SignalKind;
  text: string;
  label: string;
  url: string | null;
  // github only
  issueNumber?: number;
  category?: string;
  // discord only
  aspect?: string;
}

/**
 * Turn a stored report into the flat pool of "signals" that can recur:
 * GitHub issue analyses and Discord pain points. Positives are excluded —
 * recurring is about persistent problems or persistent feature asks. Each
 * signal carries a `kind` so pains and requests can be clustered separately.
 */
export function extractWeekSignals(
  report: Pick<z.infer<typeof reportWithoutBriefingSchema>, 'issueAnalyses' | 'summary'>,
): WeekSignal[] {
  const signals: WeekSignal[] = [];

  for (const issue of report.issueAnalyses) {
    // Recurring is about persistent open problems. Skip issues that were closed
    // (in any prior or current week), so resolved work doesn't keep surfacing.
    if (issue.lifecycle !== 'opened') continue;
    signals.push({
      signalId: `gh:${issue.issueNumber}`,
      source: 'github',
      kind: issue.type === 'Feature Request' ? 'request' : 'pain',
      text: `${issue.issueTitle}\n${issue.summary}`,
      label: `#${issue.issueNumber} ${issue.issueTitle}`,
      url: issue.issueUrl,
      issueNumber: issue.issueNumber,
      category: issue.category,
    });
  }

  for (const aspect of report.summary.discordSentiment.aspects) {
    aspect.painPoints.forEach((pain, index) => {
      signals.push({
        signalId: `dc:${aspect.aspect}:${index}`,
        source: 'discord',
        kind: pain.kind ?? 'pain',
        text: `${pain.headline}\n${pain.detail ?? ''}`.trim(),
        label: `${aspect.aspect}: ${pain.headline}`,
        url: pain.messageUrls[0] ?? null,
        aspect: aspect.aspect,
      });
    });
  }

  return signals;
}

export interface RecentWeek {
  periodEnd: string;
  signals: WeekSignal[];
  embeddings: Record<string, number[]>;
}

/**
 * Load the last N successful reports before the current period (most recent
 * first, current period excluded), deduped against overlapping re-runs. Each
 * week carries its signal pool and the cached signal embeddings persisted in
 * the run snapshot, so prior weeks never need re-embedding.
 */
export async function loadRecentReports(
  mastra: { getWorkflow?: (id: string) => unknown } | undefined,
  currentPeriod: { start: Date; end: Date },
  limit: number,
  logger?: { info?: (message: string) => void; warn?: (message: string) => void },
): Promise<RecentWeek[]> {
  try {
    const workflow = mastra?.getWorkflow?.('oss-report-workflow') as
      | { listWorkflowRuns?: (args: unknown) => Promise<{ runs: Array<{ snapshot?: unknown; createdAt?: string }> }> }
      | undefined;
    if (!workflow?.listWorkflowRuns) return [];

    const { runs } = await workflow.listWorkflowRuns({
      status: 'success',
      perPage: 50,
      page: 0,
    });

    const currentStart = currentPeriod.start.getTime();
    const currentEnd = currentPeriod.end.getTime();

    const candidates = (runs ?? [])
      .map(run => {
        const snapshot = parseRunSnapshot(run.snapshot);
        const result = unwrapRunResult(snapshot?.result) as z.infer<typeof reportSchema> | undefined;
        const createdAt = run.createdAt ? new Date(run.createdAt).getTime() : 0;
        return { result, createdAt };
      })
      .filter((entry): entry is { result: z.infer<typeof reportSchema>; createdAt: number } => {
        const result = entry.result;
        if (!result?.period?.start || !result.period.end || !result.summary?.discordSentiment) return false;

        const previousStart = new Date(result.period.start).getTime();
        const previousEnd = new Date(result.period.end).getTime();

        if (Number.isNaN(previousStart) || Number.isNaN(previousEnd)) return false;
        if (previousStart === currentStart && previousEnd === currentEnd) return false;

        return previousEnd < currentEnd;
      })
      .sort((a, b) => {
        const endDiff = new Date(b.result.period.end).getTime() - new Date(a.result.period.end).getTime();
        if (endDiff !== 0) return endDiff;
        return b.createdAt - a.createdAt;
      });

    // Collapse overlapping prior periods to a single representative, preferring
    // the most recently created run (so a rebriefed week supersedes its stale
    // original and is never double-counted as two distinct weeks).
    const deduped: Array<{ result: z.infer<typeof reportSchema>; createdAt: number }> = [];
    for (const entry of candidates) {
      const start = new Date(entry.result.period.start).getTime();
      const end = new Date(entry.result.period.end).getTime();
      const overlapIndex = deduped.findIndex(kept => {
        const keptStart = new Date(kept.result.period.start).getTime();
        const keptEnd = new Date(kept.result.period.end).getTime();
        return start < keptEnd && keptStart < end;
      });
      if (overlapIndex === -1) {
        deduped.push(entry);
      } else if (entry.createdAt > deduped[overlapIndex].createdAt) {
        deduped[overlapIndex] = entry;
      }
    }

    return deduped.slice(0, limit).map(entry => ({
      periodEnd: entry.result.period.end,
      signals: extractWeekSignals(entry.result),
      embeddings: entry.result.signalEmbeddings ?? {},
    }));
  } catch (error) {
    logger?.warn?.(`Failed to load recent reports: ${String(error)}`);
    return [];
  }
}

export interface RecurringCluster {
  currentSignal: { id: string; source: SignalSource; label: string; url: string | null };
  weeksSeen: number;
  priorWeeks: string[];
  relatedSignals: Array<{ source: SignalSource; label: string; url: string | null; periodEnd: string }>;
  theme: string;
  // convenience fields for the briefing payload / schema
  issueNumber?: number;
  issueUrl?: string;
  aspect?: string;
}

/**
 * Deterministic recurring gate. For each current-week signal, match it against
 * every prior-week signal **of the same kind** by cosine similarity. A signal
 * qualifies as recurring only when its matches span >= 2 distinct prior weeks
 * (cross-source allowed within the same kind). Returns one cluster per
 * qualifying current-week signal, separated by kind.
 */
export function computeRecurringClusters(
  currentSignals: WeekSignal[],
  currentEmbeddings: Record<string, number[]>,
  priorWeeks: RecentWeek[],
  threshold: number,
): { pains: RecurringCluster[]; requests: RecurringCluster[] } {
  const pains: RecurringCluster[] = [];
  const requests: RecurringCluster[] = [];

  for (const signal of currentSignals) {
    const vector = currentEmbeddings[signal.signalId];
    if (!vector) continue;

    const matchedWeeks = new Set<string>();
    const relatedSignals: RecurringCluster['relatedSignals'] = [];

    for (const week of priorWeeks) {
      let weekMatched = false;
      for (const prior of week.signals) {
        if (prior.kind !== signal.kind) continue;
        // Skip self-match: a single issue persisting across weeks is not the
        // same as a recurring theme. Recurring needs distinct signal ids.
        if (prior.signalId === signal.signalId) continue;
        const priorVector = week.embeddings[prior.signalId];
        if (!priorVector) continue;
        if (cosineSimilarity(vector, priorVector) >= threshold) {
          weekMatched = true;
          relatedSignals.push({
            source: prior.source,
            label: prior.label,
            url: prior.url,
            periodEnd: week.periodEnd,
          });
        }
      }
      if (weekMatched) matchedWeeks.add(week.periodEnd);
    }

    if (matchedWeeks.size >= 2) {
      const cluster: RecurringCluster = {
        currentSignal: {
          id: signal.signalId,
          source: signal.source,
          label: signal.label,
          url: signal.url,
        },
        weeksSeen: matchedWeeks.size + 1,
        priorWeeks: [...matchedWeeks].sort(),
        relatedSignals,
        theme: signal.label,
        issueNumber: signal.issueNumber,
        issueUrl: signal.source === 'github' ? signal.url ?? undefined : undefined,
        aspect: signal.aspect,
      };
      (signal.kind === 'request' ? requests : pains).push(cluster);
    }
  }

  return { pains, requests };
}

async function loadPreviousSentimentContext(
  mastra: { getWorkflow?: (id: string) => unknown } | undefined,
  currentPeriod: { start: Date; end: Date },
  logger?: { info?: (message: string) => void; warn?: (message: string) => void },
): Promise<{ period: string; text: string } | null> {
  const previousReport = await loadPreviousReport(mastra, currentPeriod, logger);
  if (!previousReport) return null;

  const s = previousReport.summary.discordSentiment;
  const aspectLine = s.aspects?.map(a => `${a.aspect} (${a.sentiment})`).join(', ');
  const text = [
    `Overall: ${s.overall}.`,
    s.summary,
    aspectLine ? `Aspects discussed: ${aspectLine}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return { period: previousReport.period.label, text };
}

function delta(current: number, previous: number): number {
  return current - previous;
}

function daysBetween(start: string, end: string): number {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Number(sorted[mid].toFixed(1));
  return Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(1));
}

export function computeIssueRollups(issueAnalyses: z.infer<typeof issueAnalysisSchema>[]) {
  const typeCounts: z.infer<typeof typeCountsSchema> = {
    Bug: 0,
    'Feature Request': 0,
    Question: 0,
  };
  const bugSeverityCounts: z.infer<typeof severityCountsSchema> = {
    CRITICAL: 0,
    MAJOR: 0,
    MINOR: 0,
  };
  const resolutionCounts: z.infer<typeof resolutionCountsSchema> = {
    fixed: 0,
    wontfix: 0,
    duplicate: 0,
    stale: 0,
    unknown: 0,
  };
  const categoryMap = new Map<string, z.infer<typeof categoryBreakdownSchema>>();
  const newIssueAnalyses = issueAnalyses.filter(
    issue => issue.lifecycle === 'opened' || issue.lifecycle === 'opened-and-closed',
  );
  let closedInWindowCount = 0;

  // Intake composition only describes issues created during this report window.
  // Older issues closed during the window belong in resolution metrics instead.
  for (const a of newIssueAnalyses) {
    typeCounts[a.type] += 1;

    if (a.type === 'Bug') {
      bugSeverityCounts[a.severity] += 1;
    }

    let bucket = categoryMap.get(a.category);
    if (!bucket) {
      bucket = {
        category: a.category,
        total: 0,
        Bug: 0,
        'Feature Request': 0,
        Question: 0,
      };
      categoryMap.set(a.category, bucket);
    }
    bucket.total += 1;
    bucket[a.type] += 1;
  }

  for (const a of issueAnalyses) {
    if (a.lifecycle === 'closed' || a.lifecycle === 'opened-and-closed') {
      closedInWindowCount += 1;
      if (a.closureReason) {
        resolutionCounts[a.closureReason] += 1;
      }
    }
  }

  const categoryBreakdown = [...categoryMap.values()].sort((a, b) => b.total - a.total);
  const closedDurations = issueAnalyses
    .filter(issue => (issue.lifecycle === 'closed' || issue.lifecycle === 'opened-and-closed') && issue.closedAt)
    .map(issue => daysBetween(issue.createdAt, issue.closedAt!));
  const closedWithin7Days = closedDurations.filter(days => days <= 7).length;
  const closedWithin30Days = closedDurations.filter(days => days <= 30).length;

  return {
    analysisCount: newIssueAnalyses.length,
    typeCounts,
    bugSeverityCounts,
    resolutionCounts,
    closedInWindowCount,
    categoryBreakdown,
    operationalHealth: {
      medianTimeToCloseDays: median(closedDurations),
      closedWithin7Days,
      closedWithin30Days,
    },
  };
}

export function computeComparison(
  summary: z.infer<typeof reportSummarySchema>,
  previousReport: z.infer<typeof reportSchema> | null,
): z.infer<typeof comparisonSchema> {
  if (!previousReport) {
    return {
      backlogDelta: null,
      issuesOpenedDelta: null,
      issuesClosedDelta: null,
      mergedPrDelta: null,
      analysisCountDelta: null,
      criticalBugDelta: null,
      sentimentChanged: null,
      sentimentDeltaSummary: null,
    };
  }
  return {
    backlogDelta: delta(summary.openBacklog, previousReport.summary.openBacklog),
    issuesOpenedDelta: delta(summary.issuesOpened.total, previousReport.summary.issuesOpened.total),
    issuesClosedDelta: delta(summary.issuesClosed.total, previousReport.summary.issuesClosed.total),
    mergedPrDelta: delta(summary.pullRequests.merged, previousReport.summary.pullRequests.merged),
    analysisCountDelta: delta(summary.analysisCount, previousReport.summary.analysisCount),
    criticalBugDelta: delta(summary.bugSeverityCounts.CRITICAL, previousReport.summary.bugSeverityCounts.CRITICAL),
    sentimentChanged:
      summary.discordSentiment.overall !== previousReport.summary.discordSentiment.overall,
    sentimentDeltaSummary:
      summary.discordSentiment.overall === previousReport.summary.discordSentiment.overall
        ? null
        : `Discord sentiment moved from ${previousReport.summary.discordSentiment.overall} to ${summary.discordSentiment.overall}.`,
  };
}

export function applyIssueEdits(
  analyses: z.infer<typeof issueAnalysisSchema>[],
  edits: Array<{
    issueNumber: number;
    severity?: 'MINOR' | 'MAJOR' | 'CRITICAL';
    type?: 'Bug' | 'Feature Request' | 'Question';
    summary?: string;
  }>,
): {
  analyses: z.infer<typeof issueAnalysisSchema>[];
  applied: Array<{ issueNumber: number; changed: Array<'severity' | 'type' | 'summary'> }>;
} {
  const editsByNumber = new Map(edits.map(e => [e.issueNumber, e]));
  const applied: Array<{ issueNumber: number; changed: Array<'severity' | 'type' | 'summary'> }> = [];
  const correctedAt = new Date().toISOString();

  const next = analyses.map(analysis => {
    const edit = editsByNumber.get(analysis.issueNumber);
    if (!edit) return analysis;

    const changed: Array<'severity' | 'type' | 'summary'> = [];
    let nextType = analysis.type;
    let nextSeverity = analysis.severity;
    let nextSummary = analysis.summary;

    if (edit.type !== undefined && edit.type !== analysis.type) {
      nextType = edit.type;
      changed.push('type');
    }
    if (edit.severity !== undefined && edit.severity !== analysis.severity) {
      nextSeverity = edit.severity;
      changed.push('severity');
    }
    if (edit.summary !== undefined && edit.summary !== analysis.summary) {
      nextSummary = edit.summary;
      changed.push('summary');
    }

    // Non-bugs always have MINOR severity (matches analyzeIssueStep coercion).
    if (nextType !== 'Bug' && nextSeverity !== 'MINOR') {
      nextSeverity = 'MINOR';
      if (!changed.includes('severity')) changed.push('severity');
    }

    if (changed.length === 0) return analysis;

    applied.push({ issueNumber: analysis.issueNumber, changed });

    return {
      ...analysis,
      type: nextType,
      severity: nextSeverity,
      summary: nextSummary,
      correctedAt,
    };
  });

  return { analyses: next, applied };
}

export function buildTakeaways(args: {
  summary: z.infer<typeof reportSummarySchema>;
  comparison: z.infer<typeof comparisonSchema>;
}) {
  const { summary, comparison } = args;
  const improved: string[] = [];
  const regressed: string[] = [];
  const watch: string[] = [];

  if ((comparison.backlogDelta ?? 0) < 0) {
    improved.push(`Open backlog fell by ${Math.abs(comparison.backlogDelta ?? 0)} issues.`);
  }
  if ((comparison.issuesClosedDelta ?? 0) > 0) {
    improved.push(`Closed throughput improved by ${comparison.issuesClosedDelta} issues.`);
  }
  if ((comparison.mergedPrDelta ?? 0) > 0) {
    improved.push(`Merged PR volume increased by ${comparison.mergedPrDelta}.`);
  }

  if ((comparison.backlogDelta ?? 0) > 0) {
    regressed.push(`Open backlog grew by ${comparison.backlogDelta} issues.`);
  }
  if ((comparison.criticalBugDelta ?? 0) > 0) {
    regressed.push(`Critical bugs increased by ${comparison.criticalBugDelta}.`);
  }
  if (summary.discordSentiment.overall === 'negative') {
    regressed.push('Discord sentiment turned negative in the general channel.');
  }

  if (comparison.sentimentDeltaSummary) {
    watch.push(comparison.sentimentDeltaSummary);
  }

  if (improved.length === 0) {
    improved.push('No clear week-over-week improvement signal yet.');
  }
  if (regressed.length === 0) {
    regressed.push('No major regression stood out versus the prior report.');
  }
  if (watch.length === 0) {
    watch.push('No concentrated risk area surfaced beyond normal triage load.');
  }

  return {
    improved: improved.slice(0, 3),
    regressed: regressed.slice(0, 3),
    watch: watch.slice(0, 3),
  };
}

export function buildActions(args: {
  issueAnalyses: z.infer<typeof issueAnalysisSchema>[];
  summary: z.infer<typeof reportSummarySchema>;
  comparison: z.infer<typeof comparisonSchema>;
}) {
  const { issueAnalyses, summary, comparison } = args;
  const recurringPainAreas = summary.discordSentiment.aspects
    .filter(aspect => aspect.painPoints.length > 0)
    .sort((a, b) => b.painPoints.length - a.painPoints.length)
    .slice(0, 3)
    .map(aspect => `${aspect.aspect}: ${aspect.painPoints[0]?.headline ?? 'community friction'}`);

  const docsCandidates = [
    ...summary.discordSentiment.aspects
      .filter(aspect => aspect.aspect === 'docs' || aspect.painPoints.some(point => /docs?|guide|example/i.test(`${point.headline} ${point.detail ?? ''}`)))
      .map(aspect => `${aspect.aspect}: ${aspect.painPoints[0]?.headline ?? 'documentation gap'}`),
    ...issueAnalyses
      .filter(issue => issue.type !== 'Bug' && /docs?|guide|example/i.test(`${issue.issueTitle} ${issue.summary}`))
      .slice(0, 2)
      .map(issue => `#${issue.issueNumber}: ${issue.issueTitle}`),
  ];

  const priorityIssues = issueAnalyses
    .filter(issue => issue.issueState === 'open')
    .sort((a, b) => {
      const severityRank = { CRITICAL: 3, MAJOR: 2, MINOR: 1 } as const;
      const severityDelta = severityRank[b.severity] - severityRank[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return b.threadMessageCount - a.threadMessageCount || b.commentCount - a.commentCount;
    })
    .slice(0, 5)
    .map(issue => issue.issueNumber);

  const recommendedActions: string[] = [];
  if ((comparison.backlogDelta ?? 0) > 0 && summary.issuesClosed.total < summary.issuesOpened.total) {
    recommendedActions.push('Spend one triage pass on backlog reduction; intake outpaced closures this window.');
  }
  if (summary.discordSentiment.overall === 'negative' || summary.discordSentiment.overall === 'mixed') {
    recommendedActions.push('Use Discord pain points to drive the next maintainer triage agenda.');
  }
  if (summary.operationalHealth.medianTimeToCloseDays && summary.operationalHealth.medianTimeToCloseDays > 14) {
    recommendedActions.push(
      `Reduce median time to close from ${summary.operationalHealth.medianTimeToCloseDays} days by clearing easy fixes and duplicates first.`,
    );
  }

  return {
    priorityIssues,
    recommendedActions: recommendedActions.slice(0, 5),
    needsDocsAttention: Array.from(new Set(docsCandidates)).slice(0, 3),
    recurringPainAreas,
  };
}

async function searchCount(query: string, logger?: { info?: (message: string) => void }) {
  const github = getGithubClient();
  const response = await github.rest.search.issuesAndPullRequests({
    q: query,
    per_page: 1,
    page: 1,
  });
  logger?.info?.(`GitHub search ${query}: total_count=${response.data.total_count}`);
  return response.data.total_count;
}

// ---- Steps ----

const resolveReportContextStep = createStep({
  id: 'resolve-report-context',
  inputSchema: workflowInputSchema,
  outputSchema: reportContextSchema,
  stateSchema: reportStateSchema,
  execute: async ({ inputData, mastra, setState, state }) => {
    const logger = mastra?.getLogger();
    const { owner, repo } = getReportRepo();
    const { start, end } = getWindow(inputData);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    logger?.info(`Collecting OSS report for ${owner}/${repo} from ${startDate} to ${endDate}`);

    const context = {
      repo: { owner, name: repo },
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        label: toDateLabel(start, end),
        startDate,
        endDate,
      },
      config: {
        generalChannelId: process.env.DISCORD_GENERAL_CHANNEL_ID || null,
        maxIssueAnalyses: inputData.maxIssueAnalyses ?? 500,
      },
    };

    await setState({
      ...state,
      ...context,
    });

    return context;
  },
});

const collectRepoMetricsStep = createStep({
  id: 'collect-repo-metrics',
  inputSchema: reportContextSchema,
  outputSchema: reportMetricsSchema,
  stateSchema: reportStateSchema,
  execute: async ({ inputData, mastra, setState, state }) => {
    const logger = mastra?.getLogger();
    const owner = inputData.repo.owner;
    const repo = inputData.repo.name;
    const { startDate, endDate } = inputData.period;

    const [
      openedTotal,
      openedDiscord,
      closedTotal,
      closedDiscord,
      openBacklog,
      prsOpened,
      prsMerged,
    ] = await Promise.all([
      searchCount(`repo:${owner}/${repo} is:issue created:${startDate}..${endDate}`, logger),
      searchCount(
        `repo:${owner}/${repo} is:issue label:discord created:${startDate}..${endDate}`,
        logger,
      ),
      searchCount(`repo:${owner}/${repo} is:issue is:closed closed:${startDate}..${endDate}`, logger),
      searchCount(
        `repo:${owner}/${repo} is:issue is:closed label:discord closed:${startDate}..${endDate}`,
        logger,
      ),
      searchCount(`repo:${owner}/${repo} is:issue created:<=${endDate} -closed:<=${endDate}`, logger),
      searchCount(`repo:${owner}/${repo} is:pr created:${startDate}..${endDate}`, logger),
      searchCount(`repo:${owner}/${repo} is:pr is:merged merged:${startDate}..${endDate}`, logger),
    ]);

    const metrics = {
      openBacklog,
      issuesOpened: {
        total: openedTotal,
        discord: openedDiscord,
        github: openedTotal - openedDiscord,
      },
      issuesClosed: {
        total: closedTotal,
        discord: closedDiscord,
        github: closedTotal - closedDiscord,
      },
      pullRequests: {
        opened: prsOpened,
        merged: prsMerged,
      },
    };

    await setState({
      ...state,
      repo: inputData.repo,
      period: inputData.period,
      config: inputData.config,
      metrics,
    });

    return {
      ...inputData,
      metrics,
    };
  },
});

const collectIssueCandidatesStep = createStep({
  id: 'collect-issue-candidates',
  inputSchema: reportMetricsSchema,
  outputSchema: z.array(issueCandidateSchema),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const github = getGithubClient();
    const { owner, name } = inputData.repo;
    const { startDate, endDate } = inputData.period;

    type SearchIssue = {
      number: number;
      title: string;
      html_url: string;
      state: string;
      state_reason?: string | null;
      body?: string | null;
      labels: Array<string | { name?: string | null }>;
      user?: { login?: string | null } | null;
      comments: number;
      created_at: string;
      closed_at?: string | null;
      pull_request?: unknown;
    };

    async function runSearch(query: string, sortField: 'created' | 'updated'): Promise<SearchIssue[]> {
      const results: SearchIssue[] = [];
      let page = 1;
      while (page <= 10) {
        const response = await github.rest.search.issuesAndPullRequests({
          q: query,
          sort: sortField,
          order: 'desc',
          per_page: 100,
          page,
        });
        results.push(...(response.data.items as SearchIssue[]));
        logger?.info?.(
          `Search page ${page} [${query}]: ${response.data.items.length} results (total_count=${response.data.total_count})`,
        );
        if (response.data.items.length < 100) break;
        page += 1;
      }
      return results;
    }

    const openedQuery = `repo:${owner}/${name} is:issue created:${startDate}..${endDate}`;
    const closedQuery = `repo:${owner}/${name} is:issue closed:${startDate}..${endDate}`;

    const [openedIssues, closedIssues] = await Promise.all([
      runSearch(openedQuery, 'created'),
      runSearch(closedQuery, 'updated'),
    ]);

    const openedNumbers = new Set(openedIssues.filter(i => !i.pull_request).map(i => i.number));
    const closedNumbers = new Set(closedIssues.filter(i => !i.pull_request).map(i => i.number));

    const byNumber = new Map<number, SearchIssue>();
    for (const issue of [...openedIssues, ...closedIssues]) {
      if (issue.pull_request) continue;
      byNumber.set(issue.number, issue);
    }

    const candidates: z.infer<typeof issueCandidateSchema>[] = [];
    for (const issue of byNumber.values()) {
      const rawLabels = issue.labels.map(label =>
        typeof label === 'string' ? label : label.name || '',
      );

      const openedInWindow = openedNumbers.has(issue.number);
      const closedInWindow = closedNumbers.has(issue.number);
      const lifecycle: z.infer<typeof lifecycleEnum> =
        openedInWindow && closedInWindow
          ? 'opened-and-closed'
          : closedInWindow
            ? 'closed'
            : 'opened';

      candidates.push({
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueUrl: issue.html_url,
        issueState: issue.state === 'closed' ? 'closed' : 'open',
        lifecycle,
        closedAt: issue.closed_at ?? null,
        stateReason: issue.state_reason ?? null,
        authorLogin: issue.user?.login ?? null,
        createdAt: issue.created_at,
        commentCount: issue.comments,
        labels: filterLabels(rawLabels),
        body: issue.body ?? null,
        threadId: extractDiscordThreadId(issue.body),
      });
    }

    // Prioritize: opened-and-closed (active resolution) and closed (resolved) first,
    // then opened. Within each group, newest first by createdAt.
    const lifecycleRank: Record<z.infer<typeof lifecycleEnum>, number> = {
      'opened-and-closed': 0,
      closed: 1,
      opened: 2,
    };
    candidates.sort((a, b) => {
      const byLifecycle = lifecycleRank[a.lifecycle] - lifecycleRank[b.lifecycle];
      if (byLifecycle !== 0) return byLifecycle;
      return b.createdAt.localeCompare(a.createdAt);
    });

    const discordLinked = candidates.filter(c => c.threadId !== null).length;
    const closedCount = candidates.filter(c => c.lifecycle !== 'opened').length;
    logger?.info?.(
      `Found ${candidates.length} issues in window (${closedCount} closed, ${discordLinked} linked to Discord threads)`,
    );

    return candidates.slice(0, inputData.config.maxIssueAnalyses);
  },
});

const analysisOutputSchema = z.object({
  summary: z
    .string()
    .describe('One or two sentences summarising the user problem and current status.'),
  type: z
    .enum(['Bug', 'Feature Request', 'Question'])
    .describe('Classification of the issue.'),
  category: z
    .string()
    .describe(
      'Short product area: e.g. "agents", "workflows", "memory", "rag", "voice", "tools", "deployer", "studio", "docs". Lowercase, one or two words.',
    ),
  severity: z
    .enum(['MINOR', 'MAJOR', 'CRITICAL'])
    .describe(
      'For Bugs only: MINOR (cosmetic / edge case / easy workaround), MAJOR (affects a common flow or has a workaround), CRITICAL (data loss, security, blocks core flow, affects many users). For Feature Request and Question, always return MINOR.',
    ),
  closureReason: z
    .enum(['fixed', 'wontfix', 'duplicate', 'stale', 'unknown'])
    .nullable()
    .describe(
      'If the issue is currently closed, classify why: "fixed" (landed a fix or the problem was resolved), "wontfix" (declined, out of scope, not planned), "duplicate" (duplicate of another issue), "stale" (closed as not reproducible, inactive, or no response), "unknown" (closed but reason unclear). Use null if the issue is still open.',
    ),
});

const discordThreadMessageSchema = z.object({
  id: z.string(),
  author: z.string(),
  createdAt: z.string(),
  content: z.string(),
  url: z.string(),
});

const issueContextSchema = issueCandidateSchema.extend({
  fetched: z.object({
    source: z.enum(['discord-thread', 'github-only']),
    thread: z
      .object({
        threadName: z.string(),
        threadUrl: z.string(),
        messages: z.array(discordThreadMessageSchema),
      })
      .nullable(),
    threadFetchError: z.string().nullable(),
    githubComments: z.array(
      z.object({
        author: z.string(),
        createdAt: z.string(),
        body: z.string(),
      }),
    ),
    githubCommentsTail: z.boolean(),
  }),
});

const fetchIssueContextStep = createStep({
  id: 'fetch-issue-context',
  inputSchema: issueCandidateSchema,
  outputSchema: issueContextSchema,
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();

    let source: 'discord-thread' | 'github-only' = 'github-only';
    let thread: z.infer<typeof issueContextSchema>['fetched']['thread'] = null;
    let threadFetchError: string | null = null;

    if (inputData.threadId) {
      try {
        const fetched = await fetchThreadMessages(inputData.threadId, MAX_THREAD_MESSAGES);
        if (fetched.messages.length > 0) {
          source = 'discord-thread';
          thread = {
            threadName: fetched.threadName,
            threadUrl: fetched.threadUrl,
            messages: fetched.messages,
          };
        }
      } catch (error) {
        threadFetchError = error instanceof Error ? error.message : String(error);
        logger?.warn?.(
          `Failed to fetch Discord thread for #${inputData.issueNumber}: ${threadFetchError}`,
        );
      }
    }

    let githubComments: Array<{ author: string; createdAt: string; body: string }> = [];
    const githubCommentsTail = inputData.issueState === 'closed';
    if (source === 'github-only' && inputData.commentCount > 0) {
      try {
        const { owner, repo } = getReportRepo();
        githubComments = await fetchIssueComments(
          owner,
          repo,
          inputData.issueNumber,
          30,
          { tail: githubCommentsTail },
        );
      } catch (error) {
        logger?.warn?.(
          `Failed to fetch GitHub comments for #${inputData.issueNumber}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      ...inputData,
      fetched: {
        source,
        thread,
        threadFetchError,
        githubComments,
        githubCommentsTail,
      },
    };
  },
});

const analyzeIssueStep = createStep({
  id: 'analyze-issue',
  inputSchema: issueContextSchema,
  outputSchema: issueAnalysisSchema.nullable(),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();

    try {
      const { fetched } = inputData;
      let contextSection: string;
      let threadUrl: string | null = null;
      let threadMessageCount = 0;

      if (inputData.threadId) {
        if (fetched.thread) {
          threadUrl = fetched.thread.threadUrl;
          threadMessageCount = fetched.thread.messages.length;
          contextSection = `Discord thread: ${fetched.thread.threadName}
Discord thread messages:
${fetched.thread.messages
  .map(message => `[${message.createdAt}] ${message.author}: ${message.content}`)
  .join('\n')}`;
        } else if (fetched.threadFetchError) {
          contextSection = 'Discord thread linked but could not be fetched.';
        } else {
          contextSection = 'Discord thread linked but has no messages.';
        }
      } else {
        contextSection = 'No Discord thread linked.';
      }

      if (fetched.source === 'github-only' && fetched.githubComments.length > 0) {
        const label = fetched.githubCommentsTail ? 'Last GitHub comments' : 'GitHub comments';
        contextSection += `\n\n${label}:\n${fetched.githubComments
          .map(c => `[${c.createdAt}] ${c.author}: ${c.body}`)
          .join('\n')}`;
      }

      const lifecycleLine =
        inputData.lifecycle === 'opened-and-closed'
          ? 'Lifecycle: opened AND closed within this window.'
          : inputData.lifecycle === 'closed'
            ? 'Lifecycle: closed within this window (opened earlier).'
            : 'Lifecycle: opened within this window (still open at window end).';

      const stateReasonLine = inputData.stateReason
        ? `GitHub state_reason: ${inputData.stateReason}`
        : '';

      const closedLine = inputData.closedAt
        ? `Closed at: ${inputData.closedAt}`
        : '';

      const analysis = await issueThreadAnalysisAgent.generate(
        `GitHub issue: #${inputData.issueNumber} ${inputData.issueTitle}
URL: ${inputData.issueUrl}
State: ${inputData.issueState}
${lifecycleLine}
${closedLine}
${stateReasonLine}

Issue body:
${inputData.body || 'No body'}

${contextSection}`,
        {
          structuredOutput: {
            schema: analysisOutputSchema,
          },
        },
      );

      // Prefer deterministic state_reason when GitHub gives us a clear signal;
      // fall back to the LLM's classification otherwise.
      const closureReason =
        inputData.issueState === 'closed'
          ? (closureReasonFromStateReason(inputData.stateReason) ??
            analysis.object.closureReason ??
            'unknown')
          : null;

      return {
        issueNumber: inputData.issueNumber,
        issueTitle: inputData.issueTitle,
        issueUrl: inputData.issueUrl,
        issueState: inputData.issueState,
        lifecycle: inputData.lifecycle,
        closedAt: inputData.closedAt,
        closureReason,
        authorLogin: inputData.authorLogin,
        createdAt: inputData.createdAt,
        commentCount: inputData.commentCount,
        labels: inputData.labels,
        threadUrl,
        threadMessageCount,
        source: fetched.source,
        summary: analysis.object.summary,
        type: analysis.object.type,
        category: analysis.object.category.toLowerCase().trim() || 'other',
        // Feature Request / Question always return MINOR from the agent, but we
        // explicitly force it here so severity is only ever meaningful for Bugs.
        severity: analysis.object.type === 'Bug' ? analysis.object.severity : 'MINOR',
      };
    } catch (error) {
      logger?.warn?.(
        `Skipping issue #${inputData.issueNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  },
});

const analyzeIssueWorkflow = createWorkflow({
  id: 'analyze-issue-with-context',
  inputSchema: issueCandidateSchema,
  outputSchema: issueAnalysisSchema.nullable(),
})
  .then(fetchIssueContextStep)
  .then(analyzeIssueStep)
  .commit();

const reportDraftSchema = z.object({
  issueAnalyses: z.array(issueAnalysisSchema),
});

const collectIssueAnalysesStep = createStep({
  id: 'collect-issue-analyses',
  inputSchema: z.array(issueAnalysisSchema.nullable().optional()),
  outputSchema: reportDraftSchema,
  execute: async ({ inputData }) => ({
    issueAnalyses: inputData.filter(isIssueAnalysis),
  }),
});

const discordReplySchema = z.object({
  id: z.string(),
  authorId: z.string(),
  authorUsername: z.string(),
  authorBot: z.boolean(),
  createdAt: z.string(),
  content: z.string(),
  url: z.string(),
});

const discordGeneralMessageSchema = discordReplySchema.extend({
  threadId: z.string().nullable(),
  threadName: z.string().nullable(),
  threadUrl: z.string().nullable(),
  replies: z.array(discordReplySchema),
});

const reportDraftWithDiscordSchema = reportDraftSchema.extend({
  discordRaw: z.object({
    channelId: z.string().nullable(),
    channelName: z.string().nullable(),
    messages: z.array(discordGeneralMessageSchema),
  }),
});

const fetchDiscordMessagesStep = createStep({
  id: 'fetch-discord-messages',
  inputSchema: reportDraftSchema,
  outputSchema: reportDraftWithDiscordSchema,
  stateSchema: reportStateSchema,
  execute: async ({ inputData, state, mastra }) => {
    const { period, config } = requireReportState(state);
    const logger = mastra?.getLogger();

    if (!config.generalChannelId) {
      return {
        ...inputData,
        discordRaw: { channelId: null, channelName: null, messages: [] },
      };
    }

    const windowStart = new Date(period.start);
    const windowEnd = new Date(period.end);

    try {
      const generalMessages = await fetchMessagesInWindow(
        config.generalChannelId,
        windowStart,
        windowEnd,
        MAX_GENERAL_MESSAGES,
      );
      const channelName = await getChannelName(config.generalChannelId);

      return {
        ...inputData,
        discordRaw: {
          channelId: config.generalChannelId,
          channelName,
          messages: generalMessages,
        },
      };
    } catch (error) {
      logger?.warn?.(
        `Failed to fetch Discord messages: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        ...inputData,
        discordRaw: {
          channelId: config.generalChannelId,
          channelName: null,
          messages: [],
        },
      };
    }
  },
});

const analyzeDiscordSentimentStep = createStep({
  id: 'analyze-discord-sentiment',
  inputSchema: reportDraftWithDiscordSchema,
  outputSchema: reportWithoutBriefingSchema,
  stateSchema: reportStateSchema,
  execute: async ({ inputData, state, mastra }) => {
    const { repo, period, config, metrics } = requireReportState(state);
    const issueAnalyses = inputData.issueAnalyses;
    const { discordRaw } = inputData;
    const logger = mastra?.getLogger();

    // ---- Discord sentiment ----
    let discordSentiment: z.infer<typeof discordSentimentSchema> = {
      overall: 'unknown',
      summary: 'Discord sentiment not configured.',
      weekOverWeek: null,
      aspects: [],
      messageCount: 0,
      uniqueAuthorCount: 0,
      channelId: config.generalChannelId,
      channelName: discordRaw.channelName,
    };

    if (config.generalChannelId) {
      const windowStart = new Date(period.start);
      const windowEnd = new Date(period.end);
      const generalMessages = discordRaw.messages;
      const channelName = discordRaw.channelName;

      // Build ID → URL map (includes thread replies so the agent can cite them too).
      const urlById = new Map<string, string>();
      const authorIds = new Set<string>();
      let totalMessages = 0;
      for (const message of generalMessages) {
        urlById.set(message.id, message.url);
        authorIds.add(message.authorId);
        totalMessages += 1;
        for (const reply of message.replies) {
          urlById.set(reply.id, reply.url);
          authorIds.add(reply.authorId);
          totalMessages += 1;
        }
      }
      const uniqueAuthors = authorIds.size;

      if (generalMessages.length) {
        // Fetch previous report for week-over-week context.
        const previousSummary = await loadPreviousSentimentContext(
          mastra,
          { start: windowStart, end: windowEnd },
          logger,
        );

        const previousBlock = previousSummary
          ? `# Previous window summary (${previousSummary.period})\n${previousSummary.text}\n\n`
          : '';

        // Render each top-level message as a conversation block, with thread
        // replies indented under their parent so the agent sees Q+A together.
        const conversationBlock = generalMessages
          .map(message => {
            const head = `[id=${message.id}] ${message.createdAt} ${message.authorUsername}: ${message.content}`;
            if (!message.replies.length) {
              return head;
            }
            const repliesBlock = message.replies
              .map(
                reply =>
                  `  ↳ [id=${reply.id}] ${reply.createdAt} ${reply.authorUsername}: ${reply.content}`,
              )
              .join('\n');
            return `${head}\n${repliesBlock}`;
          })
          .join('\n\n');

        const prompt = `${previousBlock}# Current window\nChannel: #${channelName}\nWindow: ${windowStart.toISOString()} → ${windowEnd.toISOString()}\nTop-level messages: ${generalMessages.length}\nTotal messages (incl. thread replies): ${totalMessages}\nUnique authors: ${uniqueAuthors}\n\n# Conversations\nEach block is one top-level message followed by any replies in its Discord thread (prefixed with "↳"). Treat a block as a single conversation when judging whether something was answered.\n\n${conversationBlock}`;

        const sentiment = await discordSentimentAgent.generate(prompt, {
          structuredOutput: {
            schema: z.object({
              overall: z.enum(['positive', 'neutral', 'negative', 'mixed', 'unknown']),
              summary: z.string(),
              weekOverWeek: z.string().nullable(),
              aspects: z.array(
                z.object({
                  aspect: aspectEnum,
                  sentiment: z.enum(['positive', 'negative', 'mixed']),
                  positives: z.array(
                    z.object({
                      headline: z.string(),
                      detail: z.string().nullable(),
                      messageIds: z.array(z.string()),
                    }),
                  ),
                  painPoints: z.array(
                    z.object({
                      headline: z.string(),
                      detail: z.string().nullable(),
                      messageIds: z.array(z.string()),
                      kind: z.enum(['pain', 'request']),
                    }),
                  ),
                }),
              ),
            }),
          },
        });

        const hydrate = <T extends { messageIds: string[] }>(
          item: T,
        ): T & { messageUrls: string[] } => {
          const validIds = item.messageIds.filter(id => urlById.has(id));
          return {
            ...item,
            messageIds: validIds,
            messageUrls: validIds.map(id => urlById.get(id)!),
          };
        };

        discordSentiment = {
          overall: sentiment.object.overall,
          summary: sentiment.object.summary,
          weekOverWeek: sentiment.object.weekOverWeek,
          aspects: sentiment.object.aspects.map(a => ({
            aspect: a.aspect,
            sentiment: a.sentiment,
            positives: a.positives.map(hydrate),
            painPoints: a.painPoints
              .map(hydrate)
              .sort((x, y) => y.messageIds.length - x.messageIds.length),
          })),
          messageCount: totalMessages,
          uniqueAuthorCount: uniqueAuthors,
          channelId: config.generalChannelId,
          channelName,
        };
      } else {
        discordSentiment = {
          ...discordSentiment,
          summary: 'No Discord messages found in the selected window.',
          channelName,
        };
      }
    }

    // ---- Roll-ups ----
    const rollups = computeIssueRollups(issueAnalyses);
    const summary = {
      openBacklog: metrics.openBacklog,
      issuesOpened: metrics.issuesOpened,
      issuesClosed: metrics.issuesClosed,
      pullRequests: metrics.pullRequests,
      ...rollups,
      discordSentiment,
    };

    const previousReport = await loadPreviousReport(
      mastra,
      { start: new Date(period.start), end: new Date(period.end) },
      logger,
    );
    const comparison = computeComparison(summary, previousReport);

    const takeaways = buildTakeaways({ summary, comparison });
    const actions = buildActions({ issueAnalyses, summary, comparison });

    const signals = extractWeekSignals({ issueAnalyses, summary });
    const signalEmbeddings: Record<string, number[]> = {};
    if (signals.length > 0) {
      try {
        const vectors = await embedTexts(signals.map(s => s.text));
        signals.forEach((signal, index) => {
          signalEmbeddings[signal.signalId] = vectors[index];
        });
      } catch (error) {
        logger?.warn?.(`Failed to embed week signals: ${String(error)}`);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      repo,
      period: {
        start: period.start,
        end: period.end,
        label: period.label,
      },
      comparison,
      takeaways,
      actions,
      summary,
      issueAnalyses,
      signalEmbeddings,
    };
  },
});

export function formatBriefingPayload(
  report: z.infer<typeof reportWithoutBriefingSchema>,
  recurringPains: RecurringCluster[] = [],
  recurringRequests: RecurringCluster[] = [],
): string {
  const { period, repo, summary, issueAnalyses, comparison, takeaways } = report;
  const lines: string[] = [];
  const sevRank = (s: string) => (s === 'CRITICAL' ? 3 : s === 'MAJOR' ? 2 : 1);

  lines.push(`# Weekly OSS report — period ${period.start} → ${period.end}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Repo: ${repo.owner}/${repo.name}`);
  lines.push('');

  lines.push('## Issues');
  lines.push(
    `Opened ${summary.issuesOpened.total} (discord ${summary.issuesOpened.discord}, github ${summary.issuesOpened.github})`,
  );
  lines.push(
    `Closed ${summary.issuesClosed.total} (discord ${summary.issuesClosed.discord}, github ${summary.issuesClosed.github})`,
  );
  lines.push(`Open backlog: ${summary.openBacklog}`);
  lines.push(
    `PRs: opened ${summary.pullRequests.opened}, merged ${summary.pullRequests.merged}`,
  );
  lines.push('');

  lines.push('## New issue intake (classified)');
  const t = summary.typeCounts;
  lines.push(`New issues classified: ${summary.analysisCount}`);
  lines.push(`By type — Bug ${t.Bug}, Feature ${t['Feature Request']}, Question ${t.Question}`);
  const sev = summary.bugSeverityCounts;
  lines.push(`New bug severity — Critical ${sev.CRITICAL}, Major ${sev.MAJOR}, Minor ${sev.MINOR}`);
  const res = summary.resolutionCounts;
  lines.push(
    `Closed in window: ${summary.closedInWindowCount} (fixed ${res.fixed}, wontfix ${res.wontfix}, duplicate ${res.duplicate}, stale ${res.stale}, unknown ${res.unknown})`,
  );
  lines.push('');

  lines.push('## Operational health (closed-this-window)');
  const oh = summary.operationalHealth;
  lines.push(
    `Median time-to-close (days): ${oh.medianTimeToCloseDays ?? 'n/a'}, closed within 7d: ${oh.closedWithin7Days}, within 30d: ${oh.closedWithin30Days}`,
  );
  lines.push('');

  if (summary.categoryBreakdown.length > 0) {
    lines.push('## Categories');
    for (const c of summary.categoryBreakdown.slice(0, 12)) {
      lines.push(
        `- ${c.category}: total ${c.total} (Bug ${c.Bug}, Feature ${c['Feature Request']}, Question ${c.Question})`,
      );
    }
    lines.push('');
  }

  // Closed-this-window bugs — drives wins citations
  const closedBugs = issueAnalyses
    .filter(
      (i) => i.type === 'Bug' && (i.lifecycle === 'closed' || i.lifecycle === 'opened-and-closed'),
    )
    .sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
  if (closedBugs.length > 0) {
    lines.push('## Closed this week — bugs');
    for (const issue of closedBugs) {
      const closure = issue.closureReason ? ` · ${issue.closureReason}` : '';
      lines.push(
        `- #${issue.issueNumber} [${issue.severity} · ${issue.category}${closure}] ${issue.issueTitle} — ${issue.summary}`,
      );
    }
    lines.push('');
  }

  // Newly opened CRITICAL + MAJOR bugs — drives regression citations
  const newHighSevBugs = issueAnalyses
    .filter(
      (i) =>
        i.type === 'Bug' &&
        (i.lifecycle === 'opened' || i.lifecycle === 'opened-and-closed') &&
        (i.severity === 'CRITICAL' || i.severity === 'MAJOR'),
    )
    .sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
  if (newHighSevBugs.length > 0) {
    lines.push('## Newly opened — CRITICAL + MAJOR bugs');
    for (const issue of newHighSevBugs) {
      const stillOpen = issue.issueState === 'open' ? ' · still-open' : '';
      lines.push(
        `- #${issue.issueNumber} [${issue.severity} · ${issue.category}${stillOpen} · comments ${issue.commentCount}] ${issue.issueTitle} — ${issue.summary}`,
      );
    }
    lines.push('');
  }

  // Newly opened feature requests — drives the feature-request narrative
  const newFeatureRequests = issueAnalyses
    .filter((i) => i.type === 'Feature Request' && i.lifecycle === 'opened')
    .sort((a, b) => b.commentCount + b.threadMessageCount - (a.commentCount + a.threadMessageCount))
    .slice(0, 15);
  if (newFeatureRequests.length > 0) {
    lines.push('## Newly opened — feature requests (top 15 by engagement)');
    for (const issue of newFeatureRequests) {
      lines.push(
        `- #${issue.issueNumber} [${issue.category} · comments ${issue.commentCount}] ${issue.issueTitle} — ${issue.summary}`,
      );
    }
    lines.push('');
  }

  // Hot open issues — currently-open items ranked by severity + engagement
  const hotOpen = issueAnalyses
    .filter((i) => i.issueState === 'open')
    .sort((a, b) => {
      const d = sevRank(b.severity) - sevRank(a.severity);
      if (d !== 0) return d;
      return (
        b.threadMessageCount + b.commentCount - (a.threadMessageCount + a.commentCount)
      );
    })
    .slice(0, 10);
  if (hotOpen.length > 0) {
    lines.push('## Hot open issues (top 10 by severity + engagement)');
    for (const issue of hotOpen) {
      lines.push(
        `- #${issue.issueNumber} [${issue.type} · ${issue.severity} · ${issue.category} · comments ${issue.commentCount} · thread ${issue.threadMessageCount}] ${issue.issueTitle} — ${issue.summary}`,
      );
    }
    lines.push('');
  }

  const ds = summary.discordSentiment;
  lines.push('## Discord sentiment');
  lines.push(`Overall: ${ds.overall}`);
  lines.push(`Volume: ${ds.messageCount} msgs, ${ds.uniqueAuthorCount} unique authors`);
  lines.push(`Summary: ${ds.summary}`);
  if (ds.weekOverWeek) {
    lines.push(`Δ vs last: ${ds.weekOverWeek}`);
  }
  if (ds.aspects.length > 0) {
    lines.push('');
    for (const aspect of ds.aspects) {
      lines.push(`### ${aspect.aspect} (${aspect.sentiment})`);
      if (aspect.positives.length) {
        lines.push('Positives:');
        for (const p of aspect.positives) {
          const detail = p.detail ? ` — ${p.detail}` : '';
          lines.push(`- [cites ${p.messageIds.length}] ${p.headline}${detail}`);
        }
      }
      if (aspect.painPoints.length) {
        const pains = aspect.painPoints.filter((p) => p.kind === 'pain');
        const requests = aspect.painPoints.filter((p) => p.kind === 'request');
        if (pains.length) {
          lines.push('Pains:');
          for (const p of pains) {
            const detail = p.detail ? ` — ${p.detail}` : '';
            lines.push(`- [cites ${p.messageIds.length}] ${p.headline}${detail}`);
          }
        }
        if (requests.length) {
          lines.push('Feature requests:');
          for (const r of requests) {
            const detail = r.detail ? ` — ${r.detail}` : '';
            lines.push(`- [cites ${r.messageIds.length}] ${r.headline}${detail}`);
          }
        }
      }
      lines.push('');
    }
  } else {
    lines.push('');
  }

  lines.push('## Deterministic deltas vs prior report');
  const fmt = (n: number | null) => (n === null ? 'n/a' : n >= 0 ? `+${n}` : `${n}`);
  lines.push(
    `Issues opened Δ ${fmt(comparison.issuesOpenedDelta)}, closed Δ ${fmt(comparison.issuesClosedDelta)}, backlog Δ ${fmt(comparison.backlogDelta)}, new issues classified Δ ${fmt(comparison.analysisCountDelta)}, new critical bugs Δ ${fmt(comparison.criticalBugDelta)}, PRs merged Δ ${fmt(comparison.mergedPrDelta)}`,
  );
  if (comparison.sentimentChanged !== null) {
    lines.push(
      `Sentiment changed: ${comparison.sentimentChanged}${comparison.sentimentDeltaSummary ? ` — ${comparison.sentimentDeltaSummary}` : ''}`,
    );
  }
  lines.push('');

  lines.push('## Pre-computed takeaways');
  if (takeaways.improved.length) lines.push(`Improved: ${takeaways.improved.join(' | ')}`);
  if (takeaways.regressed.length) lines.push(`Regressed: ${takeaways.regressed.join(' | ')}`);
  lines.push('');

  const renderClusterBlock = (
    heading: string,
    intro: string,
    clusters: RecurringCluster[],
  ) => {
    lines.push(heading);
    lines.push(intro);
    if (clusters.length === 0) {
      lines.push('None this week.');
    } else {
      for (const cluster of clusters) {
        const sourceTag = cluster.currentSignal.source === 'github' ? 'GITHUB' : 'DISCORD';
        const related = cluster.relatedSignals
          .map((r) => `${r.label} (${r.periodEnd})`)
          .join('; ');
        lines.push(
          `- [${sourceTag}] ${cluster.currentSignal.label} — seen ${cluster.weeksSeen} weeks (prior: ${cluster.priorWeeks.join(', ')})`,
        );
        lines.push(`  related: ${related || 'none'}`);
      }
    }
    lines.push('');
  };

  renderClusterBlock(
    '## Recurring pains (pre-qualified — allow-list)',
    'These pain clusters appeared in >=2 distinct prior weeks AND this week. Output EXACTLY one entry in `recurring` per cluster below — do not add, infer, or remove items.',
    recurringPains,
  );

  renderClusterBlock(
    '## Recurring feature requests (pre-qualified — allow-list)',
    'These feature-request clusters appeared in >=2 distinct prior weeks AND this week. Output EXACTLY one entry in `recurringRequests` per cluster below — do not add, infer, or remove items.',
    recurringRequests,
  );

  return lines.join('\n');
}

const generateBriefingStep = createStep({
  id: 'generate-briefing',
  inputSchema: generateBriefingInputSchema,
  outputSchema: reportSchema,
  stateSchema: reportStateSchema,
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    let briefing: z.infer<typeof briefingSchema> | null = null;

    const { correctionsApplied, ...reportFields } = inputData;

    // Deterministic recurring gate: cluster this week's signals against the
    // last N stored weeks, separated by kind (pain vs. request). Only clusters
    // spanning >=2 prior weeks + this week qualify, and they form a strict
    // allow-list for the agent.
    const currentSignals = extractWeekSignals(reportFields);
    const priorWeeks = await loadRecentReports(
      mastra,
      { start: new Date(reportFields.period.start), end: new Date(reportFields.period.end) },
      RECURRING_LOOKBACK_WEEKS,
      logger,
    );
    const { pains: recurringPains, requests: recurringRequests } = computeRecurringClusters(
      currentSignals,
      reportFields.signalEmbeddings,
      priorWeeks,
      RECURRING_SIMILARITY_THRESHOLD,
    );

    try {
      const payload = formatBriefingPayload(reportFields, recurringPains, recurringRequests);
      const result = await briefingAgent.generate(payload, {
        structuredOutput: {
          schema: briefingAgentOutputSchema,
          errorStrategy: 'warn',
        },
      });
      if (result.object) {
        // Agent emits the minimal recurring shape; code fills weeksSeen and
        // relatedSignals from the qualified clusters in the block below.
        const hydrateAgentList = (items: z.infer<typeof briefingRecurringAgentSchema>[]) =>
          items.map((item) => ({
            ...item,
            weeksSeen: 0,
            relatedSignals: [],
          }));
        briefing = {
          ...result.object,
          recurring: hydrateAgentList(result.object.recurring),
          recurringRequests: hydrateAgentList(result.object.recurringRequests),
          correctionsApplied: [],
        };
      } else {
        logger?.warn('Briefing agent returned no structured object', {
          text: result.text?.slice(0, 200),
        });
      }
    } catch (error) {
      logger?.error('Briefing generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Code is authoritative: replace each agent-emitted recurring list with
    // one entry per qualified cluster, keeping the agent's phrasing where it
    // cited the right cluster and falling back to the deterministic label.
    if (briefing) {
      const rebuildFromClusters = (
        agentList: z.infer<typeof briefingRecurringSchema>[],
        clusters: RecurringCluster[],
      ): z.infer<typeof briefingRecurringSchema>[] => {
        const allowedIds = new Set(clusters.map((c) => c.currentSignal.id));
        const phrasingById = new Map<string, string>();
        for (const item of agentList) {
          const matchId =
            item.source === 'github' && item.issueNumber != null
              ? `gh:${item.issueNumber}`
              : null;
          if (matchId && allowedIds.has(matchId)) {
            phrasingById.set(matchId, item.text);
          }
        }
        return clusters.map((cluster) => ({
          text: phrasingById.get(cluster.currentSignal.id) ?? cluster.theme,
          source: cluster.currentSignal.source,
          issueNumber: cluster.issueNumber ?? null,
          issueUrl: cluster.issueUrl ?? null,
          aspect: cluster.aspect ?? null,
          weeksSeen: cluster.weeksSeen,
          relatedSignals: cluster.relatedSignals.map((r) => ({
            source: r.source,
            label: r.label,
            url: r.url,
            periodEnd: r.periodEnd,
          })),
        }));
      };

      briefing = {
        ...briefing,
        recurring: rebuildFromClusters(briefing.recurring, recurringPains),
        recurringRequests: rebuildFromClusters(briefing.recurringRequests, recurringRequests),
      };
    }

    if (briefing && correctionsApplied && correctionsApplied.length > 0) {
      briefing = {
        ...briefing,
        correctionsApplied,
      };
    }

    return {
      ...reportFields,
      briefing,
    };
  },
});

/** Escape Slack mrkdwn control characters in dynamic text. */
function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Deterministic Slack digest rendered from the finished report as a Block Kit
 * card: header, 2-column metric fields, sections, and a link button. Charts
 * are posted separately as an image gallery (see buildDigestChartUrls).
 */
export function buildSlackDigestCard(
  report: z.infer<typeof reportSchema>,
  runId?: string,
): SlackCardElement {
  const { repo, period, summary, comparison, briefing, takeaways } = report;
  const fmtDate = (iso: string) => iso.slice(0, 10);
  // Compact delta badge vs last week, e.g. " (▲4)". Omitted when unchanged.
  const delta = (d: number | null) =>
    d == null || d === 0 ? '' : ` (${d > 0 ? '▲' : '▼'}${Math.abs(d)})`;

  const children: SlackCardChild[] = [];

  if (briefing?.headline) {
    children.push({ type: 'text', style: 'bold', content: slackEscape(briefing.headline) });
  }

  children.push({
    type: 'fields',
    children: [
      {
        type: 'field',
        label: 'Issues opened',
        value: `${summary.issuesOpened.total}${delta(comparison.issuesOpenedDelta)}`,
      },
      {
        type: 'field',
        label: 'Issues closed',
        value: `${summary.issuesClosed.total}${delta(comparison.issuesClosedDelta)}`,
      },
      {
        type: 'field',
        label: 'PRs merged',
        value: `${summary.pullRequests.merged}${delta(comparison.mergedPrDelta)}`,
      },
      {
        type: 'field',
        label: 'Open backlog',
        value: `${summary.openBacklog}${delta(comparison.backlogDelta)}`,
      },
    ],
  });

  // Native chart of the headline flow metrics vs last week (the deltas are
  // current − previous, so previous = current − delta). Backlog is excluded:
  // it's a level, not a flow, and its scale would dwarf the weekly bars.
  // Skipped when there is no prior report to compare against.
  if (
    comparison.issuesOpenedDelta != null &&
    comparison.issuesClosedDelta != null &&
    comparison.mergedPrDelta != null
  ) {
    const metrics = [
      { label: 'Issues opened', current: summary.issuesOpened.total, d: comparison.issuesOpenedDelta },
      { label: 'Issues closed', current: summary.issuesClosed.total, d: comparison.issuesClosedDelta },
      { label: 'PRs merged', current: summary.pullRequests.merged, d: comparison.mergedPrDelta },
    ];
    children.push({
      type: 'chart',
      title: 'This week vs last week',
      chart: {
        type: 'bar',
        categories: metrics.map((m) => m.label),
        series: [
          { name: 'This week', data: metrics.map((m) => ({ label: m.label, value: m.current })) },
          { name: 'Last week', data: metrics.map((m) => ({ label: m.label, value: m.current - m.d })) },
        ],
      },
    });
  }

  const bulletSection = (heading: string, items: string[]) => {
    if (items.length === 0) return;
    children.push({ type: 'divider' });
    children.push({
      type: 'text',
      content: `*${heading}*\n${items.map((item) => `•  ${item}`).join('\n')}`,
    });
  };

  if (briefing) {
    bulletSection(
      'Wins',
      briefing.wins.map((w) =>
        slackEscape(w.evidence ? `${w.text} — ${w.evidence}` : w.text),
      ),
    );
    bulletSection(
      'Setbacks',
      briefing.regressions.map(
        (r) => `${slackEscape(r.text)}${r.evidence ? ` — ${slackEscape(r.evidence)}` : ''}`,
      ),
    );
    const recurringLine = (item: z.infer<typeof briefingRecurringSchema>) => {
      const cite =
        item.issueNumber != null && item.issueUrl
          ? ` (<${item.issueUrl}|#${item.issueNumber}>)`
          : item.aspect
            ? ` (${slackEscape(item.aspect)})`
            : '';
      return `${slackEscape(item.text)}${cite} — seen ${item.weeksSeen} weeks`;
    };
    bulletSection('Recurring pains', briefing.recurring.map(recurringLine));
    bulletSection('Recurring requests', briefing.recurringRequests.map(recurringLine));
  } else {
    // Briefing generation failed — fall back to the deterministic takeaways.
    bulletSection('Improved', takeaways.improved.map(slackEscape));
    bulletSection('Regressed', takeaways.regressed.map(slackEscape));
    bulletSection('Watch', takeaways.watch.map(slackEscape));
  }

  // SLACK_REPORT_APP_URL is the web app base (e.g. https://host/app/). The
  // app uses a hash router where each report lives at #/reports/<runId>.
  const appUrl = process.env.SLACK_REPORT_APP_URL;
  if (appUrl) {
    const base = appUrl.endsWith('/') ? appUrl : `${appUrl}/`;
    children.push({ type: 'divider' });
    children.push({
      type: 'actions',
      children: [
        {
          type: 'link-button',
          label: 'View full report',
          style: 'primary',
          url: runId ? `${base}#/reports/${runId}` : base,
        },
      ],
    });
  }

  return {
    type: 'card',
    title: `OSS Report · ${fmtDate(period.start)} → ${fmtDate(period.end)}`,
    subtitle: `${repo.owner}/${repo.name} weekly community report`,
    children,
  };
}

// The digest step accepts a report plus optional re-post context, so it can
// run both as the tail of the weekly workflow (context omitted) and inside
// slackDigestWorkflow, where a stored report is re-posted on demand.
const postSlackDigestInputSchema = reportSchema.extend({
  /** Run id of the report being posted; defaults to the current run. */
  reportRunId: z.string().optional(),
  /** Post even for rebriefed reports (used by manual re-posts). */
  forcePost: z.boolean().optional(),
});

const postSlackDigestStep = createStep({
  id: 'post-slack-digest',
  inputSchema: postSlackDigestInputSchema,
  outputSchema: reportSchema,
  stateSchema: reportStateSchema,
  execute: async ({ inputData, mastra, runId }) => {
    const { reportRunId, forcePost, ...report } = inputData;
    const logger = mastra?.getLogger();
    const channelId = process.env.SLACK_REPORT_CHANNEL_ID;
    if (!channelId) return report;

    // Rebrief runs (time travel with corrections) already posted a digest for
    // this period; skip re-posting to avoid duplicate messages in the channel.
    if (!forcePost && report.briefing?.correctionsApplied?.length) {
      logger?.info('Skipping Slack digest for rebrief run with corrections');
      return report;
    }

    const chat = mastra?.getAgent('slackReportAgent')?.getChannels()?.sdk;
    if (!chat) {
      logger?.warn(
        'SLACK_REPORT_CHANNEL_ID is set but the Slack channel is not configured — set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET',
      );
      return report;
    }

    try {
      const digest = buildSlackDigestCard(report, reportRunId ?? runId);
      // SlackCardElement extends the Chat SDK's base CardElement with
      // Slack-only children (charts); the Slack adapter renders them natively.
      await chat.channel(`slack:${channelId}`).post({ card: digest as never });
      logger?.info('Posted Slack digest', { channelId });
    } catch (error) {
      // Delivery is best-effort: never fail the report because Slack is down.
      logger?.error('Slack digest post failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return report;
  },
});

const loadStoredReportStep = createStep({
  id: 'load-stored-report',
  inputSchema: z.object({
    /** Run id of a stored report; omit to use the latest successful run. */
    runId: z.string().optional(),
  }),
  outputSchema: postSlackDigestInputSchema,
  execute: async ({ inputData, mastra }) => {
    const workflow = mastra?.getWorkflow?.('oss-report-workflow') as
      | {
          getWorkflowRunById?: (
            runId: string,
          ) => Promise<{ status?: string; result?: unknown } | null>;
          listWorkflowRuns?: (
            args: unknown,
          ) => Promise<{
            runs: Array<{ runId: string; snapshot?: unknown; createdAt?: string | Date }>;
          }>;
        }
      | undefined;
    if (!workflow) throw new Error('oss-report-workflow not registered');

    if (inputData.runId) {
      const stored = await workflow.getWorkflowRunById?.(inputData.runId);
      if (!stored || stored.status !== 'success' || !stored.result) {
        throw new Error(`No successful report found for run ${inputData.runId}`);
      }
      const report = unwrapRunResult(stored.result) as z.infer<typeof reportSchema>;
      if (!report?.period?.start || !report.summary) {
        throw new Error(`Run ${inputData.runId} did not produce a valid report`);
      }
      return { ...report, reportRunId: inputData.runId, forcePost: true };
    }

    const { runs } = (await workflow.listWorkflowRuns?.({
      status: 'success',
      perPage: 50,
      page: 0,
    })) ?? { runs: [] };
    const latest = runs
      .map((run) => {
        const snapshot = parseRunSnapshot(run.snapshot);
        return {
          runId: run.runId,
          createdAt: run.createdAt ? new Date(run.createdAt).getTime() : 0,
          result: unwrapRunResult(snapshot?.result) as z.infer<typeof reportSchema> | undefined,
        };
      })
      .filter((run) => run.result?.period?.start && run.result.summary)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest?.result) throw new Error('No stored reports found');

    return { ...latest.result, reportRunId: latest.runId, forcePost: true };
  },
});

/**
 * Re-post the Slack digest for an already-generated report. Run it from
 * Studio (or the API) with an optional runId; defaults to the latest report.
 */
export const slackDigestWorkflow = createWorkflow({
  id: 'slack-digest-workflow',
  inputSchema: z.object({ runId: z.string().optional() }),
  outputSchema: reportSchema,
})
  .then(loadStoredReportStep)
  .then(postSlackDigestStep)
  .commit();

export const ossReportWorkflow = createWorkflow({
  id: 'oss-report-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: reportSchema,
  stateSchema: reportStateSchema,
  // Weekly report: fires Friday 3pm UTC covering Monday 00:00 UTC through fire time.
  schedule: {
    cron: '0 15 * * 5',
    timezone: 'UTC',
    inputData: { window: 'week-to-date' },
  },
})
  .then(resolveReportContextStep)
  .then(collectRepoMetricsStep)
  .then(collectIssueCandidatesStep)
  .foreach(analyzeIssueWorkflow, { concurrency: ISSUE_ANALYSIS_CONCURRENCY })
  .then(collectIssueAnalysesStep)
  .then(fetchDiscordMessagesStep)
  .then(analyzeDiscordSentimentStep)
  .then(generateBriefingStep)
  .then(postSlackDigestStep)
  .commit();
