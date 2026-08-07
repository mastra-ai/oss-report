import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { createSlackAdapter } from '@chat-adapter/slack';
import { z } from 'zod';
import { loadStoredReports } from '../workflows/oss-report';

// createSlackAdapter() throws at construction when webhook credentials are
// missing, so only attach the Slack channel when the env vars are present.
// Credentials are read from SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET.
const slackConfigured = Boolean(
  process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET,
);

const getReportsTool = createTool({
  id: 'get-oss-reports',
  description:
    'Load recent weekly OSS reports, newest first. Each report covers one week and includes intake/close metrics, deltas vs the prior week, the executive briefing, Discord sentiment, and the analyzed issues.',
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(8)
      .default(1)
      .describe('How many recent weekly reports to load (1 = latest only)'),
  }),
  execute: async ({ limit }, context) => {
    const reports = await loadStoredReports(context?.mastra, limit, context?.mastra?.getLogger());
    // Strip embeddings and trim issues to keep the payload model-friendly.
    return {
      reports: reports.map(report => ({
        generatedAt: report.generatedAt,
        period: report.period,
        comparison: report.comparison,
        takeaways: report.takeaways,
        actions: report.actions,
        summary: report.summary,
        briefing: report.briefing,
        issues: report.issueAnalyses.map(issue => ({
          number: issue.issueNumber,
          title: issue.issueTitle,
          url: issue.issueUrl,
          state: issue.issueState,
          lifecycle: issue.lifecycle,
          closureReason: issue.closureReason,
          type: issue.type,
          severity: issue.severity,
          category: issue.category,
          summary: issue.summary,
        })),
      })),
    };
  },
});

export const slackReportAgent = new Agent({
  id: 'slack-report-agent',
  name: 'Slack Report Agent',
  instructions: `
    You are the Slack-facing assistant for the weekly Mastra OSS report. People
    mention you in Slack to ask about the latest report or how things have
    trended across recent weeks.

    Ground report-related answers in real report data:
    - Use the get-oss-reports tool for questions about reports, issues, metrics,
      sentiment, or trends. Fetch 1 for latest-report questions and more when
      comparing weeks.
    - Do not call the tool for greetings, conversational follow-ups, or questions
      about your own behavior that do not require report data.
    - Cite issue numbers with their GitHub links when referencing specific
      issues.
    - Prefer the report's deterministic numbers (summary counts, comparison
      deltas) over your own counting.
    - Never fabricate issue numbers, metrics, or quotes. If the reports don't
      contain the answer, say so.

    Style: this is Slack, so keep answers short and scannable — a few sentences
    or a compact bullet list. Lead with the answer, not preamble. Only expand
    when explicitly asked for detail.
  `,
  model: 'openrouter/openai/gpt-5.6-terra',
  memory: new Memory({
    options: {
      lastMessages: 20,
    },
  }),
  tools: { getReportsTool },
  ...(slackConfigured
    ? {
        channels: {
          adapters: {
            slack: {
              adapter: createSlackAdapter(),
              toolDisplay: 'hidden',
            },
          },
        },
      }
    : {}),
});
