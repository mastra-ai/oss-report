import type { ResolutionCounts } from '@/types/report';

export function ResolutionStats({
  resolutionCounts,
  closedInWindowCount,
}: {
  resolutionCounts: ResolutionCounts;
  closedInWindowCount: number;
}) {
  const total = closedInWindowCount;
  const { fixed, wontfix, duplicate, stale, unknown } = resolutionCounts;

  const rows: Array<{ key: keyof ResolutionCounts; label: string; dotClass: string; value: number }> = [
    { key: 'fixed', label: 'Fixed', dotClass: 'bg-emerald-500', value: fixed },
    { key: 'wontfix', label: "Won't fix", dotClass: 'bg-muted-foreground/60', value: wontfix },
    { key: 'duplicate', label: 'Duplicate', dotClass: 'bg-foreground/40', value: duplicate },
    { key: 'stale', label: 'Stale', dotClass: 'bg-muted-foreground/30', value: stale },
    { key: 'unknown', label: 'Unknown', dotClass: 'bg-muted-foreground/20', value: unknown },
  ];

  return (
    <section className="rounded-md border p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Resolution</h3>
        <span className="mono text-xs text-muted-foreground">
          <span className="text-foreground font-semibold">{total}</span> closed in window
        </span>
      </div>

      {total === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No issues closed in this window.</p>
      ) : (
        <>
          <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {rows.map(row => {
              const pct = total ? (row.value / total) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={row.key}
                  className={row.dotClass}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>

          <div className="mt-4 space-y-2">
            {rows.map(row => {
              const pct = total ? (row.value / total) * 100 : 0;
              return (
                <div key={row.key} className="flex items-center gap-3 text-sm">
                  <span className={`block h-2 w-2 shrink-0 rounded-full ${row.dotClass}`} />
                  <span className="grow">{row.label}</span>
                  <span className="mono text-xs tabular-nums text-muted-foreground">
                    <span className="text-foreground font-semibold">{row.value}</span>
                    <span className="ml-1.5 inline-block w-8 text-right">{pct.toFixed(0)}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
