import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { BRIEFING_RESOURCE_ID, BRIEFING_THREAD_ID, briefingAgent } from '../agents/briefing';
import { discordSentimentAgent } from '../agents/discord-sentiment';
import { issueThreadAnalysisAgent } from '../agents/issue-thread-analysis';
import { fetchMessagesInWindow, fetchThreadMessages, getChannelName } from '../shared/discord';
import {
  extractDiscordThreadId,
  fetchIssueComments,
  getGithubClient,
  getReportRepo,
} from '../shared/github';

const ISSUE_ANALYSIS_CONCURRENCY = 5;
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

const issueStatusCountsSchema = z.object({
  open: z.number(),
  closed: z.number(),
});

const comparisonSchema = z.object({
  backlogDelta: z.number().nullable(),
  issuesOpenedDelta: z.number().nullable(),
  issuesClosedDelta: z.number().nullable(),
  mergedPrDelta: z.number().nullable(),
  analysisCountDelta: z.number().nullable(),
  criticalBugDelta: z.number().nullable(),
  majorBugDelta: z.number().nullable(),
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

const briefingMovementEnum = z.enum(['improved', 'regressed', 'steady', 'mixed']);
const briefingSeverityEnum = z.enum(['critical', 'major', 'minor']);

const briefingWinSchema = z.object({
  text: z.string(),
  evidence: z.string().nullable(),
});

const briefingRegressionSchema = z.object({
  text: z.string(),
  evidence: z.string().nullable(),
  severity: briefingSeverityEnum,
});

const briefingWatchSchema = z.object({
  text: z.string(),
  why: z.string(),
});

const briefingRecurringSchema = z.object({
  text: z.string(),
  note: z.string().nullable(),
});

const briefingCorrectionSchema = z.object({
  issueNumber: z.number(),
  changed: z.array(z.enum(['severity', 'type', 'summary'])),
});

export const briefingAgentOutputSchema = z.object({
  headline: z.string(),
  movement: briefingMovementEnum,
  wins: z.array(briefingWinSchema),
  regressions: z.array(briefingRegressionSchema),
  watchlist: z.array(briefingWatchSchema),
  recurring: z.array(briefingRecurringSchema),
  talkingPoints: z.array(z.string()),
});

export const briefingSchema = briefingAgentOutputSchema.extend({
  supersedes: z.string().nullable().optional(),
  correctionsApplied: z.array(briefingCorrectionSchema).optional(),
});

const workflowInputSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
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

const aspectSentimentSchema = z.object({
  aspect: aspectEnum,
  sentiment: z.enum(['positive', 'negative', 'mixed']),
  positives: z.array(sentimentSignalSchema),
  painPoints: z.array(sentimentSignalSchema),
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
  issueStatusCounts: issueStatusCountsSchema,
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
});

export const generateBriefingInputSchema = reportWithoutBriefingSchema.extend({
  supersedes: z.string().nullable().optional(),
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

function getWindow(input: z.infer<typeof workflowInputSchema>) {
  const end = input.end ? new Date(input.end) : new Date();
  const start = input.start
    ? new Date(input.start)
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

export async function loadPreviousReport(
  mastra: { getWorkflow?: (id: string) => unknown } | undefined,
  currentPeriod: { start: Date; end: Date },
  logger?: { info?: (message: string) => void; warn?: (message: string) => void },
): Promise<z.infer<typeof reportSchema> | null> {
  try {
    const workflow = mastra?.getWorkflow?.('ossReportWorkflow') as
      | { listWorkflowRuns?: (args: unknown) => Promise<{ runs: Array<{ snapshot?: unknown; createdAt?: string }> }> }
      | undefined;
    if (!workflow?.listWorkflowRuns) return null;

    const { runs } = await workflow.listWorkflowRuns({
      status: 'success',
      perPage: 50,
      page: 0,
    });

    const candidates = (runs ?? [])
      .map(run => {
        const snapshot = parseRunSnapshot(run.snapshot);
        return snapshot?.result as z.infer<typeof reportSchema> | undefined;
      })
      .filter((result): result is z.infer<typeof reportSchema> => {
        if (!result?.period?.start || !result.period.end || !result.summary?.discordSentiment) return false;

        const previousStart = new Date(result.period.start).getTime();
        const previousEnd = new Date(result.period.end).getTime();
        const currentStart = currentPeriod.start.getTime();
        const currentEnd = currentPeriod.end.getTime();

        if (Number.isNaN(previousStart) || Number.isNaN(previousEnd)) return false;
        if (previousStart === currentStart && previousEnd === currentEnd) return false;

        return previousEnd < currentEnd;
      })
      .sort((a, b) => new Date(b.period.end).getTime() - new Date(a.period.end).getTime());

    return candidates[0] ?? null;
  } catch (error) {
    logger?.warn?.(`Failed to load previous report context: ${String(error)}`);
    return null;
  }
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
  let openCount = 0;
  let closedCount = 0;
  let closedInWindowCount = 0;

  for (const a of issueAnalyses) {
    typeCounts[a.type] += 1;

    if (a.type === 'Bug') {
      bugSeverityCounts[a.severity] += 1;
    }

    if (a.issueState === 'open') openCount += 1;
    else closedCount += 1;

    if (a.lifecycle === 'closed' || a.lifecycle === 'opened-and-closed') {
      closedInWindowCount += 1;
      if (a.closureReason) {
        resolutionCounts[a.closureReason] += 1;
      }
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

  const categoryBreakdown = [...categoryMap.values()].sort((a, b) => b.total - a.total);
  const closedDurations = issueAnalyses
    .filter(issue => (issue.lifecycle === 'closed' || issue.lifecycle === 'opened-and-closed') && issue.closedAt)
    .map(issue => daysBetween(issue.createdAt, issue.closedAt!));
  const closedWithin7Days = closedDurations.filter(days => days <= 7).length;
  const closedWithin30Days = closedDurations.filter(days => days <= 30).length;

  return {
    typeCounts,
    bugSeverityCounts,
    issueStatusCounts: { open: openCount, closed: closedCount },
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
      majorBugDelta: null,
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
    majorBugDelta: delta(summary.bugSeverityCounts.MAJOR, previousReport.summary.bugSeverityCounts.MAJOR),
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
  if ((comparison.majorBugDelta ?? 0) > 0) {
    regressed.push(`Major bugs increased by ${comparison.majorBugDelta}.`);
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
      searchCount(`repo:${owner}/${repo} is:issue is:open`, logger),
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

const analyzeIssueStep = createStep({
  id: 'analyze-issue',
  inputSchema: issueCandidateSchema,
  outputSchema: issueAnalysisSchema.nullable(),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();

    try {
      let contextSection: string;
      let threadUrl: string | null = null;
      let threadMessageCount = 0;
      let source: 'discord-thread' | 'github-only' = 'github-only';

      if (inputData.threadId) {
        try {
          const thread = await fetchThreadMessages(inputData.threadId, MAX_THREAD_MESSAGES);
          if (thread.messages.length > 0) {
            threadUrl = thread.threadUrl;
            threadMessageCount = thread.messages.length;
            source = 'discord-thread';
            contextSection = `Discord thread: ${thread.threadName}
Discord thread messages:
${thread.messages
  .map(message => `[${message.createdAt}] ${message.author}: ${message.content}`)
  .join('\n')}`;
          } else {
            contextSection = 'Discord thread linked but has no messages.';
          }
        } catch (error) {
          logger?.warn?.(
            `Failed to fetch Discord thread for #${inputData.issueNumber}: ${error instanceof Error ? error.message : String(error)}`,
          );
          contextSection = 'Discord thread linked but could not be fetched.';
        }
      } else {
        contextSection = 'No Discord thread linked.';
      }

      if (source === 'github-only' && inputData.commentCount > 0) {
        const { owner, repo } = getReportRepo();
        // For closed issues, the closing signal (merged PR reference, maintainer
        // "fixed in X", duplicate pointer) is at the TAIL of the comment list.
        // For open issues, the early comments carry the triage/repro context.
        const tail = inputData.issueState === 'closed';
        const comments = await fetchIssueComments(owner, repo, inputData.issueNumber, 30, { tail });
        if (comments.length > 0) {
          const label = tail ? 'Last GitHub comments' : 'GitHub comments';
          contextSection += `\n\n${label}:\n${comments
            .map(c => `[${c.createdAt}] ${c.author}: ${c.body}`)
            .join('\n')}`;
        }
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
Labels: ${inputData.labels.join(', ') || 'none'}

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
        source,
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

const analyzeDiscordSentimentStep = createStep({
  id: 'analyze-discord-sentiment',
  inputSchema: reportDraftSchema,
  outputSchema: reportWithoutBriefingSchema,
  stateSchema: reportStateSchema,
  execute: async ({ inputData, state, mastra }) => {
    const { repo, period, config, metrics } = requireReportState(state);
    const issueAnalyses = inputData.issueAnalyses;
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
      channelName: null,
    };

    if (config.generalChannelId) {
      const windowStart = new Date(period.start);
      const windowEnd = new Date(period.end);
      const generalMessages = await fetchMessagesInWindow(
        config.generalChannelId,
        windowStart,
        windowEnd,
        MAX_GENERAL_MESSAGES,
      );
      const channelName = await getChannelName(config.generalChannelId);
      const uniqueAuthors = new Set(generalMessages.map(m => m.author.id)).size;

      // Build ID → URL map for hydration after the LLM responds.
      const urlById = new Map<string, string>();
      for (const message of generalMessages) {
        urlById.set(message.id, message.url);
      }

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

        const messageBlock = generalMessages
          .map(
            message =>
              `[id=${message.id}] ${message.createdAt.toISOString()} ${message.author.username}: ${message.content}`,
          )
          .join('\n');

        const prompt = `${previousBlock}# Current window\nChannel: #${channelName}\nWindow: ${windowStart.toISOString()} → ${windowEnd.toISOString()}\nMessage count: ${generalMessages.length}\nUnique authors: ${uniqueAuthors}\n\n# Messages\n${messageBlock}`;

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
          messageCount: generalMessages.length,
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
      analysisCount: issueAnalyses.length,
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
    };
  },
});

export function formatBriefingPayload(report: z.infer<typeof reportWithoutBriefingSchema>): string {
  const { period, repo, summary, issueAnalyses, comparison, takeaways, actions } = report;
  const lines: string[] = [];

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

  lines.push('## Analyzed');
  const t = summary.typeCounts;
  lines.push(`Total analyzed: ${summary.analysisCount}`);
  lines.push(`By type — Bug ${t.Bug}, Feature ${t['Feature Request']}, Question ${t.Question}`);
  const sev = summary.bugSeverityCounts;
  lines.push(`Bug severity — Critical ${sev.CRITICAL}, Major ${sev.MAJOR}, Minor ${sev.MINOR}`);
  const status = summary.issueStatusCounts;
  lines.push(`Status — Open ${status.open}, Closed ${status.closed}`);
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

  const topIssues = [...issueAnalyses]
    .sort((a, b) => {
      const sevRank = (s: string) => (s === 'CRITICAL' ? 3 : s === 'MAJOR' ? 2 : 1);
      const at = a.type === 'Bug' ? 1 : 0;
      const bt = b.type === 'Bug' ? 1 : 0;
      if (at !== bt) return bt - at;
      return sevRank(b.severity) - sevRank(a.severity);
    })
    .slice(0, 15);
  if (topIssues.length > 0) {
    lines.push('## Top issues this week');
    for (const issue of topIssues) {
      const tags: string[] = [issue.type, issue.severity, issue.issueState, issue.lifecycle];
      if (issue.closureReason) tags.push(`closure=${issue.closureReason}`);
      lines.push(
        `- #${issue.issueNumber} [${tags.join(' · ')}] ${issue.issueTitle} — ${issue.summary}`,
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
    for (const aspect of ds.aspects) {
      const positives = aspect.positives.map((s) => s.headline).join('; ') || 'none';
      const pains = aspect.painPoints
        .map((p) => p.headline)
        .join('; ') || 'none';
      lines.push(`- ${aspect.aspect}: positives — ${positives}; pains — ${pains}`);
    }
  }
  lines.push('');

  lines.push('## Deterministic deltas vs prior report');
  const fmt = (n: number | null) => (n === null ? 'n/a' : n >= 0 ? `+${n}` : `${n}`);
  lines.push(
    `Issues opened Δ ${fmt(comparison.issuesOpenedDelta)}, closed Δ ${fmt(comparison.issuesClosedDelta)}, backlog Δ ${fmt(comparison.backlogDelta)}, analyzed Δ ${fmt(comparison.analysisCountDelta)}, critical bugs Δ ${fmt(comparison.criticalBugDelta)}, major bugs Δ ${fmt(comparison.majorBugDelta)}, PRs merged Δ ${fmt(comparison.mergedPrDelta)}`,
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
  if (takeaways.watch.length) lines.push(`Watch: ${takeaways.watch.join(' | ')}`);
  lines.push('');

  lines.push('## Pre-computed action items');
  if (actions.priorityIssues.length)
    lines.push(`Priority issues: ${actions.priorityIssues.map((n) => `#${n}`).join(', ')}`);
  if (actions.recommendedActions.length)
    lines.push(`Recommended actions: ${actions.recommendedActions.join(' | ')}`);
  if (actions.needsDocsAttention.length)
    lines.push(`Docs attention: ${actions.needsDocsAttention.join(' | ')}`);
  if (actions.recurringPainAreas.length)
    lines.push(`Recurring pain: ${actions.recurringPainAreas.join(' | ')}`);

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

    const { supersedes, correctionsApplied, ...reportFields } = inputData;

    try {
      const payload = formatBriefingPayload(reportFields);
      const result = await briefingAgent.generate(payload, {
        memory: {
          thread: BRIEFING_THREAD_ID,
          resource: BRIEFING_RESOURCE_ID,
        },
        structuredOutput: {
          schema: briefingAgentOutputSchema,
          errorStrategy: 'warn',
        },
      });
      if (result.object) {
        briefing = {
          ...result.object,
          supersedes: null,
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

    if (briefing && (supersedes || (correctionsApplied && correctionsApplied.length > 0))) {
      briefing = {
        ...briefing,
        supersedes: supersedes ?? null,
        correctionsApplied: correctionsApplied ?? [],
      };
    }

    return {
      ...reportFields,
      briefing,
    };
  },
});

export const ossReportWorkflow = createWorkflow({
  id: 'oss-report-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: reportSchema,
  stateSchema: reportStateSchema,
})
  .then(resolveReportContextStep)
  .then(collectRepoMetricsStep)
  .then(collectIssueCandidatesStep)
  .foreach(analyzeIssueStep, { concurrency: ISSUE_ANALYSIS_CONCURRENCY })
  .then(collectIssueAnalysesStep)
  .then(analyzeDiscordSentimentStep)
  .then(generateBriefingStep)
  .commit();
