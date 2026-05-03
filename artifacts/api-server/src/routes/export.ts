import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  userProfiles,
  dietPlans,
  workoutPlans,
  schedules,
  progress,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Achievement, CompletionEvent } from "@workspace/db";
import { computeLevel, xpToNextLevel } from "../lib/gamification";

const router: IRouter = Router();

router.get("/export/:userId", async (req, res) => {
  const { userId } = req.params;
  const format = (req.query["format"] as string) ?? "json";
  const embed = req.query["embed"] === "true";

  const [profile, dietPlan, workoutPlan, schedule, prog] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then((r) => r[0] ?? null),
    db.select().from(dietPlans).where(eq(dietPlans.userId, userId)).then((r) => r[0] ?? null),
    db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).then((r) => r[0] ?? null),
    db.select().from(schedules).where(eq(schedules.userId, userId)).then((r) => r[0] ?? null),
    db.select().from(progress).where(eq(progress.userId, userId)).then((r) => r[0] ?? null),
  ]);

  if (!profile) {
    res.status(404).json({ error: `No state found for user '${userId}'` });
    return;
  }

  const xp = prog?.xp ?? 0;
  const level = computeLevel(xp);
  const nextLevel = xpToNextLevel(xp);
  const history = (prog?.history ?? []) as CompletionEvent[];
  const achievements = (prog?.achievements ?? []) as Achievement[];

  const workoutLogs = history.filter((h) => h.type === "workout").length;
  const dietLogs = history.filter((h) => h.type === "diet").length;

  const reportDate = new Date().toISOString().split("T")[0];

  if (format === "json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="fitness-report-${userId}-${reportDate}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      userId,
      profile: {
        name: profile.name,
        age: profile.age,
        weightKg: profile.weightKg ?? null,
        heightCm: profile.heightCm ?? null,
        goal: profile.goal,
        allergies: profile.allergies,
        preferences: profile.preferences,
        availableDays: profile.availableDays,
        equipment: profile.equipment,
        injuries: profile.injuries,
        mode: profile.mode,
      },
      progress: {
        xp,
        streak: prog?.streak ?? 0,
        level,
        xpToNextLevel: nextLevel,
        workoutLogs,
        dietLogs,
        totalLogs: workoutLogs + dietLogs,
      },
      achievements: achievements.map((a) => ({
        name: a.name,
        description: a.description,
        earnedAt: a.earnedAt,
      })),
      dietPlan: dietPlan ? { dailyCalories: dietPlan.dailyCalories, macros: dietPlan.macros, meals: dietPlan.meals } : null,
      workoutPlan: workoutPlan ? { sessions: workoutPlan.sessions } : null,
      schedule: schedule ? { events: schedule.events } : null,
      recentHistory: history.slice(-20),
    });
  } else if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="fitness-report-${userId}-${reportDate}.csv"`);

    const rows: string[] = [
      "Section,Field,Value",
      `Profile,Name,${profile.name}`,
      `Profile,Goal,${profile.goal}`,
      `Profile,Age,${profile.age ?? ""}`,
      `Profile,Weight (kg),${profile.weightKg ?? ""}`,
      `Profile,Height (cm),${profile.heightCm ?? ""}`,
      `Profile,Available Days,"${(profile.availableDays as string[]).join("; ")}"`,
      `Profile,Equipment,"${(profile.equipment as string[]).join("; ")}"`,
      `Profile,Allergies,"${(profile.allergies as string[]).join("; ")}"`,
      "",
      `Progress,XP,${xp}`,
      `Progress,Level,${level}`,
      `Progress,Streak,${prog?.streak ?? 0}`,
      `Progress,XP to Next Level,${nextLevel}`,
      `Progress,Workout Logs,${workoutLogs}`,
      `Progress,Diet Logs,${dietLogs}`,
      "",
      "Achievements,Name,Earned At",
      ...achievements.map((a) => `Achievements,${a.name},${a.earnedAt.split("T")[0]}`),
      "",
      "History,Type,Completed At,XP Gained,Notes",
      ...history.slice(-20).map((h) => `History,${h.type},${h.completedAt},${h.xpGained},"${h.notes ?? ""}"`),
    ];

    res.send(rows.join("\n"));
  } else if (format === "html") {
    res.setHeader("Content-Type", "text/html");
    if (!embed) {
      res.setHeader("Content-Disposition", `attachment; filename="fitness-report-${userId}-${reportDate}.html"`);
    }

    const achievementRows = achievements
      .map((a) => `<tr><td>${a.name}</td><td>${a.description}</td><td>${a.earnedAt.split("T")[0]}</td><td>+${a.xpBonus} XP</td></tr>`)
      .join("");

    const historyJson = JSON.stringify([...history].reverse())
      .replace(/<\/script>/gi, "<\\/script>");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Fitness Report — ${profile.name}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 960px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; background: #f9f9f9; }
  h1 { color: #111; border-bottom: 3px solid #0070f3; padding-bottom: 12px; }
  h2 { color: #333; margin-top: 40px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin: 24px 0; }
  .stat { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); text-align: center; }
  .stat-value { font-size: 2rem; font-weight: 700; color: #0070f3; }
  .stat-label { font-size: 0.85rem; color: #666; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  th { background: #0070f3; color: white; padding: 12px 16px; text-align: left; font-weight: 600; }
  td { padding: 10px 16px; border-bottom: 1px solid #f0f0f0; }
  tr:last-child td { border-bottom: none; }
  .badge { background: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; }
  footer { margin-top: 60px; color: #999; font-size: 0.8rem; text-align: center; }
  .log-controls { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin: 20px 0 12px; }
  .log-controls label { font-size: 0.85rem; font-weight: 600; color: #555; margin-right: 4px; }
  .log-controls select { padding: 6px 10px; border: 1px solid #ddd; border-radius: 8px; background: white; font-size: 0.85rem; cursor: pointer; }
  .log-controls select:hover { border-color: #0070f3; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 16px; border-top: 1px solid #f0f0f0; background: white; }
  .pagination button { padding: 8px 18px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 0.9rem; font-weight: 600; transition: all 0.15s; }
  .pagination button:hover:not(:disabled) { background: #0070f3; color: white; border-color: #0070f3; }
  .pagination button:disabled { opacity: 0.35; cursor: not-allowed; }
  .pagination #page-info { font-size: 0.85rem; color: #555; min-width: 220px; text-align: center; }
  .log-header { display: flex; align-items: baseline; gap: 10px; }
  .log-header h2 { margin: 0; }
  .log-count { font-size: 0.85rem; color: #888; }
</style>
</head>
<body>
<h1>&#127947; Fitness Report — ${profile.name}</h1>
<p>Generated on ${reportDate} &nbsp;|&nbsp; Goal: <strong>${profile.goal.replace(/_/g, " ")}</strong> &nbsp;|&nbsp; Mode: <span class="badge">${profile.mode}</span></p>

<h2>Progress</h2>
<div class="stats">
  <div class="stat"><div class="stat-value">${xp.toLocaleString()}</div><div class="stat-label">Total XP</div></div>
  <div class="stat"><div class="stat-value">${level}</div><div class="stat-label">Level</div></div>
  <div class="stat"><div class="stat-value">${prog?.streak ?? 0}</div><div class="stat-label">Day Streak</div></div>
  <div class="stat"><div class="stat-value">${workoutLogs}</div><div class="stat-label">Workouts Logged</div></div>
  <div class="stat"><div class="stat-value">${dietLogs}</div><div class="stat-label">Diet Sessions</div></div>
  <div class="stat"><div class="stat-value">${nextLevel}</div><div class="stat-label">XP to Next Level</div></div>
</div>

${achievements.length > 0 ? `<h2>Achievements (${achievements.length})</h2>
<table>
  <tr><th>Achievement</th><th>Description</th><th>Earned</th><th>Bonus</th></tr>
  ${achievementRows}
