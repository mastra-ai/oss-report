import type { Severity } from '@/types/report';

const TONE: Record<Severity, string> = {
  CRITICAL: 'border-destructive/30 bg-destructive/5 text-destructive',
  MAJOR: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  MINOR: 'border-border bg-muted text-muted-foreground',
};

const LABEL: Record<Severity, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[severity]}`}
    >
      {LABEL[severity]}
    </span>
  );
}
