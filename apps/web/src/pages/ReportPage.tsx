import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchReport } from '@/lib/api';
import type { IssueAnalysis, Report, Urgency } from '@/types/report';
import { SummaryCards } from '@/components/SummaryCards';
import { SentimentCard } from '@/components/SentimentCard';
import { IssueCard } from '@/components/IssueCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

const URGENCY_ORDER: Record<Urgency, number> = { high: 0, medium: 1, low: 2 };

type Filter = 'all' | Urgency;

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
    const items = [...report.issueAnalyses];
    items.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
    return filter === 'all' ? items : items.filter(i => i.urgency === filter);
  }, [report, filter]);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            All reports
          </Link>
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {!report && !error && (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {report && (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {formatDate(report.period.start)} → {formatDate(report.period.end)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {report.repo.owner}/{report.repo.name} · generated{' '}
              {formatDateTime(report.generatedAt)}
            </p>
          </div>

          <SummaryCards report={report} />

          <SentimentCard sentiment={report.summary.discordSentiment} />

          <Separator />

          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  Issue thread analyses
                </h2>
                <p className="text-sm text-muted-foreground">
                  {report.issueAnalyses.length} issue
                  {report.issueAnalyses.length === 1 ? '' : 's'} with linked
                  Discord threads.
                </p>
              </div>
              <div className="flex gap-1">
                {(['all', 'high', 'medium', 'low'] as const).map(f => (
                  <Button
                    key={f}
                    variant={filter === f ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter(f)}
                    className="capitalize"
                  >
                    {f}
                  </Button>
                ))}
              </div>
            </div>

            {sortedIssues.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No issues match this filter.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {sortedIssues.map(issue => (
                  <IssueCard key={issue.issueNumber} issue={issue} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
