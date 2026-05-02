import { useGetState, useGetHistory } from "@workspace/api-client-react";
import { USER_ID } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Lock } from "lucide-react";

const ACHIEVEMENT_DEFS = [
  { id: "first_workout", name: "First Rep", description: "Logged your first workout", xpBonus: 100, icon: "💪", category: "workout", target: 1, metric: "workouts" },
  { id: "first_diet", name: "Clean Plate", description: "Logged your first diet session", xpBonus: 50, icon: "🥗", category: "diet", target: 1, metric: "diet" },
  { id: "streak_3", name: "On A Roll", description: "Maintained a 3-day streak", xpBonus: 75, icon: "🔥", category: "streak", target: 3, metric: "streak" },
  { id: "streak_7", name: "Week Warrior", description: "Maintained a 7-day streak", xpBonus: 200, icon: "⚡", category: "streak", target: 7, metric: "streak" },
  { id: "streak_14", name: "Fortnight Fighter", description: "Maintained a 14-day streak", xpBonus: 400, icon: "🏅", category: "streak", target: 14, metric: "streak" },
  { id: "streak_30", name: "Iron Habit", description: "Maintained a 30-day streak", xpBonus: 1000, icon: "💎", category: "streak", target: 30, metric: "streak" },
  { id: "level_5", name: "Getting Serious", description: "Reached Level 5", xpBonus: 150, icon: "⭐", category: "level", target: 5, metric: "level" },
  { id: "level_10", name: "Dedicated", description: "Reached Level 10", xpBonus: 300, icon: "🌟", category: "level", target: 10, metric: "level" },
  { id: "level_25", name: "Elite", description: "Reached Level 25", xpBonus: 750, icon: "🏆", category: "level", target: 25, metric: "level" },
  { id: "logs_10", name: "Consistent", description: "Logged 10 completions", xpBonus: 100, icon: "📈", category: "total", target: 10, metric: "total" },
  { id: "logs_25", name: "Quarter Century", description: "Logged 25 completions", xpBonus: 175, icon: "🎯", category: "total", target: 25, metric: "total" },
  { id: "logs_50", name: "Committed", description: "Logged 50 completions", xpBonus: 250, icon: "🔑", category: "total", target: 50, metric: "total" },
  { id: "logs_100", name: "Century Club", description: "Logged 100 completions", xpBonus: 500, icon: "🎖️", category: "total", target: 100, metric: "total" },
  { id: "workouts_10", name: "Iron Will", description: "Completed 10 workouts", xpBonus: 125, icon: "🏋️", category: "workout", target: 10, metric: "workouts" },
  { id: "workouts_25", name: "Sweat Equity", description: "Completed 25 workouts", xpBonus: 200, icon: "💦", category: "workout", target: 25, metric: "workouts" },
  { id: "workouts_50", name: "Machine", description: "Completed 50 workouts", xpBonus: 400, icon: "🤖", category: "workout", target: 50, metric: "workouts" },
  { id: "diet_10", name: "Nutrition Novice", description: "Logged 10 diet sessions", xpBonus: 100, icon: "🥑", category: "diet", target: 10, metric: "diet" },
  { id: "diet_25", name: "Fueled Right", description: "Logged 25 diet sessions", xpBonus: 175, icon: "🍎", category: "diet", target: 25, metric: "diet" },
];

const CATEGORY_LABELS: Record<string, string> = {
  workout: "Workout Milestones",
  diet: "Diet Milestones",
  streak: "Streak Achievements",
  level: "Level Achievements",
  total: "Completion Milestones",
};

export default function Achievements() {
  const { data, isLoading } = useGetState(USER_ID);
  const { data: historyData } = useGetHistory(USER_ID, { page: 1, limit: 200 });

  if (isLoading) return <div className="p-8">Loading...</div>;

  const earnedSet = new Set((data?.progress?.achievements ?? []).map((a: any) => a.id));
  const earnedMap = new Map((data?.progress?.achievements ?? []).map((a: any) => [a.id, a]));

  const allHistory = historyData?.history ?? [];
  const workoutCount = allHistory.filter((h: any) => h.type === "workout").length;
  const dietCount = allHistory.filter((h: any) => h.type === "diet").length;
  const totalCount = allHistory.length;
  const streak = data?.progress?.streak ?? 0;
  const level = data?.progress?.level ?? 1;

  function getCurrentValue(metric: string): number {
    switch (metric) {
      case "workouts": return workoutCount;
      case "diet": return dietCount;
      case "total": return totalCount;
      case "streak": return streak;
      case "level": return level;
      default: return 0;
    }
  }

  const categories = ["streak", "level", "workout", "diet", "total"];

  const earnedCount = ACHIEVEMENT_DEFS.filter((d) => earnedSet.has(d.id)).length;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-10">
      <header className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Achievements</h2>
          <p className="text-muted-foreground">Your trophy room.</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{earnedCount} / {ACHIEVEMENT_DEFS.length}</div>
          <p className="text-sm text-muted-foreground">Unlocked</p>
          <Progress value={(earnedCount / ACHIEVEMENT_DEFS.length) * 100} className="mt-2 w-40" />
        </div>
      </header>

      {categories.map((cat) => {
        const defs = ACHIEVEMENT_DEFS.filter((d) => d.category === cat);
        return (
          <section key={cat} className="space-y-4">
            <h3 className="text-lg font-semibold text-muted-foreground uppercase tracking-wider">
              {CATEGORY_LABELS[cat]}
            </h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {defs.map((def) => {
                const earned = earnedSet.has(def.id);
                const earnedData = earnedMap.get(def.id);
                const current = getCurrentValue(def.metric);
                const pct = Math.min(100, Math.round((current / def.target) * 100));

                return (
                  <Card
                    key={def.id}
                    className={
                      earned
                        ? "border-yellow-500/30 bg-yellow-500/5"
                        : "opacity-70 border-border"
                    }
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{def.icon}</span>
                          <div>
                            <CardTitle className="text-base">{def.name}</CardTitle>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {earned ? (
                            <Badge variant="outline" className="text-yellow-500 border-yellow-500/40 text-xs">
                              Earned
                            </Badge>
                          ) : (
                            <Lock className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">{def.description}</p>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{Math.min(current, def.target)} / {def.target}</span>
                          <span>{pct}%</span>
                        </div>
                        <Progress value={pct} className={earned ? "h-1.5 [&>div]:bg-yellow-500" : "h-1.5"} />
                      </div>

                      <div className="flex justify-between items-center text-sm">
                        <span className={earned ? "text-yellow-500 font-semibold" : "text-muted-foreground"}>
                          +{def.xpBonus} XP
                        </span>
                        {earned && earnedData?.earnedAt && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(earnedData.earnedAt), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
