import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { discordSentimentAgent } from '../agents/discord-sentiment';
import { issueThreadAnalysisAgent } from '../agents/issue-thread-analysis';
import { fetchMessagesSince, fetchThreadMessages, getChannelName } from '../shared/discord';
import { extractDiscordThreadId, getGithubClient, getReportRepo } from '../shared/github';
import { fetchNpmDownloads } from '../shared/npm';

const ISSUE_ANALYSIS_CONCURRENCY = 5;

const issueCountsSchema = z.object({
  total: z.number(),
  discord: z.number(),
  rest: z.number(),
});

const workflowInputSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  maxIssueAnalyses: z.number().int().positive().max(500).optional(),
  maxGeneralMessages: z.number().int().positive().max(500).optional(),
  maxThreadMessages: z.number().int().positive().max(100).optional(),
});

const npmDownloadSchema = z.object({
  packageName: z.string(),
  downloads: z.number(),
  start: z.string(),
  end: z.string(),
});

const discordSentimentSchema = z.object({
  overall: z.enum(['positive', 'neutral', 'negative', 'mixed', 'unknown']),
  summary: z.string(),
  positiveSignals: z.array(z.string()),
  painPoints: z.array(z.string()),
  messageCount: z.number(),
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
});

const issueAnalysisSchema = z.object({
  issueNumber: z.number(),
  issueTitle: z.string(),
  issueUrl: z.string().url(),
  labels: z.array(z.string()),
  state: z.string(),
  threadId: z.string(),
  threadUrl: z.string().url(),
  threadMessageCount: z.number(),
  summary: z.string(),
  status: z.string(),
  urgency: z.enum(['low', 'medium', 'high']),
  recommendedAction: z.string(),
  blockers: z.array(z.string()),
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
  summary: z.object({
    stars: z.number(),
    issuesOpened: issueCountsSchema,
    issuesClosed: issueCountsSchema,
    npmDownloads: z.object({
      total: z.number(),
      packages: z.array(npmDownloadSchema),
    }),
    discordSentiment: discordSentimentSchema,
  }),
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
    npmPackages: z.array(z.string()),
    generalChannelId: z.string().nullable(),
    maxIssueAnalyses: z.number(),
    maxGeneralMessages: z.number(),
    maxThreadMessages: z.number(),
  }),
});

const reportMetricsOnlySchema = z.object({
  stars: z.number(),
  issuesOpened: issueCountsSchema,
  issuesClosed: issueCountsSchema,
  npmDownloads: z.array(npmDownloadSchema),
});

const reportMetricsSchema = reportContextSchema.extend({
  metrics: reportMetricsOnlySchema,
});

const reportStateSchema = z.object({
  repo: reportContextSchema.shape.repo.optional(),
  period: reportContextSchema.shape.period.optional(),
  config: reportContextSchema.shape.config.optional(),
  metrics: reportMetricsOnlySchema.optional(),
});

const issueCandidateSchema = z.object({
  issueNumber: z.number(),
  issueTitle: z.string(),
  issueUrl: z.string().url(),
  labels: z.array(z.string()),
  state: z.string(),
  body: z.string().nullable(),
  threadId: z.string(),
});

const reportDraftSchema = reportMetricsSchema.extend({
  issueAnalyses: z.array(issueAnalysisSchema),
  discordSentiment: discordSentimentSchema,
});

function getWindow(input: z.infer<typeof workflowInputSchema>) {
  const end = input.end ? new Date(input.end) : new Date();
  const start = input.start
    ? new Date(input.start)
    : new Date(end.getTime() - 1000 * 60 * 60 * 24 * 30);

  return { start, end };
}

