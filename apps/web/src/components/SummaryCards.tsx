import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { Report } from '@/types/report';
import { Download, GitPullRequest, Star, TriangleAlert } from 'lucide-react';

export function SummaryCards({ report }: { report: Report }) {
  const { summary } = report;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="GitHub stars"
        value={formatNumber(summary.stars)}
        icon={<Star className="h-4 w-4 text-amber-400" />}
      />
      <MetricCard
        title="Issues opened"
        value={formatNumber(summary.issuesOpened.total)}
        sub={`${summary.issuesOpened.discord} discord · ${summary.issuesOpened.rest} rest`}
        icon={<TriangleAlert className="h-4 w-4 text-sky-400" />}
      />
      <MetricCard
        title="Issues closed"
        value={formatNumber(summary.issuesClosed.total)}
        sub={`${summary.issuesClosed.discord} discord · ${summary.issuesClosed.rest} rest`}
        icon={<GitPullRequest className="h-4 w-4 text-emerald-400" />}
      />
      <MetricCard
        title="npm downloads"
        value={formatNumber(summary.npmDownloads.total)}
        sub={summary.npmDownloads.packages
          .map(p => `${p.packageName}: ${formatNumber(p.downloads)}`)
          .join(' · ')}
        icon={<Download className="h-4 w-4 text-violet-400" />}
      />
    </div>
  );
}

function MetricCard({
  title,
  value,
  sub,
  icon,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && (
          <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        )}
      </CardContent>
    </Card>
  );
}
