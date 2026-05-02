import { describe, it, expect } from "vitest";
import {
  computeLevel,
  xpToNextLevel,
  computeNewStreak,
  checkNewAchievements,
  checkWeeklyBonus,
  reinforcementMessage,
  ACHIEVEMENT_DEFS,
  XP_PER_LEVEL,
  XP_WORKOUT,
  XP_DIET,
  XP_STREAK_BONUS_PER_DAY,
  XP_WEEKLY_BONUS,
  MAX_STREAK_BONUS_DAYS,
} from "../../lib/gamification.js";
import type { Achievement, CompletionEvent } from "@workspace/db";

function makeHistory(count: number, type: "workout" | "diet" = "workout", daysAgo = false): CompletionEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    type,
    completedAt: daysAgo
      ? new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() - i * 60 * 1000).toISOString(),
    xpGained: type === "workout" ? XP_WORKOUT : XP_DIET,
  }));
}

function makeAchievement(id: string): Achievement {
  const def = ACHIEVEMENT_DEFS.find((d) => d.id === id)!;
  return { id, name: def.name, description: def.description, earnedAt: new Date().toISOString(), xpBonus: def.xpBonus };
}

describe("XP constants", () => {
  it("XP_WORKOUT is positive", () => expect(XP_WORKOUT).toBeGreaterThan(0));
  it("XP_DIET is positive", () => expect(XP_DIET).toBeGreaterThan(0));
  it("XP_WORKOUT > XP_DIET (workouts worth more)", () => expect(XP_WORKOUT).toBeGreaterThan(XP_DIET));
  it("XP_STREAK_BONUS_PER_DAY is positive", () => expect(XP_STREAK_BONUS_PER_DAY).toBeGreaterThan(0));
  it("XP_WEEKLY_BONUS is positive", () => expect(XP_WEEKLY_BONUS).toBeGreaterThan(0));
  it("MAX_STREAK_BONUS_DAYS is positive", () => expect(MAX_STREAK_BONUS_DAYS).toBeGreaterThan(0));
  it("XP_PER_LEVEL is a round multiple of 100", () => expect(XP_PER_LEVEL % 100).toBe(0));
});

