import { describe, it, expect } from "vitest";
import {
  computeLevel,
  xpToNextLevel,
  computeNewStreak,
  isConsecutiveDay,
  isSameDay,
  checkNewAchievements,
  checkWeeklyBonus,
  reinforcementMessage,
  XP_PER_LEVEL,
  XP_WORKOUT,
  XP_DIET,
} from "../../lib/gamification.js";
import type { Achievement, CompletionEvent } from "@workspace/db";

function makeHistory(count: number, type: "workout" | "diet" = "workout"): CompletionEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    type,
    completedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
    xpGained: type === "workout" ? XP_WORKOUT : XP_DIET,
  }));
}

describe("computeLevel", () => {
  it("starts at level 1 with 0 XP", () => {
    expect(computeLevel(0)).toBe(1);
  });

  it("levels up every XP_PER_LEVEL XP", () => {
    expect(computeLevel(XP_PER_LEVEL)).toBe(2);
    expect(computeLevel(XP_PER_LEVEL * 2)).toBe(3);
    expect(computeLevel(XP_PER_LEVEL * 10)).toBe(11);
  });

  it("stays at level N until the XP threshold is crossed", () => {
    expect(computeLevel(XP_PER_LEVEL - 1)).toBe(1);
    expect(computeLevel(XP_PER_LEVEL + 1)).toBe(2);
  });
});

describe("xpToNextLevel", () => {
  it("returns full XP_PER_LEVEL at 0 XP", () => {
    expect(xpToNextLevel(0)).toBe(XP_PER_LEVEL);
  });

  it("returns correct XP remaining mid-level", () => {
    expect(xpToNextLevel(100)).toBe(XP_PER_LEVEL - 100);
  });

  it("returns XP_PER_LEVEL immediately after a level-up", () => {
    expect(xpToNextLevel(XP_PER_LEVEL)).toBe(XP_PER_LEVEL);
  });
});

describe("isConsecutiveDay", () => {
  it("returns false for null", () => {
    expect(isConsecutiveDay(null)).toBe(false);
  });

  it("returns true for a date 24h ago", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(isConsecutiveDay(yesterday)).toBe(true);
  });

  it("returns false for a date less than 20h ago (same day)", () => {
    const recent = new Date(Date.now() - 10 * 60 * 60 * 1000);
    expect(isConsecutiveDay(recent)).toBe(false);
  });

  it("returns false for a date more than 48h ago (broken streak)", () => {
    const twoDaysAgo = new Date(Date.now() - 50 * 60 * 60 * 1000);
    expect(isConsecutiveDay(twoDaysAgo)).toBe(false);
  });
});

describe("isSameDay", () => {
  it("returns false for null", () => {
    expect(isSameDay(null)).toBe(false);
  });

  it("returns true for a date less than 20h ago", () => {
    const recent = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(isSameDay(recent)).toBe(true);
  });

  it("returns false for a date more than 20h ago", () => {
    const old = new Date(Date.now() - 21 * 60 * 60 * 1000);
    expect(isSameDay(old)).toBe(false);
  });
});

describe("computeNewStreak", () => {
  it("returns 1 for a new user (no last log)", () => {
    expect(computeNewStreak(0, null)).toBe(1);
  });

  it("increments streak for consecutive day", () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(computeNewStreak(5, yesterday)).toBe(6);
  });

  it("keeps streak the same for same-day log", () => {
    const recent = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(computeNewStreak(5, recent)).toBe(5);
  });

  it("resets streak to 1 for broken streak", () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    expect(computeNewStreak(10, threeDaysAgo)).toBe(1);
  });
});

