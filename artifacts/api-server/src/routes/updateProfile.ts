import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userProfiles } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.put("/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  const body = req.body as {
    name?: string;
    age?: number;
    weightKg?: number;
    heightCm?: number;
    goal?: string;
    allergies?: string[];
    preferences?: string[];
    budgetPerWeek?: number;
    availableDays?: string[];
    sessionDurationMin?: number;
    equipment?: string[];
    injuries?: string[];
    mode?: string;
  };

  const now = new Date();

  await db
    .insert(userProfiles)
    .values({
      userId,
      name: body.name ?? "Unknown",
      age: body.age,
      weightKg: body.weightKg != null ? String(body.weightKg) : undefined,
      heightCm: body.heightCm != null ? String(body.heightCm) : undefined,
      goal: body.goal ?? "maintain",
      allergies: body.allergies ?? [],
      preferences: body.preferences ?? [],
      budgetPerWeek: body.budgetPerWeek != null ? String(body.budgetPerWeek) : undefined,
      availableDays: body.availableDays ?? [],
      sessionDurationMin: body.sessionDurationMin,
      equipment: body.equipment ?? [],
      injuries: body.injuries ?? [],
      mode: body.mode ?? "auto",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.age !== undefined && { age: body.age }),
        ...(body.weightKg !== undefined && { weightKg: String(body.weightKg) }),
        ...(body.heightCm !== undefined && { heightCm: String(body.heightCm) }),
        ...(body.goal !== undefined && { goal: body.goal }),
        ...(body.allergies !== undefined && { allergies: body.allergies }),
        ...(body.preferences !== undefined && { preferences: body.preferences }),
        ...(body.budgetPerWeek !== undefined && { budgetPerWeek: String(body.budgetPerWeek) }),
        ...(body.availableDays !== undefined && { availableDays: body.availableDays }),
        ...(body.sessionDurationMin !== undefined && { sessionDurationMin: body.sessionDurationMin }),
        ...(body.equipment !== undefined && { equipment: body.equipment }),
        ...(body.injuries !== undefined && { injuries: body.injuries }),
        ...(body.mode !== undefined && { mode: body.mode }),
        updatedAt: now,
      },
    });

  const updated = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .then((r) => r[0] ?? null);

  res.json({ profile: updated });
});

router.get("/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  const profile = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .then((r) => r[0] ?? null);

  if (!profile) {
    res.status(404).json({ error: `No profile found for user '${userId}'` });
    return;
  }

  res.json({ profile });
});

export default router;
