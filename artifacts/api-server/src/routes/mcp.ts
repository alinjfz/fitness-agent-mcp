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

const DIET_SYSTEM_PROMPT = `You are a professional nutritionist. Generate a structured 7-day meal plan based on the user profile provided.
Output ONLY valid JSON — no markdown, no prose:
{"meals":[{"name":"Breakfast","time":"08:00","calories":500,"protein":30,"carbs":50,"fat":15,"ingredients":["oats","banana","milk"]}],"dailyCalories":2000,"macros":{"proteinG":150,"carbsG":200,"fatG":65},"notes":"Summary"}
Rules: NEVER include allergens, respect preferences, match calories to goal, stay within budget.`;

const WORKOUT_SYSTEM_PROMPT = `You are a professional fitness trainer. Generate a structured weekly workout plan based on the user profile provided.
Output ONLY valid JSON — no markdown, no prose:
{"sessions":[{"day":"monday","name":"Push Day","durationMin":60,"exercises":[{"name":"Bench Press","sets":4,"reps":8,"restSec":120}]}],"notes":"Summary"}
Rules: Only use available days, respect injuries and equipment, match duration to sessionDurationMin.`;

const SCHEDULE_SYSTEM_PROMPT = `Generate calendar events based on the fitness plan.
Output ONLY valid JSON: {"events":[{"title":"Push Day","date":"2026-05-05","time":"07:00","type":"workout","durationMin":60}]}
Rules: ISO date YYYY-MM-DD, 24h time HH:MM, type must be "workout"|"meal"|"check_in".`;

