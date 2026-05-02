# Fitness Agent Layer — Complete Documentation

A single PostgreSQL-backed Express API that acts as a universal fitness intelligence layer for AI assistants. ChatGPT accesses it via OpenAPI / Custom GPT Actions; Claude accesses it via a built-in MCP (Model Context Protocol) server; GitHub Copilot accesses it via VS Code MCP configuration. All three AIs share the same state, gamification engine, and data.

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
9. [AI Client Integrations](#9-ai-client-integrations)
10. [Gamification System](#10-gamification-system)
11. [OpenAPI Spec](#11-openapi-spec)
12. [Test Suite](#12-test-suite)
13. [Configuration & Environment](#13-configuration--environment)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          AI Clients                                  │
│                                                                      │
│  ChatGPT (Custom GPT)    Claude (Desktop/API)    GitHub Copilot Chat │
│  └─ OpenAPI Actions ──┐  └─ MCP StreamableHTTP─┐  └─ VS Code MCP ──┐│
└───────────────────────┼──────────────────────  ┼────────────────── ┼┘
                        │                         │                   │
                        └─────────────────────────┴───────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Express API  (/api/*)                            │
│                                                                      │
│  REST Routes                    MCP Server (/api/mcp)               │
│  ├─ /healthz                    ├─ get_state                         │
│  ├─ /state                      ├─ save_state                        │
│  ├─ /log-completion             ├─ log_completion                    │
│  ├─ /normalize                  ├─ normalize_user_input              │
│  ├─ /generate-plan              ├─ generate_plan                     │
│  ├─ /schedule-events            ├─ schedule_events                   │
│  ├─ /export                     ├─ get_history                       │
│  ├─ /progress/:userId/history   └─ export_report                    │
│  ├─ /progress/:userId/reminders/read                                 │
│  ├─ /openapi.json + /openapi.yaml                                    │
│  └─ /system-prompt                                                   │
│                                                                      │
│  Gamification Engine         node-cron Jobs                         │
│  └─ XP / Streak /            ├─ Daily: missed workout reminders     │
│     Achievements /            ├─ Weekly: progress reports           │
│     Weekly Bonus              └─ Monthly: plan renewal nudges       │
└─────────────────────────────┬───────────────────────────────────────┘
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
- One database, three AI surfaces — REST for ChatGPT, MCP for Claude and Copilot, both hit the same tables.
- State is user-scoped by `userId` string.
- All AI calls use OpenAI via the Replit AI Integration proxy — no API key management needed.
- Confirm mode: any mutation endpoint respects `mode: "confirm"` on the user profile, returning a preview without saving until `confirmed: true` is sent.

---

## 2. Phases Summary

| Phase | What was built |
|-------|---------------|
| **1 — DB Schema** | PostgreSQL tables via Drizzle ORM: `user_profiles`, `diet_plans`, `workout_plans`, `schedules`, `progress`. JSONB columns for flexible nested data (meals, sessions, events, history, achievements, reminders). |
| **2 — REST API skeleton** | Express 5 app with pino logging, CORS, JSON body parsing. All routes registered under `/api`. Health check at `/api/healthz`. |
| **3 — State endpoints** | `GET /api/state/:userId` returns the complete user state in one call. `PUT /api/state/:userId` upserts any combination of profile / diet plan / workout plan / schedule. Partial updates merge into existing data. |
| **4 — OpenAPI spec + Custom GPT** | Hand-authored `openapi.yaml` describing all endpoints. Served live at `/api/openapi.json` and `/api/openapi.yaml` with CORS headers for ChatGPT to import directly. |
| **5 — MCP server** | `@modelcontextprotocol/sdk` StreamableHTTP transport at `/api/mcp`. All tools listed in `tools/list`. Claude can call any tool via JSON-RPC. |
| **6 — AI plan generation** | `POST /api/generate-plan` calls OpenAI with a structured prompt built from the user's profile. Returns a typed workout or diet plan. Validates JSON from AI; returns 500 on parse failure. |
| **7 — AI schedule generation** | `POST /api/schedule-events` calls OpenAI to produce a calendar of events from the user's plan and available days. Events accumulate across calls. `DELETE /api/schedule-events/:userId` clears them. |
| **8 — Export** | `GET /api/export/:userId?format=json\|csv\|html` returns a full fitness report. JSON is machine-readable; CSV is spreadsheet-importable; HTML is a styled, printable report with stat cards and achievement tables. |
| **9 — Gamification** | Every `POST /api/log-completion` awards XP, computes streak, checks level-up, unlocks achievements, and applies a weekly bonus on the 5th unique active day. 12 achievement definitions. 100-entry history cap. |
| **10 — node-cron + confirm mode + system-prompt** | Three scheduled jobs (daily, weekly, monthly). Confirm mode preview/save flow. `GET /api/system-prompt` returns configs for ChatGPT, Claude, and Copilot. |
| **11 — Normalize** | `POST /api/normalize` sends freeform user text to OpenAI and extracts structured profile fields with a confidence rating. |
| **12 — Paginated History** | `GET /api/progress/:userId/history` with `page`, `limit` (max 100), `type` filter, `sort` order. Also added as MCP `get_history` tool available to all three AI clients. |
| **13 — Multi-AI integration** | OpenAPI spec updated with history endpoint + new schemas. `get_history` MCP tool added (8th tool). GitHub Copilot support via `.vscode/mcp.json` + `.github/copilot-instructions.md`. `/api/system-prompt` now returns configs for all three AIs. |
| **14 — Interactive HTML export** | HTML report upgraded to a fully client-side paginated activity log. All history embedded as JSON; no extra requests. Type filter, sort toggle, per-page selector (10/20/50/All), Previous/Next navigation. `embed=true` query param strips the download header so the report can be iframed or linked inline. |

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
Set `profile.mode = "confirm"` and AI-driven mutations (`generate_plan`, `schedule_events`) will return the proposed change with `requiresConfirmation: true, saved: false` — without writing to the database. Re-send with `confirmed: true` to commit.

### Normalize
Send any freeform text and the AI extracts structured profile fields. Example: `"I'm 28, I want to bulk up, I can train Mon/Wed/Fri, I have dumbbells"` → `{ age: 28, goal: "build_muscle", availableDays: [...], equipment: [...] }` plus `confidence` rating and `notes`.

### Paginated History
`GET /api/progress/:userId/history` and MCP `get_history` both support:
- `page` / `limit` (max 100) — pagination
- `type=workout|diet` — filter by event type
- `sort=asc|desc` — oldest-first or newest-first (default desc)
- Response includes a `summary` with unfiltered lifetime totals alongside paginated `history` and `pagination` metadata.

### Gamification System
- XP per workout/diet log + streak bonus + weekly bonus
- Level-up every 500 XP
- 12 achievements auto-unlocked during `log_completion`

### Scheduled Jobs (node-cron)
| Job | Schedule | Action |
|-----|----------|--------|
| Missed workout reminder | Daily 20:00 | Adds reminder to users who haven't logged today |
| Weekly progress report | Sunday 08:00 | Adds weekly summary reminder with XP/streak |
| Monthly plan renewal | 1st of month 09:00 | Nudges users whose plan is > 30 days old |

### Reports
Three export formats from the same data:
- **JSON** — machine-readable, suitable for AI parsing or backup.
- **CSV** — three sections (Profile, Progress, Achievements) with a History appendix. Importable into Excel/Sheets.
- **HTML** — interactive report with stat cards, achievement table, and a fully client-side paginated activity log (see below).

### HTML Report — Interactive Activity Log

The HTML export embeds the user's **complete history** as a JSON data block, then renders it client-side. No extra network requests are made after the initial page load.

**Controls available on the page:**

| Control | Options | Default |
|---------|---------|---------|
| Type filter | All types / Workout only / Diet only | All types |
| Sort order | Newest first / Oldest first | Newest first |
| Per-page selector | 10 / 20 / 50 / All | 20 |
| Pagination | Previous / Next buttons + page counter | Page 1 |

The heading shows a live count: `Activity Log (40 of 97 entries)` — updated instantly when filters change.

**Embed mode** — add `?embed=true` to strip the `Content-Disposition: attachment` download header. The report serves as a regular inline HTML page instead of a file download, suitable for iframing in a dashboard or linking directly:

```
GET /api/export/user_123?format=html&embed=true
```

---

## 4. File Structure

```
workspace/
├── .github/
│   └── copilot-instructions.md        # Workspace context for GitHub Copilot Chat
├── .vscode/
│   └── mcp.json                       # VS Code MCP config for Copilot (points to /api/mcp)
│
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
│       │   │   ├── export.ts          # GET /export/:userId?format=json|csv|html&embed=true
│       │   │   ├── progress.ts        # PATCH /progress/:userId/reminders/read
│       │   │   ├── progressHistory.ts # GET /progress/:userId/history (paginated)
│       │   │   ├── openapi.ts         # GET /openapi.json, GET /openapi.yaml
│       │   │   ├── systemPrompt.ts    # GET /system-prompt (ChatGPT + Claude + Copilot configs)
│       │   │   └── mcp.ts             # POST /mcp (MCP StreamableHTTP, 8 tools)
│       │   └── lib/
│       │       ├── gamification.ts    # XP, streak, achievements, messages
│       │       ├── cron.ts            # node-cron scheduled jobs
│       │       └── logger.ts          # pino singleton logger
│       └── src/__tests__/
│           ├── helpers.ts             # uid(), createTestUser(), cleanupTestUser(), parseSseData(), mock factories
│           ├── unit/
│           │   ├── gamification.test.ts
│           │   └── gamification.extended.test.ts
│           └── integration/
│               ├── health.test.ts
│               ├── state.test.ts
│               ├── state.extended.test.ts
│               ├── logCompletion.test.ts
│               ├── logCompletion.extended.test.ts
│               ├── normalize.test.ts
│               ├── generatePlan.test.ts
│               ├── generatePlan.extended.test.ts
│               ├── scheduleEvents.test.ts
│               ├── scheduleEvents.extended.test.ts
│               ├── export.test.ts         # JSON/CSV/HTML formats + embed mode + paginated log
│               ├── progress.test.ts
│               ├── progressHistory.test.ts
│               ├── openapi.test.ts
│               ├── mcp.test.ts
│               ├── mcp.extended.test.ts   # get_history MCP tool + extended scenarios
│               └── workflows.test.ts
│
├── lib/
│   ├── db/                            # @workspace/db — Drizzle ORM + schema
│   │   └── src/
│   │       ├── index.ts               # Exports: db, all tables, all types
│   │       └── schema.ts             # Table definitions
│   ├── api-spec/
│   │   └── openapi.yaml              # Hand-authored OpenAPI 3.1 spec (10 paths, 27 schemas)
│   ├── api-zod/                       # @workspace/api-zod — generated Zod schemas
│   ├── api-client-react/              # @workspace/api-client-react — generated React Query hooks
│   └── integrations-openai-ai-server/ # @workspace/integrations-openai-ai-server — OpenAI client
│
├── scripts/                           # @workspace/scripts utility scripts
├── pnpm-workspace.yaml               # Workspace package catalog + overrides
├── tsconfig.base.json                # Shared strict TS defaults
├── tsconfig.json                     # Solution file (libs only)
├── package.json                      # Root dev tooling
└── DOCS.md                           # This file
```

---

## 5. Database Schema

All tables use `userId` (text) as the primary key. Drizzle ORM manages migrations via `drizzle-kit push`.

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
| `preferences` | jsonb | string[] |
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
In Replit, these are set via the Secrets panel. The OpenAI integration is wired automatically via `@workspace/integrations-openai-ai-server`.

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

---

## 7. REST API Reference

All routes are under the `/api` prefix. Requests/responses are JSON unless noted.

### `GET /api/healthz`
```json
{ "status": "ok" }
```

### `GET /api/state/:userId`
Returns the complete current state for a user (profile, dietPlan, workoutPlan, schedule, progress). **404** if user not found.

### `PUT /api/state/:userId`
Upserts any combination of profile / diet plan / workout plan / schedule. All fields are optional — only provided fields are written. Returns full updated state.

### `POST /api/log-completion`
Logs a workout or diet session and runs the full gamification pipeline.

**Body** `{ userId, type: "workout"|"diet", notes? }`

**Response** `{ xpGained, totalXp, streak, level, leveledUp, xpToNextLevel, message, newAchievements?, reminders }`

### `POST /api/normalize`
Extracts structured profile fields from freeform text using AI.

**Body** `{ input: string, userId? }`

**Response** `{ extracted: { profile: {...} }, rawInput, confidence: "high"|"medium"|"low", notes }`

### `POST /api/generate-plan`
AI-generates a workout or diet plan from the user's stored profile.

**Body** `{ userId, type: "workout"|"diet", confirmed? }`

**Response** `{ plan, saved: boolean, requiresConfirmation? }` — in confirm mode without `confirmed: true`, `saved` is false.

### `POST /api/schedule-events`
AI-generates calendar events and appends them to the user's schedule.

**Body** `{ userId, startDate?, durationDays?, description?, confirmed? }`

**Response** `{ events, count, saved, startDate, durationDays, requiresConfirmation? }`

### `DELETE /api/schedule-events/:userId`
Clears all scheduled events. Returns `{ success: true }`.

### `GET /api/export/:userId`
Exports a full fitness report.

**Query params:**

| Param | Values | Default | Notes |
|-------|--------|---------|-------|
| `format` | `json`, `csv`, `html` | `json` | Output format |
| `embed` | `true`, `false` | `false` | HTML only — strips `Content-Disposition` header so the page loads inline instead of downloading |

**400** if invalid format. **404** if user not found.

**embed mode example:**
```
GET /api/export/user_123?format=html&embed=true
```
Returns the full interactive HTML report as an inline page — suitable for iframing in a dashboard or linking from another page. Without `embed=true` (the default), the browser treats the response as a file download (`Content-Disposition: attachment`).

### `GET /api/progress/:userId/history`
Returns paginated completion history.

**Query params:**
| Param | Default | Notes |
|-------|---------|-------|
| `page` | `1` | 1-indexed; clamped to `totalPages` |
| `limit` | `20` | Max 100; invalid values fall back to 20 |
| `type` | all | `workout` or `diet` — **400** on other values |
| `sort` | `desc` | `desc` = newest first, `asc` = oldest first — **400** on other values |

**Response:**
```json
{
  "userId": "user_123",
  "history": [{ "type": "workout", "completedAt": "2026-05-01T07:00:00Z", "xpGained": 85, "notes": "..." }],
  "pagination": { "page": 1, "limit": 20, "total": 47, "totalPages": 3, "hasNext": true, "hasPrev": false },
  "summary": { "workoutLogs": 30, "dietLogs": 17, "totalLogs": 47, "filteredTotal": 30 }
}
```
`summary` always shows unfiltered lifetime totals. `filteredTotal` reflects count after type filter.

**404** if no progress record found.

### `PATCH /api/progress/:userId/reminders/read`
Marks reminders as read.

**Body** `{ ids?: string[] }` — omit `ids` to mark all read.

**Response** `{ success: true, markedRead: [...] }`

### `GET /api/openapi.json` / `GET /api/openapi.yaml`
Returns the OpenAPI 3.1 spec. Both endpoints set `Access-Control-Allow-Origin: *` for ChatGPT import.

### `GET /api/system-prompt`
Returns ready-to-paste system prompts and configuration for all three AI integrations (ChatGPT, Claude, GitHub Copilot). See section 9 for details.

### `POST /api/mcp`
MCP JSON-RPC endpoint (StreamableHTTP transport). Returns SSE. See section 8 for tools.

---

## 8. MCP Tools Reference

The MCP server at `POST /api/mcp` implements the Model Context Protocol (StreamableHTTP). Claude and GitHub Copilot send JSON-RPC requests; responses are Server-Sent Events (SSE). All 8 tools are discoverable via `tools/list`.

**Protocol example:**
```http
POST /api/mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

### `get_state`
Full user state in one call.
**Input** `{ userId }` | **Output** — full state object.

### `save_state`
Upsert any combination of profile, diet plan, workout plan, schedule.
**Input** `{ userId, profile?, dietPlan?, workoutPlan?, schedule? }` | **Output** `{ success, userId, updatedAt }`.

### `log_completion`
Log a workout or diet session; runs full gamification pipeline.
**Input** `{ userId, type: "workout"|"diet", notes? }` | **Output** — xpGained, totalXp, streak, level, leveledUp, newAchievements, message.

### `normalize_user_input`
Parse freeform text → structured profile patch.
**Input** `{ input, userId? }` | **Output** — extracted profile fields, confidence, notes.

### `generate_plan`
AI-generate a workout or diet plan.
**Input** `{ userId, type: "diet"|"workout", confirmed? }` | **Output** — plan, saved, requiresConfirmation?.

### `schedule_events`
AI-generate and save calendar events.
**Input** `{ userId, description?, startDate?, durationDays?, confirmed? }` | **Output** — events, count, saved, requiresConfirmation?.

### `get_history`
Paginated completion history with optional type filter and sort order.
**Input** `{ userId, page?, limit?, type?: "workout"|"diet", sort?: "asc"|"desc" }` | **Output:**
```json
{
  "userId": "...",
  "history": [...],
  "pagination": { "page": 1, "limit": 20, "total": 47, "totalPages": 3, "hasNext": true, "hasPrev": false },
  "summary": { "workoutLogs": 30, "dietLogs": 17, "totalLogs": 47, "filteredTotal": 30 }
}
```

### `export_report`
Fitness report with download and embed URLs.
**Input** `{ userId, format?: "json"|"csv"|"html" }` | **Output** — full report object plus:

| Field | Present when | Value |
|-------|-------------|-------|
| `downloadUrl` | Always | `/api/export/{userId}?format={format}` — triggers a file download |
| `embedUrl` | `format=html` only | `/api/export/{userId}?format=html&embed=true` — serves the report as an inline page; suitable for iframes or direct links |

When an AI calls `export_report` with `format="html"`, the response contains both URLs. The AI should share `embedUrl` with the user when they want to view the report in a browser tab or embedded panel, and `downloadUrl` when they want to save the file.

---

## 9. AI Client Integrations

All configuration is available at `GET /api/system-prompt`.

### ChatGPT (Custom GPT Actions)

1. Create a Custom GPT at [chat.openai.com](https://chat.openai.com).
2. Go to **Configure → Actions → Add action**.
3. Set the schema URL to: `https://<your-domain>/api/openapi.json`
4. ChatGPT auto-discovers all 10 REST endpoints.
5. Paste the `chatgpt.prompt` value from `GET /api/system-prompt` as your GPT's System Prompt.

### Claude (MCP via Desktop App or API)

**Claude Desktop config** — add to:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

Claude auto-discovers all 8 MCP tools via `tools/list`. Use the `claude.prompt` from `GET /api/system-prompt` as your project system prompt.

### GitHub Copilot (VS Code MCP)

Two steps:

**Step 1 — VS Code MCP config** (`.vscode/mcp.json` is already in this repo, pointing to `localhost:80` for local dev):
```json
{
  "servers": {
    "fitness-agent": {
      "url": "https://<your-domain>/api/mcp",
      "type": "sse"
    }
  }
}
```
Update the URL to your deployed domain for production use.

**Step 2 — Workspace context** — `.github/copilot-instructions.md` is already in this repo. Copilot Chat automatically reads it as workspace context, giving it full knowledge of the API surface, tools, schema, and conventions without any additional setup.

After connecting, Copilot Chat can call all 8 MCP tools (same as Claude). The `github_copilot.vscode_mcp_config` field in `GET /api/system-prompt` returns the config JSON ready to copy.

---

## 10. Gamification System

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
xpGained = baseXp
         + min(streak - 1, MAX_STREAK_BONUS_DAYS) × XP_STREAK_BONUS_PER_DAY
         + achievement.xpBonus (for each newly unlocked achievement)
         + XP_WEEKLY_BONUS (if current log is the 5th unique active day this week)
```

### Streak Rules
- **Increment** — last log was 20–48 hours ago (yesterday window)
- **Hold** — last log was within the past 20 hours (same day, no double-counting)
- **Reset to 1** — last log was more than 48 hours ago or null (first ever log)

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
The completion history is capped at the last 100 entries (`.slice(-100)`). Achievements are checked before trimming.

---

## 11. OpenAPI Spec

**Location:** `lib/api-spec/openapi.yaml`

**Served at:**
- `GET /api/openapi.json` — parsed to JSON, CORS open
- `GET /api/openapi.yaml` — raw YAML, CORS open

**Paths defined (10):**
`/healthz`, `/state/{userId}`, `/log-completion`, `/normalize`, `/generate-plan`, `/schedule-events`, `/export/{userId}`, `/progress/{userId}/history`, `/progress/{userId}/reminders/read`, `/system-prompt`, `/mcp`

**Tags:** `health`, `state`, `tools`, `history`, `mcp`

**Schemas defined (30):**
`HealthStatus`, `ErrorResponse`, `UserProfile`, `Meal`, `Macros`, `DietPlan`, `WorkoutSession`, `WorkoutPlan`, `ScheduleEvent`, `Schedule`, `Achievement`, `Reminder`, `CompletionEvent`, `Progress`, `FitnessState`, `SaveStateRequest`, `LogCompletionRequest`, `LogCompletionResponse`, `NormalizeRequest`, `NormalizeResponse`, `GeneratePlanRequest`, `GeneratePlanResponse`, `ScheduleEventsRequest`, `ScheduleEventsResponse`, `HistoryPagination`, `HistorySummary`, `HistoryResponse`, `ExportReportProfile`, `ExportReportProgress`, `ExportReportResponse`

**`/export/{userId}` — query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | `json\|csv\|html` | `json` | Output format |
| `embed` | `boolean` | `false` | HTML only — strips `Content-Disposition` so the report loads inline instead of downloading |

**`ExportReportResponse` schema** (returned for `format=json`):

| Field | Type | Always present | Notes |
|-------|------|---------------|-------|
| `exportedAt` | string (date-time) | Yes | |
| `userId` | string | Yes | |
| `profile` | `ExportReportProfile` | Yes | name, goal, age, weightKg, mode |
| `progress` | `ExportReportProgress` | Yes | xp, streak, level, xpToNextLevel, workoutLogs, dietLogs, totalLogs |
| `achievements` | array | Yes | name, description, earnedAt |
| `dietPlan` | object \| null | Yes | dailyCalories, macros |
| `workoutPlan` | object \| null | Yes | sessionCount |
| `schedule` | object \| null | Yes | eventCount |
| `recentHistory` | `CompletionEvent[]` | Yes | Last 10 entries |
| `downloadUrl` | string | Yes | Relative URL — triggers file download |
| `embedUrl` | string \| null | HTML format only | Relative URL with `embed=true` — opens report inline |

**Import into ChatGPT:**
1. Create a Custom GPT → Configure → Actions → Add action
2. Set schema URL: `https://<your-domain>/api/openapi.json`
3. ChatGPT auto-discovers all endpoints

---

## 12. Test Suite

Run: `pnpm --filter @workspace/api-server test`

**Coverage: 19 test files, 340+ tests, all passing.**

### Strategy
- **Unit tests** — pure function tests, no mocking
- **Integration tests** — real PostgreSQL, mocked OpenAI + node-cron, supertest HTTP
- **End-to-end tests** — full user journeys across multiple endpoints

### Mocking
- `node-cron` — `vi.mock` (hoisted) prevents background jobs during tests
- `@workspace/integrations-openai-ai-server` — per-test `mockResolvedValueOnce` for AI responses
- Database — real PostgreSQL; unique `userId` per test, cleaned up in `afterEach`

### Test Files
| File | What it covers |
|------|---------------|
| `unit/gamification.test.ts` | Core functions: computeLevel, streak computation, checkNewAchievements, checkWeeklyBonus, reinforcementMessage |
| `unit/gamification.extended.test.ts` | All 12 achievement unlock paths, XP constants, ACHIEVEMENT_DEFS validation, boundary conditions |
| `integration/health.test.ts` | /healthz, /system-prompt (all three AI sections present, claude mentions get_history, copilot mentions all 8 tools) |
| `integration/state.test.ts` | GET 200/404, PUT create/update |
| `integration/state.extended.test.ts` | All 4 goals, both modes, 13 partial-update scenarios, array fields, type coercions |
| `integration/logCompletion.test.ts` | XP fields, streak=1 on first log, first_workout achievement, accumulation |
| `integration/logCompletion.extended.test.ts` | Streak bonus cap, same-day idempotency, weekly bonus trigger |
| `integration/normalize.test.ts` | /normalize basic flow, rawInput echo, confidence enum |
| `integration/generatePlan.test.ts` | Workout/diet plans, state persistence, confirm mode preview vs save |
| `integration/generatePlan.extended.test.ts` | Plan overwrite, AI error handling, profile edge cases |
| `integration/scheduleEvents.test.ts` | Event generation, accumulation, confirm mode, DELETE |
| `integration/scheduleEvents.extended.test.ts` | Durations (1/7/90 days), startDate, AI errors, DELETE round-trips |
| `integration/export.test.ts` | JSON/CSV formats; HTML structure; paginated log (data blob, all entries embedded, pagination controls, type filter, sort, per-page, embed mode) |
| `integration/progress.test.ts` | PATCH reminders/read, 404, mark-by-id, unread filter in state |
| `integration/progressHistory.test.ts` | Pagination, type filter, sort order, summary accuracy, empty history, combined filters |
| `integration/openapi.test.ts` | /openapi.json (10 paths, schemas), /openapi.yaml (CORS, content, JSON/YAML equivalence) |
| `integration/mcp.test.ts` | MCP protocol, tools/list (8 tools + inputSchemas), 5 core tool calls |
| `integration/mcp.extended.test.ts` | normalize/schedule via MCP, full-data get_state, export formats, save_state, get_history tool (10 scenarios) |
| `integration/workflows.test.ts` | 5 end-to-end journeys (onboarding, confirm mode plans, confirm mode schedule, XP accumulation, reminders) |

---

## 13. Configuration & Environment

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Used for session signing |
| `PORT` | Auto | Assigned by Replit proxy (default 8080) |

### OpenAI Integration
Uses `@workspace/integrations-openai-ai-server` — Replit AI Integrations proxy. No `OPENAI_API_KEY` needed in Replit.

Model: `gpt-5-mini` with `response_format: { type: "json_object" }` on all AI calls.

### node-cron Schedule Strings
| Job | Cron expression |
|-----|----------------|
| Daily missed-workout reminder | `0 20 * * *` |
| Weekly progress report | `0 8 * * 0` |
| Monthly plan renewal | `0 9 1 * *` |

### Build System
esbuild (`build.mjs`): bundles to `dist/index.mjs`, targets Node.js ESM, uses `esbuild-plugin-pino`. Tests run TypeScript source directly via Vitest.

### Key Path Convention
`process.cwd()` in both production and tests = `artifacts/api-server/`.
OpenAI YAML path: `resolve(process.cwd(), "../../lib/api-spec/openapi.yaml")`.
