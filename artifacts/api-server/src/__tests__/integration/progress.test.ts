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
  userId = uid("prog");
  await createTestUser(userId);
  await db.insert(progress).values({
    userId,
    xp: 200,
    streak: 3,
    level: 1,
    history: [],
    achievements: [],
    reminders: [
      {
        id: "r1",
        message: "Missed workout yesterday",
        type: "missed_workout",
        createdAt: new Date().toISOString(),
        read: false,
      },
      {
        id: "r2",
        message: "Old reminder",
        type: "weekly_report",
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        read: true,
      },
    ],
    lastLoggedAt: new Date(),
    updatedAt: new Date(),
  });
});

afterEach(async () => {
  await cleanupTestUser(userId);
});

describe("PATCH /api/progress/:userId/reminders/read", () => {
  it("returns 404 for unknown user", async () => {
    const res = await request.patch("/api/progress/unknown_prog_xyz/reminders/read").send({});
    expect(res.status).toBe(404);
  });

  it("marks all reminders as read when no ids provided", async () => {
    const res = await request.patch(`/api/progress/${userId}/reminders/read`).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const stateRes = await request.get(`/api/state/${userId}`);
    const reminders = stateRes.body.progress.reminders as { read: boolean }[];
    expect(reminders.every((r) => r.read)).toBe(true);
  });

  it("marks specific reminders as read when ids provided", async () => {
    const res = await request.patch(`/api/progress/${userId}/reminders/read`).send({ ids: ["r1"] });
    expect(res.status).toBe(200);
  });

  it("get_state only returns unread reminders", async () => {
    const stateRes = await request.get(`/api/state/${userId}`);
    const reminders = stateRes.body.progress.reminders as { id: string; read: boolean }[];
    expect(reminders.every((r) => !r.read)).toBe(true);
    const ids = reminders.map((r) => r.id);
    expect(ids).toContain("r1");
    expect(ids).not.toContain("r2");
  });
});
