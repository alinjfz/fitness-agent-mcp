import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import {
  uid,
  cleanupTestUser,
  makeOpenAIChoice,
  MOCK_WORKOUT_PLAN_RESPONSE,
  MOCK_DIET_PLAN_RESPONSE,
  MOCK_NORMALIZE_RESPONSE,
  MOCK_SCHEDULE_RESPONSE,
} from "../helpers.js";
import { openai } from "@workspace/integrations-openai-ai-server";

const request = supertest(app);
const mockCreate = vi.mocked(openai.chat.completions.create);

let userId: string;

beforeEach(() => {
  userId = uid("wf");
});

afterEach(async () => {
  await cleanupTestUser(userId);
  vi.clearAllMocks();
});

describe("End-to-end: full onboarding → plan → log → export", () => {
  it("completes the full user journey", async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(MOCK_NORMALIZE_RESPONSE) as never);
    const normalizeRes = await request.post("/api/normalize").send({
      input: "I'm Jane, I want to build muscle, I train Mon Wed Fri, I have dumbbells",
    });
    expect(normalizeRes.status).toBe(200);
    const extracted = normalizeRes.body.extracted as { profile: Record<string, unknown> };

    const saveRes = await request.put(`/api/state/${userId}`).send({
      profile: {
        name: extracted.profile.name ?? "Jane",
        goal: "build_muscle",
        age: 28,
        allergies: [],
        preferences: [],
        availableDays: ["monday", "wednesday", "friday"],
        sessionDurationMin: 60,
        equipment: ["dumbbells"],
        injuries: [],
        mode: "auto",
      },
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.profile.userId).toBe(userId);

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
    const planRes = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(planRes.status).toBe(200);
    expect(planRes.body.saved).toBe(true);

    const logRes = await request.post("/api/log-completion").send({
      userId,
      type: "workout",
      notes: "First workout done!",
    });
    expect(logRes.status).toBe(200);
    expect(logRes.body.streak).toBe(1);
    expect(logRes.body.xpGained).toBeGreaterThan(0);
    const firstWorkoutUnlocked = ((logRes.body.newAchievements ?? []) as { name: string }[]).some(
      (a) => a.name === "First Rep"
    );
    expect(firstWorkoutUnlocked).toBe(true);

    const stateRes = await request.get(`/api/state/${userId}`);
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.workoutPlan).not.toBeNull();
    expect(stateRes.body.progress).not.toBeNull();
    expect(stateRes.body.progress.xp).toBeGreaterThan(0);

    const exportRes = await request.get(`/api/export/${userId}?format=json`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.progress.workoutLogs).toBe(1);
    expect(exportRes.body.achievements.length).toBeGreaterThan(0);
  });
});

describe("End-to-end: confirm mode round-trip", () => {
  it("previews plan then confirms and saves it", async () => {
    await request.put(`/api/state/${userId}`).send({
      profile: {
        name: "Confirm User",
        goal: "lose_weight",
        age: 30,
        allergies: [],
        preferences: [],
        availableDays: ["tuesday", "thursday"],
        sessionDurationMin: 30,
        equipment: [],
        injuries: [],
        mode: "confirm",
      },
    });

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
    const previewRes = await request.post("/api/generate-plan").send({ userId, type: "workout" });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.requiresConfirmation).toBe(true);
    expect(previewRes.body.saved).toBe(false);

    let stateCheck = await request.get(`/api/state/${userId}`);
    expect(stateCheck.body.workoutPlan).toBeNull();

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(MOCK_WORKOUT_PLAN_RESPONSE) as never);
    const confirmRes = await request.post("/api/generate-plan").send({ userId, type: "workout", confirmed: true });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.saved).toBe(true);
    expect(confirmRes.body.requiresConfirmation).toBeUndefined();

    stateCheck = await request.get(`/api/state/${userId}`);
    expect(stateCheck.body.workoutPlan).not.toBeNull();
  });

  it("schedule events confirm mode round-trip", async () => {
    await request.put(`/api/state/${userId}`).send({
      profile: {
        name: "Schedule Confirm User",
        goal: "maintain",
        age: 25,
        allergies: [],
        preferences: [],
        availableDays: ["monday", "wednesday"],
        sessionDurationMin: 45,
        equipment: [],
        injuries: [],
        mode: "confirm",
      },
    });

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(MOCK_SCHEDULE_RESPONSE) as never);
    const previewRes = await request.post("/api/schedule-events").send({
      userId,
      description: "schedule workouts for a week",
      durationDays: 7,
    });
    expect(previewRes.body.requiresConfirmation).toBe(true);
    expect(previewRes.body.saved).toBe(false);

    let stateCheck = await request.get(`/api/state/${userId}`);
    expect(stateCheck.body.schedule).toBeNull();

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(MOCK_SCHEDULE_RESPONSE) as never);
    const confirmRes = await request.post("/api/schedule-events").send({
      userId,
      confirmed: true,
      durationDays: 7,
    });
    expect(confirmRes.body.saved).toBe(true);

    stateCheck = await request.get(`/api/state/${userId}`);
    expect(stateCheck.body.schedule).not.toBeNull();
  });
});

