import { useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, MessagesSquare, TrendingDown, TrendingUp } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import type {
  Briefing,
  BriefingRecurring,
  BriefingSeverity,
  Comparison,
} from '@/types/report';

interface Props {
  briefing: Briefing;
  comparison: Comparison;
  presentMode?: boolean;
}

type ChipTone = 'positive' | 'critical' | 'warning' | 'neutral';

interface MetricChip {
  label: string;
  value: string;
  tone: ChipTone;
  weight: number;
  icon: typeof TrendingUp;
}

const severityTone: Record<BriefingSeverity, string> = {
  critical: 'text-red-700 bg-red-50 border-red-200',
  major: 'text-amber-700 bg-amber-50 border-amber-200',
  minor: 'text-muted-foreground bg-muted border-border',
};

export function WeeklyBriefing({ briefing, comparison, presentMode = false }: Props) {
  const recurringPains = briefing.recurring ?? [];
  const recurringRequests = briefing.recurringRequests ?? [];
  const hasRecurring = recurringPains.length > 0 || recurringRequests.length > 0;
  const showTalkingPoints = presentMode && briefing.talkingPoints.length > 0;
  const metricChips = buildMetricChips(comparison);

  return (
    <section className="rounded-md border bg-card">
      <header className="border-b px-5 py-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Weekly briefing
          </div>
          <h2 className="mt-1 text-xl font-semibold leading-snug tracking-tight">
            {briefing.headline}
          </h2>
        </div>
        {metricChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {metricChips.map(chip => (
              <span
                key={chip.label}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
                  chip.tone === 'positive' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                  chip.tone === 'critical' && 'border-red-200 bg-red-50 text-red-700',
                  chip.tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700',
                  chip.tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
                )}
                title={`${chip.value} ${chip.label} vs prior report`}
              >
                <chip.icon className="h-3 w-3" />
                <span className="font-medium">{chip.value}</span>
                <span>{chip.label}</span>
              </span>
            ))}
          </div>
        )}
      </header>

      {hasRecurring && (
        <div className="border-b px-5 py-4 space-y-4">
          {recurringPains.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recurring pains
              </h3>
              <ul className="mt-2 space-y-3 text-sm">
                {recurringPains.map((item, i) => (
                  <RecurringItem key={i} item={item} />
                ))}
              </ul>
            </div>
          )}
          {recurringRequests.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recurring feature requests
              </h3>
              <ul className="mt-2 space-y-3 text-sm">
                {recurringRequests.map((item, i) => (
                  <RecurringItem key={i} item={item} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-x-6 gap-y-5 px-5 py-5 md:grid-cols-3">
        <Column
          title="Wins"
          empty="No standout wins this week."
          items={briefing.wins.map(w => ({
            text: w.text,
            meta: w.evidence,
          }))}
        />
        <Column
          title="Regressions"
          empty="No regressions worth flagging."
          items={briefing.regressions.map(r => ({
            text: r.text,
            meta: r.evidence,
            badge: { label: r.severity, tone: severityTone[r.severity] },
          }))}
        />
        <Column
          title="Watchlist"
          empty="Nothing on the watchlist."
          items={briefing.watchlist.map(w => ({
            text: w.text,
            meta: w.why,
          }))}
        />
      </div>

      {showTalkingPoints && (
        <div className="border-t bg-muted/40 px-5 py-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Talking points <span className="ml-1 normal-case">(present mode)</span>
          </h3>
          <ol className="mt-2 space-y-2 text-sm">
            {briefing.talkingPoints.map((point, i) => (
              <li key={i} className="flex gap-2 leading-snug">
                <span className="mt-0.5 w-5 shrink-0 text-xs font-medium text-muted-foreground">
                  {i + 1}.
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

interface ColumnItem {
  text: string;
  meta?: string | null;
  badge?: { label: string; tone: string };
}

function Column({
  title,
  items,
  empty,
}: {
  title: string;
  items: ColumnItem[];
  empty: string;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {items.map((item, i) => (
            <li key={i} className="leading-snug">
              <div className="flex items-start gap-2">
                {item.badge && (
                  <span
                    className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${item.badge.tone}`}
                  >
                    {item.badge.label}
                  </span>
                )}
                <span>{item.text}</span>
              </div>
              {item.meta && (
                <div className="mt-0.5 pl-0 text-xs text-muted-foreground">{item.meta}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecurringItem({ item }: { item: BriefingRecurring }) {
  const [open, setOpen] = useState(false);
  const related = item.relatedSignals ?? [];
  return (
    <li className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-snug">
        {item.source === 'github' && item.issueUrl ? (
          <a
            href={item.issueUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            #{item.issueNumber}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            <MessagesSquare className="h-3 w-3" />
            {item.aspect ?? 'discord'}
          </span>
        )}
        <span className="flex-1">{item.text}</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          seen {item.weeksSeen} weeks
        </span>
      </div>
      {related.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
            />
            Also seen in {related.length} prior signal{related.length === 1 ? '' : 's'}
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1 border-l border-border/60 pl-3 text-xs">
              {related.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {r.source === 'discord' && (
                        <MessagesSquare className="mr-1 inline h-3 w-3" />
                      )}
                      {r.label}
                    </a>
                  ) : (
                    <span className="flex-1 text-muted-foreground">
                      {r.source === 'discord' && (
                        <MessagesSquare className="mr-1 inline h-3 w-3" />
                      )}
                      {r.label}
                    </span>
                  )}
                  <span className="text-muted-foreground/70">
                    {new Date(r.periodEnd).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function buildMetricChips(comparison: Comparison): MetricChip[] {
  const chips: (MetricChip | null)[] = [
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
          weight: Math.abs(comparison.criticalBugDelta) * 3,
          icon: AlertTriangle,
        }
      : null,
    comparison.majorBugDelta !== null
      ? {
          label: 'major bugs',
          value: formatSignedDelta(comparison.majorBugDelta),
          tone:
            comparison.majorBugDelta < 0
              ? 'positive'
              : comparison.majorBugDelta > 0
                ? 'warning'
                : 'neutral',
          weight: Math.abs(comparison.majorBugDelta) * 2,
          icon: AlertTriangle,
        }
      : null,
    comparison.backlogDelta !== null
      ? {
          label: 'backlog',
          value: formatSignedDelta(comparison.backlogDelta),
          tone:
            comparison.backlogDelta < 0
              ? 'positive'
              : comparison.backlogDelta > 0
                ? 'warning'
                : 'neutral',
          weight: Math.abs(comparison.backlogDelta),
          icon: comparison.backlogDelta <= 0 ? TrendingDown : TrendingUp,
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
    comparison.mergedPrDelta !== null
      ? {
          label: 'merged PRs',
          value: formatSignedDelta(comparison.mergedPrDelta),
          tone: comparison.mergedPrDelta > 0 ? 'positive' : 'neutral',
          weight: Math.abs(comparison.mergedPrDelta),
          icon: ArrowRight,
        }
      : null,
  ];

  return chips
    .filter((chip): chip is MetricChip => chip !== null && chip.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
}

function formatSignedDelta(value: number) {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;
}
