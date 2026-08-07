import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mastra } from '@mastra/core/mastra';
import { PostgresStore } from '@mastra/pg';
import { registerApiRoute } from '@mastra/core/server';
import { MastraCompositeStore } from '@mastra/core/storage';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { briefingAgent } from './agents/briefing';
import { discordSentimentAgent } from './agents/discord-sentiment';
import { issueThreadAnalysisAgent } from './agents/issue-thread-analysis';
import { slackReportAgent } from './agents/slack-report';
import {
  applyIssueEdits,
  buildActions,
  buildTakeaways,
  computeComparison,
  computeIssueRollups,
  loadPreviousReport,
  ossReportWorkflow,
  slackDigestWorkflow,
  unwrapRunResult,
} from './workflows/oss-report';

// Candidate directories that may contain the built web app:
// - dev: cwd is src/mastra/public, which holds app/
// - prod (mastra start / Mastra Cloud): the bundle sits in .mastra/output next
//   to the copied app/ dir, so resolve relative to the bundle itself too.
const APP_ROOTS = [
  join(process.cwd(), 'app'),
  join(dirname(fileURLToPath(import.meta.url)), 'app'),
];

const APP_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

type IssueEdit = {
  issueNumber: number;
  severity?: 'MINOR' | 'MAJOR' | 'CRITICAL';
  type?: 'Bug' | 'Feature Request' | 'Question';
  summary?: string;
};

export const mastra = new Mastra({
  agents: {
    briefingAgent,
    discordSentimentAgent,
    issueThreadAnalysisAgent,
    slackReportAgent,
  },
  workflows: {
    // The evented engine (required by the schedule) resolves workflows by
    // their `id`, so registration keys must match each workflow's `id`.
    'oss-report-workflow': ossReportWorkflow,
    'slack-digest-workflow': slackDigestWorkflow,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: process.env.DATABASE_URL ?
      new PostgresStore({
        id: 'mastra-storage',
        connectionString: process.env.DATABASE_URL!,
      })
      : new LibSQLStore({
        id: 'mastra-storage',
        url: process.env.LOCAL_DATABASE_URL!
      }),
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    port: 4115,
    middleware: [
      // Serve the built web app (apps/web) at /app. The Vite build outputs to
      // src/mastra/public/app, which is the server cwd in dev and gets copied
      // into .mastra/output for production builds.
      async (c, next) => {
        const reqPath = c.req.path;
        if (reqPath !== '/app' && !reqPath.startsWith('/app/')) return next();

        // Relative asset paths in index.html resolve against the directory of
        // the page URL, so /app must be normalized to /app/.
        if (reqPath === '/app') return c.redirect('/app/');

        const rel = reqPath === '/app/' ? 'index.html' : reqPath.slice('/app/'.length);
        for (const root of APP_ROOTS) {
          const filePath = normalize(join(root, rel));
          if (!filePath.startsWith(root)) continue;
          try {
            const data = await readFile(filePath);
            const contentType = APP_MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
            return new Response(new Uint8Array(data), {
              headers: { 'Content-Type': contentType },
            });
          } catch {
            // try the next candidate root
          }
        }
        return next();
      },
    ],
    apiRoutes: [
      registerApiRoute('/runs/:runId/rebrief', {
        method: 'POST',
        handler: async c => {
          const m = c.get('mastra');
          const logger = m.getLogger();
          const runId = c.req.param('runId');

          let body: { edits?: IssueEdit[] } = {};
          try {
            body = await c.req.json();
          } catch {
            return c.json({ error: 'Invalid JSON body' }, 400);
          }

          const edits = Array.isArray(body.edits) ? body.edits : [];
          if (edits.length === 0) {
            return c.json({ error: 'edits must be a non-empty array' }, 400);
          }
          for (const e of edits) {
            if (typeof e?.issueNumber !== 'number') {
              return c.json({ error: 'each edit needs a numeric issueNumber' }, 400);
            }
          }

          const workflow = m.getWorkflow('oss-report-workflow');
          const stored = await workflow.getWorkflowRunById(runId);
          if (!stored) {
            return c.json({ error: 'run not found' }, 404);
          }
          if (stored.status !== 'success' || !stored.result) {
            return c.json({ error: 'run is not in success state' }, 409);
          }

          const original = unwrapRunResult(stored.result) as Record<string, unknown> & {
            issueAnalyses?: unknown;
            summary?: unknown;
            period?: { start: string; end: string };
            signalEmbeddings?: Record<string, number[]>;
          };
          if (!Array.isArray(original.issueAnalyses) || !original.summary || !original.period) {
            return c.json({ error: 'run snapshot missing report data' }, 500);
          }

          const { analyses: editedAnalyses, applied } = applyIssueEdits(
            original.issueAnalyses as Parameters<typeof applyIssueEdits>[0],
            edits,
          );
          if (applied.length === 0) {
            return c.json({ error: 'no edits changed any issue' }, 400);
          }

          const rollups = computeIssueRollups(editedAnalyses);
          const editedSummary = {
            ...(original.summary as Record<string, unknown>),
            ...rollups,
          } as Parameters<typeof computeComparison>[0];

          const previousReport = await loadPreviousReport(
            m,
            { start: new Date(original.period.start), end: new Date(original.period.end) },
            logger,
          );

          const editedComparison = computeComparison(editedSummary, previousReport);
          const editedTakeaways = buildTakeaways({
            summary: editedSummary,
            comparison: editedComparison,
          });
          const editedActions = buildActions({
            issueAnalyses: editedAnalyses,
            summary: editedSummary,
            comparison: editedComparison,
          });

          const editedReport = {
            generatedAt: new Date().toISOString(),
            repo: original.repo,
            period: original.period,
            comparison: editedComparison,
            takeaways: editedTakeaways,
            actions: editedActions,
            summary: editedSummary,
            issueAnalyses: editedAnalyses,
            signalEmbeddings: original.signalEmbeddings ?? {},
            correctionsApplied: applied,
          };

          try {
            const run = await workflow.createRun({ runId });
            const result = await run.timeTravel({
              step: 'generate-briefing',
              inputData: editedReport,
            });
            return c.json({
              runId,
              status: result.status,
              correctionsApplied: applied,
            });
          } catch (error) {
            logger.error('Rebrief time travel failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            return c.json(
              {
                error: 'rebrief failed',
                details: error instanceof Error ? error.message : String(error),
              },
              500,
            );
          }
        },
      }),
    ],
  },
});
