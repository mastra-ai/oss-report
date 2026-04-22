import { Badge } from '@/components/ui/badge';
import type { Urgency } from '@/types/report';

const VARIANT: Record<Urgency, 'destructive' | 'warning' | 'info'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'info',
};

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <Badge variant={VARIANT[urgency]} className="capitalize">
      {urgency}
    </Badge>
  );
}
