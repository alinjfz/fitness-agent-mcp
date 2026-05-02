# Fitness Agent Layer — GitHub Copilot Instructions

This repository is a PostgreSQL-backed Express API that acts as a universal fitness intelligence layer.
It exposes the same data and tools to multiple AI clients simultaneously:

- **ChatGPT** — via OpenAPI / Custom GPT Actions (`GET /api/openapi.json`)
- **Claude** — via MCP StreamableHTTP server (`POST /api/mcp`)
- **GitHub Copilot** — via MCP in VS Code (`.vscode/mcp.json`) + this file for workspace context

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20, TypeScript (ESM) |
| Framework | Express 5 |
| Database | PostgreSQL via Drizzle ORM |
| AI calls | OpenAI `gpt-5-mini` via Replit AI Integration proxy |
| MCP server | `@modelcontextprotocol/sdk` StreamableHTTP |
| Scheduler | node-cron |
| Bundler | esbuild |
| Tests | Vitest + supertest (310 tests, all passing) |
| Package manager | pnpm (monorepo with `pnpm-workspace.yaml`) |

---

## Monorepo layout

```
artifacts/api-server/   ← Express API (main artifact)
lib/db/                 ← @workspace/db — Drizzle schema + client
lib/api-spec/           ← OpenAPI 3.1 spec (openapi.yaml)
lib/api-zod/            ← Generated Zod schemas
lib/api-client-react/   ← Generated React Query hooks
lib/integrations-openai-ai-server/ ← OpenAI client wrapper
```

---

## All API endpoints

| Method | Path | What it does |
|--------|------|-------------|
| GET | `/api/healthz` | Health check |
| GET | `/api/state/:userId` | Full user state (profile + all plans + progress) |
| PUT | `/api/state/:userId` | Upsert profile / diet / workout / schedule |
| POST | `/api/log-completion` | Log workout or diet; awards XP, updates streak |
| POST | `/api/normalize` | Extract structured profile from freeform text (AI) |
| POST | `/api/generate-plan` | AI-generate a diet or workout plan |
| POST | `/api/schedule-events` | AI-generate calendar events from plan |
| DELETE | `/api/schedule-events/:userId` | Clear all scheduled events |
| GET | `/api/export/:userId` | Export report as JSON / CSV / HTML |
| GET | `/api/progress/:userId/history` | Paginated completion history (page/limit/type/sort) |
| PATCH | `/api/progress/:userId/reminders/read` | Mark reminders as read |
| GET | `/api/openapi.json` | OpenAPI 3.1 spec as JSON (CORS open for ChatGPT) |
| GET | `/api/openapi.yaml` | OpenAPI 3.1 spec as YAML |
| GET | `/api/system-prompt` | Copy-paste configs for ChatGPT, Claude, and Copilot |
| POST | `/api/mcp` | MCP JSON-RPC endpoint (SSE responses) |

---

## MCP tools (8 total)

All tools are exposed at `POST /api/mcp` and discoverable via `tools/list`.

| Tool | Purpose |
|------|---------|
| `get_state` | Full user state in one call |
| `save_state` | Upsert any combination of profile/plans/schedule |
| `log_completion` | Log workout/diet; returns XP, streak, achievements |
| `normalize_user_input` | Parse freeform text → structured profile patch |
| `generate_plan` | AI-generate diet or workout plan |
| `schedule_events` | AI-generate and save calendar events |
| `get_history` | Paginated completion history with type filter and sort |
| `export_report` | Fitness report (JSON/CSV/HTML) + download URL |

---

## Database tables

`user_profiles` · `diet_plans` · `workout_plans` · `schedules` · `progress`

All scoped by `userId` (text primary key). JSONB columns for arrays and nested objects.
Schema lives in `lib/db/src/schema.ts`. Push changes with:
```bash
pnpm --filter @workspace/db run push
```

---

## Gamification

- **XP**: 50 per workout, 30 per diet, +5/day streak bonus (capped at 10 days), +100 weekly bonus (5th active day/week)
- **Level**: every 500 XP → level up
- **12 achievements**: first_workout, first_diet, streak_3/7/14/30, level_5/10/25, logs_10/50/100
- **History**: capped at last 100 entries per user

---

## Confirm mode

Set `profile.mode = "confirm"` to put a user in review-before-save mode.
`generate_plan` and `schedule_events` return `requiresConfirmation: true, saved: false` until re-sent with `confirmed: true`.

---

## Scheduled jobs (node-cron)

| Schedule | Action |
|----------|--------|
| Daily 20:00 | Missed workout reminder |
| Sunday 08:00 | Weekly progress report reminder |
| 1st of month 09:00 | Plan renewal nudge (plan > 30 days old) |

---

## Testing

```bash
pnpm --filter @workspace/api-server test
```

All tests use:
- Real PostgreSQL database
- Unique `userId` per test (cleaned up in `afterEach`)
- Mocked OpenAI via `vi.mock`
- Mocked node-cron via `vi.mock`
- Supertest for HTTP requests

---

## Key conventions

- All routes mounted under `/api` prefix
- `process.cwd()` in tests and production = `artifacts/api-server/`
- OpenAI model: `gpt-5-mini` with `response_format: { type: "json_object" }`
- Never call service ports directly — use `localhost:80/api/...` through the shared proxy
- Never use `console.log` in server code — use `req.log` in handlers, `logger` elsewhere
- History endpoint sorts by `completedAt` timestamp (not insertion order)
