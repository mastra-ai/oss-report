import { formatNumber } from '@/lib/utils';
import type { Report } from '@/types/report';

export function SummaryCards({ report }: { report: Report }) {
  const { summary } = report;

  return (
    <div className="grid grid-cols-2 gap-px rounded-md border bg-border overflow-hidden lg:grid-cols-4">
      <Metric
        label="Open backlog"
        value={summary.openBacklog}
        caption="all open issues"
      />
      <Metric
        label="Issues opened"
        value={summary.issuesOpened.total}
        caption={`${summary.issuesOpened.discord} discord · ${summary.issuesOpened.github} direct`}
      />
      <Metric
        label="Issues closed"
        value={summary.issuesClosed.total}
        caption={`${summary.issuesClosed.discord} discord · ${summary.issuesClosed.github} direct`}
      />
      <Metric
        label="PRs merged"
        value={summary.pullRequests.merged}
        caption={`${formatNumber(summary.pullRequests.opened)} opened this window`}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <div className="bg-background p-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mono mt-2 text-3xl font-semibold tabular-nums tracking-tight">
        {formatNumber(value)}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{caption}</div>
    </div>
  );
}
