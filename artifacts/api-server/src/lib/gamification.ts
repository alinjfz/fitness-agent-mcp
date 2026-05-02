import type { Achievement, CompletionEvent } from "@workspace/db";

export const XP_WORKOUT = 50;
export const XP_DIET = 30;
export const XP_STREAK_BONUS_PER_DAY = 10;
export const XP_PER_LEVEL = 500;
export const XP_WEEKLY_BONUS = 100;
export const MAX_STREAK_BONUS_DAYS = 10;

export const ACHIEVEMENT_DEFS = [
  { id: "first_workout", name: "First Rep", description: "Logged your first workout", xpBonus: 100 },
  { id: "first_diet", name: "Clean Plate", description: "Logged your first diet session", xpBonus: 50 },
  { id: "streak_3", name: "On A Roll", description: "Maintained a 3-day streak", xpBonus: 75 },
  { id: "streak_7", name: "Week Warrior", description: "Maintained a 7-day streak", xpBonus: 200 },
  { id: "streak_14", name: "Fortnight Fighter", description: "Maintained a 14-day streak", xpBonus: 400 },
  { id: "streak_30", name: "Iron Habit", description: "Maintained a 30-day streak", xpBonus: 1000 },
  { id: "level_5", name: "Getting Serious", description: "Reached Level 5", xpBonus: 150 },
  { id: "level_10", name: "Dedicated", description: "Reached Level 10", xpBonus: 300 },
  { id: "level_25", name: "Elite", description: "Reached Level 25", xpBonus: 750 },
  { id: "logs_10", name: "Consistent", description: "Logged 10 completions", xpBonus: 100 },
  { id: "logs_50", name: "Committed", description: "Logged 50 completions", xpBonus: 250 },
  { id: "logs_100", name: "Century Club", description: "Logged 100 completions", xpBonus: 500 },
];

export function computeLevel(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

export function xpToNextLevel(xp: number): number {
  return XP_PER_LEVEL - (xp % XP_PER_LEVEL);
}

export function isConsecutiveDay(lastLoggedAt: Date | null): boolean {
  if (!lastLoggedAt) return false;
  const now = new Date();
  const diffHours = (now.getTime() - lastLoggedAt.getTime()) / (1000 * 60 * 60);
  return diffHours >= 20 && diffHours < 48;
}

export function isSameDay(lastLoggedAt: Date | null): boolean {
  if (!lastLoggedAt) return false;
  const now = new Date();
  const diffHours = (now.getTime() - lastLoggedAt.getTime()) / (1000 * 60 * 60);
  return diffHours < 20;
}

export function computeNewStreak(
  existingStreak: number,
  lastLoggedAt: Date | null,
): number {
  if (isConsecutiveDay(lastLoggedAt)) return existingStreak + 1;
  if (isSameDay(lastLoggedAt)) return existingStreak;
  return 1;
}

export function checkNewAchievements(
  existing: Achievement[],
  newStreak: number,
  newLevel: number,
  history: CompletionEvent[],
): Achievement[] {
  const earned = new Set(existing.map((a) => a.id));
  const unlocked: Achievement[] = [];
  const now = new Date().toISOString();

  const workoutCount = history.filter((h) => h.type === "workout").length;
  const dietCount = history.filter((h) => h.type === "diet").length;
  const totalLogs = history.length;

  const candidates: Array<{ id: string; condition: boolean }> = [
    { id: "first_workout", condition: workoutCount >= 1 },
    { id: "first_diet", condition: dietCount >= 1 },
    { id: "streak_3", condition: newStreak >= 3 },
    { id: "streak_7", condition: newStreak >= 7 },
    { id: "streak_14", condition: newStreak >= 14 },
    { id: "streak_30", condition: newStreak >= 30 },
    { id: "level_5", condition: newLevel >= 5 },
    { id: "level_10", condition: newLevel >= 10 },
    { id: "level_25", condition: newLevel >= 25 },
    { id: "logs_10", condition: totalLogs >= 10 },
    { id: "logs_50", condition: totalLogs >= 50 },
    { id: "logs_100", condition: totalLogs >= 100 },
  ];

  for (const { id, condition } of candidates) {
    if (condition && !earned.has(id)) {
      const def = ACHIEVEMENT_DEFS.find((d) => d.id === id);
      if (def) {
        unlocked.push({
          id: def.id,
          name: def.name,
          description: def.description,
          earnedAt: now,
          xpBonus: def.xpBonus,
        });
      }
    }
  }

  return unlocked;
}

export function checkWeeklyBonus(history: CompletionEvent[]): boolean {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentLogs = history.filter((h) => new Date(h.completedAt) >= oneWeekAgo);
  const uniqueDays = new Set(
    recentLogs.map((h) => new Date(h.completedAt).toDateString()),
  );
  return uniqueDays.size >= 5;
}

export function reinforcementMessage(
  streak: number,
  type: "workout" | "diet",
  leveledUp: boolean,
  newAchievements: Achievement[],
): string {
  const achievementPart =
    newAchievements.length > 0
      ? ` 🏆 Achievement unlocked: ${newAchievements.map((a) => a.name).join(", ")}!`
      : "";

  if (leveledUp) {
    return `Level up! You're on a ${streak}-day streak. Keep going!${achievementPart}`;
  }
  if (streak >= 30) {
    return `${streak}-day streak. You're built different.${achievementPart}`;
  }
  if (streak >= 14) {
    return `${streak} days. Habit locked in. No turning back now.${achievementPart}`;
  }
  if (streak >= 7) {
    return `${streak} days straight — elite consistency. ${type === "workout" ? "Your body is changing." : "Your habits are locked in."}${achievementPart}`;
  }
  if (streak >= 3) {
    return `${streak}-day streak! Momentum is building.${achievementPart}`;
  }
  const base =
    type === "workout"
      ? "Workout logged. Every rep counts. See you tomorrow."
      : "Diet logged. Fueling right is half the battle. Nice work.";
  return base + achievementPart;
}
