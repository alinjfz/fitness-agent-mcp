import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import {
  userProfiles,
  dietPlans,
  workoutPlans,
  schedules,
} from "@workspace/db";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are a fitness data extractor that can read both text and images.
Your job is to extract structured fitness data from the provided input (text description, image of a workout plan, diet menu, handwritten notes, etc.).

Extract any of these data types you find:
- profile: user profile info (name, age, weight, height, goal, allergies, preferences, availableDays, equipment, injuries, sessionDurationMin)
- workoutPlan: workout sessions with exercises (day, name, durationMin, exercises[])
- dietPlan: meal plan (meals[], dailyCalories, macros{proteinG, carbsG, fatG})
- schedule: calendar events (title, date YYYY-MM-DD, time, type: workout|meal|check_in, durationMin)

Schema reference:
{
  "profile": {
    "name": string,
    "age": integer,
    "weightKg": number,
    "heightCm": number,
    "goal": "lose_weight"|"build_muscle"|"maintain"|"improve_endurance",
    "allergies": string[],
    "preferences": string[],
    "budgetPerWeek": number,
    "availableDays": ["monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday"],
    "sessionDurationMin": integer,
    "equipment": string[],
    "injuries": string[]
  },
  "workoutPlan": {
    "sessions": [{ "day": string, "name": string, "durationMin": integer, "exercises": [{ "name": string, "sets": integer, "reps": integer, "restSec": integer }], "notes": string }]
  },
  "dietPlan": {
    "meals": [{ "name": string, "time": string, "calories": integer, "protein": number, "carbs": number, "fat": number, "ingredients": string[] }],
    "dailyCalories": integer,
    "macros": { "proteinG": number, "carbsG": number, "fatG": number },
    "notes": string
  },
  "schedule": {
    "events": [{ "title": string, "date": "YYYY-MM-DD", "time": string, "type": "workout"|"meal"|"check_in", "durationMin": integer }]
  }
}

Rules:
1. Only include fields you can confidently extract. Omit fields you cannot determine.
2. Normalize day names to lowercase full names (e.g. "Mon" → "monday").
3. Convert units if needed (lbs→kg, feet/inches→cm).
4. "detectedType": what primary type of data was found: "workout", "diet", "profile", "schedule", "mixed", or "unknown".
5. "confidence": "high" if most data is clear, "medium" if some inference needed, "low" if vague.
6. "summary": a concise human-readable description of what was extracted (1-2 sentences).
7. Return ONLY valid JSON. No markdown, no explanation outside the JSON structure.

