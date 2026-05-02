import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import { uid, createTestUser, cleanupTestUser } from "../helpers.js";

const request = supertest(app);

let userId: string;

beforeEach(async () => {
  userId = uid("state");
  await createTestUser(userId);
});

afterEach(async () => {
  await cleanupTestUser(userId);
});

describe("GET /api/state/:userId", () => {
  it("returns 200 with full state for existing user", async () => {
    const res = await request.get(`/api/state/${userId}`);
    expect(res.status).toBe(200);
    expect(res.body.profile).not.toBeNull();
    expect(res.body.profile.userId).toBe(userId);
    expect(res.body.profile.name).toBe("Test User");
    expect(res.body.profile.goal).toBe("build_muscle");
  });

  it("returns 404 for unknown user", async () => {
    const res = await request.get("/api/state/user_does_not_exist_xyz");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("includes null fields for missing plans", async () => {
    const res = await request.get(`/api/state/${userId}`);
    expect(res.status).toBe(200);
    expect(res.body.dietPlan).toBeNull();
    expect(res.body.workoutPlan).toBeNull();
    expect(res.body.schedule).toBeNull();
    expect(res.body.progress).toBeNull();
  });

  it("returns correct allergies array", async () => {
    const res = await request.get(`/api/state/${userId}`);
    expect(res.body.profile.allergies).toEqual(["nuts"]);
  });

  it("returns numeric weightKg (not string)", async () => {
    const res = await request.get(`/api/state/${userId}`);
    expect(typeof res.body.profile.weightKg).toBe("number");
    expect(res.body.profile.weightKg).toBe(80);
  });
});

describe("PUT /api/state/:userId", () => {
  it("creates a new user profile when none exists", async () => {
    const newUserId = uid("state_new");
    try {
      const res = await request.put(`/api/state/${newUserId}`).send({
        profile: {
          name: "New User",
          age: 25,
          goal: "lose_weight",
          allergies: ["gluten"],
          preferences: [],
          availableDays: ["tuesday", "thursday"],
          sessionDurationMin: 30,
          equipment: [],
          injuries: [],
          mode: "auto",
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.profile.name).toBe("New User");
      expect(res.body.profile.goal).toBe("lose_weight");
    } finally {
      await cleanupTestUser(newUserId);
    }
  });

  it("updates only the profile when only profile is provided", async () => {
    const res = await request.put(`/api/state/${userId}`).send({
      profile: { name: "Updated Name" },
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.name).toBe("Updated Name");
    expect(res.body.profile.goal).toBe("build_muscle");
  });

  it("saves a diet plan", async () => {
    const res = await request.put(`/api/state/${userId}`).send({
      dietPlan: {
        meals: [{ name: "Breakfast", time: "08:00", calories: 500, protein: 30, carbs: 50, fat: 15, ingredients: ["eggs"] }],
        dailyCalories: 2000,
        macros: { proteinG: 150, carbsG: 200, fatG: 65 },
        notes: "Test plan",
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.dietPlan).not.toBeNull();
    expect(res.body.dietPlan.dailyCalories).toBe(2000);
  });

  it("saves a workout plan", async () => {
    const res = await request.put(`/api/state/${userId}`).send({
      workoutPlan: {
        sessions: [{ day: "monday", name: "Push Day", durationMin: 60, exercises: [{ name: "Bench Press", sets: 4, reps: 8, restSec: 120 }] }],
        notes: "Push/Pull/Legs",
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.workoutPlan).not.toBeNull();
    expect(Array.isArray((res.body.workoutPlan.sessions as unknown[]))).toBe(true);
  });

  it("saves a schedule", async () => {
    const res = await request.put(`/api/state/${userId}`).send({
      schedule: {
        events: [{ title: "Push Day", date: "2026-06-02", time: "07:00", type: "workout", durationMin: 60 }],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.schedule).not.toBeNull();
    expect((res.body.schedule.events as unknown[]).length).toBe(1);
  });

  it("can update mode to confirm", async () => {
    const res = await request.put(`/api/state/${userId}`).send({
      profile: { mode: "confirm" },
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.mode).toBe("confirm");
  });
});
