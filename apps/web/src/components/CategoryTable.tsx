import type { CategoryBreakdown } from '@/types/report';

export function CategoryTable({ categories }: { categories: CategoryBreakdown[] }) {
  if (categories.length === 0) return null;

  const maxTotal = Math.max(...categories.map(c => c.total));

  return (
    <section className="rounded-md border">
      <div className="flex items-baseline justify-between border-b px-5 py-3">
        <h3 className="text-sm font-semibold">New issue categories</h3>
        <span className="mono text-xs text-muted-foreground">
          {categories.length} total
        </span>
      </div>

      <div className="grid grid-cols-[1fr_120px_auto_auto_auto] items-center gap-x-5 border-b px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Category</span>
        <span />
        <span className="w-6 text-right">Bugs</span>
        <span className="w-6 text-right">Feats</span>
        <span className="w-6 text-right">Qs</span>
      </div>

      <div className="divide-y">
        {categories.map(row => {
          const widthPct = maxTotal ? (row.total / maxTotal) * 100 : 0;
          const bugPct = row.total ? (row.Bug / row.total) * 100 : 0;
          const featPct = row.total ? (row['Feature Request'] / row.total) * 100 : 0;
          const questPct = row.total ? (row.Question / row.total) * 100 : 0;

          return (
            <div
              key={row.category}
              className="grid grid-cols-[1fr_120px_auto_auto_auto] items-center gap-x-5 px-5 py-2.5 text-sm"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-medium capitalize">{row.category}</span>
                <span className="mono text-xs text-muted-foreground tabular-nums">
                  {row.total}
                </span>
              </div>

              <div
                className="flex h-1.5 overflow-hidden rounded-full bg-muted"
                style={{ width: `${widthPct}%` }}
                aria-hidden
              >
                {bugPct > 0 && (
                  <div className="bg-destructive" style={{ width: `${bugPct}%` }} />
                )}
                {featPct > 0 && (
                  <div
                    className="bg-blue-500 dark:bg-blue-400"
                    style={{ width: `${featPct}%` }}
                  />
                )}
                {questPct > 0 && (
                  <div
                    className="bg-muted-foreground/40"
                    style={{ width: `${questPct}%` }}
                  />
                )}
              </div>

              <Cell value={row.Bug} />
              <Cell value={row['Feature Request']} />
              <Cell value={row.Question} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Cell({ value }: { value: number }) {
  return (
    <span
      className={`mono w-6 text-right text-sm tabular-nums ${
        value === 0 ? 'text-muted-foreground/40' : 'text-foreground font-medium'
      }`}
    >
      {value}
    </span>
  );
}
