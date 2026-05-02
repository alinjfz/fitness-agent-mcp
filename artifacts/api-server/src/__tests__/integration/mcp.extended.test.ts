import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import {
  uid,
  createTestUser,
  cleanupTestUser,
  parseSseData,
  makeOpenAIChoice,
  MOCK_NORMALIZE_RESPONSE,
  MOCK_SCHEDULE_RESPONSE,
  MOCK_DIET_PLAN_RESPONSE,
} from "../helpers.js";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, progress, dietPlans, workoutPlans, schedules } from "@workspace/db";
import { XP_WORKOUT, XP_DIET } from "../../lib/gamification.js";

const request = supertest(app);
const mockCreate = vi.mocked(openai.chat.completions.create);

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

async function mcpCall(method: string, params: Record<string, unknown> = {}, id = 1) {
  return request
    .post("/api/mcp")
    .set(MCP_HEADERS)
    .send({ jsonrpc: "2.0", id, method, params });
}

let userId: string;

beforeEach(async () => {
  userId = uid("mcpext");
  await createTestUser(userId);
});

afterEach(async () => {
  await cleanupTestUser(userId);
  vi.clearAllMocks();
});

describe("MCP tools/call — normalize_user_input", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_NORMALIZE_RESPONSE) as never);
  });

  it("returns extracted profile data", async () => {
    const res = await mcpCall("tools/call", {
      name: "normalize_user_input",
      arguments: { input: "I'm Jane, I want to build muscle, I can train Mon Wed Fri" },
    });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      extracted: { profile: { goal: string } };
      confidence: string;
    };
    expect(content.extracted.profile.goal).toBe("build_muscle");
    expect(content.confidence).toBe("high");
  });

  it("returns rawInput in the response", async () => {
    const input = "I want to lose weight";
    const res = await mcpCall("tools/call", {
      name: "normalize_user_input",
      arguments: { input },
    });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { rawInput: string };
    expect(content.rawInput).toBe(input);
  });

  it("accepts optional userId for context", async () => {
    const res = await mcpCall("tools/call", {
      name: "normalize_user_input",
      arguments: { input: "I now train on Saturdays too", userId },
    });
    expect(res.status).toBe(200);
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    expect(data).not.toBeNull();
  });
});

describe("MCP tools/call — schedule_events", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_SCHEDULE_RESPONSE) as never);
  });

  it("returns events and count", async () => {
    const res = await mcpCall("tools/call", {
      name: "schedule_events",
      arguments: { userId, description: "schedule workouts for 2 weeks", durationDays: 14 },
    });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      events: unknown[];
      count: number;
      saved: boolean;
    };
    expect(Array.isArray(content.events)).toBe(true);
    expect(content.count).toBe(content.events.length);
    expect(content.saved).toBe(true);
  });

  it("returns 404-equivalent error for unknown user", async () => {
    const res = await mcpCall("tools/call", {
      name: "schedule_events",
      arguments: { userId: "unknown_mcp_sched_xyz" },
    });
    const data = parseSseData(res.text) as { result: { content: { text: string }[]; isError?: boolean } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { error: string };
    expect(content.error).toBeTruthy();
  });
});

