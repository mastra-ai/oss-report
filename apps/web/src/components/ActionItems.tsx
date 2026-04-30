import type { Report, ReportActions } from '@/types/report';

export function ActionItems({ actions, issues }: { actions: ReportActions; issues: Report['issueAnalyses'] }) {
  const priorityIssues = actions.priorityIssues
    .map(issueNumber => issues.find(issue => issue.issueNumber === issueNumber))
    .filter(issue => issue !== undefined);

  const hasContent =
    priorityIssues.length > 0 ||
    actions.recommendedActions.length > 0 ||
    actions.recurringPainAreas.length > 0 ||
    actions.needsDocsAttention.length > 0;

  if (!hasContent) return null;

  return (
    <section className="rounded-md border bg-card">
      <div className="border-b px-5 py-3">
        <h2 className="text-lg font-semibold tracking-tight">Action items</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Small, opinionated next steps for the next maintainer triage pass.
        </p>
      </div>

      <div className="grid gap-px bg-border xl:grid-cols-4">
        <ActionColumn title="Recommended" items={actions.recommendedActions} />
        <ActionColumn title="Recurring pain" items={actions.recurringPainAreas} />
        <ActionColumn title="Docs attention" items={actions.needsDocsAttention} />
        <div className="bg-background p-5">
          <div className="text-sm font-semibold">Priority issues</div>
          {priorityIssues.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No priority issues were singled out.</p>
          ) : (
            <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
              {priorityIssues.map(issue => (
                <li key={issue.issueNumber}>
                  <a
                    href={issue.issueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-start gap-2 hover:text-foreground"
                  >
                    <span className="mono text-xs text-foreground">#{issue.issueNumber}</span>
                    <span className="leading-relaxed">{issue.issueTitle}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ActionColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-background p-5">
      <div className="text-sm font-semibold">{title}</div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing explicit surfaced here.</p>
      ) : (
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
          {items.map(item => (
            <li key={item} className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/70" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
