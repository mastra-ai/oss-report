import { SentimentBadge } from '@/components/SentimentBadge';
import type {
  Aspect,
  AspectBreakdown,
  AspectSentiment,
  DiscordSentiment,
  PainPoint,
  PainSeverity,
  SentimentSignal,
} from '@/types/report';

const ASPECT_LABEL: Record<Aspect, string> = {
  agents: 'Agents',
  workflows: 'Workflows',
  memory: 'Memory',
  rag: 'RAG',
  tools: 'Tools',
  observability: 'Observability',
  deployer: 'Deployer',
  studio: 'Studio',
  docs: 'Docs',
  models: 'Models',
  auth: 'Auth',
  cli: 'CLI',
  voice: 'Voice',
  community: 'Community',
  other: 'Other',
};

export function SentimentCard({ sentiment }: { sentiment: DiscordSentiment }) {
  return (
    <section className="rounded-md border">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">Discord sentiment</h3>
            {sentiment.channelName && (
              <span className="mono text-xs text-muted-foreground">
                #{sentiment.channelName}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            <span className="mono tabular-nums text-foreground">
              {sentiment.messageCount}
            </span>{' '}
            messages ·{' '}
            <span className="mono tabular-nums text-foreground">
              {sentiment.uniqueAuthorCount}
            </span>{' '}
            authors
          </div>
        </div>
        <SentimentBadge sentiment={sentiment.overall} size="lg" />
      </header>

      <div className="border-b px-5 py-4">
        <p className="text-sm leading-relaxed">{sentiment.summary}</p>
        {sentiment.weekOverWeek && (
          <div className="mt-3 flex gap-2 border-l-2 border-border pl-3">
            <span className="mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Δ vs last
            </span>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {sentiment.weekOverWeek}
            </p>
          </div>
        )}
      </div>

      {sentiment.aspects.length === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground">
          No aspects surfaced in this window.
        </div>
      ) : (
        <div className="divide-y">
          {sentiment.aspects.map(aspect => (
            <AspectRow key={aspect.aspect} aspect={aspect} />
          ))}
        </div>
      )}
    </section>
  );
}

const ASPECT_SENTIMENT_TONE: Record<AspectSentiment, string> = {
  positive: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  negative: 'border-destructive/30 bg-destructive/5 text-destructive',
  mixed: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
};

function AspectRow({ aspect }: { aspect: AspectBreakdown }) {
  const blockerCount = aspect.painPoints.filter(p => p.severity === 'blocker').length;

  return (
    <section className="px-5 py-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h4 className="text-sm font-semibold">{ASPECT_LABEL[aspect.aspect]}</h4>
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium capitalize ${ASPECT_SENTIMENT_TONE[aspect.sentiment]}`}
          >
            {aspect.sentiment}
          </span>
        </div>
        <div className="mono text-[11px] text-muted-foreground tabular-nums">
          {aspect.positives.length}+ · {aspect.painPoints.length}−
          {blockerCount > 0 && (
            <span className="ml-1.5 text-destructive">
              {blockerCount} blocker{blockerCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </header>

      <div
        className={`grid gap-4 ${
          aspect.positives.length > 0 && aspect.painPoints.length > 0
            ? 'md:grid-cols-2'
            : 'md:grid-cols-1'
        }`}
      >
        {aspect.positives.length > 0 && (
          <SignalColumn
            label="Positive"
            emptyLabel="Nothing positive surfaced"
            items={aspect.positives}
            tone="positive"
          />
        )}
        {aspect.painPoints.length > 0 && <PainColumn items={aspect.painPoints} />}
      </div>
    </section>
  );
}

function SignalColumn({
  label,
  emptyLabel,
  items,
  tone,
}: {
  label: string;
  emptyLabel: string;
  items: SentimentSignal[];
  tone: 'positive';
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{emptyLabel}</div>
      ) : (
        <ul className="space-y-3">
          {items.map((item, i) => (
            <SignalItem key={i} item={item} tone={tone} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SignalItem({
  item,
  tone,
}: {
  item: SentimentSignal;
  tone: 'positive';
}) {
  return (
    <li className="flex gap-2.5">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === 'positive' ? 'bg-emerald-500' : 'bg-muted-foreground'
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{item.headline}</div>
        {item.detail && (
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {item.detail}
          </div>
        )}
        <SignalCitations item={item} />
      </div>
    </li>
  );
}

const SEVERITY_DOT: Record<PainSeverity, string> = {
  blocker: 'bg-destructive',
  friction: 'bg-amber-500',
  nit: 'bg-muted-foreground/40',
};

const SEVERITY_LABEL: Record<PainSeverity, string> = {
  blocker: 'Blocker',
  friction: 'Friction',
  nit: 'Nit',
};

const SEVERITY_BADGE: Record<PainSeverity, string> = {
  blocker: 'border-destructive/30 bg-destructive/5 text-destructive',
  friction: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  nit: 'border-border bg-muted text-muted-foreground',
};

const SEVERITY_ORDER: Record<PainSeverity, number> = {
  blocker: 0,
  friction: 1,
  nit: 2,
};

function PainColumn({ items }: { items: PainPoint[] }) {
  const sorted = [...items].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Pain points
      </div>
      {sorted.length === 0 ? (
        <div className="text-xs text-muted-foreground">Nothing negative surfaced</div>
      ) : (
        <ul className="space-y-3">
          {sorted.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[item.severity]}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium leading-snug">
                    {item.headline}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${SEVERITY_BADGE[item.severity]}`}
                  >
                    {SEVERITY_LABEL[item.severity]}
                  </span>
                </div>
                {item.detail && (
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {item.detail}
                  </div>
                )}
                <SignalCitations item={item} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SignalCitations({ item }: { item: SentimentSignal }) {
  if (!item.messageUrls || item.messageUrls.length === 0) return null;
  const [primary] = item.messageUrls;
  const count = item.messageUrls.length;
  return (
    <div className="mt-1.5">
      <a
        href={primary}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        title={`Open in Discord · ${count} message${count === 1 ? '' : 's'}`}
      >
        <DiscordGlyph />
        <span className="mono tabular-nums">
          {count} msg{count === 1 ? '' : 's'}
        </span>
      </a>
    </div>
  );
}

function DiscordGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20 4.5C18.5 3.7 16.9 3.2 15.3 3c-.2.4-.5.9-.7 1.3-1.7-.3-3.5-.3-5.2 0-.2-.4-.5-.9-.7-1.3C7.1 3.2 5.5 3.7 4 4.5 1.4 8.3.7 12 1 15.6c1.9 1.4 3.7 2.3 5.5 2.9.4-.6.8-1.2 1.1-1.9-.6-.2-1.2-.5-1.8-.9.2-.1.3-.2.5-.3 3.4 1.6 7 1.6 10.4 0 .2.1.3.2.5.3-.6.4-1.2.7-1.8.9.3.7.7 1.3 1.1 1.9 1.8-.6 3.6-1.5 5.5-2.9.4-4.2-.6-7.9-2.5-11.1zM8.5 13.8c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1c1 0 1.9.9 1.9 2.1s-.8 2.1-1.9 2.1zm7 0c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1c1 0 1.9.9 1.9 2.1s-.8 2.1-1.9 2.1z" />
    </svg>
  );
}
