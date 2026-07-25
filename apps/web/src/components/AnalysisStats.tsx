import type { ReportSummary } from '@/types/report';

export function AnalysisStats({ summary }: { summary: ReportSummary }) {
  const { typeCounts, bugSeverityCounts } = summary;
  const total = summary.analysisCount;
  const totalBugs =
    bugSeverityCounts.CRITICAL + bugSeverityCounts.MAJOR + bugSeverityCounts.MINOR;

  const bugPct = total ? (typeCounts.Bug / total) * 100 : 0;
  const featPct = total ? (typeCounts['Feature Request'] / total) * 100 : 0;
  const questPct = total ? (typeCounts.Question / total) * 100 : 0;

  const critPct = totalBugs ? (bugSeverityCounts.CRITICAL / totalBugs) * 100 : 0;
  const majorPct = totalBugs ? (bugSeverityCounts.MAJOR / totalBugs) * 100 : 0;
  const minorPct = totalBugs ? (bugSeverityCounts.MINOR / totalBugs) * 100 : 0;

  return (
    <section className="divide-y rounded-md border md:divide-y-0 md:divide-x md:grid md:grid-cols-2">
      {/* Composition */}
      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">New issue types</h3>
          <span className="mono text-xs text-muted-foreground">{total} classified</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Classified issues opened during this report window.
        </p>

        <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-muted">
          {bugPct > 0 && (
            <div className="bg-foreground" style={{ width: `${bugPct}%` }} />
          )}
          {featPct > 0 && (
            <div className="bg-foreground/60" style={{ width: `${featPct}%` }} />
          )}
          {questPct > 0 && (
            <div className="bg-foreground/25" style={{ width: `${questPct}%` }} />
          )}
        </div>

        <div className="mt-4 space-y-2">
          <LegendRow
            dotClass="bg-foreground"
            label="Bugs"
            value={typeCounts.Bug}
            pct={bugPct}
          />
          <LegendRow
            dotClass="bg-foreground/60"
            label="Feature Requests"
            value={typeCounts['Feature Request']}
            pct={featPct}
          />
          <LegendRow
            dotClass="bg-foreground/25"
            label="Questions"
            value={typeCounts.Question}
            pct={questPct}
          />
        </div>

      </div>

      {/* Severity */}
      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">New bug severity</h3>
          <span className="mono text-xs text-muted-foreground">{totalBugs} classified bugs</span>
        </div>

        {totalBugs === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No new bugs classified.</p>
        ) : (
          <>
            <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-muted">
              {critPct > 0 && (
                <div className="bg-destructive" style={{ width: `${critPct}%` }} />
              )}
              {majorPct > 0 && (
                <div className="bg-amber-500" style={{ width: `${majorPct}%` }} />
              )}
              {minorPct > 0 && (
                <div className="bg-muted-foreground/40" style={{ width: `${minorPct}%` }} />
              )}
            </div>

            <div className="mt-4 space-y-2">
              <LegendRow
                dotClass="bg-destructive"
                label="Critical"
                value={bugSeverityCounts.CRITICAL}
                pct={critPct}
              />
              <LegendRow
                dotClass="bg-amber-500"
                label="Major"
                value={bugSeverityCounts.MAJOR}
                pct={majorPct}
              />
              <LegendRow
                dotClass="bg-muted-foreground/40"
                label="Minor"
                value={bugSeverityCounts.MINOR}
                pct={minorPct}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function LegendRow({
  dotClass,
  label,
  value,
  pct,
}: {
  dotClass: string;
  label: string;
  value: number;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`block h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      <span className="grow">{label}</span>
      <span className="mono text-xs tabular-nums text-muted-foreground">
        <span className="text-foreground font-semibold">{value}</span>
        <span className="ml-1.5 inline-block w-8 text-right">{pct.toFixed(0)}%</span>
      </span>
    </div>
  );
}
