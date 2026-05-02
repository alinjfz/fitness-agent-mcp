import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userProfiles, dietPlans, workoutPlans } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const DIET_SYSTEM_PROMPT = `You are a professional nutritionist. Generate a structured 7-day meal plan based on the user's profile.

Output ONLY valid JSON matching this exact schema — no markdown, no prose:
{
  "meals": [
    {
      "name": "Breakfast",
      "time": "08:00",
      "calories": 500,
      "protein": 30,
      "carbs": 50,
      "fat": 15,
      "ingredients": ["oats", "banana", "almond milk"]
    }
  ],
  "dailyCalories": 2000,
  "macros": {
    "proteinG": 150,
    "carbsG": 200,
    "fatG": 65
  },
  "notes": "Brief summary of the plan approach"
}

Rules:
- Include 4-6 meals per day (breakfast, snack, lunch, snack, dinner, optional post-workout)
- NEVER include allergens
- Respect food preferences (include preferred foods)
- Match calories to goal: lose_weight=-300-500 deficit, build_muscle=+300-500 surplus, maintain=TDEE, improve_endurance=high-carb
- Stay within budget if provided
- Protein: 1.6-2.2g per kg bodyweight for muscle goals, 1.2-1.6g for others`;

const WORKOUT_SYSTEM_PROMPT = `You are a professional fitness trainer. Generate a structured weekly workout plan based on the user's profile.

Output ONLY valid JSON matching this exact schema — no markdown, no prose:
{
  "sessions": [
    {
      "day": "monday",
      "name": "Push Day (Chest/Shoulders/Triceps)",
      "durationMin": 60,
      "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": 8, "restSec": 120 },
        { "name": "Overhead Press", "sets": 3, "reps": 10, "restSec": 90 }
      ]
    }
  ],
  "notes": "Brief summary of the program structure and progression tips"
}

Rules:
- Only schedule sessions on the user's available days
- Total session duration must match sessionDurationMin
- NEVER prescribe exercises that aggravate injuries
- Only use equipment the user has access to (or bodyweight if none)
- Match the program split to the goal:
  - build_muscle: hypertrophy splits (Push/Pull/Legs, Upper/Lower, etc.)
  - lose_weight: circuit training + cardio
  - improve_endurance: cardio-heavy with compound lifts
  - maintain: balanced full-body
- Include warm-up (5 min) in total duration`;

router.post("/generate-plan", async (req, res) => {
  const body = req.body as {
    userId: string;
    type: "diet" | "workout";
    confirmed?: boolean;
  };

  if (!body.userId || !body.type) {
    res.status(400).json({ error: "userId and type are required" });
    return;
  }

  const profile = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, body.userId))
    .then((r) => r[0] ?? null);

  if (!profile) {
    res
      .status(404)
      .json({ error: `No profile found for user '${body.userId}'. Call save_state first.` });
    return;
  }

  const userContext =
    body.type === "diet"
      ? `User profile:
- Name: ${profile.name}
- Age: ${profile.age ?? "unknown"}
- Weight: ${profile.weightKg ?? "unknown"} kg
- Goal: ${profile.goal}
- Allergies: ${(profile.allergies as string[]).join(", ") || "none"}
- Food preferences: ${(profile.preferences as string[]).join(", ") || "no specific preferences"}
- Weekly food budget: ${profile.budgetPerWeek ? `$${profile.budgetPerWeek}` : "no budget constraint"}`
      : `User profile:
- Name: ${profile.name}
- Age: ${profile.age ?? "unknown"}
- Weight: ${profile.weightKg ?? "unknown"} kg
- Goal: ${profile.goal}
- Available days: ${(profile.availableDays as string[]).join(", ") || "any day"}
- Session duration: ${profile.sessionDurationMin ?? 60} minutes
- Equipment: ${(profile.equipment as string[]).join(", ") || "bodyweight only"}
- Injuries / limitations: ${(profile.injuries as string[]).join(", ") || "none"}`;

  const systemPrompt =
    body.type === "diet" ? DIET_SYSTEM_PROMPT : WORKOUT_SYSTEM_PROMPT;

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Generate a ${body.type === "diet" ? "meal" : "workout"} plan for this user:\n\n${userContext}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let plan: Record<string, unknown>;

  try {
    plan = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    res.status(500).json({ error: "AI returned invalid JSON", raw });
    return;
  }

  const isConfirmMode = profile.mode === "confirm";
  const shouldSave = !isConfirmMode || body.confirmed === true;

  if (shouldSave) {
    const now = new Date();
    if (body.type === "diet") {
      await db
        .insert(dietPlans)
        .values({
          userId: body.userId,
          meals: plan.meals,
          dailyCalories: plan.dailyCalories as number,
          macros: plan.macros,
          notes: plan.notes as string | undefined,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: dietPlans.userId,
          set: {
            meals: plan.meals,
            dailyCalories: plan.dailyCalories as number,
            macros: plan.macros,
            notes: plan.notes as string | undefined,
            updatedAt: now,
          },
        });
    } else {
      await db
        .insert(workoutPlans)
        .values({
          userId: body.userId,
          sessions: plan.sessions,
          notes: plan.notes as string | undefined,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: workoutPlans.userId,
          set: {
            sessions: plan.sessions,
            notes: plan.notes as string | undefined,
            updatedAt: now,
          },
        });
    }
  }

  res.json({
    plan,
    saved: shouldSave,
    ...(isConfirmMode && !body.confirmed
      ? {
          requiresConfirmation: true,
          message:
            "User is in confirm mode. Call this endpoint again with confirmed:true to save the plan.",
        }
      : {}),
  });
});

export default router;