const NORMALIZE_SYSTEM_PROMPT = `Extract structured fitness data from messy user text.
Schema: {"profile":{"name"?:string,"age"?:int,"weightKg"?:number,"heightCm"?:number,"goal"?:"lose_weight"|"build_muscle"|"maintain"|"improve_endurance","allergies"?:string[],"preferences"?:string[],"budgetPerWeek"?:number,"availableDays"?:("monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday")[],"sessionDurationMin"?:int,"equipment"?:string[],"injuries"?:string[],"mode"?:"auto"|"confirm"}}
Only include fields you can confidently extract. Return JSON: {"extracted":{"profile":{...}},"confidence":"high"|"medium"|"low","notes":"string"}`;

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
        profile: { userId: profile.userId, name: profile.name, age: profile.age, weightKg: profile.weightKg ? Number(profile.weightKg) : null, heightCm: profile.heightCm ? Number(profile.heightCm) : null, goal: profile.goal, allergies: profile.allergies, preferences: profile.preferences, budgetPerWeek: profile.budgetPerWeek ? Number(profile.budgetPerWeek) : null, availableDays: profile.availableDays, sessionDurationMin: profile.sessionDurationMin, equipment: profile.equipment, injuries: profile.injuries, mode: profile.mode },
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
        await db.insert(userProfiles).values({ userId, name: profile.name ?? "Unknown", age: profile.age, weightKg: profile.weightKg != null ? String(profile.weightKg) : undefined, heightCm: profile.heightCm != null ? String(profile.heightCm) : undefined, goal: profile.goal ?? "maintain", allergies: profile.allergies ?? [], preferences: profile.preferences ?? [], budgetPerWeek: profile.budgetPerWeek != null ? String(profile.budgetPerWeek) : undefined, availableDays: profile.availableDays ?? [], sessionDurationMin: profile.sessionDurationMin, equipment: profile.equipment ?? [], injuries: profile.injuries ?? [], mode: profile.mode ?? "auto", updatedAt: now }).onConflictDoUpdate({ target: userProfiles.userId, set: { ...(profile.name !== undefined && { name: profile.name }), ...(profile.age !== undefined && { age: profile.age }), ...(profile.weightKg !== undefined && { weightKg: String(profile.weightKg) }), ...(profile.heightCm !== undefined && { heightCm: String(profile.heightCm) }), ...(profile.goal !== undefined && { goal: profile.goal }), ...(profile.allergies !== undefined && { allergies: profile.allergies }), ...(profile.preferences !== undefined && { preferences: profile.preferences }), ...(profile.budgetPerWeek !== undefined && { budgetPerWeek: String(profile.budgetPerWeek) }), ...(profile.availableDays !== undefined && { availableDays: profile.availableDays }), ...(profile.sessionDurationMin !== undefined && { sessionDurationMin: profile.sessionDurationMin }), ...(profile.equipment !== undefined && { equipment: profile.equipment }), ...(profile.injuries !== undefined && { injuries: profile.injuries }), ...(profile.mode !== undefined && { mode: profile.mode }), updatedAt: now } });
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
    "Parse messy, informal user text and extract structured fitness profile data. Returns only the fields that could be confidently extracted.",
    {
      input: z.string().describe("Raw, unstructured user text about their fitness preferences, schedule, dietary needs, etc."),
      userId: z.string().optional().describe("If provided, existing profile is used as context"),
    },
    async ({ input, userId }) => {
      let contextBlock = "";
      if (userId) {
        const existing = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null);
        if (existing) contextBlock = `\n\nExisting profile:\n${JSON.stringify({ name: existing.name, age: existing.age, goal: existing.goal, allergies: existing.allergies, preferences: existing.preferences, availableDays: existing.availableDays, equipment: existing.equipment, injuries: existing.injuries }, null, 2)}`;
      }
      const completion = await openai.chat.completions.create({ model: "gpt-5-mini", messages: [{ role: "system", content: NORMALIZE_SYSTEM_PROMPT }, { role: "user", content: `Extract fitness data from: "${input}"${contextBlock}` }], response_format: { type: "json_object" } });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsed: { extracted: Record<string, unknown>; confidence: string; notes: string };
      try { parsed = JSON.parse(raw) as typeof parsed; }
      catch { return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to parse AI response" }) }], isError: true }; }
      return { content: [{ type: "text", text: JSON.stringify({ extracted: parsed.extracted ?? {}, rawInput: input, confidence: parsed.confidence ?? "low", notes: parsed.notes ?? "" }) }] };
    }
  );

  server.tool(
    "generate_plan",
    "AI-generate a complete diet or workout plan based on the user's stored profile. The plan is automatically saved. In confirm mode, returns a preview and requires confirmed:true to save.",
    {
      userId: z.string(),
      type: z.enum(["diet", "workout"]).describe("Type of plan to generate"),
      confirmed: z.boolean().optional().describe("Set to true to save in confirm mode"),
    },
    async ({ userId, type, confirmed }) => {
      const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null);
      if (!profile) return { content: [{ type: "text", text: JSON.stringify({ error: `No profile found for '${userId}'. Call save_state first.` }) }], isError: true };

      const userContext = type === "diet"
        ? `Goal: ${profile.goal}, Allergies: ${(profile.allergies as string[]).join(", ") || "none"}, Preferences: ${(profile.preferences as string[]).join(", ") || "none"}, Budget/week: ${profile.budgetPerWeek ? `$${profile.budgetPerWeek}` : "no limit"}, Weight: ${profile.weightKg ?? "unknown"}kg`
        : `Goal: ${profile.goal}, Available days: ${(profile.availableDays as string[]).join(", ")}, Session: ${profile.sessionDurationMin ?? 60}min, Equipment: ${(profile.equipment as string[]).join(", ") || "bodyweight"}, Injuries: ${(profile.injuries as string[]).join(", ") || "none"}`;

      const systemPrompt = type === "diet" ? DIET_SYSTEM_PROMPT : WORKOUT_SYSTEM_PROMPT;
      const completion = await openai.chat.completions.create({ model: "gpt-5-mini", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Generate a ${type} plan:\n${userContext}` }], response_format: { type: "json_object" } });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      let plan: Record<string, unknown>;
      try { plan = JSON.parse(raw) as Record<string, unknown>; }
      catch { return { content: [{ type: "text", text: JSON.stringify({ error: "AI returned invalid JSON" }) }], isError: true }; }

      const isConfirmMode = profile.mode === "confirm";
      const shouldSave = !isConfirmMode || confirmed === true;

      if (shouldSave) {
        const now = new Date();
        if (type === "diet") {
          await db.insert(dietPlans).values({ userId, meals: plan.meals, dailyCalories: plan.dailyCalories as number, macros: plan.macros, notes: plan.notes as string | undefined, updatedAt: now }).onConflictDoUpdate({ target: dietPlans.userId, set: { meals: plan.meals, dailyCalories: plan.dailyCalories as number, macros: plan.macros, notes: plan.notes as string | undefined, updatedAt: now } });
        } else {
          await db.insert(workoutPlans).values({ userId, sessions: plan.sessions, notes: plan.notes as string | undefined, updatedAt: now }).onConflictDoUpdate({ target: workoutPlans.userId, set: { sessions: plan.sessions, notes: plan.notes as string | undefined, updatedAt: now } });
        }
      }

      const result = { plan, saved: shouldSave, ...(isConfirmMode && !confirmed ? { requiresConfirmation: true, message: "Preview only. Call generate_plan again with confirmed:true to save." } : {}) };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "schedule_events",
    "Generate and save calendar events for the user's fitness plan. Expands a description like 'schedule workouts for a month' into structured daily events.",
    {
      userId: z.string(),
      description: z.string().optional().describe("Natural language description, e.g. 'schedule my workouts for May'"),
      startDate: z.string().optional().describe("Start date YYYY-MM-DD, defaults to today"),
      durationDays: z.number().int().optional().describe("Number of days to schedule, default 30"),
      confirmed: z.boolean().optional().describe("Set to true to save in confirm mode"),
    },
    async ({ userId, description, startDate, durationDays, confirmed }) => {
      const [profile, workoutPlan] = await Promise.all([
        db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null),
        db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).then((r) => r[0] ?? null),
      ]);
      if (!profile) return { content: [{ type: "text", text: JSON.stringify({ error: `No profile found for '${userId}'` }) }], isError: true };

      const sd = startDate ?? new Date().toISOString().split("T")[0];
      const dd = durationDays ?? 30;
      type WorkoutSession = { day: string; name: string; durationMin: number };
      const sessions = (workoutPlan?.sessions as WorkoutSession[] | null) ?? [];

      const contextLines = [`Start date: ${sd}`, `Duration: ${dd} days`, `Available days: ${(profile.availableDays as string[]).join(", ")}`, `Session: ${profile.sessionDurationMin ?? 60}min`, `Description: ${description ?? "Schedule fitness events"}`, sessions.length > 0 ? `Sessions: ${sessions.map((s) => `${s.day}: ${s.name} (${s.durationMin}min)`).join("; ")}` : ""].filter(Boolean);

      const completion = await openai.chat.completions.create({ model: "gpt-5-mini", messages: [{ role: "system", content: SCHEDULE_SYSTEM_PROMPT }, { role: "user", content: contextLines.join("\n") }], response_format: { type: "json_object" } });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      let result: { events: unknown[] };
      try { result = JSON.parse(raw) as typeof result; }
      catch { return { content: [{ type: "text", text: JSON.stringify({ error: "AI returned invalid JSON" }) }], isError: true }; }

      const events = result.events ?? [];
      const isConfirmMode = profile.mode === "confirm";
      const shouldSave = !isConfirmMode || confirmed === true;

      if (shouldSave) {
        const now = new Date();
        const existing = await db.select().from(schedules).where(eq(schedules.userId, userId)).then((r) => r[0] ?? null);
        const allEvents = [...((existing?.events as unknown[]) ?? []), ...events];
        await db.insert(schedules).values({ userId, events: allEvents, updatedAt: now }).onConflictDoUpdate({ target: schedules.userId, set: { events: allEvents, updatedAt: now } });
      }

      const out = { events, count: events.length, saved: shouldSave, startDate: sd, durationDays: dd, ...(isConfirmMode && !confirmed ? { requiresConfirmation: true, message: "Preview only. Call schedule_events again with confirmed:true to save." } : {}) };
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

      const report = {
        exportedAt: new Date().toISOString(), userId,
        profile: { name: profile.name, goal: profile.goal, age: profile.age, weightKg: profile.weightKg ? Number(profile.weightKg) : null, mode: profile.mode },
        progress: { xp, streak: prog?.streak ?? 0, level: computeLevel(xp), xpToNextLevel: xpToNextLevel(xp), workoutLogs, dietLogs, totalLogs: workoutLogs + dietLogs },
        achievements: achievements.map((a) => ({ name: a.name, description: a.description, earnedAt: a.earnedAt })),
        dietPlan: dietPlan ? { dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros } : null,
        workoutPlan: workoutPlan ? { sessionCount: (workoutPlan.sessions as unknown[]).length } : null,
        schedule: schedule ? { eventCount: (schedule.events as unknown[]).length } : null,
        recentHistory: history.slice(-10),
        downloadUrl: `/api/export/${userId}?format=${format}`,
        ...(format === "html" && { embedUrl: `/api/export/${userId}?format=html&embed=true` }),
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
