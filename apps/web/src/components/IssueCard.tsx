import { SeverityBadge } from '@/components/SeverityBadge';
import { TypeBadge } from '@/components/TypeBadge';
import type { ClosureReason, IssueAnalysis } from '@/types/report';
import { formatDate } from '@/lib/utils';

const CLOSURE_LABEL: Record<ClosureReason, string> = {
  fixed: 'fixed',
  wontfix: "won't fix",
  duplicate: 'duplicate',
  stale: 'stale',
  unknown: 'closed',
};

const CLOSURE_CLASSES: Record<ClosureReason, string> = {
  fixed: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  wontfix: 'border-border bg-muted text-muted-foreground',
  duplicate: 'border-border bg-muted text-muted-foreground',
  stale: 'border-border bg-muted text-muted-foreground',
  unknown: 'border-border bg-muted text-muted-foreground',
};

const CLOSURE_DOT: Record<ClosureReason, string> = {
  fixed: 'bg-emerald-500',
  wontfix: 'bg-muted-foreground/50',
  duplicate: 'bg-muted-foreground/50',
  stale: 'bg-muted-foreground/50',
  unknown: 'bg-muted-foreground/50',
};

function StatePill({ issue }: { issue: IssueAnalysis }) {
  if (issue.issueState === 'open') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        <span className="h-1 w-1 rounded-full bg-emerald-500" />
        open
      </span>
    );
  }

  const reason = issue.closureReason ?? 'unknown';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${CLOSURE_CLASSES[reason]}`}
    >
      <span className={`h-1 w-1 rounded-full ${CLOSURE_DOT[reason]}`} />
      {CLOSURE_LABEL[reason]}
    </span>
  );
}

export function IssueCard({ issue }: { issue: IssueAnalysis }) {
  const isBug = issue.type === 'Bug';
  const closedInWindow = issue.lifecycle === 'closed' || issue.lifecycle === 'opened-and-closed';

  return (
    <article className="p-5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <a
          href={issue.issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-xs text-muted-foreground hover:text-foreground"
        >
          #{issue.issueNumber}
        </a>
        <a
          href={issue.issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 text-sm font-medium leading-snug hover:underline"
        >
          {issue.issueTitle}
        </a>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <TypeBadge type={issue.type} />
          {isBug && <SeverityBadge severity={issue.severity} />}
          <StatePill issue={issue} />
        </div>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{issue.summary}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {issue.authorLogin && <span>@{issue.authorLogin}</span>}
        <span>{formatDate(issue.createdAt)}</span>
        {closedInWindow && issue.closedAt && <span>closed {formatDate(issue.closedAt)}</span>}
        <span>
          <span className="mono tabular-nums text-foreground">{issue.commentCount}</span> comments
        </span>
        {issue.threadMessageCount > 0 && (
          <span>
            <span className="mono tabular-nums text-foreground">{issue.threadMessageCount}</span>{' '}
            discord msgs
          </span>
        )}
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize">{issue.category}</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-[11px]">AI triaged</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-[11px]">
          {issue.source === 'discord-thread' ? 'Discord + GitHub' : 'GitHub only'}
        </span>
        {issue.threadUrl && (
          <a
            href={issue.threadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            discord thread →
          </a>
        )}
      </div>
    </article>
  );
}
