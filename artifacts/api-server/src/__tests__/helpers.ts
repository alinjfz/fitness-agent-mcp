import { db, userProfiles, dietPlans, workoutPlans, schedules, progress } from "@workspace/db";
import { eq } from "drizzle-orm";

export const MOCK_WORKOUT_PLAN_RESPONSE = {
  sessions: [
    {
      day: "monday",
      name: "Full Body",
      durationMin: 45,
      exercises: [{ name: "Squat", sets: 3, reps: 10, restSec: 60 }],
    },
  ],
  notes: "Test workout plan",
};

export const MOCK_DIET_PLAN_RESPONSE = {
  meals: [
    {
      name: "Breakfast",
      time: "08:00",
      calories: 500,
      protein: 30,
      carbs: 50,
      fat: 15,
      ingredients: ["eggs", "oats"],
    },
  ],
  dailyCalories: 2000,
  macros: { proteinG: 150, carbsG: 200, fatG: 65 },
  notes: "Test diet plan",
};

export const MOCK_NORMALIZE_RESPONSE = {
  extracted: {
    profile: {
      name: "Jane Test",
      goal: "build_muscle",
      availableDays: ["monday", "wednesday", "friday"],
    },
  },
  confidence: "high",
  notes: "Extracted name, goal, and available days",
};

export const MOCK_SCHEDULE_RESPONSE = {
  events: [
    {
      title: "Full Body",
      date: "2026-06-02",
      time: "07:00",
      type: "workout",
      durationMin: 45,
    },
    {
      title: "Full Body",
      date: "2026-06-04",
      time: "07:00",
      type: "workout",
      durationMin: 45,
    },
  ],
};

export function makeOpenAIChoice(content: object) {
  return {
    choices: [{ message: { content: JSON.stringify(content) } }],
  };
}

export function uid(prefix = "test") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createTestUser(userId: string) {
  await db
    .insert(userProfiles)
    .values({
      userId,
      name: "Test User",
      age: 28,
      weightKg: "80",
      heightCm: "175",
      goal: "build_muscle",
      allergies: ["nuts"],
      preferences: ["chicken"],
      availableDays: ["monday", "wednesday", "friday"],
      sessionDurationMin: 60,
      equipment: ["barbell", "dumbbells"],
      injuries: [],
      mode: "auto",
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { name: "Test User", updatedAt: new Date() },
    });
}

export async function createTestUserConfirmMode(userId: string) {
  await db
    .insert(userProfiles)
    .values({
      userId,
      name: "Confirm User",
      age: 30,
      goal: "lose_weight",
      allergies: [],
      preferences: [],
      availableDays: ["tuesday", "thursday"],
      sessionDurationMin: 30,
      equipment: [],
      injuries: [],
      mode: "confirm",
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { mode: "confirm", updatedAt: new Date() },
    });
}

export async function cleanupTestUser(userId: string) {
  await Promise.all([
    db.delete(userProfiles).where(eq(userProfiles.userId, userId)),
    db.delete(dietPlans).where(eq(dietPlans.userId, userId)),
    db.delete(workoutPlans).where(eq(workoutPlans.userId, userId)),
    db.delete(schedules).where(eq(schedules.userId, userId)),
    db.delete(progress).where(eq(progress.userId, userId)),
  ]);
}

export function parseSseData(text: string): unknown {
  const lines = text.split("\n");
  const dataLine = lines.find((l) => l.startsWith("data: "));
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine.slice(6));
  } catch {
    return null;
  }
}
