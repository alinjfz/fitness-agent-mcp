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

  describe("HTML format — structure", () => {
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

  describe("HTML format — paginated activity log", () => {
    it("HTML contains the history data JSON blob", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain('id="history-data"');
      expect(res.text).toContain('"type":"workout"');
    });

    it("history-data element contains all entries not just 20", async () => {
      const bigUserId = uid("export_big");
      try {
        await createTestUser(bigUserId);
        const bigHistory = Array.from({ length: 35 }, (_, i) => ({
          type: i % 2 === 0 ? "workout" : "diet" as "workout" | "diet",
          completedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
          xpGained: i % 2 === 0 ? 50 : 30,
        }));
        await db.insert(progress).values({
          userId: bigUserId, xp: 1000, streak: 5, level: 2,
          history: bigHistory, achievements: [], reminders: [],
          lastLoggedAt: new Date(), updatedAt: new Date(),
        });
        const res = await request.get(`/api/export/${bigUserId}?format=html`);
        const dataStart = res.text.indexOf('id="history-data"');
        const dataEnd = res.text.indexOf("</script>", dataStart);
        const jsonSlice = res.text.slice(dataStart, dataEnd);
        const matches = (jsonSlice.match(/"completedAt"/g) ?? []).length;
        expect(matches).toBe(35);
      } finally {
        await cleanupTestUser(bigUserId);
      }
    });

    it("HTML contains pagination controls (prev and next buttons)", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain('id="prev-btn"');
      expect(res.text).toContain('id="next-btn"');
    });

    it("HTML contains type filter select", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain('id="type-filter"');
      expect(res.text).toContain("Workout only");
      expect(res.text).toContain("Diet only");
    });

    it("HTML contains sort order select", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain('id="sort-order"');
      expect(res.text).toContain("Newest first");
      expect(res.text).toContain("Oldest first");
    });

    it("HTML contains per-page select with expected options", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain('id="per-page"');
      expect(res.text).toContain(">10<");
      expect(res.text).toContain(">20<");
      expect(res.text).toContain(">50<");
      expect(res.text).toContain(">All<");
    });

    it("HTML contains page-info span and history-tbody", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain('id="page-info"');
      expect(res.text).toContain('id="history-tbody"');
    });

    it("HTML shows correct total entry count in log header", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain("of 2 entries");
    });

    it("history data entries are sorted newest-first by default in the blob", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      const dataEl = res.text.match(/<script type="application\/json" id="history-data">([\s\S]*?)<\/script>/);
      expect(dataEl).not.toBeNull();
      const entries = JSON.parse(dataEl![1]) as { completedAt: string }[];
      if (entries.length >= 2) {
        const first = new Date(entries[0].completedAt).getTime();
        const second = new Date(entries[1].completedAt).getTime();
        expect(first).toBeGreaterThanOrEqual(second);
      }
    });

    it("HTML contains the JS initialisation function", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.text).toContain("applyFilters");
      expect(res.text).toContain("render");
      expect(res.text).toContain("currentPage");
    });
  });

  describe("HTML format — embed mode", () => {
    it("default HTML has Content-Disposition attachment header", async () => {
      const res = await request.get(`/api/export/${userId}?format=html`);
      expect(res.headers["content-disposition"]).toMatch(/attachment/);
      expect(res.headers["content-disposition"]).toMatch(/fitness-report/);
    });

    it("embed=true omits Content-Disposition header entirely", async () => {
      const res = await request.get(`/api/export/${userId}?format=html&embed=true`);
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toBeUndefined();
    });

    it("embed=true still returns valid HTML", async () => {
      const res = await request.get(`/api/export/${userId}?format=html&embed=true`);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("<!DOCTYPE html>");
      expect(res.text).toContain("Test User");
    });

    it("embed=true HTML still contains the full paginated log", async () => {
      const res = await request.get(`/api/export/${userId}?format=html&embed=true`);
      expect(res.text).toContain('id="history-data"');
      expect(res.text).toContain('id="prev-btn"');
      expect(res.text).toContain('id="next-btn"');
      expect(res.text).toContain('id="type-filter"');
    });

    it("embed=false behaves identically to default (attachment)", async () => {
      const res = await request.get(`/api/export/${userId}?format=html&embed=false`);
      expect(res.headers["content-disposition"]).toMatch(/attachment/);
    });

    it("embed param is ignored for non-HTML formats", async () => {
      const resJson = await request.get(`/api/export/${userId}?format=json&embed=true`);
      expect(resJson.status).toBe(200);
      expect(resJson.headers["content-type"]).toMatch(/application\/json/);
    });
  });
});
