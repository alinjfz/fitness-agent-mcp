import { Router, type IRouter } from "express";
import { db, progress } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CompletionEvent } from "@workspace/db";
import { computeLevel } from "../lib/gamification";

const router: IRouter = Router();

router.post("/debug/seed-history/:userId", async (req, res) => {
  const { userId } = req.params;

  const existing = await db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0] ?? null);
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  const now = new Date();
  const generated: CompletionEvent[] = [];

  const patterns = [
    { daysAgo: 30, workouts: 1, diet: 1 },
    { daysAgo: 29, workouts: 1, diet: 2 },
    { daysAgo: 28, workouts: 0, diet: 1 },
    { daysAgo: 27, workouts: 2, diet: 2 },
    { daysAgo: 26, workouts: 1, diet: 1 },
    { daysAgo: 25, workouts: 0, diet: 2 },
    { daysAgo: 24, workouts: 2, diet: 1 },
    { daysAgo: 23, workouts: 1, diet: 2 },
    { daysAgo: 22, workouts: 1, diet: 1 },
    { daysAgo: 21, workouts: 2, diet: 2 },
    { daysAgo: 20, workouts: 0, diet: 1 },
    { daysAgo: 19, workouts: 1, diet: 2 },
    { daysAgo: 18, workouts: 2, diet: 1 },
    { daysAgo: 17, workouts: 1, diet: 2 },
    { daysAgo: 16, workouts: 0, diet: 1 },
    { daysAgo: 15, workouts: 2, diet: 2 },
    { daysAgo: 14, workouts: 1, diet: 1 },
    { daysAgo: 13, workouts: 2, diet: 2 },
    { daysAgo: 12, workouts: 1, diet: 1 },
    { daysAgo: 11, workouts: 0, diet: 2 },
    { daysAgo: 10, workouts: 2, diet: 1 },
    { daysAgo: 9, workouts: 1, diet: 2 },
    { daysAgo: 8, workouts: 2, diet: 2 },
    { daysAgo: 7, workouts: 1, diet: 1 },
    { daysAgo: 6, workouts: 2, diet: 2 },
    { daysAgo: 5, workouts: 1, diet: 1 },
    { daysAgo: 4, workouts: 2, diet: 2 },
    { daysAgo: 3, workouts: 1, diet: 1 },
    { daysAgo: 2, workouts: 2, diet: 2 },
    { daysAgo: 1, workouts: 1, diet: 2 },
  ];

  for (const { daysAgo, workouts, diet } of patterns) {
    const base = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    for (let w = 0; w < workouts; w++) {
      base.setHours(7 + w * 2, 30, 0, 0);
      generated.push({ type: "workout", completedAt: new Date(base).toISOString(), xpGained: 50, notes: undefined });
    }
    for (let d = 0; d < diet; d++) {
      base.setHours(12 + d * 6, 0, 0, 0);
      generated.push({ type: "diet", completedAt: new Date(base).toISOString(), xpGained: 30, notes: undefined });
    }
  }

  const prevHistory = (existing.history ?? []) as CompletionEvent[];
  const newHistory = [...generated, ...prevHistory].slice(-200);
  const totalXpAdded = generated.reduce((s, e) => s + (e.xpGained ?? 0), 0);
  const newXp = (existing.xp ?? 0) + totalXpAdded;
  const newLevel = computeLevel(newXp);

  await db.update(progress).set({ history: newHistory, xp: newXp, level: newLevel, updatedAt: new Date() }).where(eq(progress.userId, userId));
  res.json({ success: true, added: generated.length, totalHistory: newHistory.length, newXp });
});

export default router;
