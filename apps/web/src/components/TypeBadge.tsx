import type { IssueType } from '@/types/report';

const TONE: Record<IssueType, string> = {
  Bug: 'border-destructive/30 bg-destructive/5 text-destructive',
  'Feature Request': 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400',
  Question: 'border-border bg-muted text-muted-foreground',
};

const LABEL: Record<IssueType, string> = {
  Bug: 'Bug',
  'Feature Request': 'Feature',
  Question: 'Question',
};

export function TypeBadge({ type }: { type: IssueType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[type]}`}
    >
      {LABEL[type]}
    </span>
  );
}
