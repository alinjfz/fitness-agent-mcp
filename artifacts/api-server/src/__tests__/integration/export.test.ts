import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import { uid, createTestUser, cleanupTestUser } from "../helpers.js";
import { db, progress } from "@workspace/db";

const request = supertest(app);

let userId: string;

beforeEach(async () => {
  userId = uid("export");
  await createTestUser(userId);
  await db.insert(progress).values({
    userId,
    xp: 750,
    streak: 7,
    level: 2,
    history: [
      { type: "workout", completedAt: new Date().toISOString(), xpGained: 60 },
      { type: "diet", completedAt: new Date().toISOString(), xpGained: 30 },
    ],
    achievements: [
      { id: "first_workout", name: "First Rep", description: "First workout", earnedAt: new Date().toISOString(), xpBonus: 100 },
    ],
    reminders: [],
    lastLoggedAt: new Date(),
    updatedAt: new Date(),
  });
});

afterEach(async () => {
  await cleanupTestUser(userId);
});

describe("GET /api/export/:userId", () => {
  it("returns 404 for unknown user", async () => {
    const res = await request.get("/api/export/unknown_xyz_export");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 for invalid format", async () => {
    const res = await request.get(`/api/export/${userId}?format=xml`);
    expect(res.status).toBe(400);
  });

  describe("JSON format (default)", () => {
    it("returns 200 with JSON body", async () => {
      const res = await request.get(`/api/export/${userId}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });

    it("includes profile, progress, achievements", async () => {
      const res = await request.get(`/api/export/${userId}`);
      expect(res.body).toHaveProperty("profile");
      expect(res.body).toHaveProperty("progress");
      expect(res.body).toHaveProperty("achievements");
      expect(res.body).toHaveProperty("exportedAt");
    });

    it("progress contains correct XP", async () => {
      const res = await request.get(`/api/export/${userId}`);
      expect(res.body.progress.xp).toBe(750);
    });

    it("achievements list has correct length", async () => {
      const res = await request.get(`/api/export/${userId}`);
      expect(res.body.achievements.length).toBe(1);
      expect(res.body.achievements[0].name).toBe("First Rep");
    });

    it("progress workoutLogs and dietLogs are correct", async () => {
      const res = await request.get(`/api/export/${userId}`);
      expect(res.body.progress.workoutLogs).toBe(1);
      expect(res.body.progress.dietLogs).toBe(1);
      expect(res.body.progress.totalLogs).toBe(2);
    });

    it("includes recent history", async () => {
      const res = await request.get(`/api/export/${userId}`);
      expect(Array.isArray(res.body.recentHistory)).toBe(true);
    });
  });

  describe("CSV format", () => {
    it("returns 200 with CSV content-type", async () => {
      const res = await request.get(`/api/export/${userId}?format=csv`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
    });

    it("CSV contains Profile and Progress sections", async () => {
      const res = await request.get(`/api/export/${userId}?format=csv`);
      expect(res.text).toContain("Profile");
      expect(res.text).toContain("Progress");
    });

    it("CSV contains user name", async () => {
      const res = await request.get(`/api/export/${userId}?format=csv`);
      expect(res.text).toContain("Test User");
    });
  });

  describe("HTML format", () => {
    it("returns 200 with HTML content-type", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });

    it("HTML contains user name in the title", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain("Test User");
    });

    it("HTML is a valid document (has DOCTYPE)", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain("<!DOCTYPE html>");
    });

    it("HTML contains achievement name", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain("First Rep");
    });

    it("HTML contains XP value", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain("750");
    });
  });
});
