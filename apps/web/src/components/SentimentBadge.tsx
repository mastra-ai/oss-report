import { Badge } from '@/components/ui/badge';
import type { SentimentOverall } from '@/types/report';

const VARIANT: Record<SentimentOverall, 'success' | 'info' | 'destructive' | 'warning' | 'secondary'> = {
  positive: 'success',
  neutral: 'info',
  negative: 'destructive',
  mixed: 'warning',
  unknown: 'secondary',
};

export function SentimentBadge({ sentiment }: { sentiment: SentimentOverall }) {
  return (
    <Badge variant={VARIANT[sentiment]} className="capitalize">
      {sentiment}
    </Badge>
  );
}
