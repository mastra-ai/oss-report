import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { discordSentimentAgent } from '../agents/discord-sentiment';
import { issueThreadAnalysisAgent } from '../agents/issue-thread-analysis';
import { fetchMessagesSince, fetchThreadMessages, getChannelName } from '../shared/discord';
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

const painPointSchema = sentimentSignalSchema.extend({
  severity: z.enum(['blocker', 'friction', 'nit']),
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

const issueAnalysisSchema = z.object({
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
});

const reportSummarySchema = z.object({
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
  discordSentiment: discordSentimentSchema,
});

const reportSchema = z.object({
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
  summary: reportSummarySchema,
  issueAnalyses: z.array(issueAnalysisSchema),
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
  issueAnalysis: z.infer<typeof issueAnalysisSchema> | null,
): issueAnalysis is z.infer<typeof issueAnalysisSchema> {
  return issueAnalysis !== null;
}

async function loadPreviousSentimentContext(
  mastra: { getWorkflow?: (id: string) => unknown } | undefined,
  currentWindowStart: Date,
  logger?: { info?: (message: string) => void; warn?: (message: string) => void },
): Promise<{ period: string; text: string } | null> {
  try {
    const workflow = mastra?.getWorkflow?.('ossReportWorkflow') as
      | { listWorkflowRuns?: (args: unknown) => Promise<{ runs: Array<{ snapshot?: unknown; createdAt?: string }> }> }
      | undefined;
    if (!workflow?.listWorkflowRuns) return null;

    const { runs } = await workflow.listWorkflowRuns({
      status: 'success',
      perPage: 10,
      page: 0,
    });

    for (const run of runs ?? []) {
      const result = (run.snapshot as { result?: unknown })?.result as
        | z.infer<typeof reportSchema>
        | undefined;
      if (!result?.period?.end || !result.summary?.discordSentiment) continue;

      const prevEnd = new Date(result.period.end);
      if (prevEnd >= currentWindowStart) continue;

      const s = result.summary.discordSentiment;
      const aspectLine = s.aspects
        ?.map(a => `${a.aspect} (${a.sentiment})`)
        .join(', ');

      const text = [
        `Overall: ${s.overall}.`,
        s.summary,
        aspectLine ? `Aspects discussed: ${aspectLine}.` : null,
      ]
        .filter(Boolean)
        .join(' ');

      return { period: result.period.label, text };
    }

    return null;
  } catch (error) {
    logger?.warn?.(`Failed to load previous sentiment context: ${String(error)}`);
    return null;
  }
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
        maxIssueAnalyses: inputData.maxIssueAnalyses ?? 50,
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
  inputSchema: z.array(issueAnalysisSchema.nullable()),
  outputSchema: reportDraftSchema,
  execute: async ({ inputData }) => ({
    issueAnalyses: inputData.filter(isIssueAnalysis),
  }),
});

const analyzeDiscordSentimentStep = createStep({
  id: 'analyze-discord-sentiment',
  inputSchema: reportDraftSchema,
  outputSchema: reportSchema,
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
      const generalMessages = await fetchMessagesSince(
        config.generalChannelId,
        windowStart,
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
        const previousSummary = await loadPreviousSentimentContext(mastra, windowStart, logger);

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
                      severity: z.enum(['blocker', 'friction', 'nit']),
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
            painPoints: a.painPoints.map(hydrate),
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

    return {
      generatedAt: new Date().toISOString(),
      repo,
      period: {
        start: period.start,
        end: period.end,
        label: period.label,
      },
      summary: {
        openBacklog: metrics.openBacklog,
        issuesOpened: metrics.issuesOpened,
        issuesClosed: metrics.issuesClosed,
        pullRequests: metrics.pullRequests,
        analysisCount: issueAnalyses.length,
        typeCounts,
        bugSeverityCounts,
        issueStatusCounts: {
          open: openCount,
          closed: closedCount,
        },
        resolutionCounts,
        closedInWindowCount,
        categoryBreakdown,
        discordSentiment,
      },
      issueAnalyses,
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
  .commit();
