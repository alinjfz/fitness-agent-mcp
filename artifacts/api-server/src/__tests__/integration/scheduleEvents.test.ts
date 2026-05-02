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
  MOCK_SCHEDULE_RESPONSE,
} from "../helpers.js";
import { openai } from "@workspace/integrations-openai-ai-server";

const request = supertest(app);
const mockCreate = vi.mocked(openai.chat.completions.create);

let userId: string;

beforeEach(async () => {
  userId = uid("sched");
  await createTestUser(userId);
  mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_SCHEDULE_RESPONSE) as never);
});

afterEach(async () => {
  await cleanupTestUser(userId);
  vi.clearAllMocks();
});

describe("POST /api/schedule-events", () => {
  it("returns 400 when userId is missing", async () => {
    const res = await request.post("/api/schedule-events").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for unknown user", async () => {
    const res = await request.post("/api/schedule-events").send({ userId: "unknown_xyz_sched" });
    expect(res.status).toBe(404);
  });

  it("returns 200 with events array", async () => {
    const res = await request.post("/api/schedule-events").send({
      userId,
      description: "schedule workouts for two weeks",
      durationDays: 14,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.count).toBe(res.body.events.length);
  });

  it("saved is true in auto mode", async () => {
    const res = await request.post("/api/schedule-events").send({ userId });
    expect(res.body.saved).toBe(true);
  });

  it("defaults to 30 days when durationDays is not provided", async () => {
    const res = await request.post("/api/schedule-events").send({ userId });
    expect(res.status).toBe(200);
    expect(res.body.durationDays).toBe(30);
  });

  it("uses provided startDate", async () => {
    const res = await request.post("/api/schedule-events").send({
      userId,
      startDate: "2026-07-01",
      durationDays: 7,
    });
    expect(res.body.startDate).toBe("2026-07-01");
  });

  it("events appear in state after scheduling", async () => {
    await request.post("/api/schedule-events").send({ userId });
    const stateRes = await request.get(`/api/state/${userId}`);
    expect(stateRes.body.schedule).not.toBeNull();
    expect((stateRes.body.schedule.events as unknown[]).length).toBeGreaterThan(0);
  });

  it("accumulates events on subsequent calls", async () => {
    await request.post("/api/schedule-events").send({ userId, durationDays: 7 });
    await request.post("/api/schedule-events").send({ userId, durationDays: 7 });
    const stateRes = await request.get(`/api/state/${userId}`);
    expect((stateRes.body.schedule.events as unknown[]).length).toBeGreaterThan(
      MOCK_SCHEDULE_RESPONSE.events.length
    );
  });

  describe("confirm mode", () => {
    let confirmUserId: string;

    beforeEach(async () => {
      confirmUserId = uid("sched_confirm");
      await createTestUserConfirmMode(confirmUserId);
    });

    afterEach(async () => {
      await cleanupTestUser(confirmUserId);
    });

    it("returns requiresConfirmation=true without confirmed flag", async () => {
      const res = await request.post("/api/schedule-events").send({ userId: confirmUserId });
      expect(res.status).toBe(200);
      expect(res.body.requiresConfirmation).toBe(true);
      expect(res.body.saved).toBe(false);
    });

    it("saves when confirmed=true", async () => {
      const res = await request.post("/api/schedule-events").send({ userId: confirmUserId, confirmed: true });
      expect(res.body.saved).toBe(true);
      expect(res.body.requiresConfirmation).toBeUndefined();
    });
  });

  describe("DELETE /api/schedule-events/:userId", () => {
    it("clears all events for the user", async () => {
      await request.post("/api/schedule-events").send({ userId });
      const del = await request.delete(`/api/schedule-events/${userId}`);
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);
      const stateRes = await request.get(`/api/state/${userId}`);
      expect((stateRes.body.schedule.events as unknown[]).length).toBe(0);
    });
  });
});
