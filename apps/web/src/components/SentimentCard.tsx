import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SentimentBadge } from '@/components/SentimentBadge';
import type { DiscordSentiment } from '@/types/report';
import { Hash, MessageSquare } from 'lucide-react';

export function SentimentCard({ sentiment }: { sentiment: DiscordSentiment }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Discord sentiment
            </CardTitle>
            <CardDescription className="mt-1 flex items-center gap-3 text-xs">
              {sentiment.channelName && (
                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  {sentiment.channelName}
                </span>
              )}
              <span>{sentiment.messageCount} messages analyzed</span>
            </CardDescription>
          </div>
          <SentimentBadge sentiment={sentiment.overall} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">{sentiment.summary}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <SignalList
            title="Positive signals"
            items={sentiment.positiveSignals}
            tone="positive"
          />
          <SignalList
            title="Pain points"
            items={sentiment.painPoints}
            tone="negative"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SignalList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'positive' | 'negative';
}) {
  const dot = tone === 'positive' ? 'bg-emerald-400' : 'bg-rose-400';
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">None reported.</div>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
