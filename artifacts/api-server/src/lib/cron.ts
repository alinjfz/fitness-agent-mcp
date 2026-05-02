import cron from "node-cron";
import { db } from "@workspace/db";
import { progress, userProfiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Reminder, CompletionEvent } from "@workspace/db";
import { logger } from "./logger";

function generateReminderId(): string {
  return `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function checkMissedWorkouts(): Promise<void> {
  logger.info("Cron: checking for missed workouts");

  const allProgress = await db.select().from(progress);
  const allProfiles = await db.select().from(userProfiles);
  const profileMap = new Map(allProfiles.map((p) => [p.userId, p]));

  const now = new Date();
  const today = now.toDateString();
  const cutoffHour = 20;

  if (now.getHours() < cutoffHour) return;

  for (const prog of allProgress) {
    const profile = profileMap.get(prog.userId);
    if (!profile) continue;

    const history = (prog.history ?? []) as CompletionEvent[];
    const todayLogs = history.filter(
      (h) => new Date(h.completedAt).toDateString() === today,
    );
    if (todayLogs.length > 0) continue;

    const availableDays = profile.availableDays as string[];
    const todayName = now
      .toLocaleDateString("en-US", { weekday: "long" })
      .toLowerCase();
    if (!availableDays.includes(todayName)) continue;

    const existingReminders = (prog.reminders ?? []) as Reminder[];
    const alreadyReminderToday = existingReminders.some(
      (r) =>
        r.type === "missed_workout" &&
        new Date(r.createdAt).toDateString() === today,
    );
    if (alreadyReminderToday) continue;

    const reminder: Reminder = {
      id: generateReminderId(),
      message: `You haven't logged a workout today (${todayName}). Keep your streak alive!`,
      type: "missed_workout",
      createdAt: now.toISOString(),
      read: false,
    };

    const updatedReminders = [...existingReminders, reminder].slice(-20);
    await db
      .update(progress)
      .set({ reminders: updatedReminders, updatedAt: now })
      .where(eq(progress.userId, prog.userId));

    logger.info({ userId: prog.userId }, "Cron: missed workout reminder created");
  }
}

async function generateWeeklyReports(): Promise<void> {
  logger.info("Cron: generating weekly reports");

  const allProgress = await db.select().from(progress);
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const prog of allProgress) {
    const history = (prog.history ?? []) as CompletionEvent[];
    const weekHistory = history.filter(
      (h) => new Date(h.completedAt) >= oneWeekAgo,
    );
    const weekXp = weekHistory.reduce((sum, h) => sum + h.xpGained, 0);
    const workoutCount = weekHistory.filter((h) => h.type === "workout").length;
    const dietCount = weekHistory.filter((h) => h.type === "diet").length;

    const existingReminders = (prog.reminders ?? []) as Reminder[];
    const reminder: Reminder = {
      id: generateReminderId(),
      message: `Weekly summary: ${workoutCount} workouts, ${dietCount} diet sessions, ${weekXp} XP earned.${prog.streak > 0 ? ` Current streak: ${prog.streak} days.` : ""}`,
      type: "weekly_report",
      createdAt: now.toISOString(),
      read: false,
    };

    const updatedReminders = [...existingReminders, reminder].slice(-20);
    await db
      .update(progress)
      .set({ reminders: updatedReminders, updatedAt: now })
      .where(eq(progress.userId, prog.userId));
  }

  logger.info({ count: allProgress.length }, "Cron: weekly reports generated");
}

async function flagPlanRenewals(): Promise<void> {
  logger.info("Cron: checking for plan renewal flags");

  const allProgress = await db.select().from(progress);
  const now = new Date();

  for (const prog of allProgress) {
    const existingReminders = (prog.reminders ?? []) as Reminder[];
    const alreadyFlagged = existingReminders.some(
      (r) => r.type === "plan_renewal" && !r.read,
    );
    if (alreadyFlagged) continue;

    const reminder: Reminder = {
      id: generateReminderId(),
      message:
        "It has been 30 days. Consider regenerating your diet and workout plan to keep things aligned with your progress.",
      type: "plan_renewal",
      createdAt: now.toISOString(),
      read: false,
    };

    const updatedReminders = [...existingReminders, reminder].slice(-20);
    await db
      .update(progress)
      .set({ reminders: updatedReminders, updatedAt: now })
      .where(eq(progress.userId, prog.userId));
  }
}

export function initCronJobs(): void {
  cron.schedule("0 20 * * *", () => {
    checkMissedWorkouts().catch((err) =>
      logger.error({ err }, "Cron: missed workout check failed"),
    );
  });

  cron.schedule("0 8 * * 0", () => {
    generateWeeklyReports().catch((err) =>
      logger.error({ err }, "Cron: weekly report generation failed"),
    );
  });

  cron.schedule("0 9 1 * *", () => {
    flagPlanRenewals().catch((err) =>
      logger.error({ err }, "Cron: plan renewal check failed"),
    );
  });

  logger.info(
    "Cron: jobs initialized (daily missed-workout @20:00, weekly report Sun @08:00, monthly plan renewal @09:00)",
  );
}
