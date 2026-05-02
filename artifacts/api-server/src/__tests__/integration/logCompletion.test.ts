import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import { uid, createTestUser, cleanupTestUser } from "../helpers.js";
import { XP_WORKOUT, XP_DIET } from "../../lib/gamification.js";

const request = supertest(app);

let userId: string;

beforeEach(async () => {
  userId = uid("log");
  await createTestUser(userId);
});

afterEach(async () => {
  await cleanupTestUser(userId);
});

describe("POST /api/log-completion", () => {
  it("returns 400 when userId is missing", async () => {
    const res = await request.post("/api/log-completion").send({ type: "workout" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when type is missing", async () => {
    const res = await request.post("/api/log-completion").send({ userId });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("logs a workout and returns XP fields", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("xpGained");
    expect(res.body).toHaveProperty("totalXp");
    expect(res.body).toHaveProperty("streak");
    expect(res.body).toHaveProperty("level");
    expect(res.body).toHaveProperty("leveledUp");
    expect(res.body).toHaveProperty("xpToNextLevel");
    expect(res.body).toHaveProperty("message");
  });

  it("awards at least base XP for workout", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.xpGained).toBeGreaterThanOrEqual(XP_WORKOUT);
  });

  it("awards at least base XP for diet", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "diet" });
    expect(res.status).toBe(200);
    expect(res.body.xpGained).toBeGreaterThanOrEqual(XP_DIET);
  });

  it("starts with streak=1 on first log", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.streak).toBe(1);
  });

  it("level is at least 1", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.body.level).toBeGreaterThanOrEqual(1);
  });

  it("xpToNextLevel is positive", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.body.xpToNextLevel).toBeGreaterThan(0);
  });

  it("accumulates XP on second log", async () => {
    await request.post("/api/log-completion").send({ userId, type: "workout" });
    const res2 = await request.post("/api/log-completion").send({ userId, type: "diet" });
    expect(res2.status).toBe(200);
    expect(res2.body.totalXp).toBeGreaterThanOrEqual(XP_WORKOUT + XP_DIET);
  });

  it("unlocks first_workout achievement on first log", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.newAchievements).toBeDefined();
    const ids = (res.body.newAchievements as { name: string }[]).map((a) => a.name);
    expect(ids).toContain("First Rep");
  });

  it("does not re-unlock first_workout on second log", async () => {
    await request.post("/api/log-completion").send({ userId, type: "workout" });
    const res2 = await request.post("/api/log-completion").send({ userId, type: "workout" });
    const ids = ((res2.body.newAchievements ?? []) as { name: string }[]).map((a) => a.name);
    expect(ids).not.toContain("First Rep");
  });

  it("includes notes in the log when provided", async () => {
    const res = await request.post("/api/log-completion").send({
      userId,
      type: "workout",
      notes: "Great session today",
    });
    expect(res.status).toBe(200);
  });

  it("returns an empty reminders array for new user", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.reminders)).toBe(true);
  });

  it("returns a non-empty message string", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(5);
  });
});
