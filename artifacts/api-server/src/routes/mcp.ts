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
import type { CompletionEvent, Achievement } from "@workspace/db";
import {
  XP_WORKOUT,
  XP_DIET,
  XP_STREAK_BONUS_PER_DAY,
  XP_PER_LEVEL,
  MAX_STREAK_BONUS_DAYS,
  computeLevel,
  xpToNextLevel,
  computeNewStreak,
  checkNewAchievements,
  reinforcementMessage,
} from "../lib/gamification";

const router: IRouter = Router();

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "fitness-agent", version: "2.0.0" });

  server.tool(
    "get_state",
    "Get the full fitness state for a user (profile, diet plan, workout plan, schedule, progress, achievements, unread reminders)",
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
        return { content: [{ type: "text", text: JSON.stringify({ error: `No state found for user '${userId}'` }) }], isError: true };
      }

      const xp = prog?.xp ?? 0;
      const level = computeLevel(xp);
      const state = {
        profile: { userId: profile.userId, name: profile.name, age: profile.age, weightKg: profile.weightKg ?? null, heightCm: profile.heightCm ?? null, goal: profile.goal, allergies: profile.allergies, preferences: profile.preferences, budgetPerWeek: profile.budgetPerWeek ?? null, availableDays: profile.availableDays, sessionDurationMin: profile.sessionDurationMin, equipment: profile.equipment, injuries: profile.injuries, mode: profile.mode },
        dietPlan: dietPlan ? { meals: dietPlan.meals, dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros, notes: dietPlan.notes } : null,
        workoutPlan: workoutPlan ? { sessions: workoutPlan.sessions, notes: workoutPlan.notes } : null,
        schedule: schedule ? { events: schedule.events } : null,
        progress: prog ? { xp: prog.xp, streak: prog.streak, level, xpToNextLevel: xpToNextLevel(xp), achievements: prog.achievements ?? [], reminders: ((prog.reminders ?? []) as { read: boolean }[]).filter((r) => !r.read), lastLoggedAt: prog.lastLoggedAt?.toISOString() ?? null } : null,
      };
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
    }
  );

  server.tool(
    "save_state",
    "Save or update a user's fitness state. Provide only the sections you want to update (profile, dietPlan, workoutPlan, schedule). All fields within each section are optional.",
    {
      userId: z.string(),
      profile: z.object({ name: z.string().optional(), age: z.number().int().optional(), weightKg: z.number().optional(), heightCm: z.number().optional(), goal: z.enum(["lose_weight", "build_muscle", "maintain", "improve_endurance"]).optional(), allergies: z.array(z.string()).optional(), preferences: z.array(z.string()).optional(), budgetPerWeek: z.number().optional(), availableDays: z.array(z.string()).optional(), sessionDurationMin: z.number().int().optional(), equipment: z.array(z.string()).optional(), injuries: z.array(z.string()).optional(), mode: z.enum(["auto", "confirm"]).optional() }).optional(),
      dietPlan: z.object({ meals: z.array(z.any()), dailyCalories: z.number().int(), macros: z.object({ proteinG: z.number(), carbsG: z.number(), fatG: z.number() }), notes: z.string().optional() }).optional(),
      workoutPlan: z.object({ sessions: z.array(z.any()), notes: z.string().optional() }).optional(),
      schedule: z.object({ events: z.array(z.any()) }).optional(),
    },
    async ({ userId, profile, dietPlan, workoutPlan, schedule }) => {
      const now = new Date();
      if (profile) {
        await db.insert(userProfiles).values({ userId, name: profile.name ?? "Unknown", age: profile.age, weightKg: profile.weightKg ?? undefined, heightCm: profile.heightCm ?? undefined, goal: profile.goal ?? "maintain", allergies: profile.allergies ?? [], preferences: profile.preferences ?? [], budgetPerWeek: profile.budgetPerWeek ?? undefined, availableDays: profile.availableDays ?? [], sessionDurationMin: profile.sessionDurationMin, equipment: profile.equipment ?? [], injuries: profile.injuries ?? [], mode: profile.mode ?? "auto", updatedAt: now }).onConflictDoUpdate({ target: userProfiles.userId, set: { ...(profile.name !== undefined && { name: profile.name }), ...(profile.age !== undefined && { age: profile.age }), ...(profile.weightKg !== undefined && { weightKg: profile.weightKg }), ...(profile.heightCm !== undefined && { heightCm: profile.heightCm }), ...(profile.goal !== undefined && { goal: profile.goal }), ...(profile.allergies !== undefined && { allergies: profile.allergies }), ...(profile.preferences !== undefined && { preferences: profile.preferences }), ...(profile.budgetPerWeek !== undefined && { budgetPerWeek: profile.budgetPerWeek }), ...(profile.availableDays !== undefined && { availableDays: profile.availableDays }), ...(profile.sessionDurationMin !== undefined && { sessionDurationMin: profile.sessionDurationMin }), ...(profile.equipment !== undefined && { equipment: profile.equipment }), ...(profile.injuries !== undefined && { injuries: profile.injuries }), ...(profile.mode !== undefined && { mode: profile.mode }), updatedAt: now } });
      }
      if (dietPlan) {
        await db.insert(dietPlans).values({ userId, meals: dietPlan.meals, dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros, notes: dietPlan.notes, updatedAt: now }).onConflictDoUpdate({ target: dietPlans.userId, set: { meals: dietPlan.meals, dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros, notes: dietPlan.notes, updatedAt: now } });
      }
      if (workoutPlan) {
        await db.insert(workoutPlans).values({ userId, sessions: workoutPlan.sessions, notes: workoutPlan.notes, updatedAt: now }).onConflictDoUpdate({ target: workoutPlans.userId, set: { sessions: workoutPlan.sessions, notes: workoutPlan.notes, updatedAt: now } });
      }
      if (schedule) {
        await db.insert(schedules).values({ userId, events: schedule.events, updatedAt: now }).onConflictDoUpdate({ target: schedules.userId, set: { events: schedule.events, updatedAt: now } });
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true, userId, updatedAt: now.toISOString() }) }] };
    }
  );

  server.tool(
    "log_completion",
    "Log that the user completed a workout or followed their diet. Awards XP, updates streak, checks achievements, returns gamification feedback including any unread reminders.",
    {
      userId: z.string(),
      type: z.enum(["workout", "diet"]),
      notes: z.string().optional(),
    },
    async ({ userId, type, notes }) => {
      const now = new Date();
      const existing = await db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0] ?? null);

      const baseXp = type === "workout" ? XP_WORKOUT : XP_DIET;
      const newStreak = computeNewStreak(existing?.streak ?? 0, existing?.lastLoggedAt ?? null);
      const streakBonus = Math.min(newStreak - 1, MAX_STREAK_BONUS_DAYS) * XP_STREAK_BONUS_PER_DAY;
      const xpGained = baseXp + streakBonus;
      const prevXp = existing?.xp ?? 0;
      const prevHistory = (existing?.history ?? []) as CompletionEvent[];
      const prevAchievements = (existing?.achievements ?? []) as Achievement[];

      const event: CompletionEvent = { type, completedAt: now.toISOString(), xpGained, notes };
      const newHistory = [...prevHistory, event].slice(-100);
      const newXp = prevXp + xpGained;
      const prevLevel = computeLevel(prevXp);
      const newLevel = computeLevel(newXp);

      const unlocked = checkNewAchievements(prevAchievements, newStreak, newLevel, newHistory);
      const bonusXp = unlocked.reduce((sum, a) => sum + a.xpBonus, 0);
      const finalXp = newXp + bonusXp;
      const finalLevel = computeLevel(finalXp);
      const allAchievements = [...prevAchievements, ...unlocked];

      if (existing) {
        await db.update(progress).set({ xp: finalXp, streak: newStreak, level: finalLevel, history: newHistory, achievements: allAchievements, lastLoggedAt: now, updatedAt: now }).where(eq(progress.userId, userId));
      } else {
        await db.insert(progress).values({ userId, xp: finalXp, streak: newStreak, level: finalLevel, history: newHistory, achievements: allAchievements, reminders: [], lastLoggedAt: now, updatedAt: now });
      }

      const message = reinforcementMessage(newStreak, type, finalLevel > prevLevel, unlocked);
      const result = { xpGained: finalXp - prevXp, totalXp: finalXp, streak: newStreak, level: finalLevel, leveledUp: finalLevel > prevLevel, xpToNextLevel: xpToNextLevel(finalXp), message, newAchievements: unlocked.length > 0 ? unlocked.map((a) => ({ name: a.name, description: a.description, xpBonus: a.xpBonus })) : undefined };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "normalize_user_input",
    `Extract structured fitness profile data from the user's raw input text yourself, then call this tool with your extracted result.

Schema (all fields optional — include only what you can confidently extract):
{
  name?: string,
  age?: integer,
  weightKg?: number  (convert lbs ÷ 2.205),
  heightCm?: number  (convert ft/in: feet×30.48 + inches×2.54),
  goal?: "lose_weight"|"build_muscle"|"maintain"|"improve_endurance",
  allergies?: string[], preferences?: string[],
  budgetPerWeek?: number,
  availableDays?: ("monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday")[],
  sessionDurationMin?: integer,
  equipment?: string[], injuries?: string[],
  mode?: "auto"|"confirm"
}

Pass extracted data in the \`extracted\` field with a confidence level ("high"|"medium"|"low") and notes on what couldn't be extracted.`,
    {
      input: z.string().describe("Raw, unstructured user text about their fitness preferences, schedule, dietary needs, etc."),
      extracted: z.object({
        name: z.string().optional(),
        age: z.number().int().optional(),
        weightKg: z.number().optional(),
        heightCm: z.number().optional(),
        goal: z.enum(["lose_weight", "build_muscle", "maintain", "improve_endurance"]).optional(),
        allergies: z.array(z.string()).optional(),
        preferences: z.array(z.string()).optional(),
        budgetPerWeek: z.number().optional(),
        availableDays: z.array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])).optional(),
        sessionDurationMin: z.number().int().optional(),
        equipment: z.array(z.string()).optional(),
        injuries: z.array(z.string()).optional(),
        mode: z.enum(["auto", "confirm"]).optional(),
        confidence: z.enum(["high", "medium", "low"]).optional(),
        notes: z.string().optional(),
      }).optional().describe("Extracted profile data — you extract this yourself from the input, then pass it here"),
      userId: z.string().optional().describe("If provided, used as context for existing profile"),
    },
    async ({ input, extracted, userId }) => {
      if (extracted) {
        const { confidence, notes, ...profile } = extracted;
        return { content: [{ type: "text", text: JSON.stringify({ extracted: { profile }, rawInput: input, confidence: confidence ?? "high", notes: notes ?? "" }) }] };
      }
      // Fallback: instruct the AI to retry with extracted data
      let existingProfile = null;
      if (userId) {
        existingProfile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null);
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            requiresExtraction: true,
            message: "Extract structured fitness data from the input yourself, then call this tool again with the extracted field populated.",
            input,
            schema: { name: "string?", age: "integer?", weightKg: "number?", heightCm: "number?", goal: "lose_weight|build_muscle|maintain|improve_endurance?", allergies: "string[]?", preferences: "string[]?", budgetPerWeek: "number?", availableDays: "day[]?", sessionDurationMin: "integer?", equipment: "string[]?", injuries: "string[]?", mode: "auto|confirm?" },
            existingProfile: existingProfile ? { name: existingProfile.name, age: existingProfile.age, goal: existingProfile.goal, allergies: existingProfile.allergies, preferences: existingProfile.preferences, availableDays: existingProfile.availableDays, equipment: existingProfile.equipment, injuries: existingProfile.injuries } : null,
          }),
        }],
      };
    }
  );

  server.tool(
    "generate_plan",
    `Generate a complete diet or workout plan for this user yourself, then call this tool with your result.

Call get_state first to load the user's profile. Then generate the plan:

DIET PLAN: { meals:[{name,time,calories,protein,carbs,fat,ingredients[]}], dailyCalories, macros:{proteinG,carbsG,fatG}, notes? }
  Rules: no allergens from profile.allergies, match calories to goal, stay within budgetPerWeek

WORKOUT PLAN: { sessions:[{day,name,durationMin,exercises:[{name,sets,reps,restSec}]}], notes? }
  Rules: only days from profile.availableDays, respect injuries, match durationMin to profile.sessionDurationMin

Pass your generated plan in the \`plan\` field.
In confirm mode (profile.mode="confirm"): present the plan to the user for approval first, then call with confirmed:true.`,
    {
      userId: z.string(),
      type: z.enum(["diet", "workout"]).describe("Type of plan to generate"),
      plan: z.object({
        meals: z.array(z.any()).optional(),
        sessions: z.array(z.any()).optional(),
        dailyCalories: z.number().optional(),
        macros: z.any().optional(),
        notes: z.string().optional(),
      }).optional().describe("The plan you generated — pass diet or workout plan structure here"),
      confirmed: z.boolean().optional().describe("Set to true to save in confirm mode after user approved"),
    },
    async ({ userId, type, plan, confirmed }) => {
      const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null);
      if (!profile) return { content: [{ type: "text", text: JSON.stringify({ error: `No profile found for '${userId}'. Call save_state first.` }) }], isError: true };

      if (!plan) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              requiresPlan: true,
              message: `Generate a ${type} plan yourself using the profile below, then call this tool again with the plan field populated.`,
              profile: { goal: profile.goal, allergies: profile.allergies, preferences: profile.preferences, budgetPerWeek: profile.budgetPerWeek, weightKg: profile.weightKg, availableDays: profile.availableDays, sessionDurationMin: profile.sessionDurationMin, equipment: profile.equipment, injuries: profile.injuries },
              dietSchema: "{ meals:[{name,time,calories,protein,carbs,fat,ingredients[]}], dailyCalories, macros:{proteinG,carbsG,fatG}, notes? }",
              workoutSchema: "{ sessions:[{day,name,durationMin,exercises:[{name,sets,reps,restSec}]}], notes? }",
            }),
          }],
        };
      }

      const isConfirmMode = profile.mode === "confirm";
      const shouldSave = !isConfirmMode || confirmed === true;

      if (shouldSave) {
        const now = new Date();
        if (type === "diet") {
          await db.insert(dietPlans).values({ userId, meals: plan.meals, dailyCalories: plan.dailyCalories as number, macros: plan.macros, notes: plan.notes, updatedAt: now }).onConflictDoUpdate({ target: dietPlans.userId, set: { meals: plan.meals, dailyCalories: plan.dailyCalories as number, macros: plan.macros, notes: plan.notes, updatedAt: now } });
        } else {
          await db.insert(workoutPlans).values({ userId, sessions: plan.sessions, notes: plan.notes, updatedAt: now }).onConflictDoUpdate({ target: workoutPlans.userId, set: { sessions: plan.sessions, notes: plan.notes, updatedAt: now } });
        }
      }

      const result = { plan, saved: shouldSave, ...(isConfirmMode && !confirmed ? { requiresConfirmation: true, message: "Preview only. Call generate_plan again with confirmed:true to save." } : {}) };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "schedule_events",
    `Generate calendar events for the user's fitness schedule yourself, then call this tool with your events array.

Call get_state first to load the profile and workoutPlan. Then generate events for the date range:

Event schema: { title:string, date:"YYYY-MM-DD", time:"HH:MM" (24h), type:"workout"|"meal"|"check_in", durationMin:number }

Rules:
- Match workout sessions to correct days of week (profile.availableDays + workoutPlan.sessions)
- Default times: 07:00 for workouts, 08:00/13:00/19:00 for meals
- Default: 30 days from today if not specified

Pass events in the \`events\` field.
mode="append" (default) adds to existing events. mode="replace" overwrites.
In confirm mode: show the event list to the user first, then call with confirmed:true.`,
    {
      userId: z.string(),
      events: z.array(z.object({
        title: z.string(),
        date: z.string(),
        time: z.string(),
        type: z.enum(["workout", "meal", "check_in"]),
        durationMin: z.number().int(),
      })).optional().describe("The events array you generated — pass it here"),
      mode: z.enum(["append", "replace"]).optional().describe("append (default) adds to existing events, replace overwrites"),
      description: z.string().optional().describe("Natural language description, e.g. 'schedule my workouts for May'"),
      startDate: z.string().optional().describe("Start date YYYY-MM-DD, defaults to today"),
      durationDays: z.number().int().optional().describe("Number of days to schedule, default 30"),
      confirmed: z.boolean().optional().describe("Set to true to save in confirm mode after user approved"),
    },
    async ({ userId, events, mode = "append", description, startDate, durationDays, confirmed }) => {
      const [profile, workoutPlan] = await Promise.all([
        db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).then((r) => r[0] ?? null),
      ]);
      if (!profile) return { content: [{ type: "text", text: JSON.stringify({ error: `No profile found for '${userId}'` }) }], isError: true };

      if (!events) {
        const sd = startDate ?? new Date().toISOString().split("T")[0];
        const dd = durationDays ?? 30;
        type WorkoutSession = { day: string; name: string; durationMin: number };
        const sessions = (workoutPlan?.sessions as WorkoutSession[] | null) ?? [];
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              requiresEvents: true,
              message: "Generate events yourself using the context below, then call this tool again with the events field populated.",
              context: { startDate: sd, durationDays: dd, description: description ?? "Schedule fitness events", availableDays: profile.availableDays, sessionDurationMin: profile.sessionDurationMin ?? 60, sessions: sessions.map((s) => `${s.day}: ${s.name} (${s.durationMin}min)`) },
              eventSchema: "{ title:string, date:'YYYY-MM-DD', time:'HH:MM', type:'workout'|'meal'|'check_in', durationMin:number }",
            }),
          }],
        };
      }

      const isConfirmMode = profile.mode === "confirm";
      const shouldSave = !isConfirmMode || confirmed === true;

      if (shouldSave) {
        const now = new Date();
        let allEvents: unknown[];
        if (mode === "replace") {
          allEvents = events;
        } else {
          const existing = await db.select().from(schedules).where(eq(schedules.userId, userId)).then((r) => r[0] ?? null);
          allEvents = [...((existing?.events as unknown[]) ?? []), ...events];
        }
        await db.insert(schedules).values({ userId, events: allEvents, updatedAt: now }).onConflictDoUpdate({ target: schedules.userId, set: { events: allEvents, updatedAt: now } });
      }

      const out = { events, count: events.length, saved: shouldSave, mode, ...(isConfirmMode && !confirmed ? { requiresConfirmation: true, message: "Preview only. Call schedule_events again with confirmed:true to save." } : {}) };
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    }
  );

  server.tool(
    "get_history",
    "Get paginated completion event history for a user. Filter by type (workout/diet), sort newest-first or oldest-first, and paginate through results. Summary always shows unfiltered lifetime totals.",
    {
      userId: z.string().describe("The user's unique identifier"),
      page: z.number().int().optional().describe("Page number (default 1, 1-indexed)"),
      limit: z.number().int().optional().describe("Items per page (default 20, max 100)"),
      type: z.enum(["workout", "diet"]).optional().describe("Filter by event type"),
      sort: z.enum(["asc", "desc"]).optional().describe("Sort order: desc=newest first (default), asc=oldest first"),
    },
    async ({ userId, page = 1, limit = 20, type: typeFilter, sort = "desc" }) => {
      const MAX_LIMIT = 100;
      const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
      const clampedPage = Math.max(1, page);

      const prog = await db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0] ?? null);
      if (!prog) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `No progress found for user '${userId}'` }) }], isError: true };
      }

      let history = (prog.history ?? []) as CompletionEvent[];
      if (typeFilter) history = history.filter((h) => h.type === typeFilter);

      if (sort === "desc") {
        history = [...history].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
      } else {
        history = [...history].sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
      }

      const total = history.length;
      const totalPages = Math.max(1, Math.ceil(total / clampedLimit));
      const actualPage = Math.min(clampedPage, totalPages);
      const offset = (actualPage - 1) * clampedLimit;
      const pageItems = history.slice(offset, offset + clampedLimit);

      const allHistory = (prog.history ?? []) as CompletionEvent[];
      const workoutLogs = allHistory.filter((h) => h.type === "workout").length;
      const dietLogs = allHistory.filter((h) => h.type === "diet").length;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            userId,
            history: pageItems,
            pagination: { page: actualPage, limit: clampedLimit, total, totalPages, hasNext: actualPage < totalPages, hasPrev: actualPage > 1 },
            summary: { workoutLogs, dietLogs, totalLogs: workoutLogs + dietLogs, filteredTotal: total },
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "export_report",
    "Export a formatted fitness progress report for a user. Returns JSON by default. Supported formats: json, csv, html.",
    {
      userId: z.string(),
      format: z.enum(["json", "csv", "html"]).optional().describe("Output format, defaults to json"),
    },
    async ({ userId, format = "json" }) => {
      const [profile, dietPlan, workoutPlan, schedule, prog] = await Promise.all([
        db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(dietPlans).where(eq(dietPlans.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(schedules).where(eq(schedules.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0] ?? null),
      ]);
      if (!profile) return { content: [{ type: "text", text: JSON.stringify({ error: `No state found for '${userId}'` }) }], isError: true };

      const xp = prog?.xp ?? 0;
      const history = (prog?.history ?? []) as CompletionEvent[];
      const achievements = (prog?.achievements ?? []) as Achievement[];
      const workoutLogs = history.filter((h) => h.type === "workout").length;
      const dietLogs = history.filter((h) => h.type === "diet").length;

      const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
      const baseUrl =
        process.env.PUBLIC_URL?.replace(/\/$/, "") ??
        (railwayDomain ? `https://${railwayDomain}` : `http://localhost:${process.env.PORT ?? 8080}`);

      const report = {
        exportedAt: new Date().toISOString(), userId,
        profile: { name: profile.name, goal: profile.goal, age: profile.age, weightKg: profile.weightKg ?? null, mode: profile.mode },
        progress: { xp, streak: prog?.streak ?? 0, level: computeLevel(xp), xpToNextLevel: xpToNextLevel(xp), workoutLogs, dietLogs, totalLogs: workoutLogs + dietLogs },
        achievements: achievements.map((a) => ({ name: a.name, description: a.description, earnedAt: a.earnedAt })),
        dietPlan: dietPlan ? { dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros } : null,
        workoutPlan: workoutPlan ? { sessionCount: (workoutPlan.sessions as unknown[]).length } : null,
        schedule: schedule ? { eventCount: (schedule.events as unknown[]).length } : null,
        recentHistory: history.slice(-10),
        downloadUrl: `${baseUrl}/api/export/${userId}?format=${format}`,
        ...(format === "html" && { embedUrl: `${baseUrl}/api/export/${userId}?format=html&embed=true` }),
      };

      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
  );

  return server;
}

router.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  await server.connect(transport);
  res.on("close", () => { void transport.close(); void server.close(); });
  await transport.handleRequest(req, res, req.body);
});

router.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "Use POST for MCP JSON-RPC requests. Set Accept: application/json, text/event-stream" });
});

export default router;