Return JSON in this exact format:
{
  "extracted": { "profile"?: {...}, "workoutPlan"?: {...}, "dietPlan"?: {...}, "schedule"?: {...} },
  "detectedType": "workout"|"diet"|"profile"|"schedule"|"mixed"|"unknown",
  "confidence": "high"|"medium"|"low",
  "summary": "string"
}`;

router.post("/ingest", async (req, res) => {
  const body = req.body as {
    userId: string;
    text?: string;
    imageBase64?: string;
    imageUrl?: string;
    typeHint?: string;
    save?: boolean;
  };

  if (!body.userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  if (!body.text && !body.imageBase64 && !body.imageUrl) {
    res.status(400).json({ error: "At least one of text, imageBase64, or imageUrl is required" });
    return;
  }

  const shouldSave = body.save !== false;

  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  if (body.typeHint && body.typeHint !== "auto") {
    userContent.push({
      type: "text",
      text: `Focus on extracting: ${body.typeHint} data.\n\n`,
    });
  }

  if (body.text) {
    userContent.push({ type: "text", text: body.text });
  }

  if (body.imageBase64) {
    const mediaType = body.imageBase64.startsWith("/9j/") ? "image/jpeg"
      : body.imageBase64.startsWith("iVBOR") ? "image/png"
      : body.imageBase64.startsWith("UklGR") ? "image/webp"
      : "image/jpeg";

    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mediaType};base64,${body.imageBase64}` },
    });
  }

  if (body.imageUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: body.imageUrl },
    });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: userContent as Parameters<typeof openai.chat.completions.create>[0]["messages"][0]["content"],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: {
    extracted: {
      profile?: Record<string, unknown>;
      workoutPlan?: Record<string, unknown>;
      dietPlan?: Record<string, unknown>;
      schedule?: Record<string, unknown>;
    };
    detectedType: string;
    confidence: string;
    summary: string;
  };

  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    res.status(500).json({ error: "Failed to parse AI response", raw });
    return;
  }

  const { extracted = {}, detectedType = "unknown", confidence = "low", summary = "" } = parsed;

  if (shouldSave && Object.keys(extracted).length > 0) {
    const now = new Date();
    const { userId } = body;

    if (extracted.profile) {
      const p = extracted.profile;
      await db
        .insert(userProfiles)
        .values({
          userId,
          name: (p.name as string) ?? "Unknown",
          age: p.age as number | undefined,
          weightKg: p.weightKg != null ? String(p.weightKg) : undefined,
          heightCm: p.heightCm != null ? String(p.heightCm) : undefined,
          goal: (p.goal as string) ?? "maintain",
          allergies: (p.allergies as string[]) ?? [],
          preferences: (p.preferences as string[]) ?? [],
          budgetPerWeek: p.budgetPerWeek != null ? String(p.budgetPerWeek) : undefined,
          availableDays: (p.availableDays as string[]) ?? [],
          sessionDurationMin: p.sessionDurationMin as number | undefined,
          equipment: (p.equipment as string[]) ?? [],
          injuries: (p.injuries as string[]) ?? [],
          mode: "auto",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: {
            ...(p.name !== undefined && { name: p.name as string }),
            ...(p.age !== undefined && { age: p.age as number }),
            ...(p.weightKg !== undefined && { weightKg: String(p.weightKg) }),
            ...(p.heightCm !== undefined && { heightCm: String(p.heightCm) }),
            ...(p.goal !== undefined && { goal: p.goal as string }),
            ...(p.allergies !== undefined && { allergies: p.allergies as string[] }),
            ...(p.preferences !== undefined && { preferences: p.preferences as string[] }),
            ...(p.budgetPerWeek !== undefined && { budgetPerWeek: String(p.budgetPerWeek) }),
            ...(p.availableDays !== undefined && { availableDays: p.availableDays as string[] }),
            ...(p.sessionDurationMin !== undefined && { sessionDurationMin: p.sessionDurationMin as number }),
            ...(p.equipment !== undefined && { equipment: p.equipment as string[] }),
            ...(p.injuries !== undefined && { injuries: p.injuries as string[] }),
            updatedAt: now,
          },
        });
    }

    if (extracted.workoutPlan) {
      const w = extracted.workoutPlan;
      await db
        .insert(workoutPlans)
        .values({ userId, sessions: w.sessions, notes: w.notes as string | undefined, updatedAt: now })
        .onConflictDoUpdate({
          target: workoutPlans.userId,
          set: { sessions: w.sessions, notes: w.notes as string | undefined, updatedAt: now },
        });
    }

    if (extracted.dietPlan) {
      const d = extracted.dietPlan;
      await db
        .insert(dietPlans)
        .values({
          userId,
          meals: d.meals,
          dailyCalories: d.dailyCalories as number,
          macros: d.macros,
          notes: d.notes as string | undefined,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: dietPlans.userId,
          set: { meals: d.meals, dailyCalories: d.dailyCalories as number, macros: d.macros, notes: d.notes as string | undefined, updatedAt: now },
        });
    }

    if (extracted.schedule) {
      const s = extracted.schedule;
      await db
        .insert(schedules)
        .values({ userId, events: s.events, updatedAt: now })
        .onConflictDoUpdate({
          target: schedules.userId,
          set: { events: s.events, updatedAt: now },
        });
    }
  }

  res.json({
    extracted,
    detectedType,
    saved: shouldSave && Object.keys(extracted).length > 0,
    summary,
    confidence,
  });
});

export default router;
