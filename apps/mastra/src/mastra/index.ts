import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { MastraCompositeStore } from '@mastra/core/storage';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { briefingAgent } from './agents/briefing';
import { discordSentimentAgent } from './agents/discord-sentiment';
import { issueThreadAnalysisAgent } from './agents/issue-thread-analysis';
import {
  applyIssueEdits,
  buildActions,
  buildTakeaways,
  computeComparison,
  computeIssueRollups,
  loadPreviousReport,
  ossReportWorkflow,
} from './workflows/oss-report';

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
  },
  workflows: {
    ossReportWorkflow,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: 'file:./mastra.db',
    }),
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    port: 4115,
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

          const workflow = m.getWorkflow('ossReportWorkflow');
          const stored = await workflow.getWorkflowRunById(runId);
          if (!stored) {
            return c.json({ error: 'run not found' }, 404);
          }
          if (stored.status !== 'success' || !stored.result) {
            return c.json({ error: 'run is not in success state' }, 409);
          }

          const original = stored.result as Record<string, unknown> & {
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
