# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Fitness Agent Layer — a single backend exposing fitness tools to both ChatGPT (Custom GPT Actions) and Claude (MCP server).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI via Replit AI Integrations (used for `normalize_user_input`)
- **MCP**: `@modelcontextprotocol/sdk` (StreamableHTTP transport)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## API Endpoints

All endpoints are at `/api/`:

| Endpoint | Method | Tool | Description |
|----------|--------|------|-------------|
| `/api/healthz` | GET | — | Health check |
| `/api/state/:userId` | GET | `get_state` | Get full fitness state for a user |
| `/api/state/:userId` | PUT | `save_state` | Upsert fitness state (profile, diet, workout, schedule) |
| `/api/log-completion` | POST | `log_completion` | Log workout/diet completion, award XP + streak |
| `/api/normalize` | POST | `normalize_user_input` | Parse messy text into structured fitness data (AI-powered) |
| `/api/mcp` | POST | MCP server | Claude MCP integration endpoint |
| `/api/openapi.json` | GET | — | OpenAPI spec as JSON (for ChatGPT Actions) |
| `/api/openapi.yaml` | GET | — | OpenAPI spec as YAML |

## Database Schema

Tables (PostgreSQL, managed with Drizzle):
- `user_profiles` — user identity, goals, preferences, allergies, equipment, injuries, mode
- `diet_plans` — meals (jsonb), daily calories, macros
- `workout_plans` — sessions (jsonb), notes
- `schedules` — events (jsonb)
- `progress` — XP, streak, level, history (jsonb), lastLoggedAt

## Phase Integration Guide

### Phase 2A — ChatGPT Custom GPT Actions

1. Go to ChatGPT → Create a GPT → Configure → Actions
2. Import via URL: `https://<your-domain>/api/openapi.json`
3. Set authentication: None (or API key if you add auth later)

### Phase 2B — Claude MCP

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "fitness-agent": {
      "url": "https://<your-domain>/api/mcp",
      "transport": "streamable-http"
    }
  }
}
```

## XP System

- Workout completion: 50 XP base
- Diet completion: 30 XP base
- Streak bonus: +10 XP per consecutive day (max 10 days = +100 XP)
- Level up: every 500 XP
- Streak resets if no activity for >48 hours

## MCP Tools Exposed

1. `get_state(userId)` — fetch full fitness state
2. `save_state(userId, profile?, dietPlan?, workoutPlan?, schedule?)` — upsert any section
3. `log_completion(userId, type, notes?)` — log workout/diet, get XP feedback
4. `normalize_user_input(input, userId?)` — AI text → structured data extraction

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
