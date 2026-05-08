# Fitness Agent MCP

A zero-dependency Express API that acts as a universal fitness intelligence layer for AI assistants. Claude, ChatGPT, and GitHub Copilot all share the same state, gamification engine, and data. Claude and Copilot via the built-in MCP server, ChatGPT via OpenAPI Custom Actions.

**No OpenAI key. No database server. One deployed URL.**

---

## Table of Contents

1. [What This Does](#1-what-this-does)
2. [Architecture](#2-architecture)
3. [Local Setup](#3-local-setup)
4. [Deploy to Railway](#4-deploy-to-railway)
5. [Connecting AI Clients](#5-connecting-ai-clients)
6. [MCP Tools](#6-mcp-tools)
7. [Security Notes](#7-security-notes)
8. [Environment Variables](#8-environment-variables)

---

## 1. What This Does

One server, three AI surfaces:

| AI Client | Protocol | How it connects |
|-----------|----------|----------------|
| Claude Desktop / claude.ai | MCP (StreamableHTTP) | Calls `/api/mcp` with JSON-RPC |
| GitHub Copilot Chat | MCP (SSE) | Reads `.vscode/mcp.json`, calls `/api/mcp` |
| ChatGPT Custom GPT | REST / OpenAPI | Reads `/api/openapi.json`, calls REST endpoints |

**Features:** user profiles · workout + diet plans · calendar scheduling · gamification (XP / streaks / 12 achievements) · paginated history · export (JSON / CSV / interactive HTML) · cron reminders

**Design principle:** The server is a pure storage layer. The AI client (Claude, GPT-4, Copilot) reads tool descriptions and generates all structured data itself — diet plans, workout schedules, calendar events — then passes them as parameters. No server-side AI calls. No API keys required.

---

## 2. Architecture

```
Claude / Copilot          ChatGPT Custom GPT
    └─ MCP JSON-RPC ──────┐   └─ REST/OpenAPI ──┐
                          ▼                      ▼
              ┌──────────────────────────────────────┐
              │        Express API  (/api/*)         │
              │                                      │
              │  MCP tools (8)     REST routes       │
              │  get_state         /state            │
              │  save_state        /log-completion   │
              │  log_completion    /normalize        │
              │  normalize_user_input /generate-plan │
              │  generate_plan     /schedule-events  │
              │  schedule_events   /export           │
              │  get_history       /progress/history │
              │  export_report     /healthz          │
              │                                      │
              │  Gamification engine + node-cron     │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │  SQLite (file) │
                        │                │
                        │ user_profiles  │
                        │ diet_plans     │
                        │ workout_plans  │
                        │ schedules      │
                        │ progress       │
                        └────────────────┘
```

Tables are created automatically on first boot via Drizzle migrations — no manual schema push needed.

---

## 3. Local Setup

### Prerequisites

- Node.js 20+
- pnpm 9+

### Install and run

```bash
git clone <your-repo-url>
cd fitness-agent-mcp-v2
pnpm install
```

Copy the example env file (optional — defaults work out of the box):

```bash
cp .env.example .env
```

Start the server:

```bash
pnpm --filter @workspace/api-server run dev
```

The API is at `http://localhost:8080/api`. SQLite database is created automatically at `./artifacts/api-server/data/fitness.db`.

### Verify

```bash
curl http://localhost:8080/api/healthz
# → {"status":"ok"}
```

### Run tests

```bash
pnpm --filter @workspace/api-server test
```

---

## 4. Deploy to Railway

The `railway.toml` at the project root configures everything automatically.

### Steps

1. Push this repo to GitHub
2. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → select repo
3. Dashboard → **Add Volume** → Mount path: `/data`, Size: 1 GB
4. Service → **Variables** → add:

| Key | Value |
|-----|-------|
| `PORT` | `8080` |
| `DB_PATH` | `/data/fitness.db` |

5. Deploy — Railway auto-sets `RAILWAY_PUBLIC_DOMAIN`

### Test

```bash
curl https://your-app.up.railway.app/api/healthz
# → {"status":"ok"}
```

### List on Smithery (optional)

[Smithery.ai](https://smithery.ai) is the MCP marketplace — users can find your server and connect it to Claude with one click.

```bash
npx smithery mcp publish "https://your-app.up.railway.app/api/mcp" \
  -n yourusername/fitness-agent
```

---

## 5. Connecting AI Clients

Once deployed, get your base URL (`https://your-app.up.railway.app`).

### Claude — claude.ai web

1. Settings → **Integrations → Add Custom Integration**
2. Paste: `https://your-app.up.railway.app/api/mcp`
3. Done — syncs to Claude iOS app automatically

### Claude Desktop (manual config)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "fitness-agent": {
      "url": "https://your-app.up.railway.app/api/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Restart Claude Desktop completely after saving.

Get the recommended system prompt:

```bash
curl https://your-app.up.railway.app/api/system-prompt
# → use the claude.prompt value
```

### GitHub Copilot — VS Code

Update `.vscode/mcp.json` with your deployed URL:

```json
{
  "servers": {
    "fitness-agent": {
      "url": "https://your-app.up.railway.app/api/mcp",
      "type": "sse"
    }
  }
}
```

`.github/copilot-instructions.md` is already in the repo — Copilot Chat reads it automatically for full API context.

### ChatGPT — Custom GPT Actions

1. [chat.openai.com](https://chat.openai.com) → profile → **My GPTs → Create → Configure → Actions → Add action**
2. Schema URL: `https://your-app.up.railway.app/api/openapi.json`
3. ChatGPT auto-discovers all REST endpoints
4. Paste the `chatgpt.prompt` value from `GET /api/system-prompt` as your GPT's System Prompt

---

## 6. MCP Tools

All 8 tools are available at `POST /api/mcp` (JSON-RPC, StreamableHTTP).

| Tool | What it does | Who computes the data |
|------|-------------|----------------------|
| `get_state` | Fetch full profile, plans, schedule, progress | — |
| `save_state` | Upsert any section of user state | — |
| `log_completion` | Log workout/diet, award XP + streak | — |
| `normalize_user_input` | Extract profile fields from freeform text | **AI client** passes `extracted` param |
| `generate_plan` | Save a diet or workout plan | **AI client** passes `plan` param |
| `schedule_events` | Save calendar events | **AI client** passes `events` array |
| `get_history` | Paginated completion history | — |
| `export_report` | Report in JSON / CSV / HTML | — |

For `normalize_user_input`, `generate_plan`, and `schedule_events`: the tool description instructs the AI to generate the structured data itself and pass it as a parameter. The server validates and stores it. No server-side AI call is made.

Discover all tools and their input schemas:

```http
POST /api/mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

---

## 7. Security Notes

**Current status: safe for personal use and demos.**

- **No authentication** — any `userId` string can read/write any user's data. For personal use this is fine. For multi-user deployments, add an `x-api-key` header check before going public.
- **Open CORS** — `app.use(cors())` allows all origins. Restrict to your domain in production.
- **No rate limiting** — add `express-rate-limit` if hosting publicly.
- **SQL injection** — safe, Drizzle ORM uses parameterized queries throughout.
- **Secrets** — no hardcoded credentials; all config via environment variables.

---

## 8. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | Server port |
| `DB_PATH` | No | `./data/fitness.db` | SQLite file path — set to `/data/fitness.db` on Railway (volume mount) |
| `PUBLIC_URL` | No | Auto-detected | Base URL for report links — Railway sets this via `RAILWAY_PUBLIC_DOMAIN` automatically |
| `LOG_LEVEL` | No | `info` | Pino log level |
