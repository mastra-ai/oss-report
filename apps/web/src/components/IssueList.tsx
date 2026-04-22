import { useMemo, useState } from 'react';
import { IssueCard } from './IssueCard';
import type { IssueAnalysis } from '@/types/report';
import { Button } from '@/components/ui/button';

type Filter = 'all' | 'high' | 'medium' | 'low';

export function IssueList({ issues }: { issues: IssueAnalysis[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const base = filter === 'all' ? issues : issues.filter(i => i.urgency === filter);
    const urgencyOrder = { high: 0, medium: 1, low: 2 } as const;
    return [...base].sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
  }, [issues, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">
          Issue thread analyses <span className="text-muted-foreground">({issues.length})</span>
        </h2>
        <div className="flex gap-1">
          {(['all', 'high', 'medium', 'low'] as Filter[]).map(f => (
            <Button
              key={f}
              variant={filter === f ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No issues match this filter.</p>
      ) : (
        <div className="grid gap-4">
          {filtered.map(issue => (
            <IssueCard key={issue.issueNumber} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}
