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
  createTestUserConfirmMode,
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
  userId = uid("plan");
  await createTestUser(userId);
});

afterEach(async () => {
  await cleanupTestUser(userId);
  vi.clearAllMocks();
});

describe("POST /api/generate-plan", () => {
  it("returns 400 when userId is missing", async () => {
    const res = await request.post("/api/generate-plan").send({ type: "workout" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when type is missing", async () => {
    const res = await request.post("/api/generate-plan").send({ userId });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for unknown user", async () => {
    const res = await request.post("/api/generate-plan").send({ userId: "unknown_xyz_abc", type: "workout" });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  describe("workout plan", () => {
    beforeEach(() => {
      mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
    });

    it("returns 200 with a plan", async () => {
      const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("plan");
      expect(res.body).toHaveProperty("saved");
    });

    it("plan has sessions array", async () => {
      const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
      expect(Array.isArray(res.body.plan.sessions)).toBe(true);
      expect(res.body.plan.sessions.length).toBeGreaterThan(0);
    });

    it("saved is true in auto mode", async () => {
      const res = await request.post("/api/generate-plan").send({ userId, type: "workout" });
      expect(res.body.saved).toBe(true);
    });

    it("calls OpenAI exactly once", async () => {
      await request.post("/api/generate-plan").send({ userId, type: "workout" });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("plan appears in get_state after generation", async () => {
      await request.post("/api/generate-plan").send({ userId, type: "workout" });
      const stateRes = await request.get(`/api/state/${userId}`);
      expect(stateRes.body.workoutPlan).not.toBeNull();
    });
  });

  describe("diet plan", () => {
    beforeEach(() => {
      mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_DIET_PLAN_RESPONSE) as never);
    });

    it("returns 200 with a diet plan", async () => {
      const res = await request.post("/api/generate-plan").send({ userId, type: "diet" });
      expect(res.status).toBe(200);
      expect(res.body.plan).toHaveProperty("meals");
      expect(res.body.plan).toHaveProperty("dailyCalories");
      expect(res.body.plan).toHaveProperty("macros");
    });

    it("dailyCalories is a number", async () => {
      const res = await request.post("/api/generate-plan").send({ userId, type: "diet" });
      expect(typeof res.body.plan.dailyCalories).toBe("number");
    });

    it("plan appears in get_state after generation", async () => {
      await request.post("/api/generate-plan").send({ userId, type: "diet" });
      const stateRes = await request.get(`/api/state/${userId}`);
      expect(stateRes.body.dietPlan).not.toBeNull();
    });
  });

  describe("confirm mode", () => {
    let confirmUserId: string;

    beforeEach(async () => {
      confirmUserId = uid("plan_confirm");
      await createTestUserConfirmMode(confirmUserId);
      mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
    });

    afterEach(async () => {
      await cleanupTestUser(confirmUserId);
    });

    it("returns requiresConfirmation=true in confirm mode without confirmed flag", async () => {
      const res = await request.post("/api/generate-plan").send({ userId: confirmUserId, type: "workout" });
      expect(res.status).toBe(200);
      expect(res.body.requiresConfirmation).toBe(true);
      expect(res.body.saved).toBe(false);
    });

    it("plan is still returned even in confirm mode (preview)", async () => {
      const res = await request.post("/api/generate-plan").send({ userId: confirmUserId, type: "workout" });
      expect(res.body.plan).not.toBeNull();
      expect(res.body.plan).toHaveProperty("sessions");
    });

    it("saves when confirmed=true in confirm mode", async () => {
      const res = await request.post("/api/generate-plan").send({ userId: confirmUserId, type: "workout", confirmed: true });
      expect(res.status).toBe(200);
      expect(res.body.saved).toBe(true);
      expect(res.body.requiresConfirmation).toBeUndefined();
    });
  });
});
