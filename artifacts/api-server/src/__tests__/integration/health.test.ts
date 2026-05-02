import { vi, describe, it, expect } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";

const request = supertest(app);

describe("GET /api/healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await request.get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("returns JSON content type", async () => {
    const res = await request.get("/api/healthz");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("GET /api/system-prompt", () => {
  it("returns 200 with all three AI integration sections", async () => {
    const res = await request.get("/api/system-prompt");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("chatgpt");
    expect(res.body).toHaveProperty("claude");
    expect(res.body).toHaveProperty("github_copilot");
    expect(res.body.chatgpt).toHaveProperty("prompt");
    expect(res.body.claude).toHaveProperty("prompt");
    expect(res.body.claude).toHaveProperty("desktop_config");
    expect(res.body.github_copilot).toHaveProperty("prompt");
    expect(res.body.github_copilot).toHaveProperty("vscode_mcp_config");
  });

  it("chatgpt prompt is a non-empty string", async () => {
    const res = await request.get("/api/system-prompt");
    expect(typeof res.body.chatgpt.prompt).toBe("string");
    expect(res.body.chatgpt.prompt.length).toBeGreaterThan(100);
  });

  it("claude prompt mentions get_history tool", async () => {
    const res = await request.get("/api/system-prompt");
    expect(res.body.claude.prompt).toContain("get_history");
  });

  it("github_copilot prompt mentions all 8 tools", async () => {
    const res = await request.get("/api/system-prompt");
    const prompt = res.body.github_copilot.prompt as string;
    expect(prompt).toContain("get_state");
    expect(prompt).toContain("get_history");
    expect(prompt).toContain("log_completion");
    expect(prompt).toContain("export_report");
  });

  it("includes the mcp_endpoint path", async () => {
    const res = await request.get("/api/system-prompt");
    expect(res.body.mcp_endpoint).toBe("/api/mcp");
  });

  it("includes openapi_url", async () => {
    const res = await request.get("/api/system-prompt");
    expect(res.body.openapi_url).toBe("/api/openapi.json");
  });
});
