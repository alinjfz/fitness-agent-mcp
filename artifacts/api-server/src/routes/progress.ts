import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { progress } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Reminder } from "@workspace/db";

const router: IRouter = Router();

router.patch("/progress/:userId/reminders/read", async (req, res) => {
  const { userId } = req.params;
  const { ids } = req.body as { ids?: string[] };

  const existing = await db
    .select()
    .from(progress)
    .where(eq(progress.userId, userId))
    .then((r) => r[0] ?? null);

  if (!existing) {
    res.status(404).json({ error: `No progress found for user '${userId}'` });
    return;
  }

  const reminders = (existing.reminders ?? []) as Reminder[];
  const updated = reminders.map((r) =>
    !ids || ids.includes(r.id) ? { ...r, read: true } : r,
  );

  await db
    .update(progress)
    .set({ reminders: updated, updatedAt: new Date() })
    .where(eq(progress.userId, userId));

  res.json({ success: true, markedRead: ids ?? "all" });
});

export default router;
