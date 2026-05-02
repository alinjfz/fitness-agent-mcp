import { vi, describe, it, expect } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";

const request = supertest(app);

describe("GET /api/openapi.json", () => {
  it("returns 200", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.status).toBe(200);
  });

  it("returns JSON content-type", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("has CORS header allowing all origins", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("body has openapi version field", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body).toHaveProperty("openapi");
    expect(res.body.openapi).toMatch(/^3\./);
  });

  it("body has info.title", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.info).toHaveProperty("title");
    expect(typeof res.body.info.title).toBe("string");
  });

  it("body has paths object", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body).toHaveProperty("paths");
    expect(typeof res.body.paths).toBe("object");
  });

  it("paths includes /healthz", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.paths).toHaveProperty("/healthz");
  });

  it("paths includes /state/{userId}", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.paths).toHaveProperty("/state/{userId}");
  });

  it("paths includes /log-completion", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.paths).toHaveProperty("/log-completion");
  });

  it("paths includes /generate-plan", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.paths).toHaveProperty("/generate-plan");
  });

  it("paths includes /schedule-events", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.paths).toHaveProperty("/schedule-events");
  });

  it("paths includes /export/{userId}", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.paths).toHaveProperty("/export/{userId}");
  });

  it("paths includes /normalize", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.paths).toHaveProperty("/normalize");
  });

  it("paths includes /mcp", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.paths).toHaveProperty("/mcp");
  });

  it("components has schemas", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.components).toHaveProperty("schemas");
  });

  it("FitnessState schema is defined", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.components.schemas).toHaveProperty("FitnessState");
  });

  it("LogCompletionResponse schema is defined", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.components.schemas).toHaveProperty("LogCompletionResponse");
  });

  it("GeneratePlanResponse schema is defined", async () => {
    const res = await request.get("/api/openapi.json");
    expect(res.body.components.schemas).toHaveProperty("GeneratePlanResponse");
  });
});

describe("GET /api/openapi.yaml", () => {
  it("returns 200", async () => {
    const res = await request.get("/api/openapi.yaml");
    expect(res.status).toBe(200);
  });

  it("returns yaml content-type", async () => {
    const res = await request.get("/api/openapi.yaml");
    expect(res.headers["content-type"]).toMatch(/yaml/);
  });

  it("has CORS header", async () => {
    const res = await request.get("/api/openapi.yaml");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("response text starts with 'openapi:'", async () => {
    const res = await request.get("/api/openapi.yaml");
    expect(res.text.trim()).toMatch(/^openapi:/);
  });

  it("contains healthz path definition", async () => {
    const res = await request.get("/api/openapi.yaml");
    expect(res.text).toContain("/healthz");
  });

  it("contains FitnessState schema", async () => {
    const res = await request.get("/api/openapi.yaml");
    expect(res.text).toContain("FitnessState");
  });

  it("JSON and YAML specs are equivalent (both contain same key paths)", async () => {
    const [jsonRes, yamlRes] = await Promise.all([
      request.get("/api/openapi.json"),
      request.get("/api/openapi.yaml"),
    ]);
    expect(jsonRes.status).toBe(200);
    expect(yamlRes.status).toBe(200);
    const jsonPaths = Object.keys(jsonRes.body.paths as Record<string, unknown>);
    for (const p of jsonPaths) {
      expect(yamlRes.text).toContain(p);
    }
  });
});
