# Fitness Agent Layer — Complete Documentation

A single PostgreSQL-backed Express API that acts as a universal fitness intelligence layer for AI assistants. ChatGPT accesses it via OpenAPI / Custom GPT Actions; Claude accesses it via a built-in MCP (Model Context Protocol) server. Both AIs share the same state, gamification engine, and data — so a user can start a conversation in ChatGPT and continue in Claude without losing context.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phases Summary](#2-phases-summary)
3. [Feature Reference](#3-feature-reference)
4. [File Structure](#4-file-structure)
5. [Database Schema](#5-database-schema)
6. [Setup Guide](#6-setup-guide)
7. [REST API Reference](#7-rest-api-reference)
8. [MCP Tools Reference](#8-mcp-tools-reference)
9. [Gamification System](#9-gamification-system)
10. [OpenAPI Spec](#10-openapi-spec)
11. [Test Suite](#11-test-suite)
12. [Configuration & Environment](#12-configuration--environment)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Clients                               │
│                                                             │
│  ChatGPT (Custom GPT)          Claude (Desktop / API)       │
│  └─ OpenAPI Actions ──────┐    └─ MCP StreamableHTTP ──┐   │
└───────────────────────────┼────────────────────────────┼───┘
                            │                            │
                            ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│               Express API  (/api/*)                         │
│                                                             │
│  REST Routes          MCP Server (/api/mcp)                 │
│  ├─ /healthz          ├─ get_state                          │
│  ├─ /state            ├─ save_state                         │
│  ├─ /log-completion   ├─ log_completion                     │
│  ├─ /normalize        ├─ normalize_user_input               │
│  ├─ /generate-plan    ├─ generate_plan                      │
│  ├─ /schedule-events  ├─ schedule_events                    │
│  ├─ /export           └─ export_report                      │
│  ├─ /progress/*                                             │
│  ├─ /openapi.*                                              │
│  └─ /system-prompt                                          │
│                                                             │
│  Gamification Engine    node-cron Jobs                      │
│  └─ XP / Streak /       ├─ Daily: missed workout reminders  │
│     Achievements /       ├─ Weekly: progress reports        │
│     Weekly Bonus         └─ Monthly: plan renewal nudges    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   PostgreSQL    │
                    │                 │
                    │  user_profiles  │
                    │  diet_plans     │
                    │  workout_plans  │
                    │  schedules      │
                    │  progress       │
                    └─────────────────┘
```

**Key design decisions:**
- One database, two AI surfaces — REST for ChatGPT, MCP for Claude, both hit the same tables.
- State is user-scoped by `userId` string (passed by the AI or user).
- All AI calls (plan generation, normalization, scheduling) use OpenAI via the Replit AI Integration proxy — no API key management needed.
- Confirm mode: any mutation endpoint respects `mode: "confirm"` on the user profile, returning a preview without saving until `confirmed: true` is sent.

---

## 2. Phases Summary

| Phase | What was built |
|-------|---------------|
| **1 — DB Schema** | PostgreSQL tables via Drizzle ORM: `user_profiles`, `diet_plans`, `workout_plans`, `schedules`, `progress`. JSONB columns for flexible nested data (meals, sessions, events, history, achievements, reminders). |
| **2 — REST API skeleton** | Express 5 app with pino logging, CORS, JSON body parsing. All routes registered under `/api`. Health check at `/api/healthz`. |
| **3 — State endpoints** | `GET /api/state/:userId` returns the complete user state in one call. `PUT /api/state/:userId` upserts any combination of profile / diet plan / workout plan / schedule. Partial updates merge into existing data. |
| **4 — OpenAPI spec + Custom GPT** | Hand-authored `openapi.yaml` describing all endpoints. Served live at `/api/openapi.json` and `/api/openapi.yaml` with CORS headers for ChatGPT to import directly. |
| **5 — MCP server** | `@modelcontextprotocol/sdk` StreamableHTTP transport at `/api/mcp`. All 7 tools listed in `tools/list`. Claude can call any tool via JSON-RPC. GET `/api/mcp` returns 405 (spec-compliant). |
| **6 — AI plan generation** | `POST /api/generate-plan` calls OpenAI with a structured prompt built from the user's profile. Returns a typed workout or diet plan. Validate JSON from AI; return 500 on parse failure. |
| **7 — AI schedule generation** | `POST /api/schedule-events` calls OpenAI to produce a calendar of events from the user's plan and available days. Events accumulate across calls. `DELETE /api/schedule-events/:userId` clears them. |
| **8 — Export** | `GET /api/export/:userId?format=json|csv|html` returns a full fitness report. JSON is machine-readable; CSV is spreadsheet-importable; HTML is a styled, printable report with stat cards and achievement tables. |
| **9 — Gamification** | Every `POST /api/log-completion` awards XP, computes streak, checks level-up, unlocks achievements, and applies a weekly bonus on the 5th unique active day. 12 achievement definitions. 100-entry history cap. |
| **10 — node-cron + confirm mode + system-prompt** | Three scheduled jobs: daily missed-workout reminders (20:00), weekly progress reports (Sun 08:00), monthly plan renewal nudges (1st 09:00). Confirm mode: generate-plan and schedule-events return `requiresConfirmation: true, saved: false` for users with `mode: "confirm"` unless `confirmed: true` is sent. `GET /api/system-prompt` returns copy-paste system prompts for both ChatGPT and Claude. |
| **11 — Normalize** | `POST /api/normalize` sends freeform user text to OpenAI and extracts structured profile fields (goal, days, equipment, allergies, etc.) with a confidence rating. Optional `userId` provides existing profile context. |
| **12 — Paginated History** | `GET /api/progress/:userId/history` returns the completion event log with pagination (`page`, `limit` up to 100), type filtering (`workout`/`diet`), sort order (`asc`/`desc`), and summary counts. |

---

## 3. Feature Reference

### User State
A user's complete state is:
- **Profile** — name, age, weight/height, goal, allergies, preferences, equipment, injuries, available training days, session duration, weekly budget, mode (auto/confirm).
- **Diet Plan** — daily calorie target, macros (protein/carbs/fat), list of meals with times and ingredients.
- **Workout Plan** — list of sessions keyed by day with exercises (sets × reps, rest).
- **Schedule** — ordered list of calendar events with dates, times, and types.
- **Progress** — XP total, current level, streak, achievement list, 100-entry completion history, unread reminders.

### Confirm Mode
Set `profile.mode = "confirm"` and AI-driven mutations (`generate_plan`, `schedule_events`) will return the proposed change with `requiresConfirmation: true, saved: false` — without writing to the database. Re-send the same request with `confirmed: true` to commit.

### Normalize
Send any freeform text and the AI extracts structured profile fields. Example input: `"I'm 28, I want to bulk up, I can train Mon/Wed/Fri, I have dumbbells"` → structured `{ name, goal: "build_muscle", availableDays: ["monday","wednesday","friday"], equipment: ["dumbbells"] }` plus `confidence` rating and `notes`.

### Gamification System
- **XP per workout** — `XP_WORKOUT` (base)
- **XP per diet log** — `XP_DIET` (base)
- **Streak bonus** — `XP_STREAK_BONUS_PER_DAY` per consecutive day, capped at `MAX_STREAK_BONUS_DAYS`
- **Weekly bonus** — `XP_WEEKLY_BONUS` when the 5th unique active day this week is logged
- **Level** — every `XP_PER_LEVEL` XP, level = `floor(XP / XP_PER_LEVEL) + 1`
- **Achievements** — 12 milestones (see [Gamification System](#9-gamification-system))

### Scheduled Jobs (node-cron)
| Job | Schedule | Action |
|-----|----------|--------|
| Missed workout reminder | Daily 20:00 | Adds reminder to users who haven't logged today |
| Weekly progress report | Sunday 08:00 | Adds weekly summary reminder with XP/streak |
| Monthly plan renewal | 1st of month 09:00 | Nudges users whose plan is > 30 days old |

### Reports
Three export formats from the same data:
- **JSON** — machine-readable, suitable for AI parsing or backup. Includes full profile, progress metrics, achievements, diet/workout/schedule summaries, and last 20 history entries.
- **CSV** — three sections (Profile, Progress, Achievements) with a History appendix. Importable into Excel/Sheets.
- **HTML** — styled report with stat cards, achievement table, and activity log. Print-friendly.

---

## 4. File Structure

```
workspace/
├── artifacts/
│   └── api-server/                    # Main Express API
│       ├── .replit-artifact/
│       │   └── artifact.toml          # Service binding: /api → port 8080
│       ├── src/
│       │   ├── app.ts                 # Express app setup, middleware, route mount
│       │   ├── index.ts               # Server entry point (listen on PORT)
│       │   ├── routes/
│       │   │   ├── index.ts           # Assembles all routers
│       │   │   ├── health.ts          # GET /healthz
│       │   │   ├── state.ts           # GET/PUT /state/:userId
│       │   │   ├── logCompletion.ts   # POST /log-completion
│       │   │   ├── normalize.ts       # POST /normalize
│       │   │   ├── generatePlan.ts    # POST /generate-plan
│       │   │   ├── scheduleEvents.ts  # POST /schedule-events, DELETE /schedule-events/:userId
│       │   │   ├── export.ts          # GET /export/:userId
│       │   │   ├── progress.ts        # PATCH /progress/:userId/reminders/read
│       │   │   ├── progressHistory.ts # GET /progress/:userId/history (paginated)
│       │   │   ├── openapi.ts         # GET /openapi.json, GET /openapi.yaml
│       │   │   ├── systemPrompt.ts    # GET /system-prompt
│       │   │   └── mcp.ts             # POST /mcp (MCP StreamableHTTP server)
│       │   └── lib/
│       │       ├── gamification.ts    # XP, streak, achievements, messages
│       │       ├── cron.ts            # node-cron scheduled jobs
│       │       └── logger.ts          # pino singleton logger
│       ├── src/__tests__/
│       │   ├── helpers.ts             # Test factories, DB cleanup, SSE parser, mock factories
│       │   ├── unit/
│       │   │   ├── gamification.test.ts          # Core gamification function tests
│       │   │   └── gamification.extended.test.ts # XP constants, all 12 achievements, edge cases
│       │   └── integration/
│       │       ├── health.test.ts                # /healthz, /system-prompt
│       │       ├── state.test.ts                 # GET/PUT /state/:userId
│       │       ├── state.extended.test.ts        # Partial updates, all goals, type coercions
│       │       ├── logCompletion.test.ts         # Basic XP, streak, achievements
│       │       ├── logCompletion.extended.test.ts# Streak bonus cap, weekly bonus, seeded DB
│       │       ├── normalize.test.ts             # /normalize with mocked OpenAI
│       │       ├── generatePlan.test.ts          # /generate-plan, confirm mode
│       │       ├── generatePlan.extended.test.ts # Overwrite, AI errors, profile edge cases
│       │       ├── scheduleEvents.test.ts        # /schedule-events, DELETE, confirm mode
│       │       ├── scheduleEvents.extended.test.ts # Durations, startDate, AI errors
│       │       ├── export.test.ts                # JSON/CSV/HTML exports
│       │       ├── progress.test.ts              # PATCH reminders/read
│       │       ├── progressHistory.test.ts       # GET history with pagination, filters, sort
│       │       ├── openapi.test.ts               # /openapi.json and /openapi.yaml
│       │       ├── mcp.test.ts                   # MCP protocol, tools/list, 5 tool calls
│       │       ├── mcp.extended.test.ts          # normalize/schedule via MCP, full data state
│       │       └── workflows.test.ts             # 5 end-to-end journey tests
│       ├── build.mjs                  # esbuild bundler config
│       ├── vitest.config.ts           # Vitest test runner config
│       └── package.json
│
├── lib/
│   ├── db/                            # @workspace/db — Drizzle ORM + schema
│   │   └── src/
│   │       ├── index.ts               # Exports: db, all tables, all types
│   │       └── schema.ts             # Table definitions
│   ├── api-spec/
│   │   └── openapi.yaml              # Hand-authored OpenAPI 3.1 spec
│   ├── api-zod/                       # @workspace/api-zod — Zod schemas
│   ├── api-client-react/              # @workspace/api-client-react — React Query hooks
│   └── integrations-openai-ai-server/ # @workspace/integrations-openai-ai-server — OpenAI client
│
├── scripts/                           # Utility scripts (@workspace/scripts)
├── pnpm-workspace.yaml               # Workspace package catalog + overrides
├── tsconfig.base.json                # Shared strict TS defaults
├── tsconfig.json                     # Solution file (libs only)
├── package.json                      # Root dev tooling
└── DOCS.md                           # This file
```

---

## 5. Database Schema

All tables use `userId` (text) as the primary key or foreign key. Drizzle ORM manages migrations via `drizzle-kit push`.

### `user_profiles`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | Provided by the AI/client |
| `name` | text | |
| `age` | integer | |
| `weightKg` | numeric(6,2) | Stored as string, returned as number |
| `heightCm` | numeric(6,2) | Stored as string, returned as number |
| `goal` | text | `lose_weight`, `build_muscle`, `maintain`, `improve_endurance` |
| `allergies` | jsonb | string[] |
| `preferences` | jsonb | string[] (foods they like) |
| `budgetPerWeek` | numeric(8,2) | USD, optional |
| `availableDays` | jsonb | string[] of day names |
| `sessionDurationMin` | integer | |
| `equipment` | jsonb | string[] |
| `injuries` | jsonb | string[] |
| `mode` | text | `auto` (default) or `confirm` |
| `createdAt` / `updatedAt` | timestamp | |

### `diet_plans`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | |
| `meals` | jsonb | `{ name, time, calories, protein, carbs, fat, ingredients }[]` |
| `dailyCalories` | integer | |
| `macros` | jsonb | `{ proteinG, carbsG, fatG }` |
| `notes` | text | |
| `updatedAt` | timestamp | |

### `workout_plans`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | |
| `sessions` | jsonb | `{ day, name, durationMin, exercises: { name, sets, reps, restSec }[] }[]` |
| `notes` | text | |
| `updatedAt` | timestamp | |

### `schedules`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | |
| `events` | jsonb | `{ title, date, time, type, durationMin }[]` — accumulates across calls |
| `updatedAt` | timestamp | |

### `progress`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | |
| `xp` | integer | Cumulative XP total |
| `streak` | integer | Current consecutive-day streak |
| `level` | integer | Derived from XP, cached here |
| `history` | jsonb | `CompletionEvent[]`, capped at 100 entries |
| `achievements` | jsonb | `Achievement[]` — only earned achievements |
| `reminders` | jsonb | `Reminder[]` — includes `read` flag |
| `lastLoggedAt` | timestamp | Used to compute streak transitions |
| `updatedAt` | timestamp | |

---

## 6. Setup Guide

### Prerequisites
- Node.js 20+
- pnpm 9+
- A Replit project with PostgreSQL database (or any `DATABASE_URL`)
- Replit AI Integration for OpenAI (or set `OPENAI_API_KEY` manually)

### 1. Install dependencies
```bash
pnpm install
```

### 2. Set environment secrets
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SESSION_SECRET=<random string>
```
If using Replit, these are set via the Secrets panel. The OpenAI integration is wired automatically via `@workspace/integrations-openai-ai-server`.

### 3. Push the database schema
```bash
pnpm --filter @workspace/db run push
```

### 4. Build the API server
```bash
pnpm --filter @workspace/api-server run build
```

### 5. Start the server
```bash
pnpm --filter @workspace/api-server run start
```
Or, in Replit, start the `API Server` workflow — it runs on the port assigned by `$PORT`.

### 6. Run tests
```bash
pnpm --filter @workspace/api-server test
```

### Connecting ChatGPT
1. Go to `GET /api/system-prompt` for the exact system prompt and instructions.
2. In your Custom GPT, set the Action schema URL to `https://<your-domain>/api/openapi.json`.
3. Paste the system prompt from `chatgpt.prompt` into your GPT's instructions.

### Connecting Claude
1. Get the MCP endpoint from `GET /api/system-prompt` → `mcp_endpoint` (e.g. `/api/mcp`).
2. Paste the Claude Desktop config from `claude_desktop_config` into `~/.claude/claude_desktop_config.json`.
3. Claude will discover all 7 tools automatically via `tools/list`.

---

## 7. REST API Reference

All routes are under the `/api` prefix. Requests/responses are JSON unless noted.

---

### `GET /api/healthz`
Returns server health status.

**Response 200**
```json
{ "status": "ok" }
```

---

### `GET /api/state/:userId`
Returns the complete current state for a user.

**Response 200**
```json
{
  "profile": {
    "userId": "user_123",
    "name": "Jane",
    "age": 28,
    "weightKg": 65,
    "heightCm": 168,
    "goal": "build_muscle",
    "allergies": ["nuts"],
    "preferences": ["chicken"],
    "availableDays": ["monday", "wednesday", "friday"],
    "sessionDurationMin": 60,
    "equipment": ["dumbbells"],
    "injuries": [],
    "mode": "auto"
  },
  "dietPlan": { "meals": [...], "dailyCalories": 2000, "macros": {...}, "notes": "..." },
  "workoutPlan": { "sessions": [...], "notes": "..." },
  "schedule": { "events": [...] },
  "progress": {
    "xp": 750, "streak": 5, "level": 2, "xpToNextLevel": 250,
    "history": [...], "achievements": [...], "reminders": [...]
  }
}
```
**Response 404** — user not found.

---

### `PUT /api/state/:userId`
Upserts any combination of profile / diet plan / workout plan / schedule. All fields are optional — only provided fields are written.

**Request body** (all fields optional)
```json
{
  "profile": { "name": "Jane", "goal": "build_muscle", "mode": "auto", ... },
  "dietPlan": { "meals": [...], "dailyCalories": 2000, "macros": {...} },
  "workoutPlan": { "sessions": [...] },
  "schedule": { "events": [...] }
}
```
**Response 200** — full updated state (same shape as GET).

---

### `POST /api/log-completion`
Logs a workout or diet session and runs the full gamification pipeline.

**Request body**
```json
{ "userId": "user_123", "type": "workout", "notes": "Great session" }
```

**Response 200**
```json
{
  "xpGained": 85,
  "totalXp": 835,
  "streak": 6,
  "level": 2,
  "leveledUp": false,
  "xpToNextLevel": 165,
  "message": "6-day streak! You're unstoppable. Keep it going.",
  "newAchievements": [{ "name": "Week Warrior", "description": "...", "xpBonus": 150 }],
  "reminders": []
}
```
**Response 400** — `userId` or `type` missing.

---

### `POST /api/normalize`
Extracts structured profile fields from freeform text using OpenAI.

**Request body**
```json
{
  "input": "I'm 28, want to build muscle, train Mon/Wed/Fri, have dumbbells",
  "userId": "user_123"
}
```

**Response 200**
```json
{
  "extracted": {
    "profile": { "age": 28, "goal": "build_muscle", "availableDays": ["monday", "wednesday", "friday"], "equipment": ["dumbbells"] }
  },
  "rawInput": "I'm 28, want to build muscle...",
  "confidence": "high",
  "notes": "Extracted age, goal, 3 training days, equipment. Name not found."
}
```
**Response 400** — `input` missing.

---

### `POST /api/generate-plan`
Generates a personalized workout or diet plan using OpenAI, based on the user's profile.

**Request body**
```json
{ "userId": "user_123", "type": "workout", "confirmed": true }
```
- `type`: `"workout"` or `"diet"` (required)
- `confirmed`: `true` to save in confirm mode

**Response 200**
```json
{
  "plan": {
    "sessions": [{ "day": "monday", "name": "Push Day", "durationMin": 60, "exercises": [...] }],
    "notes": "..."
  },
  "saved": true
}
```
In confirm mode without `confirmed: true`:
```json
{ "plan": {...}, "saved": false, "requiresConfirmation": true }
```
**Response 404** — user not found.
**Response 500** — AI returned invalid JSON.

---

### `POST /api/schedule-events`
Generates a calendar of events using OpenAI and appends them to the user's schedule.

**Request body**
```json
{
  "userId": "user_123",
  "startDate": "2026-06-01",
  "durationDays": 30,
  "description": "3 workouts per week",
  "confirmed": true
}
```
All fields except `userId` are optional (defaults: today, 30 days, auto-description).

**Response 200**
```json
{
  "events": [{ "title": "Push Day", "date": "2026-06-02", "time": "07:00", "type": "workout", "durationMin": 60 }],
  "count": 12,
  "saved": true,
  "startDate": "2026-06-01",
  "durationDays": 30
}
```

---

### `DELETE /api/schedule-events/:userId`
Clears all scheduled events for a user.

**Response 200** `{ "success": true }`

---

### `GET /api/export/:userId`
Exports the user's full fitness report.

**Query params**
- `format`: `json` (default), `csv`, or `html`

**Response 200** — Content-Disposition attachment header set. JSON body, CSV text, or HTML document.
**Response 400** — invalid format.
**Response 404** — user not found.

---

### `GET /api/progress/:userId/history`
Returns the paginated completion event history for a user.

**Query params**
| Param | Default | Notes |
|-------|---------|-------|
| `page` | `1` | Page number (1-indexed, clamped to totalPages) |
| `limit` | `20` | Entries per page (max 100) |
| `type` | (all) | Filter: `workout` or `diet` |
| `sort` | `desc` | Sort order: `desc` (newest first) or `asc` (oldest first) |

**Response 200**
```json
{
  "userId": "user_123",
  "history": [
    { "type": "workout", "completedAt": "2026-05-01T07:00:00Z", "xpGained": 85, "notes": "..." }
  ],
  "pagination": {
    "page": 1, "limit": 20, "total": 47, "totalPages": 3,
    "hasNext": true, "hasPrev": false
  },
  "summary": {
    "workoutLogs": 30, "dietLogs": 17, "totalLogs": 47, "filteredTotal": 47
  }
}
```
`summary` always reflects unfiltered totals. `filteredTotal` reflects the count after type filter is applied.

**Response 400** — invalid `type` or `sort` value.
**Response 404** — no progress record for user.

---

### `PATCH /api/progress/:userId/reminders/read`
Marks reminders as read so they no longer appear in `GET /state`.

**Request body**
```json
{ "ids": ["reminder_id_1"] }
```
Omit `ids` to mark all reminders read.

**Response 200** `{ "success": true, "markedRead": ["reminder_id_1"] }`

---

### `GET /api/openapi.json`
Returns the OpenAPI 3.1 spec as JSON. `Access-Control-Allow-Origin: *` header set for ChatGPT import.

### `GET /api/openapi.yaml`
Returns the OpenAPI 3.1 spec as YAML. Same CORS header.

---

### `GET /api/system-prompt`
Returns ready-to-paste system prompts and configuration for both AI integrations.

**Response 200**
```json
{
  "mcp_endpoint": "/api/mcp",
  "chatgpt": { "prompt": "You are a fitness coach AI..." },
  "claude_mcp": { "prompt": "You are a fitness coach AI..." },
  "claude_desktop_config": { "mcpServers": { "fitness": { "url": "..." } } }
}
```

---

## 8. MCP Tools Reference

The MCP server at `POST /api/mcp` implements the Model Context Protocol (StreamableHTTP transport). Claude sends JSON-RPC requests; responses are Server-Sent Events (SSE).

**Protocol**
```
POST /api/mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

---

### `get_state`
Retrieves the complete state for a user.

**Input** `{ userId: string }`
**Output** — full state object (profile, dietPlan, workoutPlan, schedule, progress).

---

### `save_state`
Saves any combination of profile, diet plan, workout plan, and schedule.

**Input**
```json
{
  "userId": "string",
  "profile": { ... },
  "dietPlan": { ... },
  "workoutPlan": { ... },
  "schedule": { ... }
}
```
**Output** `{ success: true, state: { ... } }`

---

### `log_completion`
Logs a workout or diet session and returns gamification results.

**Input** `{ userId: string, type: "workout"|"diet", notes?: string }`
**Output** — xpGained, totalXp, streak, level, leveledUp, newAchievements, message.

---

### `normalize_user_input`
Extracts structured profile data from freeform text.

**Input** `{ input: string, userId?: string }`
**Output** — extracted profile fields, confidence rating, notes.

---

### `generate_plan`
Generates a workout or diet plan using AI.

**Input** `{ userId: string, type: "workout"|"diet", confirmed?: boolean }`
**Output** — plan object, saved flag, requiresConfirmation flag (in confirm mode).

---

### `schedule_events`
Generates and saves a calendar of fitness events.

**Input** `{ userId: string, startDate?: string, durationDays?: number, description?: string, confirmed?: boolean }`
**Output** — events array, count, saved flag.

---

### `export_report`
Returns a fitness report and a download URL.

**Input** `{ userId: string, format?: "json"|"csv"|"html" }`
**Output**
```json
{
  "userId": "...",
  "downloadUrl": "/api/export/user_123?format=json",
  "profile": { ... },
  "progress": { "xp": 750, "level": 2, "streak": 5, "workoutLogs": 10, "dietLogs": 5, "totalLogs": 15 },
  "achievements": [...],
  "recentHistory": [...]
}
```

---

## 9. Gamification System

Defined in `artifacts/api-server/src/lib/gamification.ts`.

### XP Constants
| Constant | Value | Description |
|----------|-------|-------------|
| `XP_WORKOUT` | 50 | Base XP per workout |
| `XP_DIET` | 30 | Base XP per diet log |
| `XP_STREAK_BONUS_PER_DAY` | 5 | Bonus XP per streak day |
| `MAX_STREAK_BONUS_DAYS` | 10 | Maximum streak days for bonus (cap = 50 XP) |
| `XP_WEEKLY_BONUS` | 100 | Bonus for 5th unique active day in a week |
| `XP_PER_LEVEL` | 500 | XP required to advance one level |

### XP Calculation (per log)
```
xpGained = baseXp + min(streak - 1, MAX_STREAK_BONUS_DAYS) * XP_STREAK_BONUS_PER_DAY
         + achievement.xpBonus (for each newly unlocked achievement)
         + XP_WEEKLY_BONUS (if current log is the 5th unique active day this week)
```

### Streak Rules
- **Increment** — last log was 20–48 hours ago (yesterday window)
- **Hold** — last log was within the past 20 hours (same day)
- **Reset** — last log was more than 48 hours ago or null (first log → streak = 1)

### Level Formula
```typescript
level = Math.floor(totalXp / XP_PER_LEVEL) + 1
xpToNextLevel = XP_PER_LEVEL - (totalXp % XP_PER_LEVEL)
```

### Achievements (12 total)
| ID | Name | Condition | XP Bonus |
|----|------|-----------|----------|
| `first_workout` | First Rep | First workout logged | 100 |
| `first_diet` | Clean Plate | First diet session logged | 50 |
| `streak_3` | On A Roll | 3-day streak | 75 |
| `streak_7` | Week Warrior | 7-day streak | 150 |
| `streak_14` | Fortnight Fighter | 14-day streak | 250 |
| `streak_30` | Monthly Legend | 30-day streak | 500 |
| `level_5` | Rising Star | Reach level 5 | 200 |
| `level_10` | Elite Athlete | Reach level 10 | 400 |
| `level_25` | Champion | Reach level 25 | 1000 |
| `logs_10` | Consistent | 10 total logs | 100 |
| `logs_50` | Dedicated | 50 total logs | 300 |
| `logs_100` | Unstoppable | 100 total logs | 750 |

### History Cap
The completion history is capped at the last 100 entries (`.slice(-100)`). The full count is reflected in achievement checks before trimming.

---

## 10. OpenAPI Spec

The spec lives at `lib/api-spec/openapi.yaml`. It is served live by the API (no build step needed) at:
- `GET /api/openapi.json` — parsed to JSON
- `GET /api/openapi.yaml` — raw YAML

**Paths defined** (8):
`/healthz`, `/state/{userId}`, `/log-completion`, `/normalize`, `/generate-plan`, `/schedule-events`, `/export/{userId}`, `/mcp`

**Schemas defined**: `FitnessState`, `UserProfile`, `DietPlan`, `WorkoutPlan`, `Schedule`, `Progress`, `CompletionEvent`, `Achievement`, `LogCompletionResponse`, `GeneratePlanResponse`, `ScheduleEventsResponse`, `NormalizeResponse`, `ExportResponse`

To import into ChatGPT:
1. Create a Custom GPT
2. Add an Action with schema URL: `https://<your-domain>/api/openapi.json`
3. ChatGPT will auto-discover all endpoints

---

## 11. Test Suite

Run: `pnpm --filter @workspace/api-server test`

**Coverage: 19 test files, 305+ tests, all passing.**

### Strategy
- **Unit tests** — pure function tests with no mocking (gamification logic)
- **Integration tests** — real PostgreSQL database, mocked OpenAI, mocked node-cron, supertest HTTP client
- **End-to-end tests** — full user journeys across multiple endpoints

### Mocking
- `node-cron` — mocked via `vi.mock` (hoisted) to prevent background jobs during tests
- `@workspace/integrations-openai-ai-server` — mocked OpenAI client with `vi.fn()`, per-test `mockResolvedValueOnce` for AI responses
- Database — real PostgreSQL; each test uses a unique `userId` like `test_<suite>_<random>`, cleaned up in `afterEach`

### Test Files
| File | What it covers |
|------|---------------|
| `unit/gamification.test.ts` | Core functions: computeLevel, isConsecutiveDay, isSameDay, computeNewStreak, checkNewAchievements, checkWeeklyBonus, reinforcementMessage |
| `unit/gamification.extended.test.ts` | All 12 achievement unlock paths, XP constants, ACHIEVEMENT_DEFS validation, boundary conditions |
| `integration/health.test.ts` | /healthz, /system-prompt structure |
| `integration/state.test.ts` | GET 200/404, PUT create/update, saves for all sub-documents |
| `integration/state.extended.test.ts` | All 4 goals, both modes, 13 partial-update scenarios, array fields, type coercions |
| `integration/logCompletion.test.ts` | XP fields, streak=1 on first log, first_workout achievement, accumulation |
| `integration/logCompletion.extended.test.ts` | Streak bonus cap, same-day idempotency, DB-seeded streak increment/reset, weekly bonus trigger |
| `integration/normalize.test.ts` | /normalize basic flow, rawInput echo, confidence enum, single OpenAI call |
| `integration/generatePlan.test.ts` | Workout/diet plans, state persistence, confirm mode preview vs save |
| `integration/generatePlan.extended.test.ts` | Plan overwrite, AI error handling (invalid JSON/array/empty), profile edge cases |
| `integration/scheduleEvents.test.ts` | Event generation, accumulation, confirm mode, DELETE |
| `integration/scheduleEvents.extended.test.ts` | Durations (1/7/90 days), startDate, AI errors, DELETE round-trips |
| `integration/export.test.ts` | JSON/CSV/HTML formats, XP/achievement values, content-type headers |
| `integration/progress.test.ts` | PATCH reminders/read, 404, mark-by-id, unread filter in state |
| `integration/progressHistory.test.ts` | Pagination (page/limit/clamping), type filter, sort order, summary accuracy, empty history |
| `integration/openapi.test.ts` | /openapi.json (8 paths, 3 schemas), /openapi.yaml (CORS, content, equivalence) |
| `integration/mcp.test.ts` | MCP protocol, tools/list (7 tools + schemas), 5 tool calls |
| `integration/mcp.extended.test.ts` | normalize/schedule via MCP, full-data get_state, export formats, save_state with plans, inputSchema validation |
| `integration/workflows.test.ts` | 5 end-to-end journeys (onboarding, confirm mode plans, confirm mode schedule, XP accumulation, reminders) |

---

## 12. Configuration & Environment

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Used for session signing |
| `PORT` | Auto | Assigned by Replit proxy (default 8080) |

### OpenAI Integration
The server uses `@workspace/integrations-openai-ai-server` which wraps the Replit AI Integrations proxy. No `OPENAI_API_KEY` is needed in the Replit environment — the proxy authenticates automatically.

Model used: `gpt-5-mini` (all AI calls — normalize, generate-plan, schedule-events).

`response_format: { type: "json_object" }` is set on all calls that require structured output.

### node-cron Schedule Strings
| Job | Cron expression |
|-----|----------------|
| Daily missed-workout reminder | `0 20 * * *` |
| Weekly progress report | `0 8 * * 0` |
| Monthly plan renewal | `0 9 1 * *` |

### Build System
The API server is bundled with esbuild (`build.mjs`). The bundle:
- Targets Node.js ESM
- Bundles all workspace package dependencies
- Uses `esbuild-plugin-pino` for pino's dynamic requires
- Outputs to `dist/index.mjs`

In production the built bundle is run; in tests Vitest runs the TypeScript source directly.