</table>` : ""}

<div class="log-header" style="margin-top:40px;">
  <h2>Activity Log</h2>
  <span class="log-count">(<span id="filtered-count">${history.length}</span> of ${history.length} entries)</span>
</div>

<div class="log-controls">
  <div>
    <label for="type-filter">Filter:</label>
    <select id="type-filter">
      <option value="all">All types</option>
      <option value="workout">Workout only</option>
      <option value="diet">Diet only</option>
    </select>
  </div>
  <div>
    <label for="sort-order">Sort:</label>
    <select id="sort-order">
      <option value="desc">Newest first</option>
      <option value="asc">Oldest first</option>
    </select>
  </div>
  <div>
    <label for="per-page">Per page:</label>
    <select id="per-page">
      <option value="10">10</option>
      <option value="20" selected>20</option>
      <option value="50">50</option>
      <option value="all">All</option>
    </select>
  </div>
</div>

<table id="history-table">
  <thead><tr><th>Type</th><th>Date</th><th>XP</th><th>Notes</th></tr></thead>
  <tbody id="history-tbody"><tr><td colspan="4">Loading…</td></tr></tbody>
</table>
<div class="pagination">
  <button id="prev-btn" disabled>&#8592; Previous</button>
  <span id="page-info"></span>
  <button id="next-btn" disabled>Next &#8594;</button>
</div>

<script type="application/json" id="history-data">${historyJson}</script>
<script>
(function () {
  var ALL = JSON.parse(document.getElementById('history-data').textContent);
  var filtered = ALL.slice();
  var currentPage = 1;
  var perPage = 20;
  var typeFilter = 'all';
  var sortOrder = 'desc';

  function applyFilters() {
    filtered = ALL.filter(function (h) {
      return typeFilter === 'all' || h.type === typeFilter;
    });
    filtered.sort(function (a, b) {
      var ta = new Date(a.completedAt).getTime();
      var tb = new Date(b.completedAt).getTime();
      return sortOrder === 'desc' ? tb - ta : ta - tb;
    });
    currentPage = 1;
    render();
  }

  function render() {
    var tbody = document.getElementById('history-tbody');
    var info = document.getElementById('page-info');
    var prev = document.getElementById('prev-btn');
    var next = document.getElementById('next-btn');
    var counter = document.getElementById('filtered-count');
    var total = filtered.length;
    counter.textContent = total;

    var start, end;
    if (perPage === 'all' || perPage >= total) {
      start = 0; end = total;
    } else {
      start = (currentPage - 1) * perPage;
      end = Math.min(start + perPage, total);
    }
    var pageItems = filtered.slice(start, end);

    var rows = '';
    if (pageItems.length === 0) {
      rows = '<tr><td colspan="4" style="text-align:center;color:#999;">No entries match the current filter</td></tr>';
    } else {
      for (var i = 0; i < pageItems.length; i++) {
        var h = pageItems[i];
        var icon = h.type === 'workout' ? '&#127947;' : '&#129367;';
        var date = h.completedAt.split('T')[0];
        rows += '<tr><td>' + icon + ' ' + h.type + '</td><td>' + date + '</td><td>+' + h.xpGained + ' XP</td><td>' + (h.notes || '') + '</td></tr>';
      }
    }
    tbody.innerHTML = rows;

    if (perPage === 'all' || total <= (typeof perPage === 'number' ? perPage : total)) {
      var totalPages = 1;
      info.textContent = total === 0 ? 'No entries' : 'All ' + total + ' entr' + (total === 1 ? 'y' : 'ies');
      prev.disabled = true;
      next.disabled = true;
    } else {
      var totalPages = Math.max(1, Math.ceil(total / perPage));
      if (currentPage > totalPages) currentPage = totalPages;
      var dispStart = total === 0 ? 0 : start + 1;
      info.textContent = 'Page ' + currentPage + ' of ' + totalPages + ' — entries ' + dispStart + '–' + end + ' of ' + total;
      prev.disabled = currentPage <= 1;
      next.disabled = currentPage >= totalPages;
    }
  }

  document.getElementById('type-filter').addEventListener('change', function () { typeFilter = this.value; applyFilters(); });
  document.getElementById('sort-order').addEventListener('change', function () { sortOrder = this.value; applyFilters(); });
  document.getElementById('per-page').addEventListener('change', function () {
    perPage = this.value === 'all' ? 'all' : parseInt(this.value, 10);
    currentPage = 1;
    render();
  });
  document.getElementById('prev-btn').addEventListener('click', function () { if (currentPage > 1) { currentPage--; render(); } });
  document.getElementById('next-btn').addEventListener('click', function () {
    var totalPages = perPage === 'all' ? 1 : Math.max(1, Math.ceil(filtered.length / perPage));
    if (currentPage < totalPages) { currentPage++; render(); }
  });

  render();
}());
</script>

<footer>Exported from Fitness Agent Layer &nbsp;|&nbsp; ${new Date().toISOString()}</footer>
</body>
</html>`;

    res.send(html);
  } else if (format === "markdown") {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="fitness-report-${userId}-${reportDate}.md"`);

    const goalLabel = (profile.goal as string).replace(/_/g, " ");
    const streak = prog?.streak ?? 0;
    const macros = dietPlan?.macros as { proteinG?: number; carbsG?: number; fatG?: number } | null;
    const meals = (dietPlan?.meals ?? []) as Array<{ name: string; time?: string; calories: number; protein: number; carbs: number; fat: number }>;
    const sessions = (workoutPlan?.sessions ?? []) as Array<{ day: string; name: string; durationMin: number; exercises: Array<{ name: string; sets?: number; reps?: number }> }>;

    const lines: string[] = [
      `# Fitness Report — ${profile.name}`,
      ``,
      `*Generated on ${reportDate} | Goal: ${goalLabel} | Level ${level}*`,
      ``,
      `---`,
      ``,
      `## Progress`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total XP | ${xp.toLocaleString()} |`,
      `| Level | ${level} |`,
      `| Streak | ${streak} day${streak !== 1 ? "s" : ""} |`,
      `| XP to Next Level | ${nextLevel} |`,
      `| Workouts Logged | ${workoutLogs} |`,
      `| Diet Sessions | ${dietLogs} |`,
      `| Total Logs | ${workoutLogs + dietLogs} |`,
      ``,
    ];

    if (achievements.length > 0) {
      lines.push(`## Achievements (${achievements.length})`, ``);
      lines.push(`| Achievement | Description | Earned | XP Bonus |`);
      lines.push(`|-------------|-------------|--------|----------|`);
      for (const a of achievements) {
        lines.push(`| ${a.name} | ${a.description} | ${a.earnedAt.split("T")[0]} | +${a.xpBonus} XP |`);
      }
      lines.push(``);
    }

    if (history.length > 0) {
      const recent = [...history].reverse().slice(0, 30);
      lines.push(`## Recent Activity (last ${recent.length} entries)`, ``);
      lines.push(`| Date | Type | XP Gained | Notes |`);
      lines.push(`|------|------|-----------|-------|`);
      for (const h of recent) {
        lines.push(`| ${h.completedAt.split("T")[0]} | ${h.type} | +${h.xpGained} XP | ${h.notes ?? ""} |`);
      }
      lines.push(``);
    }

    if (workoutPlan && sessions.length > 0) {
      lines.push(`## Workout Plan`, ``);
      for (const s of sessions) {
        lines.push(`### ${s.day.charAt(0).toUpperCase() + s.day.slice(1)} — ${s.name} (${s.durationMin} min)`, ``);
        if (s.exercises.length > 0) {
          lines.push(`| Exercise | Sets | Reps |`);
          lines.push(`|----------|------|------|`);
          for (const e of s.exercises) {
            lines.push(`| ${e.name} | ${e.sets ?? "—"} | ${e.reps ?? "—"} |`);
          }
          lines.push(``);
        }
      }
    }

    if (dietPlan) {
      lines.push(`## Diet Plan`, ``);
      lines.push(`**Daily Calories:** ${dietPlan.dailyCalories} kcal`, ``);
      if (macros) {
        lines.push(`**Macros:** ${macros.proteinG ?? 0}g protein / ${macros.carbsG ?? 0}g carbs / ${macros.fatG ?? 0}g fat`, ``);
      }
      if (meals.length > 0) {
        lines.push(`| Meal | Time | Calories | Protein | Carbs | Fat |`);
        lines.push(`|------|------|----------|---------|-------|-----|`);
        for (const m of meals) {
          lines.push(`| ${m.name} | ${m.time ?? "—"} | ${m.calories} kcal | ${m.protein}g | ${m.carbs}g | ${m.fat}g |`);
        }
        lines.push(``);
      }
    }

    lines.push(`---`);
    lines.push(`*Exported from Fitness Agent Layer — ${new Date().toISOString()}*`);

    res.send(lines.join("\n"));
  } else {
    res.status(400).json({ error: "format must be json, csv, html, or markdown" });
  }
});

export default router;
