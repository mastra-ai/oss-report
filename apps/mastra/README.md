# @oss-report/mastra

Mastra app with the `ossReportWorkflow`, agents, and shared helpers.

## Output

Each run of `ossReportWorkflow` is persisted as a workflow run in `mastra.db`. The run's `result` matches `reportSchema` (see `src/mastra/workflows/oss-report.ts`) and is what the web app reads via `@mastra/client-js`.

## Scripts

```bash
pnpm dev        # mastra dev
pnpm build      # mastra build
pnpm typecheck  # tsc --noEmit
```
