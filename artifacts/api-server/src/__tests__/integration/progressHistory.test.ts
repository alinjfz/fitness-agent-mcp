import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import { uid, createTestUser, cleanupTestUser } from "../helpers.js";
import { db, progress } from "@workspace/db";
import { XP_WORKOUT, XP_DIET } from "../../lib/gamification.js";

const request = supertest(app);

let userId: string;

function makeHistory(count: number, type: "workout" | "diet" = "workout", daysAgo = true) {
  return Array.from({ length: count }, (_, i) => ({
    type,
    completedAt: daysAgo
      ? new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() - i * 60 * 1000).toISOString(),
    xpGained: type === "workout" ? XP_WORKOUT : XP_DIET,
    notes: `Entry ${i + 1}`,
  }));
}

beforeEach(async () => {
  userId = uid("hist");
  await createTestUser(userId);
  const mixed = [
    ...makeHistory(30, "workout", true),
    ...makeHistory(20, "diet", true),
  ];
  await db.insert(progress).values({
    userId,
    xp: 2500,
    streak: 10,
    level: 5,
    history: mixed,
    achievements: [],
    reminders: [],
    lastLoggedAt: new Date(),
    updatedAt: new Date(),
  });
});

afterEach(async () => {
  await cleanupTestUser(userId);
});

describe("GET /api/progress/:userId/history — basic", () => {
  it("returns 404 for unknown user", async () => {
    const res = await request.get("/api/progress/unknown_hist_xyz/history");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 for a known user", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.status).toBe(200);
  });

  it("response has history, pagination, and summary fields", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body).toHaveProperty("history");
    expect(res.body).toHaveProperty("pagination");
    expect(res.body).toHaveProperty("summary");
    expect(res.body.userId).toBe(userId);
  });

  it("history is an array", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it("each history entry has type, completedAt, xpGained", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    for (const entry of res.body.history as { type: string; completedAt: string; xpGained: number }[]) {
      expect(["workout", "diet"]).toContain(entry.type);
      expect(typeof entry.completedAt).toBe("string");
      expect(typeof entry.xpGained).toBe("number");
    }
  });
});

describe("GET /api/progress/:userId/history — default pagination", () => {
  it("returns at most 20 entries by default", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body.history.length).toBeLessThanOrEqual(20);
  });

  it("pagination.limit defaults to 20", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body.pagination.limit).toBe(20);
  });

  it("pagination.page defaults to 1", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body.pagination.page).toBe(1);
  });

  it("pagination.total matches the total history length", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body.pagination.total).toBe(50);
  });

  it("pagination.totalPages is correct", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body.pagination.totalPages).toBe(3);
  });

  it("pagination.hasNext is true when there are more pages", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body.pagination.hasNext).toBe(true);
  });

  it("pagination.hasPrev is false on page 1", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body.pagination.hasPrev).toBe(false);
  });
});

