import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import supertest from "supertest";
import app from "../../app.js";
import { uid, cleanupTestUser } from "../helpers.js";

const request = supertest(app);
let userId: string;

beforeEach(() => {
  userId = uid("stateext");
});

afterEach(async () => {
  await cleanupTestUser(userId);
});

const baseProfile = {
  name: "Edge Case User",
  age: 35,
  weightKg: 72.5,
  heightCm: 168,
  goal: "maintain",
  allergies: [],
  preferences: [],
  availableDays: ["monday"],
  sessionDurationMin: 45,
  equipment: [],
  injuries: [],
  mode: "auto",
};

describe("PUT /api/state/:userId — goal types", () => {
  for (const goal of ["lose_weight", "build_muscle", "maintain", "improve_endurance"] as const) {
    it(`accepts goal="${goal}"`, async () => {
      const res = await request.put(`/api/state/${userId}`).send({ profile: { ...baseProfile, goal } });
      expect(res.status).toBe(200);
      expect(res.body.profile.goal).toBe(goal);
    });
  }
});

describe("PUT /api/state/:userId — mode values", () => {
  it("accepts mode=auto", async () => {
    const res = await request.put(`/api/state/${userId}`).send({ profile: { ...baseProfile, mode: "auto" } });
    expect(res.status).toBe(200);
    expect(res.body.profile.mode).toBe("auto");
  });

  it("accepts mode=confirm", async () => {
    const res = await request.put(`/api/state/${userId}`).send({ profile: { ...baseProfile, mode: "confirm" } });
    expect(res.status).toBe(200);
    expect(res.body.profile.mode).toBe("confirm");
  });
});

describe("PUT /api/state/:userId — partial updates", () => {
  beforeEach(async () => {
    await request.put(`/api/state/${userId}`).send({ profile: baseProfile });
  });

  it("updating name preserves goal", async () => {
    const res = await request.put(`/api/state/${userId}`).send({ profile: { name: "New Name" } });
    expect(res.status).toBe(200);
    expect(res.body.profile.name).toBe("New Name");
    expect(res.body.profile.goal).toBe("maintain");
  });

  it("updating allergies preserves name and age", async () => {
    const res = await request.put(`/api/state/${userId}`).send({ profile: { allergies: ["soy"] } });
    expect(res.status).toBe(200);
    expect(res.body.profile.allergies).toEqual(["soy"]);
    expect(res.body.profile.name).toBe("Edge Case User");
    expect(res.body.profile.age).toBe(35);
  });

  it("updating availableDays replaces the whole array", async () => {
    const res = await request.put(`/api/state/${userId}`).send({
      profile: { availableDays: ["tuesday", "thursday", "saturday"] },
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.availableDays).toEqual(["tuesday", "thursday", "saturday"]);
  });

  it("can clear injuries array to empty", async () => {
    await request.put(`/api/state/${userId}`).send({ profile: { injuries: ["knee"] } });
    const res = await request.put(`/api/state/${userId}`).send({ profile: { injuries: [] } });
    expect(res.status).toBe(200);
    expect(res.body.profile.injuries).toEqual([]);
  });

  it("setting budgetPerWeek works", async () => {
    const res = await request.put(`/api/state/${userId}`).send({ profile: { budgetPerWeek: 150.50 } });
    expect(res.status).toBe(200);
    expect(Number(res.body.profile.budgetPerWeek)).toBeCloseTo(150.50, 1);
  });

  it("second PUT is idempotent (same data → same result)", async () => {
    const res1 = await request.put(`/api/state/${userId}`).send({ profile: baseProfile });
    const res2 = await request.put(`/api/state/${userId}`).send({ profile: baseProfile });
    expect(res1.body.profile.name).toBe(res2.body.profile.name);
    expect(res1.body.profile.goal).toBe(res2.body.profile.goal);
  });
});

describe("PUT /api/state/:userId — arrays", () => {
  it("accepts multiple allergies", async () => {
    const allergies = ["nuts", "dairy", "gluten", "soy"];
    const res = await request.put(`/api/state/${userId}`).send({ profile: { ...baseProfile, allergies } });
    expect(res.body.profile.allergies).toEqual(allergies);
  });

  it("accepts multiple equipment items", async () => {
    const equipment = ["barbell", "dumbbells", "pull-up bar", "resistance bands"];
    const res = await request.put(`/api/state/${userId}`).send({ profile: { ...baseProfile, equipment } });
    expect(res.body.profile.equipment).toEqual(equipment);
  });

  it("accepts all 7 days as availableDays", async () => {
    const allDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const res = await request.put(`/api/state/${userId}`).send({ profile: { ...baseProfile, availableDays: allDays } });
    expect(res.body.profile.availableDays).toEqual(allDays);
  });
});

describe("GET /api/state/:userId — data type coercions", () => {
  beforeEach(async () => {
    await request.put(`/api/state/${userId}`).send({
      profile: { ...baseProfile, weightKg: 85.3, heightCm: 182.5, budgetPerWeek: 200 },
    });
  });

  it("weightKg is returned as a number", async () => {
    const res = await request.get(`/api/state/${userId}`);
    expect(typeof res.body.profile.weightKg).toBe("number");
  });

  it("heightCm is returned as a number", async () => {
    const res = await request.get(`/api/state/${userId}`);
    expect(typeof res.body.profile.heightCm).toBe("number");
  });

  it("progress is null when no log has been made", async () => {
    const res = await request.get(`/api/state/${userId}`);
    expect(res.body.progress).toBeNull();
  });
});

describe("PUT /api/state/:userId — diet and workout plan updates", () => {
  beforeEach(async () => {
    await request.put(`/api/state/${userId}`).send({ profile: baseProfile });
  });

  it("can update diet and workout plan in same request", async () => {
    const res = await request.put(`/api/state/${userId}`).send({
      dietPlan: {
        meals: [{ name: "Lunch", time: "12:00", calories: 700, protein: 45, carbs: 70, fat: 20, ingredients: ["chicken"] }],
        dailyCalories: 2200,
        macros: { proteinG: 180, carbsG: 220, fatG: 70 },
      },
      workoutPlan: {
        sessions: [{ day: "friday", name: "Leg Day", durationMin: 75, exercises: [{ name: "Squat", sets: 5, reps: 5, restSec: 180 }] }],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.dietPlan).not.toBeNull();
    expect(res.body.workoutPlan).not.toBeNull();
  });

  it("overwriting diet plan replaces all meals", async () => {
    await request.put(`/api/state/${userId}`).send({
      dietPlan: {
        meals: [{ name: "Breakfast", time: "08:00", calories: 500, protein: 30, carbs: 50, fat: 15, ingredients: [] }],
        dailyCalories: 1800,
        macros: { proteinG: 120, carbsG: 180, fatG: 55 },
      },
    });
    const res = await request.put(`/api/state/${userId}`).send({
      dietPlan: {
        meals: [
          { name: "Lunch", time: "12:00", calories: 700, protein: 45, carbs: 70, fat: 20, ingredients: [] },
          { name: "Dinner", time: "19:00", calories: 800, protein: 50, carbs: 80, fat: 25, ingredients: [] },
        ],
        dailyCalories: 2100,
        macros: { proteinG: 150, carbsG: 200, fatG: 65 },
      },
    });
    expect(res.status).toBe(200);
    expect((res.body.dietPlan.meals as unknown[]).length).toBe(2);
    expect(res.body.dietPlan.dailyCalories).toBe(2100);
  });
});
