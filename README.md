# OSS Report

Monorepo for generating and browsing weekly OSS health reports for `mastra-ai/mastra`.

## Structure

```
apps/
├── mastra/   Mastra app: agents + workflow that produce the report
└── web/      Vite + React + Tailwind + shadcn UI for browsing reports
```

## Requirements

- Node `>=22.13.0`
- pnpm `10.x`

## Setup

```bash
pnpm install
cp apps/mastra/.env.example apps/mastra/.env
cp apps/web/.env.example apps/web/.env  # optional, only if Mastra isn't on :4111
```

Fill in `apps/mastra/.env`:

- `OPENAI_API_KEY`
- `GITHUB_PERSONAL_ACCESS_TOKEN`
- `DISCORD_BOT_TOKEN`
- `DISCORD_GENERAL_CHANNEL_ID`

## Develop

Run both apps at once:

```bash
pnpm dev
```

- Mastra Studio: http://localhost:4111
- Web app: http://localhost:5173

Or individually:

```bash
pnpm dev:mastra
pnpm dev:web
```

## How reports are stored

Each run of `ossReportWorkflow` is persisted by Mastra in `apps/mastra/mastra.db` (LibSQL). The web app doesn't read any files — it uses [`@mastra/client-js`](https://mastra.ai/docs/server/mastra-client) to query workflow runs directly from the Mastra server.

This means **the Mastra server must be running** for the web app to list or load reports.

The base URL is controlled by `VITE_MASTRA_API_URL` (defaults to `http://localhost:4111`).

## Generate a report

1. Open Mastra Studio.
2. Run `ossReportWorkflow` with input like:
   ```json
   { "start": "2026-04-20T00:00:00.000Z", "end": "2026-04-22T23:59:59.999Z" }
   ```
3. All fields are optional:
   - `start` / `end` — ISO timestamps (defaults to the last 30 days)
   - `maxIssueAnalyses`, `maxGeneralMessages`, `maxThreadMessages`

Every successful run immediately shows up on the web app's home page.

## Browse reports

Open http://localhost:5173:

- `/` — list of every successful run (newest first)
- `/reports/:runId` — full report detail

## Build

```bash
pnpm build          # both apps
pnpm build:mastra
pnpm build:web
```

## Roadmap

- Trigger the workflow from the web app.
- Schedule weekly runs (GitHub Actions cron or Mastra scheduled workflow).
