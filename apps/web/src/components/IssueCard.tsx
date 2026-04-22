import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UrgencyBadge } from '@/components/UrgencyBadge';
import type { IssueAnalysis } from '@/types/report';
import { ExternalLink, MessagesSquare } from 'lucide-react';

export function IssueCard({ issue }: { issue: IssueAnalysis }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="text-muted-foreground">#{issue.issueNumber}</span>
              <span className="truncate">{issue.issueTitle}</span>
            </CardTitle>
            <CardDescription className="mt-2 flex flex-wrap items-center gap-2">
              <a
                href={issue.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                GitHub <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={issue.threadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Discord thread <ExternalLink className="h-3 w-3" />
              </a>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MessagesSquare className="h-3 w-3" />
                {issue.threadMessageCount} msgs
              </span>
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UrgencyBadge urgency={issue.urgency} />
            <Badge variant="outline" className="capitalize">
              {issue.state}
            </Badge>
          </div>
        </div>
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {issue.labels.map(label => (
              <Badge key={label} variant="secondary" className="text-[10px]">
                {label}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status
          </div>
          <div className="mt-1 text-sm">{issue.status}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Summary
          </div>
          <p className="mt-1 text-sm leading-relaxed">{issue.summary}</p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recommended action
          </div>
          <p className="mt-1 text-sm leading-relaxed">{issue.recommendedAction}</p>
        </div>
        {issue.blockers.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Blockers
            </div>
            <ul className="mt-1 space-y-1 text-sm">
              {issue.blockers.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
