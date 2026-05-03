import { Router, type IRouter } from "express";
import { db, progress } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CompletionEvent } from "@workspace/db";

const router: IRouter = Router();

router.patch("/log-completion/:userId/:index", async (req, res) => {
  const { userId, index } = req.params;
  const idx = parseInt(index, 10);
  const { notes } = req.body as { notes?: string };

  if (!userId || isNaN(idx)) {
    res.status(400).json({ error: "userId and valid index are required" });
    return;
  }

  const existing = await db
    .select()
    .from(progress)
    .where(eq(progress.userId, userId))
    .then((r) => r[0] ?? null);

  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  const history = (existing.history ?? []) as CompletionEvent[];
  if (idx < 0 || idx >= history.length) { res.status(400).json({ error: "Index out of range" }); return; }

  const newHistory = [...history];
  newHistory[idx] = { ...newHistory[idx], notes };

  await db.update(progress).set({ history: newHistory, updatedAt: new Date() }).where(eq(progress.userId, userId));
  res.json({ success: true, updated: newHistory[idx] });
});

router.delete("/log-completion/:userId/:index", async (req, res) => {
  const { userId, index } = req.params;
  const idx = parseInt(index, 10);

  if (!userId || isNaN(idx)) {
    res.status(400).json({ error: "userId and valid index are required" });
    return;
  }

  const existing = await db
    .select()
    .from(progress)
    .where(eq(progress.userId, userId))
    .then((r) => r[0] ?? null);

  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const history = (existing.history ?? []) as CompletionEvent[];

  if (idx < 0 || idx >= history.length) {
    res.status(400).json({ error: "Index out of range" });
    return;
  }

  const removed = history[idx];
  const newHistory = history.filter((_, i) => i !== idx);

  const xpLost = removed.xpGained ?? 0;
  const newXp = Math.max(0, (existing.xp ?? 0) - xpLost);

  const now = new Date();
  await db
    .update(progress)
    .set({
      history: newHistory,
      xp: newXp,
      updatedAt: now,
    })
    .where(eq(progress.userId, userId));

  res.json({ success: true, removed, newXp, historyLength: newHistory.length });
});

export default router;
