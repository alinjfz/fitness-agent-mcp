import { Router, type IRouter } from "express";
import { db, progress } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CompletionEvent } from "@workspace/db";

const router: IRouter = Router();

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

router.get("/progress/:userId/history", async (req, res) => {
  const { userId } = req.params;

  const rawPage = parseInt((req.query["page"] as string) ?? "1", 10);
  const rawLimit = parseInt((req.query["limit"] as string) ?? String(DEFAULT_LIMIT), 10);
  const typeFilter = req.query["type"] as "workout" | "diet" | undefined;
  const sort = (req.query["sort"] as string) ?? "desc";

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (typeFilter && typeFilter !== "workout" && typeFilter !== "diet") {
    res.status(400).json({ error: "type must be 'workout' or 'diet'" });
    return;
  }

  if (sort !== "asc" && sort !== "desc") {
    res.status(400).json({ error: "sort must be 'asc' or 'desc'" });
    return;
  }

  const prog = await db
    .select()
    .from(progress)
    .where(eq(progress.userId, userId))
    .then((r) => r[0] ?? null);

  if (!prog) {
    res.status(404).json({ error: `No progress found for user '${userId}'` });
    return;
  }

  let history = (prog.history ?? []) as CompletionEvent[];

  if (typeFilter) {
    history = history.filter((h) => h.type === typeFilter);
  }

  if (sort === "desc") {
    history = [...history].sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
    );
  } else {
    history = [...history].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
    );
  }

  const total = history.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const clampedPage = Math.min(page, totalPages);
  const offset = (clampedPage - 1) * limit;
  const pageItems = history.slice(offset, offset + limit);

  const allHistory = (prog.history ?? []) as CompletionEvent[];
  const workoutLogs = allHistory.filter((h) => h.type === "workout").length;
  const dietLogs = allHistory.filter((h) => h.type === "diet").length;

  res.json({
    userId,
    history: pageItems,
    pagination: {
      page: clampedPage,
      limit,
      total,
      totalPages,
      hasNext: clampedPage < totalPages,
      hasPrev: clampedPage > 1,
    },
    summary: {
      workoutLogs,
      dietLogs,
      totalLogs: workoutLogs + dietLogs,
      filteredTotal: total,
    },
  });
});

export default router;
