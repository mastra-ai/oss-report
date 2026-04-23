import type { SentimentOverall } from '@/types/report';

const TONE: Record<SentimentOverall, string> = {
  positive: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  neutral: 'border-border bg-muted text-muted-foreground',
  negative: 'border-destructive/30 bg-destructive/5 text-destructive',
  mixed: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  unknown: 'border-border bg-muted text-muted-foreground',
};

const DOT: Record<SentimentOverall, string> = {
  positive: 'bg-emerald-500',
  neutral: 'bg-muted-foreground/50',
  negative: 'bg-destructive',
  mixed: 'bg-amber-500',
  unknown: 'bg-muted-foreground/50',
};

export function SentimentBadge({
  sentiment,
  size = 'sm',
}: {
  sentiment: SentimentOverall;
  size?: 'sm' | 'lg';
}) {
  const sizeClass =
    size === 'lg'
      ? 'gap-1.5 px-2.5 py-1 text-xs'
      : 'gap-1 px-2 py-0.5 text-[11px]';
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium capitalize ${sizeClass} ${TONE[sentiment]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[sentiment]}`} aria-hidden />
      {sentiment}
    </span>
  );
}
