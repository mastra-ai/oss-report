import { Link } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SentimentBadge } from '@/components/SentimentBadge';
import { formatDate, formatNumber, formatRelative } from '@/lib/utils';
import type { ReportIndexEntry } from '@/types/report';
import { ArrowRight, GitPullRequest, Star, TriangleAlert } from 'lucide-react';

export function ReportListItem({ entry }: { entry: ReportIndexEntry }) {
  return (
    <Link to={`/reports/${entry.id}`} className="group block">
      <Card className="transition-colors hover:border-primary/60 hover:bg-muted/30">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {formatDate(entry.period.start)} → {formatDate(entry.period.end)}
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                Generated {formatRelative(entry.generatedAt)} ·{' '}
                {entry.repo.owner}/{entry.repo.name}
              </CardDescription>
            </div>
            <SentimentBadge sentiment={entry.summary.discordSentiment} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Metric
              icon={<Star className="h-3.5 w-3.5 text-amber-400" />}
              label="Stars"
              value={formatNumber(entry.summary.stars)}
            />
            <Metric
              icon={<TriangleAlert className="h-3.5 w-3.5 text-sky-400" />}
              label="Opened"
              value={formatNumber(entry.summary.issuesOpened.total)}
              sub={`${entry.summary.issuesOpened.discord} discord`}
            />
            <Metric
              icon={<GitPullRequest className="h-3.5 w-3.5 text-emerald-400" />}
              label="Closed"
              value={formatNumber(entry.summary.issuesClosed.total)}
              sub={`${entry.summary.issuesClosed.discord} discord`}
            />
            <Metric
              label="Analyses"
              value={formatNumber(entry.summary.issueAnalysisCount)}
              sub={`${formatNumber(entry.summary.npmDownloadsTotal)} npm`}
            />
          </div>
          <div className="mt-4 flex items-center justify-end text-xs text-muted-foreground transition-colors group-hover:text-foreground">
            View report <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
