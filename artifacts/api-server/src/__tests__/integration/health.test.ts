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
  it("returns 200 with chatgpt and claude_mcp prompts", async () => {
    const res = await request.get("/api/system-prompt");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("chatgpt");
    expect(res.body).toHaveProperty("claude_mcp");
    expect(res.body).toHaveProperty("claude_desktop_config");
    expect(res.body.chatgpt).toHaveProperty("prompt");
    expect(res.body.claude_mcp).toHaveProperty("prompt");
  });

  it("chatgpt prompt is a non-empty string", async () => {
    const res = await request.get("/api/system-prompt");
    expect(typeof res.body.chatgpt.prompt).toBe("string");
    expect(res.body.chatgpt.prompt.length).toBeGreaterThan(100);
  });

  it("includes the mcp_endpoint path", async () => {
    const res = await request.get("/api/system-prompt");
    expect(res.body.mcp_endpoint).toBe("/api/mcp");
  });
});