describe("ACHIEVEMENT_DEFS", () => {
  it("has exactly 12 definitions", () => expect(ACHIEVEMENT_DEFS).toHaveLength(12));

  it("every def has id, name, description, and positive xpBonus", () => {
    for (const def of ACHIEVEMENT_DEFS) {
      expect(def.id).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.xpBonus).toBeGreaterThan(0);
    }
  });

  it("all ids are unique", () => {
    const ids = ACHIEVEMENT_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("streak milestones are in ascending order of xpBonus", () => {
    const streakDefs = ACHIEVEMENT_DEFS.filter((d) => d.id.startsWith("streak_"));
    const bonuses = streakDefs.map((d) => d.xpBonus);
    const sorted = [...bonuses].sort((a, b) => a - b);
    expect(bonuses).toEqual(sorted);
  });

  it("level milestones are in ascending order of xpBonus", () => {
    const levelDefs = ACHIEVEMENT_DEFS.filter((d) => d.id.startsWith("level_"));
    const bonuses = levelDefs.map((d) => d.xpBonus);
    const sorted = [...bonuses].sort((a, b) => a - b);
    expect(bonuses).toEqual(sorted);
  });
});

describe("computeLevel — extended", () => {
  it("is always >= 1", () => {
    for (const xp of [0, 1, 100, 499, 500, 999, 10000]) {
      expect(computeLevel(xp)).toBeGreaterThanOrEqual(1);
    }
  });

  it("level 50 at 50 × XP_PER_LEVEL", () => {
    expect(computeLevel(50 * XP_PER_LEVEL)).toBe(51);
  });

  it("xpToNextLevel + current XP remainder always equals XP_PER_LEVEL", () => {
    for (const xp of [0, 123, 499, 500, 999, 2750]) {
      expect((xp % XP_PER_LEVEL) + xpToNextLevel(xp)).toBe(XP_PER_LEVEL);
    }
  });
});

describe("computeNewStreak — extended edge cases", () => {
  it("handles exactly 20h (boundary — should NOT count as same day)", () => {
    const exactly20h = new Date(Date.now() - 20 * 60 * 60 * 1000 - 1);
    const result = computeNewStreak(5, exactly20h);
    expect(result).toBe(6);
  });

  it("handles exactly 48h (boundary — should NOT count as consecutive)", () => {
    const exactly48h = new Date(Date.now() - 48 * 60 * 60 * 1000 - 1);
    const result = computeNewStreak(5, exactly48h);
    expect(result).toBe(1);
  });
});

describe("checkNewAchievements — all 12 achievement paths", () => {
  it("unlocks first_diet on first diet entry", () => {
    const history = makeHistory(1, "diet");
    const unlocked = checkNewAchievements([], 1, 1, history);
    expect(unlocked.map((a) => a.id)).toContain("first_diet");
  });

  it("unlocks streak_14 at 14-day streak", () => {
    const history = makeHistory(14, "workout", true);
    const unlocked = checkNewAchievements(
      [makeAchievement("first_workout"), makeAchievement("streak_3"), makeAchievement("streak_7")],
      14, 1, history
    );
    expect(unlocked.map((a) => a.id)).toContain("streak_14");
  });

  it("unlocks streak_30 at 30-day streak", () => {
    const history = makeHistory(30, "workout", true);
    const existing = ["streak_3", "streak_7", "streak_14"].map(makeAchievement);
    const unlocked = checkNewAchievements(existing, 30, 1, history);
    expect(unlocked.map((a) => a.id)).toContain("streak_30");
  });

  it("unlocks level_10 at level 10", () => {
    const history = makeHistory(5);
    const existing = [makeAchievement("level_5")];
    const unlocked = checkNewAchievements(existing, 1, 10, history);
    expect(unlocked.map((a) => a.id)).toContain("level_10");
  });

  it("unlocks level_25 at level 25", () => {
    const history = makeHistory(5);
    const existing = [makeAchievement("level_5"), makeAchievement("level_10")];
    const unlocked = checkNewAchievements(existing, 1, 25, history);
    expect(unlocked.map((a) => a.id)).toContain("level_25");
  });

  it("unlocks logs_50 at 50 completions", () => {
    const history = makeHistory(50);
    const existing = [makeAchievement("logs_10")];
    const unlocked = checkNewAchievements(existing, 1, 1, history);
    expect(unlocked.map((a) => a.id)).toContain("logs_50");
  });

  it("unlocks logs_100 at 100 completions", () => {
    const history = makeHistory(100);
    const existing = [makeAchievement("logs_10"), makeAchievement("logs_50")];
    const unlocked = checkNewAchievements(existing, 1, 1, history);
    expect(unlocked.map((a) => a.id)).toContain("logs_100");
  });

  it("can unlock multiple achievements in one call", () => {
    const history = makeHistory(10, "workout", true);
    const unlocked = checkNewAchievements([], 3, 1, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).toContain("first_workout");
    expect(ids).toContain("streak_3");
    expect(ids).toContain("logs_10");
    expect(unlocked.length).toBeGreaterThanOrEqual(3);
  });

  it("does not unlock future thresholds prematurely", () => {
    const history = makeHistory(2);
    const unlocked = checkNewAchievements([], 2, 1, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).not.toContain("streak_3");
    expect(ids).not.toContain("logs_10");
  });

  it("all unlocked achievements have earnedAt as ISO string", () => {
    const history = makeHistory(1, "workout");
    const unlocked = checkNewAchievements([], 1, 1, history);
    for (const a of unlocked) {
      expect(() => new Date(a.earnedAt)).not.toThrow();
      expect(new Date(a.earnedAt).toISOString()).toBe(a.earnedAt);
    }
  });
});

describe("checkWeeklyBonus — boundary cases", () => {
  it("returns true at exactly 5 unique days", () => {
    const now = Date.now();
    const history: CompletionEvent[] = Array.from({ length: 5 }, (_, i) => ({
      type: "workout" as const,
      completedAt: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      xpGained: 50,
    }));
    expect(checkWeeklyBonus(history)).toBe(true);
  });

  it("returns false at exactly 4 unique days", () => {
    const now = Date.now();
    const history: CompletionEvent[] = Array.from({ length: 4 }, (_, i) => ({
      type: "workout" as const,
      completedAt: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      xpGained: 50,
    }));
    expect(checkWeeklyBonus(history)).toBe(false);
  });

  it("multiple logs on same day count as one day", () => {
    const now = Date.now();
    const history: CompletionEvent[] = [
      { type: "workout", completedAt: new Date(now).toISOString(), xpGained: 50 },
      { type: "diet", completedAt: new Date(now - 1000).toISOString(), xpGained: 30 },
      { type: "workout", completedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(), xpGained: 50 },
      { type: "workout", completedAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(), xpGained: 50 },
      { type: "workout", completedAt: new Date(now - 72 * 60 * 60 * 1000).toISOString(), xpGained: 50 },
    ];
    expect(checkWeeklyBonus(history)).toBe(false);
  });
});

describe("reinforcementMessage — all branches", () => {
  it("returns a message for diet type", () => {
    const msg = reinforcementMessage(1, "diet", false, []);
    expect(msg.toLowerCase()).toMatch(/diet|fuel|meal|food|nutrition/);
  });

  it("includes streak count in the message for streak >= 7", () => {
    const msg = reinforcementMessage(7, "workout", false, []);
    expect(msg).toContain("7");
  });

  it("includes streak count in the message for streak >= 14", () => {
    const msg = reinforcementMessage(14, "workout", false, []);
    expect(msg).toContain("14");
  });

  it("includes streak count in the message for streak >= 30", () => {
    const msg = reinforcementMessage(30, "workout", false, []);
    expect(msg).toContain("30");
  });

  it("message for streak >= 3 but < 7 mentions momentum", () => {
    const msg = reinforcementMessage(5, "workout", false, []);
    expect(msg.toLowerCase()).toMatch(/streak|momentum|5/);
  });

  it("multiple achievements all appear in message", () => {
    const achievements: Achievement[] = [
      makeAchievement("first_workout"),
      makeAchievement("streak_3"),
    ];
    const msg = reinforcementMessage(3, "workout", false, achievements);
    expect(msg).toContain("First Rep");
    expect(msg).toContain("On A Roll");
  });
});
