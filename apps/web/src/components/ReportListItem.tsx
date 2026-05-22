import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SentimentBadge } from '@/components/SentimentBadge';
import { deleteRun } from '@/lib/api';
import { cn, formatDateUTC, formatNumber, formatRelative } from '@/lib/utils';
import type { ReportIndexEntry } from '@/types/report';

export function ReportListItem({
  entry,
  onDeleted,
}: {
  entry: ReportIndexEntry;
  onDeleted?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const label = `${formatDateUTC(entry.period.start)} → ${formatDateUTC(entry.period.end)}`;
    if (!window.confirm(`Delete the report for ${label}? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteRun(entry.id);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }
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
    <div className="group relative flex items-stretch transition-colors hover:bg-muted/50">
      <Link
        to={`/reports/${entry.id}`}
        className="flex flex-1 items-center justify-between gap-6 p-5"
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
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label="Delete report"
        title={error ?? 'Delete report'}
        className={cn(
          'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100',
          deleting && 'opacity-100',
          error && 'text-destructive opacity-100',
        )}
      >
        {deleting ? (
          <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        )}
      </button>
    </div>
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
