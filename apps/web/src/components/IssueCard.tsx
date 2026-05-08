import { useState } from 'react';
import { SeverityBadge } from '@/components/SeverityBadge';
import { TypeBadge } from '@/components/TypeBadge';
import type {
  ClosureReason,
  IssueAnalysis,
  IssueType,
  Severity,
} from '@/types/report';
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

export type IssueCardEdit = {
  severity?: Severity;
  type?: IssueType;
  summary?: string;
};

export function IssueCard({
  issue,
  edit,
  onSaveEdit,
  onClearEdit,
}: {
  issue: IssueAnalysis;
  edit?: IssueCardEdit;
  onSaveEdit?: (issueNumber: number, edit: IssueCardEdit) => void;
  onClearEdit?: (issueNumber: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  // Effective values (apply pending edit on top of original).
  const effectiveType: IssueType = edit?.type ?? issue.type;
  const effectiveSeverity: Severity =
    effectiveType === 'Bug' ? edit?.severity ?? issue.severity : 'MINOR';
  const effectiveSummary = edit?.summary ?? issue.summary;

  const isBug = effectiveType === 'Bug';
  const closedInWindow = issue.lifecycle === 'closed' || issue.lifecycle === 'opened-and-closed';
  const hasEdit = Boolean(edit);

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
          <TypeBadge type={effectiveType} />
          {isBug && <SeverityBadge severity={effectiveSeverity} />}
          <StatePill issue={issue} />
          {hasEdit && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              edited
            </span>
          )}
          {onSaveEdit && (
            <button
              type="button"
              className="inline-flex h-6 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setIsEditing((v) => !v)}
              aria-label="Edit issue"
            >
              {isEditing ? 'Close' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{effectiveSummary}</p>

      {isEditing && onSaveEdit && (
        <EditPanel
          issue={issue}
          edit={edit}
          onSave={(next) => {
            onSaveEdit(issue.issueNumber, next);
            setIsEditing(false);
          }}
          onClear={() => {
            onClearEdit?.(issue.issueNumber);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      )}

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

const TYPE_OPTIONS: IssueType[] = ['Bug', 'Feature Request', 'Question'];
const SEVERITY_OPTIONS: Severity[] = ['MINOR', 'MAJOR', 'CRITICAL'];

function EditPanel({
  issue,
  edit,
  onSave,
  onClear,
  onCancel,
}: {
  issue: IssueAnalysis;
  edit?: IssueCardEdit;
  onSave: (next: IssueCardEdit) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<IssueType>(edit?.type ?? issue.type);
  const [severity, setSeverity] = useState<Severity>(edit?.severity ?? issue.severity);
  const [summary, setSummary] = useState<string>(edit?.summary ?? issue.summary);

  function handleSave() {
    const next: IssueCardEdit = {};
    if (type !== issue.type) next.type = type;
    // Severity only applies for bugs; ignore otherwise.
    const effectiveType = type;
    if (effectiveType === 'Bug') {
      if (severity !== issue.severity) next.severity = severity;
    } else if (type !== issue.type && issue.severity !== 'MINOR') {
      // Switching off Bug — clear any prior severity edit by leaving it unset
      // (server applies MINOR automatically for non-bugs).
    }
    if (summary.trim() && summary.trim() !== issue.summary) next.summary = summary.trim();
    if (Object.keys(next).length === 0) {
      onCancel();
      return;
    }
    onSave(next);
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Type</span>
          <select
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as IssueType)}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Severity {type !== 'Bug' && '(bugs only)'}</span>
          <select
            className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-50"
            value={severity}
            disabled={type !== 'Bug'}
            onChange={(e) => setSeverity(e.target.value as Severity)}
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-muted-foreground">Summary</span>
        <textarea
          className="min-h-[72px] rounded border border-border bg-background px-2 py-1 text-sm leading-snug"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center rounded border border-border bg-foreground px-3 py-1 text-xs font-medium text-background hover:bg-foreground/90"
          onClick={handleSave}
        >
          Stage edit
        </button>
        <button
          type="button"
          className="inline-flex items-center rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onCancel}
        >
          Cancel
        </button>
        {edit && (
          <button
            type="button"
            className="ml-auto inline-flex items-center rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClear}
          >
            Clear edit
          </button>
        )}
      </div>
    </div>
  );
}
