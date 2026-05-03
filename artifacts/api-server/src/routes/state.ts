import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  userProfiles,
  dietPlans,
  workoutPlans,
  schedules,
  progress,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeLevel, xpToNextLevel } from "../lib/gamification";

const router: IRouter = Router();

async function buildState(userId: string) {
  const [profile, dietPlan, workoutPlan, schedule, prog] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null),
    db.select().from(dietPlans).where(eq(dietPlans.userId, userId)).then((r) => r[0] ?? null),
    db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).then((r) => r[0] ?? null),
    db.select().from(schedules).where(eq(schedules.userId, userId)).then((r) => r[0] ?? null),
    db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0] ?? null),
  ]);

  const xp = prog?.xp ?? 0;
  const level = computeLevel(xp);
  const nextLevelXp = xpToNextLevel(xp);

  return {
    profile: profile
      ? {
          userId: profile.userId,
          name: profile.name,
          age: profile.age,
          weightKg: profile.weightKg ?? null,
          heightCm: profile.heightCm ?? null,
          goal: profile.goal,
          allergies: profile.allergies,
          preferences: profile.preferences,
          budgetPerWeek: profile.budgetPerWeek ?? null,
          availableDays: profile.availableDays,
          sessionDurationMin: profile.sessionDurationMin,
          equipment: profile.equipment,
          injuries: profile.injuries,
          mode: profile.mode,
        }
      : null,
    dietPlan: dietPlan
      ? { meals: dietPlan.meals, dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros, notes: dietPlan.notes }
      : null,
    workoutPlan: workoutPlan
      ? { sessions: workoutPlan.sessions, notes: workoutPlan.notes }
      : null,
    schedule: schedule ? { events: schedule.events } : null,
    progress: prog
      ? {
          xp: prog.xp,
          streak: prog.streak,
          level,
          history: prog.history,
          achievements: prog.achievements ?? [],
          reminders: (prog.reminders ?? []).filter((r: { read: boolean }) => !r.read),
          lastLoggedAt: prog.lastLoggedAt?.toISOString() ?? null,
          xpToNextLevel: nextLevelXp,
        }
      : null,
  };
}

router.get("/state/:userId", async (req, res) => {
  const { userId } = req.params;
  const state = await buildState(userId);

  if (!state.profile) {
    res.status(404).json({ error: `No state found for user '${userId}'` });
    return;
  }

  res.json(state);
});

router.put("/state/:userId", async (req, res) => {
  const { userId } = req.params;
  const body = req.body as {
    profile?: Record<string, unknown>;
    dietPlan?: Record<string, unknown>;
    workoutPlan?: Record<string, unknown>;
    schedule?: Record<string, unknown>;
  };

  const now = new Date();

  if (body.profile) {
    const p = body.profile;
    await db
      .insert(userProfiles)
      .values({
        userId,
        name: (p.name as string) ?? "Unknown",
        age: p.age as number | undefined,
        weightKg: p.weightKg != null ? p.weightKg as number : undefined,
        heightCm: p.heightCm != null ? p.heightCm as number : undefined,
        goal: (p.goal as string) ?? "maintain",
        allergies: (p.allergies as string[]) ?? [],
        preferences: (p.preferences as string[]) ?? [],
        budgetPerWeek: p.budgetPerWeek != null ? p.budgetPerWeek as number : undefined,
        availableDays: (p.availableDays as string[]) ?? [],
        sessionDurationMin: p.sessionDurationMin as number | undefined,
        equipment: (p.equipment as string[]) ?? [],
        injuries: (p.injuries as string[]) ?? [],
        mode: (p.mode as string) ?? "auto",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          ...(p.name !== undefined && { name: p.name as string }),
          ...(p.age !== undefined && { age: p.age as number }),
          ...(p.weightKg !== undefined && { weightKg: p.weightKg as number }),
          ...(p.heightCm !== undefined && { heightCm: p.heightCm as number }),
          ...(p.goal !== undefined && { goal: p.goal as string }),
          ...(p.allergies !== undefined && { allergies: p.allergies as string[] }),
          ...(p.preferences !== undefined && { preferences: p.preferences as string[] }),
          ...(p.budgetPerWeek !== undefined && { budgetPerWeek: p.budgetPerWeek as number }),
          ...(p.availableDays !== undefined && { availableDays: p.availableDays as string[] }),
          ...(p.sessionDurationMin !== undefined && { sessionDurationMin: p.sessionDurationMin as number }),
          ...(p.equipment !== undefined && { equipment: p.equipment as string[] }),
          ...(p.injuries !== undefined && { injuries: p.injuries as string[] }),
          ...(p.mode !== undefined && { mode: p.mode as string }),
          updatedAt: now,
        },
      });
  }

  if (body.dietPlan) {
    const d = body.dietPlan;
    await db
      .insert(dietPlans)
      .values({
        userId,
        meals: d.meals,
        dailyCalories: d.dailyCalories as number,
        macros: d.macros,
        notes: d.notes as string | undefined,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: dietPlans.userId,
        set: { meals: d.meals, dailyCalories: d.dailyCalories as number, macros: d.macros, notes: d.notes as string | undefined, updatedAt: now },
      });
  }

  if (body.workoutPlan) {
    const w = body.workoutPlan;
    await db
      .insert(workoutPlans)
      .values({ userId, sessions: w.sessions, notes: w.notes as string | undefined, updatedAt: now })
      .onConflictDoUpdate({
        target: workoutPlans.userId,
        set: { sessions: w.sessions, notes: w.notes as string | undefined, updatedAt: now },
      });
  }

  if (body.schedule) {
    const s = body.schedule;
    await db
      .insert(schedules)
      .values({ userId, events: s.events, updatedAt: now })
      .onConflictDoUpdate({
        target: schedules.userId,
        set: { events: s.events, updatedAt: now },
      });
  }

  res.json(await buildState(userId));
});

export default router;
