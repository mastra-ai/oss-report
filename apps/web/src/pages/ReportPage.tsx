import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchReport } from '@/lib/api';
import type { IssueAnalysis, IssueType, Report } from '@/types/report';
import { SummaryCards } from '@/components/SummaryCards';
import { SentimentCard } from '@/components/SentimentCard';
import { AnalysisStats } from '@/components/AnalysisStats';
import { CategoryTable } from '@/components/CategoryTable';
import { IssueCard } from '@/components/IssueCard';
import { ResolutionStats } from '@/components/ResolutionStats';
import { formatDateTime, formatDateUTC } from '@/lib/utils';

type Filter = 'all' | IssueType | 'closed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'Bug', label: 'Bugs' },
  { key: 'Feature Request', label: 'Features' },
  { key: 'Question', label: 'Questions' },
  { key: 'closed', label: 'Closed' },
];

export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setReport(null);
    setError(null);
    fetchReport(id)
      .then(data => {
        if (!cancelled) setReport(data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const sortedIssues = useMemo<IssueAnalysis[]>(() => {
    if (!report) return [];
    const severityRank = { CRITICAL: 3, MAJOR: 2, MINOR: 1 } as const;
    const items = [...report.issueAnalyses].sort((a, b) => {
      if (a.type === 'Bug' && b.type !== 'Bug') return -1;
      if (a.type !== 'Bug' && b.type === 'Bug') return 1;
      return severityRank[b.severity] - severityRank[a.severity];
    });
    if (filter === 'all') return items;
    if (filter === 'closed') {
      return items.filter(
        i => i.lifecycle === 'closed' || i.lifecycle === 'opened-and-closed',
      );
    }
    return items.filter(i => i.type === filter);
  }, [report, filter]);

  return (
    <div className="space-y-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ← All reports
      </Link>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!report && !error && (
        <div className="space-y-6">
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-28 animate-pulse rounded bg-muted" />
          <div className="h-56 animate-pulse rounded bg-muted" />
        </div>
      )}

      {report && (
        <>
          <section>
            <div className="text-xs font-medium text-muted-foreground">
              {report.repo.owner}/{report.repo.name} · generated{' '}
              {formatDateTime(report.generatedAt)}
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {formatDateUTC(report.period.start)}
              <span className="mx-2 text-muted-foreground">→</span>
              {formatDateUTC(report.period.end)}
            </h1>
          </section>

          <SummaryCards report={report} />

          <div className="grid gap-6 lg:grid-cols-2">
            <AnalysisStats summary={report.summary} />
            <CategoryTable categories={report.summary.categoryBreakdown} />
          </div>

          <ResolutionStats
            resolutionCounts={report.summary.resolutionCounts}
            closedInWindowCount={report.summary.closedInWindowCount}
          />

          <SentimentCard sentiment={report.summary.discordSentiment} />

          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Issues</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {report.issueAnalyses.length} analyzed
                </p>
              </div>
              <div
                role="tablist"
                className="inline-flex rounded-md border p-0.5"
              >
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      filter === f.key
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {sortedIssues.length === 0 ? (
              <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
                Nothing matches this filter.
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {sortedIssues.map(issue => (
                  <IssueCard key={issue.issueNumber} issue={issue} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
