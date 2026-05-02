import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import { uid, createTestUser, cleanupTestUser, makeOpenAIChoice, MOCK_NORMALIZE_RESPONSE } from "../helpers.js";
import { openai } from "@workspace/integrations-openai-ai-server";

const request = supertest(app);

const mockCreate = vi.mocked(openai.chat.completions.create);

let userId: string;

beforeEach(async () => {
  userId = uid("norm");
  await createTestUser(userId);
  mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_NORMALIZE_RESPONSE) as never);
});

afterEach(async () => {
  await cleanupTestUser(userId);
  vi.clearAllMocks();
});

describe("POST /api/normalize", () => {
  it("returns 400 when input is missing", async () => {
    const res = await request.post("/api/normalize").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with extracted data for valid input", async () => {
    const res = await request.post("/api/normalize").send({
      input: "I'm Jane, I want to build muscle, I can train Monday Wednesday Friday",
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("extracted");
    expect(res.body).toHaveProperty("rawInput");
    expect(res.body).toHaveProperty("confidence");
  });

  it("rawInput echoes the submitted text", async () => {
    const input = "I want to lose weight and I train on weekdays";
    const res = await request.post("/api/normalize").send({ input });
    expect(res.status).toBe(200);
    expect(res.body.rawInput).toBe(input);
  });

  it("confidence is one of high/medium/low", async () => {
    const res = await request.post("/api/normalize").send({ input: "some text" });
    expect(["high", "medium", "low"]).toContain(res.body.confidence);
  });

  it("extracted has a profile key", async () => {
    const res = await request.post("/api/normalize").send({ input: "some text" });
    expect(res.body.extracted).toHaveProperty("profile");
  });

  it("calls OpenAI exactly once", async () => {
    await request.post("/api/normalize").send({ input: "some text" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("accepts an optional userId for context", async () => {
    const res = await request.post("/api/normalize").send({
      input: "I now also train on Saturdays",
      userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("extracted");
  });

  it("returns extracted goal from AI response", async () => {
    const res = await request.post("/api/normalize").send({ input: "I want to build muscle" });
    const profile = res.body.extracted.profile as Record<string, unknown>;
    expect(profile.goal).toBe("build_muscle");
  });
});