describe("MCP tools/call — get_state with full data", () => {
  beforeEach(async () => {
    const now = new Date();
    await Promise.all([
      db.insert(dietPlans).values({
        userId,
        meals: MOCK_DIET_PLAN_RESPONSE.meals,
        dailyCalories: MOCK_DIET_PLAN_RESPONSE.dailyCalories,
        macros: MOCK_DIET_PLAN_RESPONSE.macros,
        notes: "Seeded diet plan",
        updatedAt: now,
      }),
      db.insert(schedules).values({
        userId,
        events: MOCK_SCHEDULE_RESPONSE.events,
        updatedAt: now,
      }),
      db.insert(progress).values({
        userId,
        xp: 350,
        streak: 4,
        level: 1,
        history: [{ type: "workout", completedAt: now.toISOString(), xpGained: 60 }],
        achievements: [{ id: "first_workout", name: "First Rep", description: "...", earnedAt: now.toISOString(), xpBonus: 100 }],
        reminders: [{ id: "r1", message: "Unread reminder", type: "missed_workout", createdAt: now.toISOString(), read: false }],
        lastLoggedAt: now,
        updatedAt: now,
      }),
    ]);
  });

  it("returns all sections when all data is present", async () => {
    const res = await mcpCall("tools/call", { name: "get_state", arguments: { userId } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const state = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      profile: object;
      dietPlan: object;
      workoutPlan: object | null;
      schedule: object;
      progress: object;
    };
    expect(state.profile).not.toBeNull();
    expect(state.dietPlan).not.toBeNull();
    expect(state.schedule).not.toBeNull();
    expect(state.progress).not.toBeNull();
  });

  it("progress includes achievements array", async () => {
    const res = await mcpCall("tools/call", { name: "get_state", arguments: { userId } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const state = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      progress: { achievements: unknown[]; xp: number };
    };
    expect(Array.isArray(state.progress.achievements)).toBe(true);
    expect(state.progress.xp).toBe(350);
  });

  it("only unread reminders are returned in progress", async () => {
    const res = await mcpCall("tools/call", { name: "get_state", arguments: { userId } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const state = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      progress: { reminders: { read: boolean }[] };
    };
    expect(state.progress.reminders.every((r) => !r.read)).toBe(true);
  });
});

describe("MCP tools/call — export_report formats", () => {
  beforeEach(async () => {
    await db.insert(progress).values({
      userId,
      xp: 100,
      streak: 1,
      level: 1,
      history: [],
      achievements: [],
      reminders: [],
      lastLoggedAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("returns downloadUrl with correct userId for json", async () => {
    const res = await mcpCall("tools/call", { name: "export_report", arguments: { userId, format: "json" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { downloadUrl: string };
    expect(content.downloadUrl).toContain(userId);
    expect(content.downloadUrl).toContain("format=json");
  });

  it("returns downloadUrl for csv format", async () => {
    const res = await mcpCall("tools/call", { name: "export_report", arguments: { userId, format: "csv" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { downloadUrl: string };
    expect(content.downloadUrl).toContain("format=csv");
  });

  it("html format includes embedUrl pointing to embed=true endpoint", async () => {
    const res = await mcpCall("tools/call", { name: "export_report", arguments: { userId, format: "html" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { downloadUrl: string; embedUrl: string };
    expect(content.downloadUrl).toContain("format=html");
    expect(content.embedUrl).toContain(userId);
    expect(content.embedUrl).toContain("format=html");
    expect(content.embedUrl).toContain("embed=true");
  });

  it("json format does not include embedUrl", async () => {
    const res = await mcpCall("tools/call", { name: "export_report", arguments: { userId, format: "json" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
    expect(content).not.toHaveProperty("embedUrl");
  });

  it("csv format does not include embedUrl", async () => {
    const res = await mcpCall("tools/call", { name: "export_report", arguments: { userId, format: "csv" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
    expect(content).not.toHaveProperty("embedUrl");
  });

  it("default format (json) does not include embedUrl", async () => {
    const res = await mcpCall("tools/call", { name: "export_report", arguments: { userId } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
    expect(content).not.toHaveProperty("embedUrl");
  });

  it("report contains correct level", async () => {
    const res = await mcpCall("tools/call", { name: "export_report", arguments: { userId } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      progress: { level: number; xp: number };
    };
    expect(content.progress.xp).toBe(100);
    expect(content.progress.level).toBeGreaterThanOrEqual(1);
  });

  it("returns error for unknown user", async () => {
    const res = await mcpCall("tools/call", { name: "export_report", arguments: { userId: "unknown_export_mcp" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[]; isError?: boolean } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { error: string };
    expect(content.error).toBeTruthy();
  });
});

describe("MCP tools/call — save_state extended", () => {
  it("saves diet plan via MCP and verifies via REST", async () => {
    const newUserId = uid("mcp_save_diet");
    try {
      await mcpCall("tools/call", {
        name: "save_state",
        arguments: {
          userId: newUserId,
          profile: { name: "MCP Save User", goal: "lose_weight", allergies: [], preferences: [], availableDays: ["monday"], equipment: [], injuries: [], mode: "auto" },
          dietPlan: {
            meals: MOCK_DIET_PLAN_RESPONSE.meals,
            dailyCalories: 1800,
            macros: { proteinG: 120, carbsG: 180, fatG: 55 },
          },
        },
      });
      const stateRes = await request.get(`/api/state/${newUserId}`);
      expect(stateRes.body.dietPlan).not.toBeNull();
      expect(stateRes.body.dietPlan.dailyCalories).toBe(1800);
    } finally {
      await cleanupTestUser(newUserId);
    }
  });

  it("saves workout plan and schedule in one call", async () => {
    const newUserId = uid("mcp_save_wp");
    try {
      await mcpCall("tools/call", {
        name: "save_state",
        arguments: {
          userId: newUserId,
          profile: { name: "WP User", goal: "build_muscle", allergies: [], preferences: [], availableDays: ["monday", "wednesday"], equipment: ["dumbbells"], injuries: [], mode: "auto" },
          workoutPlan: { sessions: [{ day: "monday", name: "Push", durationMin: 45, exercises: [] }] },
          schedule: { events: [{ title: "Push", date: "2026-06-02", time: "07:00", type: "workout", durationMin: 45 }] },
        },
      });
      const stateRes = await request.get(`/api/state/${newUserId}`);
      expect(stateRes.body.workoutPlan).not.toBeNull();
      expect(stateRes.body.schedule).not.toBeNull();
    } finally {
      await cleanupTestUser(newUserId);
    }
  });
});

describe("MCP tools/call — get_history", () => {
  beforeEach(async () => {
    const mixed = [
      ...Array.from({ length: 15 }, (_, i) => ({
        type: "workout" as const,
        completedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
        xpGained: XP_WORKOUT,
        notes: `Workout ${i + 1}`,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        type: "diet" as const,
        completedAt: new Date(Date.now() - (i + 15) * 24 * 60 * 60 * 1000).toISOString(),
        xpGained: XP_DIET,
      })),
    ];
    await db.insert(progress).values({
      userId,
      xp: 1050,
      streak: 7,
      level: 3,
      history: mixed,
      achievements: [],
      reminders: [],
      lastLoggedAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("returns 200 with history, pagination, and summary", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      history: unknown[];
      pagination: { total: number; page: number; limit: number };
      summary: { totalLogs: number };
    };
    expect(Array.isArray(content.history)).toBe(true);
    expect(content.pagination).toHaveProperty("total");
    expect(content.summary.totalLogs).toBe(25);
  });

  it("returns error for unknown user", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId: "unknown_hist_mcp_xyz" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[]; isError?: boolean } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { error: string };
    expect(content.error).toBeTruthy();
  });

  it("respects limit parameter", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId, limit: 5 } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      history: unknown[];
      pagination: { limit: number };
    };
    expect(content.history.length).toBeLessThanOrEqual(5);
    expect(content.pagination.limit).toBe(5);
  });

  it("filters by type=workout", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId, type: "workout", limit: 50 } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      history: { type: string }[];
      pagination: { total: number };
    };
    expect(content.history.every((h) => h.type === "workout")).toBe(true);
    expect(content.pagination.total).toBe(15);
  });

  it("filters by type=diet", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId, type: "diet", limit: 50 } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      history: { type: string }[];
      pagination: { total: number };
    };
    expect(content.history.every((h) => h.type === "diet")).toBe(true);
    expect(content.pagination.total).toBe(10);
  });

  it("summary.workoutLogs and dietLogs are always unfiltered", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId, type: "workout" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      summary: { workoutLogs: number; dietLogs: number; totalLogs: number };
    };
    expect(content.summary.workoutLogs).toBe(15);
    expect(content.summary.dietLogs).toBe(10);
    expect(content.summary.totalLogs).toBe(25);
  });

  it("sort=desc returns newest first", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId, sort: "desc", limit: 5 } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      history: { completedAt: string }[];
    };
    const dates = content.history.map((h) => new Date(h.completedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it("sort=asc returns oldest first", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId, sort: "asc", limit: 5 } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      history: { completedAt: string }[];
    };
    const dates = content.history.map((h) => new Date(h.completedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeLessThanOrEqual(dates[i]);
    }
  });

  it("pagination.hasNext is true when there are more pages", async () => {
    const res = await mcpCall("tools/call", { name: "get_history", arguments: { userId, limit: 10, page: 1 } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      pagination: { hasNext: boolean; hasPrev: boolean; totalPages: number };
    };
    expect(content.pagination.hasNext).toBe(true);
    expect(content.pagination.hasPrev).toBe(false);
    expect(content.pagination.totalPages).toBe(3);
  });

  it("page 2 returns different entries than page 1", async () => {
    const p1 = await mcpCall("tools/call", { name: "get_history", arguments: { userId, limit: 10, page: 1 } });
    const p2 = await mcpCall("tools/call", { name: "get_history", arguments: { userId, limit: 10, page: 2 } });
    const d1 = parseSseData(p1.text) as { result: { content: { text: string }[] } };
    const d2 = parseSseData(p2.text) as { result: { content: { text: string }[] } };
    const c1 = JSON.parse(d1?.result?.content?.[0]?.text ?? "{}") as { history: { completedAt: string }[] };
    const c2 = JSON.parse(d2?.result?.content?.[0]?.text ?? "{}") as { history: { completedAt: string }[] };
    const dates1 = c1.history.map((h) => h.completedAt);
    const dates2 = c2.history.map((h) => h.completedAt);
    expect(dates1.some((d) => dates2.includes(d))).toBe(false);
  });
});

describe("MCP tools/list — schema validation", () => {
  it("generate_plan inputSchema has userId and type", async () => {
    const res = await mcpCall("tools/list");
    const data = parseSseData(res.text) as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } };
    const tool = data?.result?.tools?.find((t) => t.name === "generate_plan");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toHaveProperty("userId");
    expect(tool?.inputSchema.properties).toHaveProperty("type");
  });

  it("log_completion inputSchema has userId and type", async () => {
    const res = await mcpCall("tools/list");
    const data = parseSseData(res.text) as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } };
    const tool = data?.result?.tools?.find((t) => t.name === "log_completion");
    expect(tool?.inputSchema.properties).toHaveProperty("userId");
    expect(tool?.inputSchema.properties).toHaveProperty("type");
  });

  it("schedule_events inputSchema has userId", async () => {
    const res = await mcpCall("tools/list");
    const data = parseSseData(res.text) as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } };
    const tool = data?.result?.tools?.find((t) => t.name === "schedule_events");
    expect(tool?.inputSchema.properties).toHaveProperty("userId");
  });
});
