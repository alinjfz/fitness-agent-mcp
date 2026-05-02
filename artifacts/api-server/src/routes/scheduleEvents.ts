import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userProfiles, workoutPlans, schedules } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

type WorkoutSession = {
  day: string;
  name: string;
  durationMin: number;
};

const SCHEDULE_SYSTEM_PROMPT = `You are a scheduling assistant. Generate calendar events based on the user's fitness plan.

Output ONLY valid JSON with this exact structure — no markdown, no prose:
{
  "events": [
    {
      "title": "Push Day (Chest/Shoulders/Triceps)",
      "date": "2026-05-05",
      "time": "07:00",
      "type": "workout",
      "durationMin": 60
    }
  ]
}

Rules:
- Use ISO date format YYYY-MM-DD
- Use 24-hour time format HH:MM
- Spread events across the date range provided
- Match workout sessions to the correct days of week (monday->next monday, etc.)
- For diet type events, schedule 3 meal check-in events per day at breakfast, lunch, dinner times
- type must be one of: "workout", "meal", "check_in"
- Return as many events as the durationDays requires`;

router.post("/schedule-events", async (req, res) => {
  const body = req.body as {
    userId: string;
    description?: string;
    startDate?: string;
    durationDays?: number;
    confirmed?: boolean;
    eventType?: "workout" | "meal" | "both";
  };

  if (!body.userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const [profile, workoutPlan] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, body.userId)).then((r) => r[0] ?? null),
    db.select().from(workoutPlans).where(eq(workoutPlans.userId, body.userId)).then((r) => r[0] ?? null),
  ]);

  if (!profile) {
    res.status(404).json({ error: `No profile found for user '${body.userId}'` });
    return;
  }

  const startDate = body.startDate ?? new Date().toISOString().split("T")[0];
  const durationDays = body.durationDays ?? 30;
  const eventType = body.eventType ?? "workout";

  const workoutSessions = (workoutPlan?.sessions as WorkoutSession[] | null) ?? [];
  const availableDays = profile.availableDays as string[];

  const contextLines = [
    `Start date: ${startDate}`,
    `Duration: ${durationDays} days`,
    `Event type: ${eventType}`,
    `User available days: ${availableDays.join(", ") || "any"}`,
    `Session duration: ${profile.sessionDurationMin ?? 60} minutes`,
    `Description: ${body.description ?? "Schedule fitness events for the period"}`,
  ];

  if (workoutSessions.length > 0) {
    contextLines.push(
      `Workout sessions to schedule: ${workoutSessions.map((s) => `${s.day}: ${s.name} (${s.durationMin}min)`).join("; ")}`,
    );
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: SCHEDULE_SYSTEM_PROMPT },
      { role: "user", content: contextLines.join("\n") },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let result: { events: unknown[] };

  try {
    result = JSON.parse(raw) as typeof result;
  } catch {
    res.status(500).json({ error: "AI returned invalid JSON", raw });
    return;
  }

  const events = result.events ?? [];
  const isConfirmMode = profile.mode === "confirm";
  const shouldSave = !isConfirmMode || body.confirmed === true;

  if (shouldSave) {
    const now = new Date();
    const existing = await db.select().from(schedules).where(eq(schedules.userId, body.userId)).then((r) => r[0] ?? null);
    const existingEvents = (existing?.events as unknown[]) ?? [];
    const allEvents = [...existingEvents, ...events];

    await db
      .insert(schedules)
      .values({ userId: body.userId, events: allEvents, updatedAt: now })
      .onConflictDoUpdate({
        target: schedules.userId,
        set: { events: allEvents, updatedAt: now },
      });
  }

  res.json({
    events,
    count: events.length,
    saved: shouldSave,
    startDate,
    durationDays,
    ...(isConfirmMode && !body.confirmed
      ? {
          requiresConfirmation: true,
          message: "User is in confirm mode. Call this endpoint again with confirmed:true to save.",
        }
      : {}),
  });
});

router.delete("/schedule-events/:userId", async (req, res) => {
  const { userId } = req.params;
  const now = new Date();
  await db
    .insert(schedules)
    .values({ userId, events: [], updatedAt: now })
    .onConflictDoUpdate({
      target: schedules.userId,
      set: { events: [], updatedAt: now },
    });
  res.json({ success: true, message: "Schedule cleared" });
});

export default router;
