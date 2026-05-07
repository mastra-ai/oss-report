import { AlertTriangle, ArrowRight, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import type {
  Briefing,
  BriefingMovement,
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

const movementCopy: Record<BriefingMovement, { label: string; tone: string }> = {
  improved: { label: 'Improved', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  regressed: { label: 'Regressed', tone: 'text-red-700 bg-red-50 border-red-200' },
  steady: { label: 'Steady', tone: 'text-muted-foreground bg-muted border-border' },
  mixed: { label: 'Mixed', tone: 'text-amber-700 bg-amber-50 border-amber-200' },
};

const severityTone: Record<BriefingSeverity, string> = {
  critical: 'text-red-700 bg-red-50 border-red-200',
  major: 'text-amber-700 bg-amber-50 border-amber-200',
  minor: 'text-muted-foreground bg-muted border-border',
};

export function WeeklyBriefing({ briefing, comparison, presentMode = false }: Props) {
  const movement = movementCopy[briefing.movement];
  const hasRecurring = briefing.recurring.length > 0;
  const showTalkingPoints = presentMode && briefing.talkingPoints.length > 0;
  const metricChips = buildMetricChips(comparison);

  return (
    <section className="rounded-md border bg-card">
      <header className="border-b px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Weekly briefing
            </div>
            <h2 className="mt-1 text-xl font-semibold leading-snug tracking-tight">
              {briefing.headline}
            </h2>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${movement.tone}`}
          >
            {movement.label}
          </span>
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
        <div className="border-b px-5 py-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recurring
          </h3>
          <ul className="mt-2 space-y-2 text-sm">
            {briefing.recurring.map((item, i) => (
              <li key={i} className="leading-snug">
                <span>{item.text}</span>
                {item.note && (
                  <span className="ml-1.5 text-xs text-muted-foreground">— {item.note}</span>
                )}
              </li>
            ))}
          </ul>
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
