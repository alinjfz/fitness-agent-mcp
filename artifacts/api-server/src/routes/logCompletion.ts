import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { progress } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CompletionEvent } from "@workspace/db";
import {
  XP_WORKOUT,
  XP_DIET,
  XP_STREAK_BONUS_PER_DAY,
  XP_PER_LEVEL,
  XP_WEEKLY_BONUS,
  MAX_STREAK_BONUS_DAYS,
  computeLevel,
  xpToNextLevel,
  computeNewStreak,
  checkNewAchievements,
  checkWeeklyBonus,
  reinforcementMessage,
} from "../lib/gamification";

const router: IRouter = Router();

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
  const newStreak = computeNewStreak(existing?.streak ?? 0, existing?.lastLoggedAt ?? null);
  const streakBonus = Math.min(newStreak - 1, MAX_STREAK_BONUS_DAYS) * XP_STREAK_BONUS_PER_DAY;

  const prevXp = existing?.xp ?? 0;
  const prevHistory = (existing?.history ?? []) as CompletionEvent[];
  const prevAchievements = (existing?.achievements ?? []) as import("@workspace/db").Achievement[];

  const completionEvent: CompletionEvent = {
    type: body.type,
    completedAt: now.toISOString(),
    xpGained: baseXp + streakBonus,
    notes: body.notes,
  };
  const newHistory = [...prevHistory, completionEvent].slice(-100);

  const prevLevel = computeLevel(prevXp);
  let xpGained = baseXp + streakBonus;

  const weeklyBonus = checkWeeklyBonus(newHistory);
  if (weeklyBonus) {
    const alreadyThisWeek = newHistory.slice(0, -1).filter((h) => {
      const d = new Date(h.completedAt);
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d >= oneWeekAgo;
    }).length;
    if (alreadyThisWeek < 5) {
      xpGained += XP_WEEKLY_BONUS;
      completionEvent.notes = (completionEvent.notes ? completionEvent.notes + " | " : "") + `Weekly bonus: +${XP_WEEKLY_BONUS} XP!`;
    }
  }

  completionEvent.xpGained = xpGained;
  const newXp = prevXp + xpGained;
  const newLevel = computeLevel(newXp);
  const leveledUp = newLevel > prevLevel;
  const nextLevelXp = xpToNextLevel(newXp);

  const unlocked = checkNewAchievements(prevAchievements, newStreak, newLevel, newHistory);
  const bonusXpFromAchievements = unlocked.reduce((sum, a) => sum + a.xpBonus, 0);
  const finalXp = newXp + bonusXpFromAchievements;
  const finalLevel = computeLevel(finalXp);

  const allAchievements = [...prevAchievements, ...unlocked];
  const reminders = (existing?.reminders ?? []) as import("@workspace/db").Reminder[];

  if (existing) {
    await db
      .update(progress)
      .set({
        xp: finalXp,
        streak: newStreak,
        level: finalLevel,
        history: newHistory,
        achievements: allAchievements,
        lastLoggedAt: now,
        updatedAt: now,
      })
      .where(eq(progress.userId, body.userId));
  } else {
    await db.insert(progress).values({
      userId: body.userId,
      xp: finalXp,
      streak: newStreak,
      level: finalLevel,
      history: newHistory,
      achievements: allAchievements,
      reminders: [],
      lastLoggedAt: now,
      updatedAt: now,
    });
  }

  const message = reinforcementMessage(newStreak, body.type, leveledUp || finalLevel > newLevel, unlocked);

  res.json({
    xpGained: finalXp - prevXp,
    totalXp: finalXp,
    streak: newStreak,
    level: finalLevel,
    leveledUp: finalLevel > prevLevel,
    xpToNextLevel: xpToNextLevel(finalXp),
    message,
    newAchievements: unlocked.length > 0 ? unlocked.map((a) => ({ name: a.name, description: a.description, xpBonus: a.xpBonus })) : undefined,
    reminders: reminders.filter((r) => !r.read).slice(0, 3),
  });
});

export default router;