describe("checkNewAchievements", () => {
  it("unlocks first_workout on first workout", () => {
    const history = makeHistory(1, "workout");
    const unlocked = checkNewAchievements([], 1, 1, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).toContain("first_workout");
  });

  it("unlocks first_diet on first diet log", () => {
    const history = makeHistory(1, "diet");
    const unlocked = checkNewAchievements([], 1, 1, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).toContain("first_diet");
  });

  it("unlocks streak_3 at 3-day streak", () => {
    const history = makeHistory(3);
    const unlocked = checkNewAchievements([], 3, 1, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).toContain("streak_3");
  });

  it("unlocks streak_7 at 7-day streak", () => {
    const history = makeHistory(7);
    const unlocked = checkNewAchievements([], 7, 2, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).toContain("streak_3");
    expect(ids).toContain("streak_7");
  });

  it("unlocks level_5 when reaching level 5", () => {
    const history = makeHistory(5);
    const unlocked = checkNewAchievements([], 1, 5, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).toContain("level_5");
  });

  it("unlocks logs_10 at 10 total completions", () => {
    const history = makeHistory(10);
    const unlocked = checkNewAchievements([], 1, 1, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).toContain("logs_10");
  });

  it("does not re-unlock already earned achievements", () => {
    const history = makeHistory(1, "workout");
    const existing: Achievement[] = [
      { id: "first_workout", name: "First Rep", description: "...", earnedAt: new Date().toISOString(), xpBonus: 100 },
    ];
    const unlocked = checkNewAchievements(existing, 1, 1, history);
    const ids = unlocked.map((a) => a.id);
    expect(ids).not.toContain("first_workout");
  });

  it("returns empty array when nothing new unlocked", () => {
    const history = makeHistory(1, "workout");
    const existing: Achievement[] = [
      { id: "first_workout", name: "First Rep", description: "...", earnedAt: new Date().toISOString(), xpBonus: 100 },
    ];
    const unlocked = checkNewAchievements(existing, 1, 1, history);
    expect(unlocked).toHaveLength(0);
  });

  it("each achievement has required fields", () => {
    const history = makeHistory(1, "workout");
    const unlocked = checkNewAchievements([], 1, 1, history);
    for (const a of unlocked) {
      expect(a.id).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.description).toBeTruthy();
      expect(a.earnedAt).toBeTruthy();
      expect(a.xpBonus).toBeGreaterThan(0);
    }
  });
});

describe("checkWeeklyBonus", () => {
  it("returns true when 5 or more unique days in the last 7 days", () => {
    const history: CompletionEvent[] = Array.from({ length: 5 }, (_, i) => ({
      type: "workout" as const,
      completedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      xpGained: 50,
    }));
    expect(checkWeeklyBonus(history)).toBe(true);
  });

  it("returns false when fewer than 5 unique days", () => {
    const history = makeHistory(3);
    expect(checkWeeklyBonus(history)).toBe(false);
  });

  it("returns false for empty history", () => {
    expect(checkWeeklyBonus([])).toBe(false);
  });

  it("ignores entries older than 7 days", () => {
    const history: CompletionEvent[] = Array.from({ length: 5 }, (_, i) => ({
      type: "workout" as const,
      completedAt: new Date(Date.now() - (8 + i) * 24 * 60 * 60 * 1000).toISOString(),
      xpGained: 50,
    }));
    expect(checkWeeklyBonus(history)).toBe(false);
  });
});

describe("reinforcementMessage", () => {
  it("returns a non-empty string for any valid input", () => {
    const msg = reinforcementMessage(1, "workout", false, []);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("mentions level up when leveledUp is true", () => {
    const msg = reinforcementMessage(1, "workout", true, []);
    expect(msg.toLowerCase()).toContain("level");
  });

  it("includes achievement name when new achievements are unlocked", () => {
    const achievements: Achievement[] = [
      { id: "first_workout", name: "First Rep", description: "First workout", earnedAt: new Date().toISOString(), xpBonus: 100 },
    ];
    const msg = reinforcementMessage(1, "workout", false, achievements);
    expect(msg).toContain("First Rep");
  });

  it("returns elite message for 30+ day streak", () => {
    const msg = reinforcementMessage(30, "workout", false, []);
    expect(msg).toContain("30");
  });
});
