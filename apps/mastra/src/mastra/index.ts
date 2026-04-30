import { Mastra } from '@mastra/core/mastra';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { CloudExporter, DefaultExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import { discordSentimentAgent } from './agents/discord-sentiment';
import { issueThreadAnalysisAgent } from './agents/issue-thread-analysis';
import { ossReportWorkflow } from './workflows/oss-report';

export const mastra = new Mastra({
  agents: {
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
    // domains: {
    //   observability: await new DuckDBStore().getStore('observability'),
    // },
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  // observability: new Observability({
  //   configs: {
  //     default: {
  //       serviceName: 'mastra',
  //       exporters: [new DefaultExporter(), new CloudExporter()],
  //       spanOutputProcessors: [new SensitiveDataFilter()],
  //     },
  //   },
  // }),
});
