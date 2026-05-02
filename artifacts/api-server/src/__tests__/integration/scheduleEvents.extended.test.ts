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
  MOCK_SCHEDULE_RESPONSE,
  MOCK_WORKOUT_PLAN_RESPONSE,
} from "../helpers.js";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, workoutPlans } from "@workspace/db";

const request = supertest(app);
const mockCreate = vi.mocked(openai.chat.completions.create);

let userId: string;

beforeEach(async () => {
  userId = uid("schedext");
  await createTestUser(userId);
  mockCreate.mockResolvedValue(makeOpenAIChoice(MOCK_SCHEDULE_RESPONSE) as never);
});

afterEach(async () => {
  await cleanupTestUser(userId);
  vi.clearAllMocks();
});

describe("POST /api/schedule-events — with existing workout plan", () => {
  beforeEach(async () => {
    await db.insert(workoutPlans).values({
      userId,
      sessions: MOCK_WORKOUT_PLAN_RESPONSE.sessions,
      notes: "Pre-seeded plan",
      updatedAt: new Date(),
    });
  });

  it("returns 200 and saves events", async () => {
    const res = await request.post("/api/schedule-events").send({ userId, durationDays: 14 });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });

  it("events have required fields", async () => {
    const res = await request.post("/api/schedule-events").send({ userId, durationDays: 7 });
    const events = res.body.events as { title: string; date: string; type: string }[];
    for (const event of events) {
      expect(event.title).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["workout", "meal", "check_in"]).toContain(event.type);
    }
  });
});

describe("POST /api/schedule-events — various durations", () => {
  it("schedules 1-day events", async () => {
    const res = await request.post("/api/schedule-events").send({ userId, durationDays: 1 });
    expect(res.status).toBe(200);
    expect(res.body.durationDays).toBe(1);
  });

  it("schedules 7-day events", async () => {
    const res = await request.post("/api/schedule-events").send({ userId, durationDays: 7 });
    expect(res.status).toBe(200);
    expect(res.body.durationDays).toBe(7);
  });

  it("schedules 90-day events", async () => {
    const res = await request.post("/api/schedule-events").send({ userId, durationDays: 90 });
    expect(res.status).toBe(200);
    expect(res.body.durationDays).toBe(90);
  });
});

describe("POST /api/schedule-events — startDate", () => {
  it("startDate defaults to today", async () => {
    const res = await request.post("/api/schedule-events").send({ userId });
    const today = new Date().toISOString().split("T")[0];
    expect(res.body.startDate).toBe(today);
  });

  it("uses the provided startDate", async () => {
    const res = await request.post("/api/schedule-events").send({ userId, startDate: "2027-01-01" });
    expect(res.body.startDate).toBe("2027-01-01");
  });
});

describe("POST /api/schedule-events — AI call", () => {
  it("calls OpenAI exactly once per request", async () => {
    await request.post("/api/schedule-events").send({ userId });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when AI returns invalid JSON", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "not-json" } }] } as never);
    const res = await request.post("/api/schedule-events").send({ userId });
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});

describe("DELETE /api/schedule-events/:userId", () => {
  it("returns success even when schedule does not exist yet", async () => {
    const res = await request.delete(`/api/schedule-events/${userId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("after delete, schedule in state has empty events array", async () => {
    await request.post("/api/schedule-events").send({ userId });
    await request.delete(`/api/schedule-events/${userId}`);
    const stateRes = await request.get(`/api/state/${userId}`);
    expect((stateRes.body.schedule.events as unknown[]).length).toBe(0);
  });

  it("can add events again after clearing", async () => {
    await request.post("/api/schedule-events").send({ userId });
    await request.delete(`/api/schedule-events/${userId}`);
    const res = await request.post("/api/schedule-events").send({ userId });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });
});
