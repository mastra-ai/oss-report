import type { SentimentOverall } from '@/types/report';

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function sentimentVariant(
  sentiment: SentimentOverall,
): 'success' | 'destructive' | 'warning' | 'secondary' | 'info' {
  switch (sentiment) {
    case 'positive':
      return 'success';
    case 'negative':
      return 'destructive';
    case 'mixed':
      return 'warning';
    case 'neutral':
      return 'info';
    default:
      return 'secondary';
  }
}

