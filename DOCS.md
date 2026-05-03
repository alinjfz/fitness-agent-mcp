# Fitness Agent MCP — Technical Reference

A zero-dependency Express API acting as a universal fitness intelligence layer for AI assistants. SQLite database, no OpenAI key on the server. Any AI client (Claude, GPT-4, Copilot) reads tool descriptions and generates structured data itself, then submits it as parameters. The server validates and stores.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Design Principles](#2-design-principles)
3. [File Structure](#3-file-structure)
4. [Database Schema](#4-database-schema)
5. [Setup Guide](#5-setup-guide)
6. [REST API Reference](#6-rest-api-reference)
7. [MCP Tools Reference](#7-mcp-tools-reference)
8. [AI Client Integrations](#8-ai-client-integrations)
9. [Gamification System](#9-gamification-system)
10. [OpenAPI Spec](#10-openapi-spec)
11. [Test Suite](#11-test-suite)
12. [Configuration & Environment](#12-configuration--environment)

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          AI Clients                                  │
│                                                                      │
│  Claude (Desktop/claude.ai)   GitHub Copilot Chat   ChatGPT GPT     │
│  └─ MCP StreamableHTTP ───┐   └─ VS Code MCP ────┐  └─ OpenAPI ──┐  │
└───────────────────────────┼─────────────────────┼──────────────┼──┘
                            └──────────┬──────────┘              │
                                       ▼                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Express API  (/api/*)                            │
│                                                                      │
│  MCP Server (/api/mcp, 8 tools)      REST Routes                    │
│  ├─ get_state                        ├─ GET  /healthz                │
│  ├─ save_state                       ├─ GET  /state/:userId          │
│  ├─ log_completion                   ├─ PUT  /state/:userId          │
│  ├─ normalize_user_input             ├─ POST /log-completion         │
│  ├─ generate_plan                    ├─ POST /normalize              │
│  ├─ schedule_events                  ├─ POST /generate-plan          │
│  ├─ get_history                      ├─ POST /schedule-events        │
│  └─ export_report                    ├─ GET  /export/:userId         │
│                                      ├─ GET  /progress/:id/history   │
│  Gamification Engine                 ├─ PATCH /progress/:id/reminders│
│  └─ XP / Streak / Achievements      ├─ GET  /openapi.json           │
│                                      ├─ GET  /openapi.yaml           │
│  node-cron Jobs                      └─ GET  /system-prompt         │
│  ├─ Daily: missed workout reminders                                  │
│  ├─ Weekly: progress summaries                                       │
│  └─ Monthly: plan renewal nudges                                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   SQLite (file)      │
                    │                      │
                    │  user_profiles       │
                    │  diet_plans          │
                    │  workout_plans       │
                    │  schedules           │
                    │  progress            │
                    └──────────────────────┘
```

**Database** — better-sqlite3 via Drizzle ORM. Migrations run automatically on startup (`migrate()` in `lib/db/src/index.ts`). No migration commands needed.

**State isolation** — all data is scoped by `userId` (text). No authentication by default; appropriate for personal use or demos.

---

## 2. Design Principles

### Server as pure storage layer

The three "generation" tools (`normalize_user_input`, `generate_plan`, `schedule_events`) no longer call any AI on the server. Instead:

1. The tool description instructs the AI client to generate the structured data itself.
2. The AI passes its result as a parameter (`extracted`, `plan`, `events`).
3. The server validates the parameter schema and saves to SQLite.

This means **no `OPENAI_API_KEY` required** on the server. Any AI client that can read tool descriptions (Claude, GPT-4, Copilot, etc.) works out of the box.

### Confirm mode

Set `profile.mode = "confirm"` and mutation tools return a preview with `requiresConfirmation: true, saved: false`. Re-send with `confirmed: true` to commit. Applies to `generate_plan` and `schedule_events`.

### Tool descriptions as prompt engineering

Tool descriptions contain full schema definitions, unit conversion rules, and generation instructions. Any AI that reads the description before calling the tool will produce correctly structured data without any additional system prompt.

---

## 3. File Structure

```
fitness-agent-mcp-v2/
├── .github/
│   └── copilot-instructions.md        # Workspace context for GitHub Copilot Chat
├── .vscode/
│   └── mcp.json                       # VS Code MCP config (points to /api/mcp)
├── railway.toml                       # Railway build + deploy config
├── .env.example                       # Local dev env template
│
├── artifacts/
│   └── api-server/                    # Main Express API (@workspace/api-server)
│       ├── build.mjs                  # esbuild config — bundles + copies migrations to dist/
│       ├── src/
│       │   ├── app.ts                 # Express app setup, middleware, route mount
│       │   ├── index.ts               # Server entry point (listen on PORT)
│       │   ├── routes/
│       │   │   ├── index.ts           # Assembles all routers
│       │   │   ├── health.ts          # GET /healthz
│       │   │   ├── state.ts           # GET/PUT /state/:userId
│       │   │   ├── logCompletion.ts   # POST /log-completion
│       │   │   ├── normalize.ts       # POST /normalize (REST version)
│       │   │   ├── generatePlan.ts    # POST /generate-plan (REST version)
│       │   │   ├── scheduleEvents.ts  # POST/DELETE /schedule-events (REST version)
│       │   │   ├── export.ts          # GET /export/:userId?format=json|csv|html
│       │   │   ├── progress.ts        # PATCH /progress/:userId/reminders/read
│       │   │   ├── progressHistory.ts # GET /progress/:userId/history (paginated)
│       │   │   ├── updateProfile.ts   # PATCH /profile/:userId
│       │   │   ├── openapi.ts         # GET /openapi.json, GET /openapi.yaml
│       │   │   ├── systemPrompt.ts    # GET /system-prompt (all 3 AI configs)
│       │   │   └── mcp.ts             # POST /mcp — MCP StreamableHTTP, 8 tools
│       │   └── lib/
│       │       ├── gamification.ts    # XP, streak, achievements, messages
│       │       ├── cron.ts            # node-cron scheduled jobs
│       │       └── logger.ts          # pino singleton
│       └── src/__tests__/
│           ├── helpers.ts
│           ├── unit/
│           └── integration/
│
├── lib/
│   ├── db/                            # @workspace/db — Drizzle ORM + SQLite
│   │   ├── drizzle.config.ts          # dialect: sqlite, default path
│   │   ├── migrations/                # Generated SQL migrations (committed to repo)
│   │   └── src/
│   │       ├── index.ts               # db singleton + auto-migrate on startup
│   │       └── schema/
│   │           ├── fitness.ts         # user_profiles, diet_plans, workout_plans, schedules, progress
│   │           ├── conversations.ts
│   │           └── messages.ts
│   ├── api-spec/
│   │   └── openapi.yaml              # Hand-authored OpenAPI 3.1 spec
│   └── api-zod/                       # Generated Zod schemas
│
├── pnpm-workspace.yaml               # Workspace catalog + overrides
├── tsconfig.base.json
└── tsconfig.json
```

---

## 4. Database Schema

All tables use `userId` (text) as the primary key. Tables are created automatically on first startup via `migrate()`.

### `user_profiles`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | Provided by the AI/client |
| `name` | text | |
| `age` | integer | |
| `weightKg` | real | kg |
| `heightCm` | real | cm |
| `goal` | text | `lose_weight` · `build_muscle` · `maintain` · `improve_endurance` |
| `allergies` | text (JSON) | `string[]` |
| `preferences` | text (JSON) | `string[]` |
| `budgetPerWeek` | real | USD, optional |
| `availableDays` | text (JSON) | `string[]` of day names |
| `sessionDurationMin` | integer | |
| `equipment` | text (JSON) | `string[]` |
| `injuries` | text (JSON) | `string[]` |
| `mode` | text | `auto` (default) or `confirm` |
| `createdAt` / `updatedAt` | integer (timestamp) | Stored as Unix ms |

### `diet_plans`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | |
| `meals` | text (JSON) | `{ name, time, calories, protein, carbs, fat, ingredients[] }[]` |
| `dailyCalories` | integer | |
| `macros` | text (JSON) | `{ proteinG, carbsG, fatG }` |
| `notes` | text | |
| `updatedAt` | integer (timestamp) | |

### `workout_plans`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | |
| `sessions` | text (JSON) | `{ day, name, durationMin, exercises: { name, sets, reps, restSec }[] }[]` |
| `notes` | text | |
| `updatedAt` | integer (timestamp) | |

### `schedules`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | |
| `events` | text (JSON) | `{ title, date, time, type, durationMin }[]` — accumulates across calls |
| `updatedAt` | integer (timestamp) | |

### `progress`
| Column | Type | Notes |
|--------|------|-------|
| `userId` | text PK | |
| `xp` | integer | Cumulative XP |
| `streak` | integer | Consecutive-day streak |
| `level` | integer | Derived from XP, cached |
| `history` | text (JSON) | `CompletionEvent[]`, capped at 100 |
| `achievements` | text (JSON) | `Achievement[]` — earned only |
| `reminders` | text (JSON) | `Reminder[]` — includes `read` flag |
| `lastLoggedAt` | integer (timestamp) | For streak computation |
| `updatedAt` | integer (timestamp) | |

---

## 5. Setup Guide

### Local development

```bash
# Install
pnpm install

# Optional: copy env template
cp .env.example .env

# Start (builds + runs, SQLite auto-created)
pnpm --filter @workspace/api-server run dev

# Test
pnpm --filter @workspace/api-server test
```

No `DATABASE_URL`. No `OPENAI_API_KEY`. The SQLite file is created at `./artifacts/api-server/data/fitness.db` (git-ignored).

### Railway deployment

See `railway.toml` — Railway reads it automatically.

```
1. Push to GitHub
2. Railway → New Project → Deploy from GitHub → select repo
3. Add Volume: mount /data, 1 GB
4. Variables: PORT=8080, DB_PATH=/data/fitness.db
5. Deploy
```

`RAILWAY_PUBLIC_DOMAIN` is set automatically by Railway and used to build full report URLs in `export_report`.

---

## 6. REST API Reference

All routes under `/api`. JSON in, JSON out unless noted.

### `GET /api/healthz`
```json
{ "status": "ok" }
```

### `GET /api/state/:userId`
Full state: profile, dietPlan, workoutPlan, schedule, progress. **404** if userId not found.

### `PUT /api/state/:userId`
Upsert any combination of profile / dietPlan / workoutPlan / schedule. All fields optional — only provided sections are written.

### `POST /api/log-completion`
**Body** `{ userId, type: "workout"|"diet", notes? }`

**Response** `{ xpGained, totalXp, streak, level, leveledUp, xpToNextLevel, message, newAchievements? }`

### `POST /api/normalize`
Extracts structured profile fields from freeform text. The REST version still accepts unstructured input — structured extraction happens server-side for REST callers.

**Body** `{ input: string, userId? }`

**Response** `{ extracted: { profile: {...} }, rawInput, confidence: "high"|"medium"|"low", notes }`

### `POST /api/generate-plan`
**Body** `{ userId, type: "workout"|"diet", confirmed? }`

**Response** `{ plan, saved: boolean, requiresConfirmation? }`

### `POST /api/schedule-events`
**Body** `{ userId, startDate?, durationDays?, description?, confirmed? }`

**Response** `{ events, count, saved, startDate, durationDays, requiresConfirmation? }`

### `DELETE /api/schedule-events/:userId`
Clears all events. Returns `{ success: true }`.

### `GET /api/export/:userId`
**Query params:**

| Param | Values | Default | Notes |
|-------|--------|---------|-------|
| `format` | `json`, `csv`, `html` | `json` | Output format |
| `embed` | `true`, `false` | `false` | HTML only — strips `Content-Disposition` for inline display |

### `GET /api/progress/:userId/history`
**Query params:** `page` (default 1) · `limit` (default 20, max 100) · `type=workout|diet` · `sort=asc|desc` (default desc)

**Response:**
```json
{
  "userId": "...",
  "history": [...],
  "pagination": { "page": 1, "limit": 20, "total": 47, "totalPages": 3, "hasNext": true, "hasPrev": false },
  "summary": { "workoutLogs": 30, "dietLogs": 17, "totalLogs": 47, "filteredTotal": 30 }
}
```

### `PATCH /api/progress/:userId/reminders/read`
**Body** `{ ids?: string[] }` — omit to mark all read.

### `GET /api/openapi.json` / `GET /api/openapi.yaml`
OpenAPI 3.1 spec with `Access-Control-Allow-Origin: *`.

### `GET /api/system-prompt`
Returns ready-to-use system prompts and config for ChatGPT, Claude, and Copilot.

### `POST /api/mcp`
MCP JSON-RPC endpoint (StreamableHTTP). See section 7.

---

## 7. MCP Tools Reference

The MCP server at `POST /api/mcp` uses the Model Context Protocol StreamableHTTP transport. All 8 tools are discoverable via `tools/list`.

**Discovery:**
```http
POST /api/mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

---

### `get_state`
Full user state in one call.

**Input:** `{ userId: string }`

**Output:** `{ profile, dietPlan, workoutPlan, schedule, progress }` — all sections, null where not yet set.

---

### `save_state`
Upsert any combination of profile, diet plan, workout plan, schedule.

**Input:** `{ userId, profile?, dietPlan?, workoutPlan?, schedule? }`

**Output:** `{ success: true, userId, updatedAt }`

---

### `log_completion`
Log a workout or diet session. Runs full gamification pipeline (XP, streak, achievements, weekly bonus).

**Input:** `{ userId, type: "workout"|"diet", notes? }`

**Output:** `{ xpGained, totalXp, streak, level, leveledUp, xpToNextLevel, message, newAchievements? }`

---

### `normalize_user_input`
**The AI extracts profile data from the input text itself, then calls this tool with the result.**

**Input:**
```typescript
{
  input: string,                  // raw user text
  extracted?: {                   // YOU fill this in — extracted profile fields
    name?: string,
    age?: integer,
    weightKg?: number,            // convert lbs ÷ 2.205
    heightCm?: number,            // convert ft/in: feet×30.48 + inches×2.54
    goal?: "lose_weight"|"build_muscle"|"maintain"|"improve_endurance",
    allergies?: string[],
    preferences?: string[],
    budgetPerWeek?: number,
    availableDays?: ("monday"|...|"sunday")[],
    sessionDurationMin?: integer,
    equipment?: string[],
    injuries?: string[],
    mode?: "auto"|"confirm",
    confidence?: "high"|"medium"|"low",
    notes?: string
  },
  userId?: string                 // optional — used to load existing profile for context
}
```

**Behavior:**
- `extracted` provided → validates and returns it
- `extracted` missing → returns schema + existing profile context, instructs retry

---

### `generate_plan`
**The AI generates the plan itself, then calls this tool with the result.**

**Input:**
```typescript
{
  userId: string,
  type: "diet"|"workout",
  plan?: {
    // diet: meals, dailyCalories, macros, notes
    meals?: { name, time, calories, protein, carbs, fat, ingredients[] }[],
    dailyCalories?: number,
    macros?: { proteinG, carbsG, fatG },
    // workout: sessions, notes
    sessions?: { day, name, durationMin, exercises: { name, sets, reps, restSec }[] }[],
    notes?: string
  },
  confirmed?: boolean             // set true to save in confirm mode
}
```

**Behavior:**
- `plan` provided → confirm-mode check → save to DB
- `plan` missing → returns profile context + schemas for retry
- confirm mode without `confirmed: true` → returns `{ plan, saved: false, requiresConfirmation: true }`

---

### `schedule_events`
**The AI generates the events array itself, then calls this tool with the result.**

**Input:**
```typescript
{
  userId: string,
  events?: {
    title: string,
    date: string,          // "YYYY-MM-DD"
    time: string,          // "HH:MM" (24h)
    type: "workout"|"meal"|"check_in",
    durationMin: number
  }[],
  mode?: "append"|"replace",     // default: "append"
  description?: string,
  startDate?: string,            // "YYYY-MM-DD"
  durationDays?: number,
  confirmed?: boolean
}
```

**Behavior:**
- `events` provided, `mode=append` → appends to existing events → saves
- `events` provided, `mode=replace` → overwrites all events → saves
- `events` missing → returns profile/workoutPlan context + event schema for retry

---

### `get_history`
Paginated completion history.

**Input:** `{ userId, page?, limit?, type?: "workout"|"diet", sort?: "asc"|"desc" }`

**Output:**
```json
{
  "userId": "...",
  "history": [{ "type": "workout", "completedAt": "...", "xpGained": 85, "notes": "..." }],
  "pagination": { "page": 1, "limit": 20, "total": 47, "totalPages": 3, "hasNext": true, "hasPrev": false },
  "summary": { "workoutLogs": 30, "dietLogs": 17, "totalLogs": 47, "filteredTotal": 30 }
}
```

---

### `export_report`
Full fitness report with download/embed URLs.

**Input:** `{ userId, format?: "json"|"csv"|"html" }`

**Output:** full report object plus:
- `downloadUrl` — triggers file download
- `embedUrl` (HTML only) — serves report inline; suitable for direct links or iframes

---

## 8. AI Client Integrations

All configs available at `GET /api/system-prompt`.

### Claude

**claude.ai web** — Settings → Integrations → Add Custom Integration → paste `/api/mcp` URL.

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "fitness-agent": {
      "url": "https://your-domain.com/api/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Use the `claude.prompt` from `/api/system-prompt` as your project system prompt.

### GitHub Copilot

`.vscode/mcp.json`:
```json
{
  "servers": {
    "fitness-agent": {
      "url": "https://your-domain.com/api/mcp",
      "type": "sse"
    }
  }
}
```

`.github/copilot-instructions.md` is already in the repo — Copilot reads it automatically.

### ChatGPT

1. Create a Custom GPT → Configure → Actions → Add action
2. Schema URL: `https://your-domain.com/api/openapi.json`
3. System Prompt: use `chatgpt.prompt` from `/api/system-prompt`

---

## 9. Gamification System

Defined in `artifacts/api-server/src/lib/gamification.ts`.

### XP Constants
| Constant | Value | Description |
|----------|-------|-------------|
| `XP_WORKOUT` | 50 | Base XP per workout |
| `XP_DIET` | 30 | Base XP per diet log |
| `XP_STREAK_BONUS_PER_DAY` | 5 | Bonus per streak day |
| `MAX_STREAK_BONUS_DAYS` | 10 | Streak bonus cap (max +50 XP) |
| `XP_WEEKLY_BONUS` | 100 | Bonus for 5th unique active day in a week |
| `XP_PER_LEVEL` | 500 | XP to advance one level |

### XP Calculation
```
xpGained = baseXp
         + min(streak - 1, MAX_STREAK_BONUS_DAYS) × XP_STREAK_BONUS_PER_DAY
         + sum(achievement.xpBonus for each newly unlocked)
         + XP_WEEKLY_BONUS (if 5th unique active day this week)
```

### Streak Rules
- **Increment** — last log was 20–48 hours ago (yesterday window)
- **Hold** — last log was < 20 hours ago (same day, no double-count)
- **Reset to 1** — last log > 48 hours ago or null

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

### node-cron Jobs
| Job | Schedule | Action |
|-----|----------|--------|
| Missed workout reminder | `0 20 * * *` (daily 20:00) | Reminder for users who haven't logged today |
| Weekly progress report | `0 8 * * 0` (Sunday 08:00) | Weekly XP/streak summary |
| Monthly plan renewal | `0 9 1 * *` (1st of month 09:00) | Nudge if plan > 30 days old |

---

## 10. OpenAPI Spec

**Source:** `lib/api-spec/openapi.yaml`

**Served at:** `GET /api/openapi.json` and `GET /api/openapi.yaml` — both with `Access-Control-Allow-Origin: *`

**Paths:** `/healthz` · `/state/{userId}` · `/log-completion` · `/normalize` · `/generate-plan` · `/schedule-events` · `/export/{userId}` · `/progress/{userId}/history` · `/progress/{userId}/reminders/read` · `/system-prompt` · `/mcp`

**Key schemas:** `UserProfile` · `DietPlan` · `WorkoutPlan` · `ScheduleEvent` · `Progress` · `CompletionEvent` · `Achievement` · `FitnessState` · `LogCompletionResponse` · `HistoryResponse` · `ExportReportResponse`

---

## 11. Test Suite

```bash
pnpm --filter @workspace/api-server test
```

**Coverage: 19 test files, 340+ tests.**

### Strategy
- **Unit** — pure function tests (gamification math, achievement logic)
- **Integration** — real SQLite, supertest HTTP, mocked node-cron
- **End-to-end** — full user journeys across multiple endpoints

### Test Files
| File | Covers |
|------|--------|
| `unit/gamification.test.ts` | computeLevel, streak, checkNewAchievements, reinforcementMessage |
| `unit/gamification.extended.test.ts` | All 12 achievement paths, XP constants, boundary conditions |
| `integration/health.test.ts` | /healthz, /system-prompt (all 3 AI sections) |
| `integration/state.test.ts` | GET/PUT state, 404 |
| `integration/state.extended.test.ts` | All 4 goals, both modes, 13 partial-update scenarios |
| `integration/logCompletion.test.ts` | XP, streak=1 on first log, achievements |
| `integration/logCompletion.extended.test.ts` | Streak bonus cap, same-day idempotency, weekly bonus |
| `integration/normalize.test.ts` | /normalize basic flow, confidence enum |
| `integration/generatePlan.test.ts` | Workout/diet plans, confirm mode |
| `integration/generatePlan.extended.test.ts` | Plan overwrite, AI error handling |
| `integration/scheduleEvents.test.ts` | Event generation, accumulation, confirm mode, DELETE |
| `integration/scheduleEvents.extended.test.ts` | Durations, startDate, AI errors |
| `integration/export.test.ts` | JSON/CSV/HTML formats, embed mode, paginated log |
| `integration/progress.test.ts` | PATCH reminders/read, mark-by-id |
| `integration/progressHistory.test.ts` | Pagination, type filter, sort, summary accuracy |
| `integration/openapi.test.ts` | /openapi.json paths + schemas, /openapi.yaml equivalence |
| `integration/mcp.test.ts` | tools/list (8 tools + schemas), 5 core tool calls |
| `integration/mcp.extended.test.ts` | All 8 tools, get_history 10 scenarios |
| `integration/workflows.test.ts` | 5 end-to-end journeys (onboarding, confirm mode, XP accumulation) |

---

## 12. Configuration & Environment

### Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | Server port |
| `DB_PATH` | No | `./data/fitness.db` (relative to CWD) | SQLite file path. Set to `/data/fitness.db` on Railway |
| `PUBLIC_URL` | No | Auto-detected | Base URL for report links. Railway sets `RAILWAY_PUBLIC_DOMAIN` automatically |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `NODE_ENV` | No | — | Set to `production` on hosted deployments |

### Build System
esbuild (`build.mjs`): bundles `src/` → `dist/index.mjs` (ESM, Node 20 target). After bundling, copies `lib/db/migrations/` to `dist/migrations/` so the production binary can run auto-migrations without the source tree.

### Drizzle Migrations
Generated migrations are committed to `lib/db/migrations/`. They are copied into `dist/migrations/` at build time. `migrate()` in `lib/db/src/index.ts` applies them on every startup — no-op after first run.

To regenerate (dev only, not needed by end users):
```bash
pnpm --filter @workspace/db run generate
```
