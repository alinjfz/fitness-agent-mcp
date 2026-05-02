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
  makeOpenAIChoice,
  MOCK_WORKOUT_PLAN_RESPONSE,
  MOCK_DIET_PLAN_RESPONSE,
} from "../helpers.js";
import { openai } from "@workspace/integrations-openai-ai-server";

const request = supertest(app);
const mockCreate = vi.mocked(openai.chat.completions.create);

let userId: string;

beforeEach(async () => {
  userId = uid("planext");
  await createTestUser(userId);
});

afterEach(async () => {
  await cleanupTestUser(userId);
  vi.clearAllMocks();
});

describe("POST /api/generate-plan — plan overwrite", () => {
  it("re-generating workout plan overwrites the previous one (no duplicates in state)", async () => {
    const plan1 = { sessions: [{ day: "monday", name: "Version 1", durationMin: 30, exercises: [] }], notes: "v1" };
    const plan2 = { sessions: [{ day: "tuesday", name: "Version 2", durationMin: 60, exercises: [] }], notes: "v2" };

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(plan1) as never);
    await request.post("/api/generate-plan").send({ userId, type: "workout" });

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(plan2) as never);
    await request.post("/api/generate-plan").send({ userId, type: "workout" });

    const stateRes = await request.get(`/api/state/${userId}`);
    const sessions = stateRes.body.workoutPlan.sessions as { name: string }[];
    expect(sessions.length).toBe(1);
    expect(sessions[0].name).toBe("Version 2");
  });

  it("re-generating diet plan overwrites the previous one", async () => {
    const plan1 = { ...MOCK_DIET_PLAN_RESPONSE, dailyCalories: 1800, notes: "v1" };
    const plan2 = { ...MOCK_DIET_PLAN_RESPONSE, dailyCalories: 2200, notes: "v2" };

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(plan1) as never);
    await request.post("/api/generate-plan").send({ userId, type: "diet" });

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(plan2) as never);
    await request.post("/api/generate-plan").send({ userId, type: "diet" });

    const stateRes = await request.get(`/api/state/${userId}`);
    expect(stateRes.body.dietPlan.dailyCalories).toBe(2200);
  });
});

describe("POST /api/generate-plan — AI error handling", () => {
  it("returns 500 when AI returns invalid JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not valid json {{{{" } }],
    } as never);
    const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 500 when AI returns empty string", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    } as never);
    const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(res.status).toBe(500);
  });

  it("returns 500 when AI returns an array instead of object", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "[1, 2, 3]" } }],
    } as never);
    const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/generate-plan — profile edge cases", () => {
  it("works for user with bodyweight-only (no equipment)", async () => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
    await request.put(`/api/state/${userId}`).send({
      profile: { equipment: [] },
    });
    const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.plan).toBeTruthy();
  });

  it("works for user with injuries", async () => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
    await request.put(`/api/state/${userId}`).send({
      profile: { injuries: ["bad knee", "shoulder impingement"] },
    });
    const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
  });

  it("works for user with allergies (diet plan)", async () => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_DIET_PLAN_RESPONSE) as never);
    await request.put(`/api/state/${userId}`).send({
      profile: { allergies: ["nuts", "dairy", "gluten"] },
    });
    const res = await request.post("/api/generate-plan").send({ userId, type: "diet" });
    expect(res.status).toBe(200);
    expect(res.body.plan.meals).toBeDefined();
  });

  it("workout plan is callable even with no availableDays", async () => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
    await request.put(`/api/state/${userId}`).send({
      profile: { availableDays: [] },
    });
    const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/generate-plan — response shape", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
  });

  it("response always has plan and saved fields", async () => {
    const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(res.body).toHaveProperty("plan");
    expect(res.body).toHaveProperty("saved");
    expect(typeof res.body.saved).toBe("boolean");
  });

  it("workout plan has notes field", async () => {
    const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(res.body.plan.notes).toBe("Test workout plan");
  });

  it("diet plan has macros with proteinG, carbsG, fatG", async () => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_DIET_PLAN_RESPONSE) as never);
    const res = await request.post("/api/generate-plan").send({ userId, type: "diet" });
    expect(res.body.plan.macros).toHaveProperty("proteinG");
    expect(res.body.plan.macros).toHaveProperty("carbsG");
    expect(res.body.plan.macros).toHaveProperty("fatG");
  });

  it("diet plan meals is an array", async () => {
    mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_DIET_PLAN_RESPONSE) as never);
    const res = await request.post("/api/generate-plan").send({ userId, type: "diet" });
    expect(Array.isArray(res.body.plan.meals)).toBe(true);
    expect(res.body.plan.meals.length).toBeGreaterThan(0);
  });
});
