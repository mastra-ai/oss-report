import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRunStatus, startReportRun } from '@/lib/api';

/** Return YYYY-MM-DD in UTC. */
function toInputDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start: toInputDate(start), end: toInputDate(end) };
}

export function GenerateReport({ onComplete }: { onComplete?: () => void }) {
  const defaults = defaultRange();
  const navigate = useNavigate();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitting = runId !== null && status !== null && !isTerminal(status);

  useEffect(() => {
    if (!runId || !status || isTerminal(status)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getRunStatus(runId);
        if (cancelled) return;
        setStatus(s);
        if (s === 'success') {
          onComplete?.();
          navigate(`/reports/${runId}`);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('failed');
      }
    };
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [runId, status, navigate, onComplete]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (start > end) {
      setError('Start date must be on or before end date.');
      return;
    }
    try {
      const startIso = `${start}T00:00:00.000Z`;
      const endIso = `${end}T23:59:59.999Z`;
      const { runId: newRunId } = await startReportRun({
        start: startIso,
        end: endIso,
      });
      setRunId(newRunId);
      setStatus('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border p-4 md:p-5"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="grow">
          <h2 className="text-sm font-semibold tracking-tight">Generate report</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Defaults to the last 7 days.
          </p>
        </div>

        <DateField label="Start" value={start} onChange={setStart} max={end} />
        <DateField label="End" value={end} onChange={setEnd} min={start} />

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-9 shrink-0 items-center rounded-md bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {(status || error) && (
        <div className="mt-4 border-t pt-3 text-xs">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/30" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground" />
              </span>
              Run <span className="mono">{runId?.slice(0, 8)}</span> · {status} ·
              this usually takes a few minutes
            </span>
          )}
        </div>
      )}
    </form>
  );
}

function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(e.target.value)}
        className="mono h-9 rounded-md border bg-background px-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

function isTerminal(status: string): boolean {
  return ['success', 'failed', 'canceled', 'tripwire', 'bailed'].includes(status);
}
