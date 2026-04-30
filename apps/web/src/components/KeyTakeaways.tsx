import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import type { Comparison, Takeaways } from '@/types/report';

const DEFAULT_EMPTY = {
  improved: 'No clear week-over-week improvement signal yet.',
  regressed: 'No major regression stood out versus the prior report.',
  watch: 'No concentrated risk area surfaced beyond normal triage load.',
} as const;

export function KeyTakeaways({
  takeaways,
  comparison,
}: {
  takeaways: Takeaways;
  comparison: Comparison;
}) {
  const improved = normalizeImprovedItems(takeaways.improved);
  const regressed = normalizeItems(takeaways.regressed, DEFAULT_EMPTY.regressed);
  const watch = normalizeWatchItems(takeaways.watch);
  const metricChips = buildMetricChips(comparison);
  const hasCriticalRegression = regressed.some(item => item.toLowerCase().includes('critical'));

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="border-b border-border/70 bg-gradient-to-r from-background via-background to-muted/30 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <span className="rounded-full border border-border/70 bg-background px-2 py-1">
                {metricChips.length > 0 ? 'Compared with previous report' : 'Current report'}
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground">Key takeaways</h2>
          </div>

          {metricChips.length > 0 && (
            <div className="flex flex-wrap gap-2 lg:max-w-xl lg:justify-end">
              {metricChips.map(chip => (
                <div
                  key={chip.label}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                    chip.tone === 'positive' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                    chip.tone === 'critical' && 'border-rose-200 bg-rose-50 text-rose-700',
                    chip.tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700',
                    chip.tone === 'neutral' && 'border-border bg-background text-muted-foreground',
                  )}
                >
                  <chip.icon className="h-3.5 w-3.5" />
                  <span>{chip.value}</span>
                  <span className="text-current/70">{chip.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-6 xl:grid-cols-3">
        <TakeawayCard
          title="Improved"
          tone="emerald"
          icon={TrendingUp}
          eyebrow="Where momentum improved"
          items={improved}
          empty={DEFAULT_EMPTY.improved}
        />
        <TakeawayCard
          title={regressed.length > 0 ? 'Regressed' : 'No regression'}
          tone={regressed.length > 0 ? (hasCriticalRegression ? 'rose' : 'amber') : 'slate'}
          icon={regressed.length > 0 ? TrendingDown : CheckCircle2}
          eyebrow={regressed.length > 0 ? 'What changed unfavorably' : 'What stayed stable'}
          items={regressed}
          empty={DEFAULT_EMPTY.regressed}
        />
        <TakeawayCard
          title={watch.length > 0 ? 'Needs attention' : 'No watch items'}
          tone={watch.length > 0 ? 'amber' : 'slate'}
          icon={watch.length > 0 ? AlertTriangle : CheckCircle2}
          eyebrow={watch.length > 0 ? 'What to watch next' : 'What stayed quiet'}
          items={watch}
          empty={DEFAULT_EMPTY.watch}
        />
      </div>
    </section>
  );
}

function TakeawayCard({
  title,
  tone,
  icon: Icon,
  eyebrow,
  items,
  empty,
}: {
  title: string;
  tone: 'emerald' | 'rose' | 'amber' | 'slate';
  icon: typeof TrendingUp;
  eyebrow: string;
  items: string[];
  empty: string;
}) {
  const styles = {
    emerald: {
      card: 'border-emerald-200/80 bg-emerald-50/60',
      iconWrap: 'bg-emerald-500/12 text-emerald-700',
      bullet: 'bg-emerald-500',
      emptyIcon: CheckCircle2,
      emptyWrap: 'border-emerald-200/80 bg-white/80 text-emerald-800',
    },
    rose: {
      card: 'border-rose-200/80 bg-rose-50/60',
      iconWrap: 'bg-rose-500/12 text-rose-700',
      bullet: 'bg-rose-500',
      emptyIcon: Minus,
      emptyWrap: 'border-rose-200/80 bg-white/80 text-rose-800',
    },
    amber: {
      card: 'border-amber-200/80 bg-amber-50/60',
      iconWrap: 'bg-amber-500/12 text-amber-700',
      bullet: 'bg-amber-500',
      emptyIcon: CheckCircle2,
      emptyWrap: 'border-amber-200/80 bg-white/80 text-amber-800',
    },
    slate: {
      card: 'border-slate-200/80 bg-slate-50/60',
      iconWrap: 'bg-slate-500/10 text-slate-600',
      bullet: 'bg-slate-500',
      emptyIcon: CheckCircle2,
      emptyWrap: 'border-slate-200/80 bg-white/80 text-slate-700',
    },
  }[tone];

  const EmptyIcon = styles.emptyIcon;

  return (
    <section className={cn('rounded-2xl border p-5', styles.card)}>
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', styles.iconWrap)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">{title}</h3>
        </div>
      </div>

      {items.length === 0 ? (
        <div className={cn('mt-4 flex items-start gap-3 rounded-2xl border p-4 text-sm', styles.emptyWrap)}>
          <EmptyIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-6 text-current/85">{empty}</p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {items.map((item, index) => (
            <li key={item} className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
                      styles.bullet,
                    )}
                  >
                    {index + 1}
                  </span>
                </div>
                <p className="text-sm leading-6 text-foreground/85">{item}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function normalizeItems(items: string[], emptyMessage: string) {
  return items.filter(item => item !== emptyMessage).map(cleanTakeawayText);
}

function normalizeImprovedItems(items: string[]) {
  return normalizeItems(items, DEFAULT_EMPTY.improved).filter(
    item => !/^\d+ issues? closed within 7 days\.$/i.test(item),
  );
}

function normalizeWatchItems(items: string[]) {
  return normalizeItems(items, DEFAULT_EMPTY.watch).filter(item => {
    const categoryRiseMatch = item.match(/issue activity rose by (\d+)\.$/i);
    if (!categoryRiseMatch) return true;
    return Number(categoryRiseMatch[1]) >= 5;
  });
}

function cleanTakeawayText(item: string) {
  const categoryRiseMatch = item.match(/^([a-z-]+) discussion volume rose by (\d+) issues?\.$/i);
  if (categoryRiseMatch) {
    const [, rawCategory, amount] = categoryRiseMatch;
    return `${toTitleCase(rawCategory)} issue activity rose by ${amount}.`;
  }

  return item.charAt(0).toUpperCase() + item.slice(1);
}

function toTitleCase(value: string) {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildMetricChips(comparison: Comparison) {
  const chips = [
    comparison.mergedPrDelta !== null
      ? {
          label: 'merged PRs',
          value: formatSignedDelta(comparison.mergedPrDelta),
          tone: comparison.mergedPrDelta > 0 ? 'positive' : 'neutral',
          weight: Math.abs(comparison.mergedPrDelta),
          icon: ArrowRight,
        }
      : null,
    comparison.issuesClosedDelta !== null
      ? {
          label: 'issues closed',
          value: formatSignedDelta(comparison.issuesClosedDelta),
          tone: comparison.issuesClosedDelta > 0 ? 'positive' : 'neutral',
          weight: Math.abs(comparison.issuesClosedDelta),
          icon: CheckCircle2,
        }
      : null,
    comparison.backlogDelta !== null
      ? {
          label: 'backlog',
          value: formatSignedDelta(comparison.backlogDelta),
          tone: comparison.backlogDelta < 0 ? 'positive' : comparison.backlogDelta > 0 ? 'warning' : 'neutral',
          weight: Math.abs(comparison.backlogDelta),
          icon: comparison.backlogDelta <= 0 ? TrendingDown : TrendingUp,
        }
      : null,
    comparison.criticalBugDelta !== null
      ? {
          label: 'critical bugs',
          value: formatSignedDelta(comparison.criticalBugDelta),
          tone:
            comparison.criticalBugDelta < 0
              ? 'positive'
              : comparison.criticalBugDelta > 0
                ? 'critical'
                : 'neutral',
          weight: Math.abs(comparison.criticalBugDelta),
          icon: AlertTriangle,
        }
      : null,
    comparison.majorBugDelta !== null
      ? {
          label: 'major bugs',
          value: formatSignedDelta(comparison.majorBugDelta),
          tone:
            comparison.majorBugDelta < 0 ? 'positive' : comparison.majorBugDelta > 0 ? 'warning' : 'neutral',
          weight: Math.abs(comparison.majorBugDelta),
          icon: AlertTriangle,
        }
      : null,
  ]
    .filter((chip): chip is Exclude<typeof chip, null> => chip !== null && chip.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);

  return chips;
}

function formatSignedDelta(value: number) {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;
}
