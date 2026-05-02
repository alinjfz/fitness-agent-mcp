# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Fitness Agent Layer — a single backend exposing fitness tools to both ChatGPT (Custom GPT Actions) and Claude (MCP server). One schema, one backend, one tool layer, two AI entry points.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (bundled ESM)
- **AI**: OpenAI via Replit AI Integrations (`gpt-5-mini`)
- **MCP**: `@modelcontextprotocol/sdk` StreamableHTTP transport
- **Cron**: `node-cron` (daily, weekly, monthly jobs)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run build` — build the API server

## API Endpoints

All endpoints are at `/api/`:

| Endpoint | Method | Tool | Description |
|----------|--------|------|-------------|
| `/api/healthz` | GET | — | Health check |
| `/api/state/:userId` | GET | `get_state` | Get full fitness state |
| `/api/state/:userId` | PUT | `save_state` | Upsert state (profile, diet, workout, schedule) |
| `/api/log-completion` | POST | `log_completion` | Log workout/diet, award XP + streak + achievements |
| `/api/normalize` | POST | `normalize_user_input` | AI text → structured data extraction |
| `/api/generate-plan` | POST | `generate_plan` | AI-generate diet or workout plan from profile |
| `/api/schedule-events` | POST | `schedule_events` | AI-generate + save calendar events |
| `/api/schedule-events/:userId` | DELETE | — | Clear all schedule events |
| `/api/export/:userId` | GET | `export_report` | Download report (json/csv/html) |
| `/api/progress/:userId/reminders/read` | PATCH | — | Mark reminders as read |
| `/api/mcp` | POST | MCP server | Claude MCP endpoint (all 7 tools) |
| `/api/openapi.json` | GET | — | OpenAPI spec as JSON (for ChatGPT Actions) |
| `/api/openapi.yaml` | GET | — | OpenAPI spec as YAML |
| `/api/system-prompt` | GET | — | Get system prompts + integration configs |

## Database Schema

Tables (PostgreSQL, Drizzle):
- `user_profiles` — userId, name, age, weight, height, goal, allergies, preferences, budget, availableDays, sessionDurationMin, equipment, injuries, mode (auto/confirm)
- `diet_plans` — userId, meals (jsonb), dailyCalories, macros (jsonb), notes
- `workout_plans` — userId, sessions (jsonb), notes
- `schedules` — userId, events (jsonb)
- `progress` — userId, xp, streak, level, history (jsonb), achievements (jsonb), reminders (jsonb), lastLoggedAt

## MCP Tools (Claude Integration)

All 7 tools exposed via `/api/mcp` (StreamableHTTP):
1. `get_state(userId)` — full state read
2. `save_state(userId, profile?, dietPlan?, workoutPlan?, schedule?)` — upsert any section
3. `log_completion(userId, type, notes?)` — XP + streak + achievements
4. `normalize_user_input(input, userId?)` — AI text parsing
5. `generate_plan(userId, type, confirmed?)` — AI diet/workout plan generation
6. `schedule_events(userId, description?, startDate?, durationDays?, confirmed?)` — calendar event generation
7. `export_report(userId, format?)` — progress report

## Gamification System

- Workout completion: 50 XP base
- Diet completion: 30 XP base
- Streak bonus: +10 XP per consecutive day (max 10 days = +100 XP)
- Weekly bonus: +100 XP if 5+ unique days logged in a week
- Level up: every 500 XP
- Achievements: 12 total (first_workout, first_diet, streak_3/7/14/30, level_5/10/25, logs_10/50/100)

## Cron Jobs

- **Daily @20:00** — check for missed workouts on scheduled days, store reminder
- **Weekly Sunday @08:00** — generate weekly XP/activity summary reminder
- **Monthly 1st @09:00** — flag plan renewal reminder (regenerate after 30 days)

## Permission Modes (Phase 9)

- `mode: "auto"` — tools execute and save immediately
- `mode: "confirm"` — `generate_plan` and `schedule_events` return a preview with `requiresConfirmation: true`; call again with `confirmed: true` to save

## Integration Guide

### ChatGPT Custom GPT Actions
1. Create a Custom GPT → Configure → Actions
2. Import via URL: `https://[your-domain]/api/openapi.json`
3. Paste system prompt from `GET /api/system-prompt` → `chatgpt.prompt`

### Claude Desktop (MCP)
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "fitness-agent": {
      "url": "https://[your-domain]/api/mcp",
      "transport": "streamable-http"
    }
  }
}
```
Use system prompt from `GET /api/system-prompt` → `claude_mcp.prompt` as your Claude project instructions.
