import { Link } from 'react-router-dom';
import { SentimentBadge } from '@/components/SentimentBadge';
import { cn, formatDateUTC, formatNumber, formatRelative } from '@/lib/utils';
import type { ReportIndexEntry } from '@/types/report';

export function ReportListItem({ entry }: { entry: ReportIndexEntry }) {
  const totalBugs =
    entry.summary.bugSeverityCounts.CRITICAL +
    entry.summary.bugSeverityCounts.MAJOR +
    entry.summary.bugSeverityCounts.MINOR;
  const critical = entry.summary.bugSeverityCounts.CRITICAL;
  const preview =
    entry.briefing?.headline ??
    entry.takeaways.regressed[0] ??
    entry.takeaways.watch[0] ??
    entry.takeaways.improved[0] ??
    null;

  return (
    <Link
      to={`/reports/${entry.id}`}
      className="group flex items-center justify-between gap-6 p-5 transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tracking-tight group-hover:text-foreground">
            {formatDateUTC(entry.period.start)}
            <span className="mx-1.5 text-muted-foreground">→</span>
            {formatDateUTC(entry.period.end)}
          </span>
          {critical > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
              <span className="h-1 w-1 rounded-full bg-destructive" />
              {critical} critical
            </span>
          )}
          <DeltaChip label="backlog" delta={entry.comparison.backlogDelta} direction="down-better" />
          <DeltaChip label="merged" delta={entry.comparison.mergedPrDelta} direction="neutral" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Generated {formatRelative(entry.generatedAt)}</span>
          <span>·</span>
          <span>
            <span className="mono tabular-nums text-foreground">
              {formatNumber(entry.summary.issuesOpened.total)}
            </span>{' '}
            opened
          </span>
          <span>
            <span className="mono tabular-nums text-foreground">
              {formatNumber(entry.summary.issuesClosed.total)}
            </span>{' '}
            closed
          </span>
          <span>
            <span className="mono tabular-nums text-foreground">
              {formatNumber(entry.summary.pullRequests.merged)}
            </span>{' '}
            PRs merged
          </span>
          <span>
            <span className="mono tabular-nums text-foreground">{entry.summary.analysisCount}</span> analyzed
          </span>
          {totalBugs > 0 && (
            <span>
              <span className="mono tabular-nums text-foreground">{totalBugs}</span> bug
              {totalBugs === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {preview && <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{preview}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <SentimentBadge sentiment={entry.summary.discordSentiment} />
        <span className="text-muted-foreground transition-colors group-hover:text-foreground">→</span>
      </div>
    </Link>
  );
}

function DeltaChip({
  label,
  delta,
  direction,
}: {
  label: string;
  delta: number | null;
  direction: 'up-better' | 'down-better' | 'neutral';
}) {
  if (delta === null || delta === 0) return null;
  const positive = delta > 0;
  const tone =
    direction === 'neutral'
      ? 'border-border bg-muted text-muted-foreground'
      : direction === 'up-better'
        ? positive
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
        : positive
          ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
          : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        tone,
      )}
    >
      {label} {positive ? '+' : ''}
      {delta}
    </span>
  );
}
