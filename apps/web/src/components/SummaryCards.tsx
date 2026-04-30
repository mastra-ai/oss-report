import { cn, formatNumber } from '@/lib/utils';
import type { Comparison, Report } from '@/types/report';

export function SummaryCards({ report }: { report: Report }) {
  const { summary, comparison } = report;

  return (
    <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-5">
      <Metric
        label="Open backlog"
        value={summary.openBacklog}
        caption="all open issues"
        delta={comparison.backlogDelta}
        direction="down-better-warning"
      />
      <Metric
        label="New issues"
        value={summary.issuesOpened.total}
        caption={`${summary.issuesOpened.discord} from Discord · ${summary.issuesOpened.github} direct`}
        delta={comparison.issuesOpenedDelta}
        direction="neutral"
      />
      <Metric
        label="Closed issues"
        value={summary.issuesClosed.total}
        caption={`${summary.issuesClosed.discord} from Discord · ${summary.issuesClosed.github} direct`}
        delta={comparison.issuesClosedDelta}
        direction="neutral"
      />
      <Metric
        label="PRs merged"
        value={summary.pullRequests.merged}
        caption={`${formatNumber(summary.pullRequests.opened)} opened this window`}
        delta={comparison.mergedPrDelta}
        direction="neutral"
      />
      <Metric
        label="Critical bugs"
        value={summary.bugSeverityCounts.CRITICAL}
        caption={`${summary.bugSeverityCounts.MAJOR} major also surfaced`}
        delta={comparison.criticalBugDelta}
        direction="down-better"
      />
    </div>
  );
}

function Metric({
  label,
  value,
  caption,
  delta,
  direction,
}: {
  label: string;
  value: number;
  caption: string;
  delta: Comparison['backlogDelta'];
  direction: 'up-better' | 'down-better' | 'down-better-warning' | 'neutral';
}) {
  return (
    <div className="bg-background p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <DeltaBadge delta={delta} direction={direction} />
      </div>
      <div className="mono mt-2 text-3xl font-semibold tabular-nums tracking-tight">
        {formatNumber(value)}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{caption}</div>
    </div>
  );
}

function DeltaBadge({
  delta,
  direction,
}: {
  delta: number | null;
  direction: 'up-better' | 'down-better' | 'down-better-warning' | 'neutral';
}) {
  if (delta === null) {
    return <span className="text-[10px] text-muted-foreground">first run</span>;
  }
  if (delta === 0) {
    return <span className="text-[10px] text-muted-foreground">flat</span>;
  }

  const positive = delta > 0;
  const arrow = positive ? '↑' : '↓';
  const tone =
    direction === 'neutral'
      ? 'border-border bg-muted text-muted-foreground'
      : direction === 'up-better'
        ? positive
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
        : direction === 'down-better-warning'
          ? positive
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
            : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : positive
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        tone,
      )}
    >
      {arrow} {Math.abs(delta)}
    </span>
  );
}