describe("End-to-end: multiple logs accumulate XP and level", () => {
  beforeEach(async () => {
    await request.put(`/api/state/${userId}`).send({
      profile: {
        name: "Grinder",
        goal: "build_muscle",
        age: 22,
        allergies: [],
        preferences: [],
        availableDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        sessionDurationMin: 60,
        equipment: [],
        injuries: [],
        mode: "auto",
      },
    });
  });

  it("XP accumulates across multiple log calls", async () => {
    const log1 = await request.post("/api/log-completion").send({ userId, type: "workout" });
    const log2 = await request.post("/api/log-completion").send({ userId, type: "diet" });
    const log3 = await request.post("/api/log-completion").send({ userId, type: "workout" });

    expect(log1.body.totalXp).toBeGreaterThan(0);
    expect(log2.body.totalXp).toBeGreaterThan(log1.body.totalXp);
    expect(log3.body.totalXp).toBeGreaterThan(log2.body.totalXp);
  });

  it("xpToNextLevel decreases as XP accumulates", async () => {
    const log1 = await request.post("/api/log-completion").send({ userId, type: "workout" });
    const log2 = await request.post("/api/log-completion").send({ userId, type: "workout" });
    expect(log2.body.xpToNextLevel).toBeLessThanOrEqual(log1.body.xpToNextLevel);
  });

  it("total XP in get_state matches the last log_completion totalXp", async () => {
    await request.post("/api/log-completion").send({ userId, type: "workout" });
    const log2 = await request.post("/api/log-completion").send({ userId, type: "diet" });
    const stateRes = await request.get(`/api/state/${userId}`);
    expect(stateRes.body.progress.xp).toBe(log2.body.totalXp);
  });
});

describe("End-to-end: diet plan → export CSV contains plan info", () => {
  it("export CSV includes goal from profile", async () => {
    await request.put(`/api/state/${userId}`).send({
      profile: {
        name: "CSV User",
        goal: "lose_weight",
        age: 40,
        allergies: [],
        preferences: [],
        availableDays: ["monday"],
        sessionDurationMin: 30,
        equipment: [],
        injuries: [],
        mode: "auto",
      },
    });

    mockCreate.mockResolvedValueOnce(makeOpenAIChoice(MOCK_DIET_PLAN_RESPONSE) as never);
    await request.post("/api/generate-plan").send({ userId, type: "diet" });

    const exportRes = await request.get(`/api/export/${userId}?format=csv`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text).toContain("lose_weight");
    expect(exportRes.text).toContain("CSV User");
  });
});

describe("End-to-end: reminders cleared after reading", () => {
  it("reminder created by cron is cleared by mark-read then absent in get_state", async () => {
    await request.put(`/api/state/${userId}`).send({
      profile: {
        name: "Reminder User",
        goal: "maintain",
        age: 30,
        allergies: [],
        preferences: [],
        availableDays: ["monday"],
        sessionDurationMin: 30,
        equipment: [],
        injuries: [],
        mode: "auto",
      },
    });

    const { db: dbImport, progress: progressTable } = await import("@workspace/db");
    const now = new Date();
    await dbImport.insert(progressTable).values({
      userId,
      xp: 0,
      streak: 0,
      level: 1,
      history: [],
      achievements: [],
      reminders: [
        { id: "test_reminder_1", message: "Miss workout", type: "missed_workout", createdAt: now.toISOString(), read: false },
      ],
      lastLoggedAt: null,
      updatedAt: now,
    });

    let stateRes = await request.get(`/api/state/${userId}`);
    const unread = stateRes.body.progress.reminders as { id: string }[];
    expect(unread.find((r) => r.id === "test_reminder_1")).toBeDefined();

    await request.patch(`/api/progress/${userId}/reminders/read`).send({ ids: ["test_reminder_1"] });

    stateRes = await request.get(`/api/state/${userId}`);
    const afterRead = stateRes.body.progress.reminders as { id: string }[];
    expect(afterRead.find((r) => r.id === "test_reminder_1")).toBeUndefined();
  });
});
