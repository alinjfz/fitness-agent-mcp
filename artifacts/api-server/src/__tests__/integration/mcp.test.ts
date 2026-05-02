import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import { uid, createTestUser, cleanupTestUser, parseSseData, makeOpenAIChoice, MOCK_WORKOUT_PLAN_RESPONSE } from "../helpers.js";
import { openai } from "@workspace/integrations-openai-ai-server";

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
  userId = uid("mcp");
  await createTestUser(userId);
});

afterEach(async () => {
  await cleanupTestUser(userId);
  vi.clearAllMocks();
});

describe("POST /api/mcp — protocol", () => {
  it("returns 200 for valid JSON-RPC request", async () => {
    const res = await mcpCall("tools/list");
    expect(res.status).toBe(200);
  });

  it("GET /api/mcp returns 405", async () => {
    const res = await request.get("/api/mcp");
    expect(res.status).toBe(405);
  });
});

describe("POST /api/mcp — tools/list", () => {
  it("returns all 7 tools", async () => {
    const res = await mcpCall("tools/list");
    const data = parseSseData(res.text) as { result: { tools: { name: string }[] } };
    expect(data).not.toBeNull();
    const tools = data?.result?.tools ?? [];
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("get_state");
    expect(names).toContain("save_state");
    expect(names).toContain("log_completion");
    expect(names).toContain("normalize_user_input");
    expect(names).toContain("generate_plan");
    expect(names).toContain("schedule_events");
    expect(names).toContain("export_report");
    expect(names).toHaveLength(7);
  });

  it("each tool has a name, description, and inputSchema", async () => {
    const res = await mcpCall("tools/list");
    const data = parseSseData(res.text) as { result: { tools: { name: string; description: string; inputSchema: object }[] } };
    const tools = data?.result?.tools ?? [];
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

describe("POST /api/mcp — tools/call: get_state", () => {
  it("returns state for existing user", async () => {
    const res = await mcpCall("tools/call", { name: "get_state", arguments: { userId } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = data?.result?.content?.[0]?.text;
    expect(content).toBeTruthy();
    const parsed = JSON.parse(content ?? "{}") as { profile: { userId: string } };
    expect(parsed.profile).not.toBeNull();
    expect(parsed.profile.userId).toBe(userId);
  });

  it("returns error for unknown user", async () => {
    const res = await mcpCall("tools/call", { name: "get_state", arguments: { userId: "unknown_mcp_xyz" } });
    const data = parseSseData(res.text) as { result: { content: { text: string }[]; isError?: boolean } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { error: string };
    expect(content.error).toBeTruthy();
  });
});

describe("POST /api/mcp — tools/call: save_state", () => {
  it("saves a profile and returns success", async () => {
    const newUserId = uid("mcp_save");
    try {
      const res = await mcpCall("tools/call", {
        name: "save_state",
        arguments: {
          userId: newUserId,
          profile: {
            name: "MCP User",
            goal: "maintain",
            allergies: [],
            preferences: [],
            availableDays: ["monday"],
            equipment: [],
            injuries: [],
            mode: "auto",
          },
        },
      });
      const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
      const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { success: boolean };
      expect(content.success).toBe(true);
    } finally {
      await cleanupTestUser(newUserId);
    }
  });
});

describe("POST /api/mcp — tools/call: log_completion", () => {
  it("logs a workout and returns XP data", async () => {
    const res = await mcpCall("tools/call", {
      name: "log_completion",
      arguments: { userId, type: "workout" },
    });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      xpGained: number;
      streak: number;
      message: string;
    };
    expect(content.xpGained).toBeGreaterThan(0);
    expect(content.streak).toBe(1);
    expect(typeof content.message).toBe("string");
  });
});

describe("POST /api/mcp — tools/call: generate_plan", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
  });

  it("generates and returns a workout plan", async () => {
    const res = await mcpCall("tools/call", {
      name: "generate_plan",
      arguments: { userId, type: "workout" },
    });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as { plan: object; saved: boolean };
    expect(content.plan).toBeTruthy();
    expect(content.saved).toBe(true);
  });
});

describe("POST /api/mcp — tools/call: export_report", () => {
  it("returns a report with download URL", async () => {
    const res = await mcpCall("tools/call", {
      name: "export_report",
      arguments: { userId, format: "json" },
    });
    const data = parseSseData(res.text) as { result: { content: { text: string }[] } };
    const content = JSON.parse(data?.result?.content?.[0]?.text ?? "{}") as {
      userId: string;
      downloadUrl: string;
    };
    expect(content.userId).toBe(userId);
    expect(content.downloadUrl).toContain(userId);
  });
});
