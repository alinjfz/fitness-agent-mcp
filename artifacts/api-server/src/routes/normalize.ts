import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { userProfiles } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are a fitness data extractor. Your job is to parse messy, informal user text and extract structured fitness profile information.

The user schema is:
{
  "profile": {
    "name": string (optional),
    "age": integer (optional),
    "weightKg": number (optional),
    "heightCm": number (optional),
    "goal": "lose_weight" | "build_muscle" | "maintain" | "improve_endurance" (optional),
    "allergies": string[] (optional),
    "preferences": string[] (optional, foods they like),
    "budgetPerWeek": number (optional, USD),
    "availableDays": array of "monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday" (optional),
    "sessionDurationMin": integer (optional),
    "equipment": string[] (optional),
    "injuries": string[] (optional),
    "mode": "auto" | "confirm" (optional)
  }
}

Rules:
1. Only include fields you can confidently extract from the input. Omit everything else.
2. Normalize day names to lowercase full names (e.g. "mon" → "monday").
3. Convert units if needed (e.g. lbs to kg, feet/inches to cm).
4. Map goals: losing weight → "lose_weight", gaining muscle/bulk → "build_muscle", maintain weight → "maintain", cardio/endurance → "improve_endurance".
5. Return ONLY valid JSON matching the schema. No markdown, no prose, no explanation in the JSON.
6. Provide a "confidence" field: "high" if most data is clear, "medium" if some inference was needed, "low" if very little was extractable.
7. Provide a "notes" field explaining what you extracted and what you could not determine.

Return JSON in this format:
{
  "extracted": { "profile": { ... } },
  "confidence": "high" | "medium" | "low",
  "notes": "string"
}`;

router.post("/normalize", async (req, res) => {
  const body = req.body as { input: string; userId?: string };

  if (!body.input) {
    res.status(400).json({ error: "input is required" });
    return;
  }

  let contextBlock = "";
  if (body.userId) {
    const existing = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, body.userId))
      .then((r) => r[0] ?? null);

    if (existing) {
      contextBlock = `\n\nExisting profile for context (only update fields that changed):\n${JSON.stringify({
        name: existing.name,
        age: existing.age,
        goal: existing.goal,
        allergies: existing.allergies,
        preferences: existing.preferences,
        availableDays: existing.availableDays,
        equipment: existing.equipment,
        injuries: existing.injuries,
      }, null, 2)}`;
    }
  }

  const userMessage = `Extract fitness data from this input:

"${body.input}"${contextBlock}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { extracted: Record<string, unknown>; confidence: string; notes: string };

  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    res.status(500).json({ error: "Failed to parse AI response", raw });
    return;
  }

  res.json({
    extracted: parsed.extracted ?? {},
    rawInput: body.input,
    confidence: parsed.confidence ?? "low",
    notes: parsed.notes ?? "",
  });
});

export default router;
