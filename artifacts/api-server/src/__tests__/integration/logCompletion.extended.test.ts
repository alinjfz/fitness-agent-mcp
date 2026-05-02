import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import { uid, createTestUser, cleanupTestUser } from "../helpers.js";
import { db, progress } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  XP_WORKOUT,
  XP_DIET,
  XP_STREAK_BONUS_PER_DAY,
  XP_WEEKLY_BONUS,
  MAX_STREAK_BONUS_DAYS,
} from "../../lib/gamification.js";

const request = supertest(app);

let userId: string;

beforeEach(async () => {
  userId = uid("logext");
  await createTestUser(userId);
});

afterEach(async () => {
  await cleanupTestUser(userId);
});

describe("POST /api/log-completion — streak bonus cap", () => {
  it("streak bonus is capped at MAX_STREAK_BONUS_DAYS × XP_STREAK_BONUS_PER_DAY", async () => {
    const highStreak = MAX_STREAK_BONUS_DAYS + 10;
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.insert(progress).values({
      userId,
      xp: 1000,
      streak: highStreak,
      level: 3,
      history: [],
      achievements: [],
      reminders: [],
      lastLoggedAt: yesterday,
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    const maxBonusXp = MAX_STREAK_BONUS_DAYS * XP_STREAK_BONUS_PER_DAY;
    const baseXp = res.body.xpGained - (res.body.newAchievements ?? []).reduce((s: number, a: { xpBonus: number }) => s + a.xpBonus, 0);
    expect(baseXp).toBeLessThanOrEqual(XP_WORKOUT + maxBonusXp);
  });
});

describe("POST /api/log-completion — same-day idempotency", () => {
  it("second log in the same day does not increment streak", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await db.insert(progress).values({
      userId,
      xp: 100,
      streak: 3,
      level: 1,
      history: [],
      achievements: [],
      reminders: [],
      lastLoggedAt: fiveMinutesAgo,
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.streak).toBe(3);
  });
});

describe("POST /api/log-completion — streak increment from DB state", () => {
  it("increments streak when lastLoggedAt was yesterday", async () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.insert(progress).values({
      userId,
      xp: 200,
      streak: 5,
      level: 1,
      history: [],
      achievements: [],
      reminders: [],
      lastLoggedAt: yesterday,
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.streak).toBe(6);
  });

  it("resets streak when lastLoggedAt was 3 days ago", async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    await db.insert(progress).values({
      userId,
      xp: 500,
      streak: 10,
      level: 2,
      history: [],
      achievements: [],
      reminders: [],
      lastLoggedAt: threeDaysAgo,
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.streak).toBe(1);
  });
});

describe("POST /api/log-completion — achievements from seeded data", () => {
  it("unlocks first_diet when seeded with 0 diet history", async () => {
    const res = await request.post("/api/log-completion").send({ userId, type: "diet" });
    expect(res.status).toBe(200);
    const ids = ((res.body.newAchievements ?? []) as { name: string }[]).map((a) => a.name);
    expect(ids).toContain("Clean Plate");
  });

  it("unlocks logs_10 when history has 9 entries already", async () => {
    const nineEntries = Array.from({ length: 9 }, (_, i) => ({
      type: "workout" as const,
      completedAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      xpGained: XP_WORKOUT,
    }));
    await db.insert(progress).values({
      userId,
      xp: 450,
      streak: 1,
      level: 1,
      history: nineEntries,
      achievements: [
        { id: "first_workout", name: "First Rep", description: "...", earnedAt: new Date().toISOString(), xpBonus: 100 },
      ],
      reminders: [],
      lastLoggedAt: new Date(Date.now() - 60 * 60 * 1000),
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    const ids = ((res.body.newAchievements ?? []) as { name: string }[]).map((a) => a.name);
    expect(ids).toContain("Consistent");
  });

  it("unlocks streak_7 when current streak becomes 7", async () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const existing = [
      { id: "first_workout", name: "First Rep", description: "...", earnedAt: new Date().toISOString(), xpBonus: 100 },
      { id: "streak_3", name: "On A Roll", description: "...", earnedAt: new Date().toISOString(), xpBonus: 75 },
    ];
    await db.insert(progress).values({
      userId,
      xp: 700,
      streak: 6,
      level: 2,
      history: Array.from({ length: 6 }, (_, i) => ({
        type: "workout" as const,
        completedAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
        xpGained: XP_WORKOUT,
      })),
      achievements: existing,
      reminders: [],
      lastLoggedAt: yesterday,
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.streak).toBe(7);
    const ids = ((res.body.newAchievements ?? []) as { name: string }[]).map((a) => a.name);
    expect(ids).toContain("Week Warrior");
  });

  it("level-up is reflected in response", async () => {
    await db.insert(progress).values({
      userId,
      xp: 490,
      streak: 1,
      level: 1,
      history: [],
      achievements: [],
      reminders: [],
      lastLoggedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    expect(res.body.leveledUp).toBe(true);
    expect(res.body.level).toBeGreaterThanOrEqual(2);
  });

  it("achievements add their xpBonus to total XP", async () => {
    const prevXp = 200;
    await db.insert(progress).values({
      userId,
      xp: prevXp,
      streak: 1,
      level: 1,
      history: [],
      achievements: [],
      reminders: [],
      lastLoggedAt: null,
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    const bonusXp = ((res.body.newAchievements ?? []) as { xpBonus: number }[]).reduce((s, a) => s + a.xpBonus, 0);
    expect(res.body.totalXp).toBeGreaterThanOrEqual(prevXp + XP_WORKOUT + bonusXp);
  });

  it("history is trimmed to 100 entries max", async () => {
    const manyEntries = Array.from({ length: 99 }, (_, i) => ({
      type: "workout" as const,
      completedAt: new Date(Date.now() - i * 60 * 1000).toISOString(),
      xpGained: XP_WORKOUT,
    }));
    await db.insert(progress).values({
      userId,
      xp: 4950,
      streak: 1,
      level: 10,
      history: manyEntries,
      achievements: [],
      reminders: [],
      lastLoggedAt: new Date(Date.now() - 60 * 1000),
      updatedAt: new Date(),
    });
    await request.post("/api/log-completion").send({ userId, type: "workout" });
    await request.post("/api/log-completion").send({ userId, type: "diet" });
    const prog = await db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0]);
    expect((prog?.history as unknown[]).length).toBeLessThanOrEqual(100);
  });
});

describe("POST /api/log-completion — weekly bonus", () => {
  it("weekly bonus XP is included when current log makes the 5th unique day this week", async () => {
    const fourDayHistory = Array.from({ length: 4 }, (_, i) => ({
      type: "workout" as const,
      completedAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
      xpGained: XP_WORKOUT,
    }));
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.insert(progress).values({
      userId,
      xp: 200,
      streak: 4,
      level: 1,
      history: fourDayHistory,
      achievements: [
        { id: "first_workout", name: "First Rep", description: "...", earnedAt: new Date().toISOString(), xpBonus: 100 },
        { id: "streak_3", name: "On A Roll", description: "...", earnedAt: new Date().toISOString(), xpBonus: 75 },
      ],
      reminders: [],
      lastLoggedAt: yesterday,
      updatedAt: new Date(),
    });
    const res = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(res.status).toBe(200);
    const xpGained = res.body.xpGained as number;
    expect(xpGained).toBeGreaterThanOrEqual(XP_WORKOUT + XP_WEEKLY_BONUS);
  });
});