function toDateLabel(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${formatter.format(start)} → ${formatter.format(end)}`;
}

function getDefaultDiscordSentiment(
  channelId: string | null,
): z.infer<typeof discordSentimentSchema> {
  return {
    overall: 'unknown',
    summary: 'Discord sentiment not configured.',
    positiveSignals: [],
    painPoints: [],
    messageCount: 0,
    channelId,
    channelName: null,
  };
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

async function searchIssueCount(query: string, logger?: { info?: (message: string) => void }) {
  const github = getGithubClient();
  let total = 0;
  let page = 1;

  while (page <= 10) {
    const response = await github.rest.search.issuesAndPullRequests({
      q: query,
      per_page: 100,
      page,
    });

    const items = response.data.items.filter(item => !('pull_request' in item));
    total += items.length;

    logger?.info?.(`GitHub search page ${page}: ${items.length} issues for query ${query}`);

    if (response.data.items.length < 100) {
      break;
    }

    page += 1;
  }

  return total;
}

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
        npmPackages: ['@mastra/core'],
        generalChannelId: process.env.DISCORD_GENERAL_CHANNEL_ID || null,
        maxIssueAnalyses: inputData.maxIssueAnalyses ?? 300,
        maxGeneralMessages: inputData.maxGeneralMessages ?? 200,
        maxThreadMessages: inputData.maxThreadMessages ?? 50,
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
    const github = getGithubClient();
    const owner = inputData.repo.owner;
    const repo = inputData.repo.name;
    const { startDate, endDate } = inputData.period;

    const repoResponse = await github.rest.repos.get({ owner, repo });

    const [openedTotal, openedDiscord, closedTotal, closedDiscord, npmDownloads] = await Promise.all([
      searchIssueCount(`repo:${owner}/${repo} is:issue created:${startDate}..${endDate}`, logger),
      searchIssueCount(`repo:${owner}/${repo} is:issue label:discord created:${startDate}..${endDate}`, logger),
      searchIssueCount(`repo:${owner}/${repo} is:issue is:closed closed:${startDate}..${endDate}`, logger),
      searchIssueCount(`repo:${owner}/${repo} is:issue is:closed label:discord closed:${startDate}..${endDate}`, logger),
      fetchNpmDownloads(inputData.config.npmPackages, startDate, endDate),
    ]);

    const metrics = {
      stars: repoResponse.data.stargazers_count,
      issuesOpened: {
        total: openedTotal,
        discord: openedDiscord,
        rest: openedTotal - openedDiscord,
      },
      issuesClosed: {
        total: closedTotal,
        discord: closedDiscord,
        rest: closedTotal - closedDiscord,
      },
      npmDownloads,
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

    const query = `repo:${owner}/${name} is:issue label:discord created:${startDate}..${endDate}`;
    logger?.info?.(`Searching Discord-labeled issues with query: ${query}`);

    const searchResults: Array<{
      number: number;
      title: string;
      html_url: string;
      state: string;
      body?: string | null;
      labels: Array<string | { name?: string | null }>;
      pull_request?: unknown;
      created_at: string;
    }> = [];

    let page = 1;
    while (page <= 10) {
      const response = await github.rest.search.issuesAndPullRequests({
        q: query,
        sort: 'created',
        order: 'desc',
        per_page: 100,
        page,
      });

      searchResults.push(...response.data.items);
      logger?.info?.(
        `Issue candidate search page ${page}: ${response.data.items.length} results (total_count=${response.data.total_count})`,
      );

      if (response.data.items.length < 100) {
        break;
      }

      page += 1;
    }

    const candidates = searchResults
      .filter(issue => !('pull_request' in issue) || !issue.pull_request)
      .map(issue => ({
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueUrl: issue.html_url,
        labels: issue.labels
          .map(label => (typeof label === 'string' ? label : label.name || ''))
          .filter(Boolean),
        state: issue.state,
        body: issue.body ?? null,
        threadId: extractDiscordThreadId(issue.body),
        createdAt: issue.created_at,
      }))
      .filter(issue => {
        if (!issue.threadId) {
          logger?.info?.(
            `Skipping issue #${issue.issueNumber} (${issue.createdAt}): no Discord thread URL in body`,
          );
          return false;
        }
        return true;
      })
      .map(({ createdAt: _ignored, ...rest }) => rest)
      .filter((issue): issue is z.infer<typeof issueCandidateSchema> => Boolean(issue.threadId));

    logger?.info?.(
      `Found ${searchResults.length} Discord-labeled issues created in range, ${candidates.length} with Discord thread links`,
    );

    return candidates.slice(0, inputData.config.maxIssueAnalyses);
  },
});

