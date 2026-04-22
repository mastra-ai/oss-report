# @oss-report/web

Vite + React + Tailwind + shadcn UI for browsing OSS reports.

Reads report JSON files from the Mastra server at `/report-data/` (proxied in dev to `http://localhost:4111`).

## Scripts

```bash
pnpm dev        # vite dev server on :5173
pnpm build      # typecheck + vite build
pnpm preview    # preview built output
pnpm typecheck  # tsc --noEmit
```

## Routes

- `/` — list of all reports (from `index.json`)
- `/reports/:id` — single report (from `reports/<id>.json`)
