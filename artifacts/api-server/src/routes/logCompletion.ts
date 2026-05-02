import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { progress } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CompletionEvent } from "@workspace/db";

const router: IRouter = Router();

const XP_WORKOUT = 50;
const XP_DIET = 30;
const XP_STREAK_BONUS = 10;
const XP_PER_LEVEL = 500;

function computeLevel(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

function reinforcementMessage(streak: number, type: "workout" | "diet", leveledUp: boolean): string {
  if (leveledUp) {
    return `Level up! You're on a ${streak}-day streak and crushing it. Keep going!`;
  }
  if (streak >= 7) {
    return `${streak} days straight — that's elite consistency. ${type === "workout" ? "Your body is changing." : "Your habits are locked in."}`;
  }
  if (streak >= 3) {
    return `${streak}-day streak! Momentum is building. Don't stop now.`;
  }
  if (type === "workout") {
    return "Workout logged. Every rep counts. See you tomorrow.";
  }
  return "Diet logged. Fueling right is half the battle. Nice work.";
}

function isConsecutiveDay(lastLoggedAt: Date | null): boolean {
  if (!lastLoggedAt) return false;
  const now = new Date();
  const diffMs = now.getTime() - lastLoggedAt.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours >= 20 && diffHours < 48;
}

router.post("/log-completion", async (req, res) => {
  const body = req.body as { userId: string; type: "workout" | "diet"; notes?: string };

  if (!body.userId || !body.type) {
    res.status(400).json({ error: "userId and type are required" });
    return;
  }

  const now = new Date();
  const existing = await db
    .select()
    .from(progress)
    .where(eq(progress.userId, body.userId))
    .then((r) => r[0] ?? null);

  const baseXp = body.type === "workout" ? XP_WORKOUT : XP_DIET;
  let newStreak = 1;

  if (existing) {
    if (isConsecutiveDay(existing.lastLoggedAt)) {
      newStreak = existing.streak + 1;
    } else if (existing.lastLoggedAt) {
      const diffMs = now.getTime() - existing.lastLoggedAt.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      if (diffHours < 20) {
        newStreak = existing.streak;
      } else {
        newStreak = 1;
      }
    }
  }

  const streakBonus = Math.min(newStreak - 1, 10) * XP_STREAK_BONUS;
  const xpGained = baseXp + streakBonus;
  const prevXp = existing?.xp ?? 0;
  const newXp = prevXp + xpGained;
  const prevLevel = computeLevel(prevXp);
  const newLevel = computeLevel(newXp);
  const leveledUp = newLevel > prevLevel;
  const xpToNextLevel = XP_PER_LEVEL - (newXp % XP_PER_LEVEL);

  const completionEvent: CompletionEvent = {
    type: body.type,
    completedAt: now.toISOString(),
    xpGained,
    notes: body.notes,
  };

  const prevHistory = existing?.history ?? [];
  const newHistory = [...prevHistory, completionEvent].slice(-100);

  if (existing) {
    await db
      .update(progress)
      .set({
        xp: newXp,
        streak: newStreak,
        level: newLevel,
        history: newHistory,
        lastLoggedAt: now,
        updatedAt: now,
      })
      .where(eq(progress.userId, body.userId));
  } else {
    await db.insert(progress).values({
      userId: body.userId,
      xp: newXp,
      streak: newStreak,
      level: newLevel,
      history: newHistory,
      lastLoggedAt: now,
      updatedAt: now,
    });
  }

  const message = reinforcementMessage(newStreak, body.type, leveledUp);

  res.json({
    xpGained,
    totalXp: newXp,
    streak: newStreak,
    level: newLevel,
    leveledUp,
    xpToNextLevel,
    message,
  });
});

export default router;
