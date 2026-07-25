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

- `OPENROUTER_API_KEY` — used for all agents and signal embeddings
- `GITHUB_PERSONAL_ACCESS_TOKEN`
- `DISCORD_BOT_TOKEN`
- `DISCORD_GENERAL_CHANNEL_ID`
- `OSS_REPORT_REPO_OWNER` / `OSS_REPORT_REPO_NAME` — repo to report on (defaults to `mastra-ai/mastra`)

Optional tuning:

- `OSS_REPORT_MAX_GENERAL_MESSAGES` (default 200)
- `OSS_REPORT_MAX_THREAD_MESSAGES` (default 50)
- `OSS_REPORT_RECURRING_THRESHOLD` — cosine similarity threshold for recurring detection (default 0.82)

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

Each run of `ossReportWorkflow` is persisted by Mastra in a LibSQL database (`apps/mastra/.mastra/output/mastra.db` when running `pnpm dev`). The web app doesn't read any files — it uses [`@mastra/client-js`](https://mastra.ai/docs/server/mastra-client) to query workflow runs directly from the Mastra server.

This means **the Mastra server must be running** for the web app to list or load reports.

The base URL is controlled by `VITE_MASTRA_API_URL` (defaults to `http://localhost:4111`).

## Generate a report

Either use the **Generate report** form on the web app's home page (defaults to the last 7 days), or run `ossReportWorkflow` from Mastra Studio with input like:

```json
{ "start": "2026-04-20T00:00:00.000Z", "end": "2026-04-22T23:59:59.999Z" }
```

All fields are optional:

- `start` / `end` — ISO timestamps (defaults to the last 30 days)
- `maxIssueAnalyses` — cap on issues analyzed per run (default 500)

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

- Schedule weekly runs (GitHub Actions cron or Mastra scheduled workflow).
