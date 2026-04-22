import { useEffect, useState } from 'react';
import { fetchReportIndex } from '@/lib/api';
import type { ReportIndexEntry } from '@/types/report';
import { ReportListItem } from '@/components/ReportListItem';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { FileX } from 'lucide-react';

export function HomePage() {
  const [entries, setEntries] = useState<ReportIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReportIndex()
      .then(data => {
        if (!cancelled) setEntries(data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Weekly OSS health reports for mastra-ai/mastra.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {entries === null && !error && (
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {entries !== null && entries.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <FileX className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">No successful runs yet</div>
            <div className="max-w-md text-xs text-muted-foreground">
              Run the <code className="rounded bg-muted px-1 py-0.5">ossReportWorkflow</code> in
              Mastra Studio to generate your first report.
            </div>
          </CardContent>
        </Card>
      )}

      {entries && entries.length > 0 && (
        <div className="grid gap-4">
          {entries.map(entry => (
            <ReportListItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
