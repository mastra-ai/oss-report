import { useCallback, useEffect, useState } from 'react';
import { fetchReportIndex } from '@/lib/api';
import type { ReportIndexEntry } from '@/types/report';
import { ReportListItem } from '@/components/ReportListItem';
import { GenerateReport } from '@/components/GenerateReport';

export function HomePage() {
  const [entries, setEntries] = useState<ReportIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
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

  useEffect(() => {
    return load();
  }, [load]);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Weekly activity across mastra-ai/mastra.
        </p>
      </section>

      <GenerateReport onComplete={load} />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {entries === null && !error && (
        <div className="divide-y divide-border rounded-md border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse p-5">
              <div className="h-4 w-48 bg-muted" />
              <div className="mt-3 h-3 w-64 bg-muted" />
            </div>
          ))}
        </div>
      )}

      {entries !== null && entries.length === 0 && (
        <div className="rounded-md border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No reports yet.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Generate one above — it'll appear here when it finishes.
          </p>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="divide-y divide-border rounded-md border">
          {entries.map(entry => (
            <ReportListItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
