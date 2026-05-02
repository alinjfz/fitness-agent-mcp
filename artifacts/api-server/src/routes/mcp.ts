import { Router, type IRouter } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  userProfiles,
  dietPlans,
  workoutPlans,
  schedules,
  progress,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { CompletionEvent } from "@workspace/db";

const router: IRouter = Router();

const XP_WORKOUT = 50;
const XP_DIET = 30;
const XP_STREAK_BONUS = 10;
const XP_PER_LEVEL = 500;

function computeLevel(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

function isConsecutiveDay(lastLoggedAt: Date | null): boolean {
  if (!lastLoggedAt) return false;
  const now = new Date();
  const diffHours = (now.getTime() - lastLoggedAt.getTime()) / (1000 * 60 * 60);
  return diffHours >= 20 && diffHours < 48;
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "fitness-agent",
    version: "1.0.0",
  });

  server.tool(
    "get_state",
    "Get the full fitness state for a user (profile, diet plan, workout plan, schedule, progress/XP)",
    { userId: z.string().describe("The user's unique identifier") },
    async ({ userId }) => {
      const [profile, dietPlan, workoutPlan, schedule, prog] = await Promise.all([
        db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(dietPlans).where(eq(dietPlans.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(schedules).where(eq(schedules.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0] ?? null),
      ]);

      if (!profile) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `No state found for user '${userId}'` }) }],
          isError: true,
        };
      }

      const xp = prog?.xp ?? 0;
      const level = prog?.level ?? 1;
      const xpToNextLevel = XP_PER_LEVEL - (xp % XP_PER_LEVEL);

      const state = {
        profile: {
          userId: profile.userId,
          name: profile.name,
          age: profile.age,
          weightKg: profile.weightKg ? Number(profile.weightKg) : null,
          heightCm: profile.heightCm ? Number(profile.heightCm) : null,
          goal: profile.goal,
          allergies: profile.allergies,
          preferences: profile.preferences,
          budgetPerWeek: profile.budgetPerWeek ? Number(profile.budgetPerWeek) : null,
          availableDays: profile.availableDays,
          sessionDurationMin: profile.sessionDurationMin,
          equipment: profile.equipment,
          injuries: profile.injuries,
          mode: profile.mode,
        },
        dietPlan: dietPlan ? { meals: dietPlan.meals, dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros, notes: dietPlan.notes } : null,
        workoutPlan: workoutPlan ? { sessions: workoutPlan.sessions, notes: workoutPlan.notes } : null,
        schedule: schedule ? { events: schedule.events } : null,
        progress: prog
          ? { xp: prog.xp, streak: prog.streak, level, history: prog.history, lastLoggedAt: prog.lastLoggedAt?.toISOString() ?? null, xpToNextLevel }
          : null,
      };

      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
    }
  );

  server.tool(
    "save_state",
    "Save or update a user's fitness state. Provide only the sections you want to update (profile, dietPlan, workoutPlan, schedule).",
    {
      userId: z.string().describe("The user's unique identifier"),
      profile: z.object({
        name: z.string().optional(),
        age: z.number().int().optional(),
        weightKg: z.number().optional(),
        heightCm: z.number().optional(),
        goal: z.enum(["lose_weight", "build_muscle", "maintain", "improve_endurance"]).optional(),
        allergies: z.array(z.string()).optional(),
        preferences: z.array(z.string()).optional(),
        budgetPerWeek: z.number().optional(),
        availableDays: z.array(z.string()).optional(),
        sessionDurationMin: z.number().int().optional(),
        equipment: z.array(z.string()).optional(),
        injuries: z.array(z.string()).optional(),
        mode: z.enum(["auto", "confirm"]).optional(),
      }).optional().describe("User profile fields to update"),
      dietPlan: z.object({
        meals: z.array(z.any()),
        dailyCalories: z.number().int(),
        macros: z.object({ proteinG: z.number(), carbsG: z.number(), fatG: z.number() }),
        notes: z.string().optional(),
      }).optional().describe("Diet plan to save"),
      workoutPlan: z.object({
        sessions: z.array(z.any()),
        notes: z.string().optional(),
      }).optional().describe("Workout plan to save"),
      schedule: z.object({
        events: z.array(z.any()),
      }).optional().describe("Schedule events to save"),
    },
    async ({ userId, profile, dietPlan, workoutPlan, schedule }) => {
      const now = new Date();

      if (profile) {
        await db
          .insert(userProfiles)
          .values({
            userId,
            name: profile.name ?? "Unknown",
            age: profile.age,
            weightKg: profile.weightKg != null ? String(profile.weightKg) : undefined,
            heightCm: profile.heightCm != null ? String(profile.heightCm) : undefined,
            goal: profile.goal ?? "maintain",
            allergies: profile.allergies ?? [],
            preferences: profile.preferences ?? [],
            budgetPerWeek: profile.budgetPerWeek != null ? String(profile.budgetPerWeek) : undefined,
            availableDays: profile.availableDays ?? [],
            sessionDurationMin: profile.sessionDurationMin,
            equipment: profile.equipment ?? [],
            injuries: profile.injuries ?? [],
            mode: profile.mode ?? "auto",
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userProfiles.userId,
            set: {
              ...(profile.name !== undefined && { name: profile.name }),
              ...(profile.age !== undefined && { age: profile.age }),
              ...(profile.weightKg !== undefined && { weightKg: String(profile.weightKg) }),
              ...(profile.heightCm !== undefined && { heightCm: String(profile.heightCm) }),
              ...(profile.goal !== undefined && { goal: profile.goal }),
              ...(profile.allergies !== undefined && { allergies: profile.allergies }),
              ...(profile.preferences !== undefined && { preferences: profile.preferences }),
              ...(profile.budgetPerWeek !== undefined && { budgetPerWeek: String(profile.budgetPerWeek) }),
              ...(profile.availableDays !== undefined && { availableDays: profile.availableDays }),
              ...(profile.sessionDurationMin !== undefined && { sessionDurationMin: profile.sessionDurationMin }),
              ...(profile.equipment !== undefined && { equipment: profile.equipment }),
              ...(profile.injuries !== undefined && { injuries: profile.injuries }),
              ...(profile.mode !== undefined && { mode: profile.mode }),
              updatedAt: now,
            },
          });
      }

      if (dietPlan) {
        await db
          .insert(dietPlans)
          .values({ userId, meals: dietPlan.meals, dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros, notes: dietPlan.notes, updatedAt: now })
          .onConflictDoUpdate({
            target: dietPlans.userId,
            set: { meals: dietPlan.meals, dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros, notes: dietPlan.notes, updatedAt: now },
          });
      }

      if (workoutPlan) {
        await db
          .insert(workoutPlans)
          .values({ userId, sessions: workoutPlan.sessions, notes: workoutPlan.notes, updatedAt: now })
          .onConflictDoUpdate({
            target: workoutPlans.userId,
            set: { sessions: workoutPlan.sessions, notes: workoutPlan.notes, updatedAt: now },
          });
      }

      if (schedule) {
        await db
          .insert(schedules)
          .values({ userId, events: schedule.events, updatedAt: now })
          .onConflictDoUpdate({
            target: schedules.userId,
            set: { events: schedule.events, updatedAt: now },
          });
      }

      return { content: [{ type: "text", text: JSON.stringify({ success: true, userId, updatedAt: now.toISOString() }) }] };
    }
  );

  server.tool(
    "log_completion",
    "Log that the user completed a workout or followed their diet. Awards XP and updates streak. Returns gamification feedback.",
    {
      userId: z.string().describe("The user's unique identifier"),
      type: z.enum(["workout", "diet"]).describe("Type of completion to log"),
      notes: z.string().optional().describe("Optional notes about the session"),
    },
    async ({ userId, type, notes }) => {
      const now = new Date();
      const existing = await db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0] ?? null);

      const baseXp = type === "workout" ? XP_WORKOUT : XP_DIET;
      let newStreak = 1;

      if (existing) {
        if (isConsecutiveDay(existing.lastLoggedAt)) {
          newStreak = existing.streak + 1;
        } else if (existing.lastLoggedAt) {
          const diffHours = (now.getTime() - existing.lastLoggedAt.getTime()) / (1000 * 60 * 60);
          if (diffHours < 20) newStreak = existing.streak;
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

      const event: CompletionEvent = { type, completedAt: now.toISOString(), xpGained, notes };
      const prevHistory = existing?.history ?? [];
      const newHistory = [...prevHistory, event].slice(-100);

      if (existing) {
        await db.update(progress).set({ xp: newXp, streak: newStreak, level: newLevel, history: newHistory, lastLoggedAt: now, updatedAt: now }).where(eq(progress.userId, userId));
      } else {
        await db.insert(progress).values({ userId, xp: newXp, streak: newStreak, level: newLevel, history: newHistory, lastLoggedAt: now, updatedAt: now });
      }

      let message: string;
      if (leveledUp) {
        message = `Level up! You're on a ${newStreak}-day streak and crushing it.`;
      } else if (newStreak >= 7) {
        message = `${newStreak} days straight — elite consistency. ${type === "workout" ? "Your body is changing." : "Your habits are locked in."}`;
      } else if (newStreak >= 3) {
        message = `${newStreak}-day streak! Momentum is building. Don't stop now.`;
      } else {
        message = type === "workout" ? "Workout logged. Every rep counts. See you tomorrow." : "Diet logged. Fueling right is half the battle. Nice work.";
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ xpGained, totalXp: newXp, streak: newStreak, level: newLevel, leveledUp, xpToNextLevel, message }),
        }],
      };
    }
  );

  server.tool(
    "normalize_user_input",
    "Parse messy, informal user text and extract structured fitness profile data. Returns only the fields that could be confidently extracted.",
    {
      input: z.string().describe("Raw, unstructured user text about their fitness preferences, schedule, dietary needs, etc."),
      userId: z.string().optional().describe("Optional — if provided, existing profile is used as context for smarter extraction"),
    },
    async ({ input, userId }) => {
      let contextBlock = "";
      if (userId) {
        const existing = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null);
        if (existing) {
          contextBlock = `\n\nExisting profile:\n${JSON.stringify({ name: existing.name, age: existing.age, goal: existing.goal, allergies: existing.allergies, preferences: existing.preferences, availableDays: existing.availableDays, equipment: existing.equipment, injuries: existing.injuries }, null, 2)}`;
        }
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are a fitness data extractor. Extract structured fitness profile information from messy user text.

Schema: { "profile": { "name"?: string, "age"?: int, "weightKg"?: number, "heightCm"?: number, "goal"?: "lose_weight"|"build_muscle"|"maintain"|"improve_endurance", "allergies"?: string[], "preferences"?: string[], "budgetPerWeek"?: number, "availableDays"?: ("monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday")[], "sessionDurationMin"?: int, "equipment"?: string[], "injuries"?: string[], "mode"?: "auto"|"confirm" } }

Only include fields you can confidently extract. Return JSON: { "extracted": { "profile": {...} }, "confidence": "high"|"medium"|"low", "notes": "string" }`,
          },
          { role: "user", content: `Extract fitness data from: "${input}"${contextBlock}` },
        ],
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsed: { extracted: Record<string, unknown>; confidence: string; notes: string };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to parse AI response" }) }], isError: true };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ extracted: parsed.extracted ?? {}, rawInput: input, confidence: parsed.confidence ?? "low", notes: parsed.notes ?? "" }),
        }],
      };
    }
  );

  return server;
}

router.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const server = createMcpServer();
  await server.connect(transport);

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await transport.handleRequest(req, res, req.body);
});

router.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "Use POST for MCP JSON-RPC requests" });
});

export default router;