const analyzeIssueThreadStep = createStep({
  id: 'analyze-issue-thread',
  inputSchema: issueCandidateSchema,
  outputSchema: issueAnalysisSchema.nullable(),
  stateSchema: reportStateSchema,
  execute: async ({ inputData, mastra, state }) => {
    const logger = mastra?.getLogger();
    const { config } = requireReportState(state);

    try {
      const thread = await fetchThreadMessages(inputData.threadId, config.maxThreadMessages);

      if (!thread.messages.length) {
        return null;
      }

      const analysis = await issueThreadAnalysisAgent.generate(
        `GitHub issue: #${inputData.issueNumber} ${inputData.issueTitle}\nURL: ${inputData.issueUrl}\nState: ${inputData.state}\nLabels: ${inputData.labels.join(', ')}\n\nIssue body:\n${inputData.body || 'No body'}\n\nDiscord thread: ${thread.threadName}\nDiscord thread messages:\n${thread.messages
          .map(message => `[${message.createdAt}] ${message.author}: ${message.content}`)
          .join('\n')}`,
        {
          structuredOutput: {
            schema: z.object({
              summary: z.string(),
              status: z.string(),
              urgency: z.enum(['low', 'medium', 'high']),
              recommendedAction: z.string(),
              blockers: z.array(z.string()),
            }),
          },
        },
      );

      return {
        issueNumber: inputData.issueNumber,
        issueTitle: inputData.issueTitle,
        issueUrl: inputData.issueUrl,
        labels: inputData.labels,
        state: inputData.state,
        threadId: inputData.threadId,
        threadUrl: thread.threadUrl,
        threadMessageCount: thread.messages.length,
        summary: analysis.object.summary,
        status: analysis.object.status,
        urgency: analysis.object.urgency,
        recommendedAction: analysis.object.recommendedAction,
        blockers: analysis.object.blockers,
      };
    } catch (error) {
      logger?.warn?.(
        `Skipping issue #${inputData.issueNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    }
  },
});

const collectIssueAnalysesStep = createStep({
  id: 'collect-issue-analyses',
  inputSchema: z.array(issueAnalysisSchema.nullable()),
  outputSchema: reportDraftSchema,
  stateSchema: reportStateSchema,
  execute: async ({ inputData, state }) => {
    const { repo, period, config, metrics } = requireReportState(state);

    return {
      repo,
      period,
      config,
      metrics,
      issueAnalyses: inputData.filter(isIssueAnalysis),
      discordSentiment: getDefaultDiscordSentiment(config.generalChannelId),
    };
  },
});

const analyzeDiscordSentimentStep = createStep({
  id: 'analyze-discord-sentiment',
  inputSchema: reportDraftSchema,
  outputSchema: reportSchema,
  execute: async ({ inputData }) => {
    let discordSentiment = getDefaultDiscordSentiment(inputData.config.generalChannelId);

    if (inputData.config.generalChannelId) {
      const start = new Date(inputData.period.start);
      const generalMessages = await fetchMessagesSince(
        inputData.config.generalChannelId,
        start,
        inputData.config.maxGeneralMessages,
      );
      const channelName = await getChannelName(inputData.config.generalChannelId);

      if (generalMessages.length) {
        const sentiment = await discordSentimentAgent.generate(
          `Analyze the following Discord messages from #${channelName} for community sentiment.\n\n${generalMessages
            .map(message => `[${message.createdAt.toISOString()}] ${message.author.username}: ${message.content}`)
            .join('\n')}`,
          {
            structuredOutput: {
              schema: z.object({
                overall: z.enum(['positive', 'neutral', 'negative', 'mixed', 'unknown']),
                summary: z.string(),
                positiveSignals: z.array(z.string()),
                painPoints: z.array(z.string()),
              }),
            },
          },
        );

        discordSentiment = {
          overall: sentiment.object.overall,
          summary: sentiment.object.summary,
          positiveSignals: sentiment.object.positiveSignals,
          painPoints: sentiment.object.painPoints,
          messageCount: generalMessages.length,
          channelId: inputData.config.generalChannelId,
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

    return {
      generatedAt: new Date().toISOString(),
      repo: inputData.repo,
      period: {
        start: inputData.period.start,
        end: inputData.period.end,
        label: inputData.period.label,
      },
      summary: {
        stars: inputData.metrics.stars,
        issuesOpened: inputData.metrics.issuesOpened,
        issuesClosed: inputData.metrics.issuesClosed,
        npmDownloads: {
          total: inputData.metrics.npmDownloads.reduce((sum, item) => sum + item.downloads, 0),
          packages: inputData.metrics.npmDownloads,
        },
        discordSentiment,
      },
      issueAnalyses: inputData.issueAnalyses,
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
  .foreach(analyzeIssueThreadStep, { concurrency: ISSUE_ANALYSIS_CONCURRENCY })
  .then(collectIssueAnalysesStep)
  .then(analyzeDiscordSentimentStep)
  .commit();