describe("GET /api/progress/:userId/history — page navigation", () => {
  it("page 2 returns different entries than page 1", async () => {
    const page1 = await request.get(`/api/progress/${userId}/history?page=1&limit=10`);
    const page2 = await request.get(`/api/progress/${userId}/history?page=2&limit=10`);
    const p1Dates = (page1.body.history as { completedAt: string }[]).map((h) => h.completedAt);
    const p2Dates = (page2.body.history as { completedAt: string }[]).map((h) => h.completedAt);
    expect(p1Dates).not.toEqual(p2Dates);
  });

  it("page 2 has hasPrev=true", async () => {
    const res = await request.get(`/api/progress/${userId}/history?page=2`);
    expect(res.body.pagination.hasPrev).toBe(true);
  });

  it("last page has hasNext=false", async () => {
    const res = await request.get(`/api/progress/${userId}/history?page=3&limit=20`);
    expect(res.body.pagination.hasNext).toBe(false);
  });

  it("page beyond totalPages returns last page content (clamped)", async () => {
    const res = await request.get(`/api/progress/${userId}/history?page=999`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBeLessThanOrEqual(res.body.pagination.totalPages);
  });

  it("page=0 is treated as page=1", async () => {
    const res = await request.get(`/api/progress/${userId}/history?page=0`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
  });
});

describe("GET /api/progress/:userId/history — limit parameter", () => {
  it("respects custom limit", async () => {
    const res = await request.get(`/api/progress/${userId}/history?limit=5`);
    expect(res.body.history.length).toBeLessThanOrEqual(5);
    expect(res.body.pagination.limit).toBe(5);
  });

  it("limit=1 returns exactly 1 entry", async () => {
    const res = await request.get(`/api/progress/${userId}/history?limit=1`);
    expect(res.body.history.length).toBe(1);
  });

  it("limit is capped at 100", async () => {
    const res = await request.get(`/api/progress/${userId}/history?limit=999`);
    expect(res.body.pagination.limit).toBe(100);
  });

  it("invalid limit defaults to 20", async () => {
    const res = await request.get(`/api/progress/${userId}/history?limit=abc`);
    expect(res.body.pagination.limit).toBe(20);
  });
});

describe("GET /api/progress/:userId/history — type filter", () => {
  it("returns 400 for invalid type", async () => {
    const res = await request.get(`/api/progress/${userId}/history?type=yoga`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("filters to workout only", async () => {
    const res = await request.get(`/api/progress/${userId}/history?type=workout&limit=100`);
    expect(res.status).toBe(200);
    const types = (res.body.history as { type: string }[]).map((h) => h.type);
    expect(types.every((t) => t === "workout")).toBe(true);
  });

  it("filters to diet only", async () => {
    const res = await request.get(`/api/progress/${userId}/history?type=diet&limit=100`);
    expect(res.status).toBe(200);
    const types = (res.body.history as { type: string }[]).map((h) => h.type);
    expect(types.every((t) => t === "diet")).toBe(true);
  });

  it("workout total matches summary.workoutLogs", async () => {
    const res = await request.get(`/api/progress/${userId}/history?type=workout&limit=100`);
    expect(res.body.pagination.total).toBe(res.body.summary.workoutLogs);
  });

  it("diet total matches summary.dietLogs", async () => {
    const res = await request.get(`/api/progress/${userId}/history?type=diet&limit=100`);
    expect(res.body.pagination.total).toBe(res.body.summary.dietLogs);
  });

  it("summary always shows unfiltered totals", async () => {
    const res = await request.get(`/api/progress/${userId}/history?type=workout`);
    expect(res.body.summary.workoutLogs).toBe(30);
    expect(res.body.summary.dietLogs).toBe(20);
    expect(res.body.summary.totalLogs).toBe(50);
  });
});

describe("GET /api/progress/:userId/history — sort order", () => {
  it("default sort is desc (most recent first)", async () => {
    const res = await request.get(`/api/progress/${userId}/history?limit=5`);
    const dates = (res.body.history as { completedAt: string }[]).map((h) => new Date(h.completedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it("sort=asc returns oldest first", async () => {
    const res = await request.get(`/api/progress/${userId}/history?sort=asc&limit=5`);
    const dates = (res.body.history as { completedAt: string }[]).map((h) => new Date(h.completedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeLessThanOrEqual(dates[i]);
    }
  });

  it("sort=desc returns newest first", async () => {
    const res = await request.get(`/api/progress/${userId}/history?sort=desc&limit=5`);
    const dates = (res.body.history as { completedAt: string }[]).map((h) => new Date(h.completedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it("returns 400 for invalid sort value", async () => {
    const res = await request.get(`/api/progress/${userId}/history?sort=random`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("asc page1 + asc page2 items don't overlap and are in order", async () => {
    const p1 = await request.get(`/api/progress/${userId}/history?sort=asc&limit=10&page=1`);
    const p2 = await request.get(`/api/progress/${userId}/history?sort=asc&limit=10&page=2`);
    const lastP1 = new Date((p1.body.history as { completedAt: string }[]).at(-1)!.completedAt).getTime();
    const firstP2 = new Date((p2.body.history as { completedAt: string }[])[0].completedAt).getTime();
    expect(firstP2).toBeGreaterThanOrEqual(lastP1);
  });
});

describe("GET /api/progress/:userId/history — summary accuracy", () => {
  it("summary.totalLogs = workoutLogs + dietLogs", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    const { workoutLogs, dietLogs, totalLogs } = res.body.summary as {
      workoutLogs: number;
      dietLogs: number;
      totalLogs: number;
    };
    expect(totalLogs).toBe(workoutLogs + dietLogs);
  });

  it("summary counts are correct for 30 workout + 20 diet", async () => {
    const res = await request.get(`/api/progress/${userId}/history`);
    expect(res.body.summary.workoutLogs).toBe(30);
    expect(res.body.summary.dietLogs).toBe(20);
    expect(res.body.summary.totalLogs).toBe(50);
  });
});

describe("GET /api/progress/:userId/history — empty history", () => {
  let emptyUserId: string;

  beforeEach(async () => {
    emptyUserId = uid("hist_empty");
    await createTestUser(emptyUserId);
    await db.insert(progress).values({
      userId: emptyUserId,
      xp: 0,
      streak: 0,
      level: 1,
      history: [],
      achievements: [],
      reminders: [],
      lastLoggedAt: null,
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await cleanupTestUser(emptyUserId);
  });

  it("returns empty history array", async () => {
    const res = await request.get(`/api/progress/${emptyUserId}/history`);
    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
  });

  it("pagination.total is 0", async () => {
    const res = await request.get(`/api/progress/${emptyUserId}/history`);
    expect(res.body.pagination.total).toBe(0);
  });

  it("pagination.totalPages is 1 for empty history", async () => {
    const res = await request.get(`/api/progress/${emptyUserId}/history`);
    expect(res.body.pagination.totalPages).toBe(1);
  });

  it("hasNext and hasPrev are both false", async () => {
    const res = await request.get(`/api/progress/${emptyUserId}/history`);
    expect(res.body.pagination.hasNext).toBe(false);
    expect(res.body.pagination.hasPrev).toBe(false);
  });

  it("summary is all zeros", async () => {
    const res = await request.get(`/api/progress/${emptyUserId}/history`);
    expect(res.body.summary.workoutLogs).toBe(0);
    expect(res.body.summary.dietLogs).toBe(0);
    expect(res.body.summary.totalLogs).toBe(0);
  });
});

describe("GET /api/progress/:userId/history — combined filters", () => {
  it("type=workout + sort=asc + limit=5 works", async () => {
    const res = await request.get(`/api/progress/${userId}/history?type=workout&sort=asc&limit=5`);
    expect(res.status).toBe(200);
    expect((res.body.history as { type: string }[]).every((h) => h.type === "workout")).toBe(true);
    expect(res.body.history.length).toBeLessThanOrEqual(5);
    const dates = (res.body.history as { completedAt: string }[]).map((h) => new Date(h.completedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeLessThanOrEqual(dates[i]);
    }
  });

  it("type=diet + page=2 + limit=5 correctly paginates", async () => {
    const p1 = await request.get(`/api/progress/${userId}/history?type=diet&limit=5&page=1`);
    const p2 = await request.get(`/api/progress/${userId}/history?type=diet&limit=5&page=2`);
    expect(p1.body.pagination.total).toBe(20);
    expect(p2.body.pagination.hasPrev).toBe(true);
    const p1Ids = (p1.body.history as { completedAt: string }[]).map((h) => h.completedAt);
    const p2Ids = (p2.body.history as { completedAt: string }[]).map((h) => h.completedAt);
    expect(p1Ids.some((id) => p2Ids.includes(id))).toBe(false);
  });
});
