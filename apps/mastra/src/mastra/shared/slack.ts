// Minimal structural view of the report fields used for Slack formatting.
// Kept local to avoid a runtime import cycle with the workflow module.
export type SlackReportInput = {
  repo: { owner: string; name: string };
  period: { label: string };
  summary: {
    issuesOpened: { total: number };
    issuesClosed: { total: number };
    pullRequests: { opened: number; merged: number };
    bugSeverityCounts: { CRITICAL: number; MAJOR: number };
  };
  takeaways: { improved: string[]; regressed: string[]; watch: string[] };
  actions: { recommendedActions: string[] };
  briefing: { headline: string } | null;
};

type SlackLogger = {
  info?: (message: string) => void;
  error?: (message: string) => void;
};

const MAX_ITEMS_PER_SECTION = 3;

function bulletList(items: string[]) {
  return items
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map(item => `• ${item}`)
    .join('\n');
}

export function formatSlackReportMessage(report: SlackReportInput, runId: string) {
  const { repo, period, summary, takeaways, actions, briefing } = report;
  const headline = briefing?.headline ?? `OSS report — ${repo.owner}/${repo.name} — ${period.label}`;

  const metricsLine = [
    `Issues opened: *${summary.issuesOpened.total}*`,
    `Issues closed: *${summary.issuesClosed.total}*`,
    `PRs merged: *${summary.pullRequests.merged}*`,
    `Critical bugs: *${summary.bugSeverityCounts.CRITICAL}*`,
    `Major bugs: *${summary.bugSeverityCounts.MAJOR}*`,
  ].join('  |  ');

  const blocks: Record<string, unknown>[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Weekly OSS report — ${period.label}`, emoji: true },
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*${headline}*` } },
    { type: 'section', text: { type: 'mrkdwn', text: metricsLine } },
  ];

  const sections: Array<[string, string[]]> = [
    ['Improved', takeaways.improved],
    ['Regressed', takeaways.regressed],
    ['Watch', takeaways.watch],
    ['Recommended actions', actions.recommendedActions],
  ];

  for (const [title, items] of sections) {
    if (items.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${title}*\n${bulletList(items)}` },
      });
    }
  }

  const publicUrl = process.env.OSS_REPORT_PUBLIC_URL;

  if (publicUrl) {
    const reportUrl = `${publicUrl.replace(/\/$/, '')}/app/#/reports/${runId}`;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<${reportUrl}|View the full report>` },
    });
  }

  return {
    text: `${headline} — ${metricsLine.replaceAll('*', '')}`,
    blocks,
  };
}

export async function postToSlackWebhook(payload: object, logger?: SlackLogger) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    logger?.info?.('SLACK_WEBHOOK_URL is not set; skipping Slack post');
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger?.error?.(`Slack webhook responded with ${response.status}: ${body}`);
      return false;
    }

    return true;
  } catch (error) {
    logger?.error?.(`Failed to post to Slack webhook: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
