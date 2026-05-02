import { useState } from "react";
import { useGetState, useLogCompletion, useGetHistory } from "@workspace/api-client-react";
import { USER_ID } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Activity, Flame, Trophy, Target, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { BASE_PATH } from "@/lib/constants";

const AWARD_ICON = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="8" r="6" />
    <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
  </svg>
);

type LogType = "workout" | "diet";

interface LogForm {
  notes: string;
  beginTime: string;
  endTime: string;
}

function buildChartData(history: Array<{ type: string; completedAt: string }>) {
  const buckets: Record<string, { label: string; workouts: number; diet: number }> = {};

  for (const item of history) {
    const d = new Date(item.completedAt);
    const key = format(d, "MMM d");
    if (!buckets[key]) buckets[key] = { label: key, workouts: 0, diet: 0 };
    if (item.type === "workout") buckets[key].workouts++;
    else buckets[key].diet++;
  }

  return Object.values(buckets).slice(-14);
}

export default function Overview() {
  const { data: state, isLoading, refetch } = useGetState(USER_ID);
  const { data: historyData } = useGetHistory(USER_ID, { page: 1, limit: 100 });
  const logCompletion = useLogCompletion();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [logType, setLogType] = useState<LogType>("workout");
  const [form, setForm] = useState<LogForm>({ notes: "", beginTime: "", endTime: "" });

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!state) return <div className="p-8">Failed to load state</div>;

  const { progress, profile } = state;
  const xp = progress?.xp || 0;
  const nextLevelXp = progress?.xpToNextLevel || 1000;
  const level = progress?.level || 1;
  const progressPercent = Math.min(100, Math.max(0, (xp / nextLevelXp) * 100));

  const openDialog = (type: LogType) => {
    setLogType(type);
    const now = new Date();
    const hhmm = format(now, "HH:mm");
    setForm({ notes: "", beginTime: hhmm, endTime: hhmm });
    setDialogOpen(true);
  };

  const handleConfirmLog = () => {
    const notes = [
      form.notes,
      logType === "workout" && form.beginTime ? `Start: ${form.beginTime}` : "",
      logType === "workout" && form.endTime ? `End: ${form.endTime}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    logCompletion.mutate(
      { data: { userId: USER_ID, type: logType, notes: notes || undefined } },
      {
        onSuccess: (res) => {
          toast({ title: "Logged!", description: `+${res.xpGained} XP earned.` });
          setDialogOpen(false);
          refetch();
        },
        onError: () => {
          toast({ title: "Failed to log", variant: "destructive" });
        },
      }
    );
  };

  const handleRemoveEntry = async (index: number) => {
    try {
      const res = await fetch(`${BASE_PATH}api/log-completion/${USER_ID}/${index}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Entry removed" });
      refetch();
    } catch {
      toast({ title: "Failed to remove entry", variant: "destructive" });
    }
  };

  const allHistory = historyData?.history ?? progress?.history ?? [];
  const chartData = buildChartData(allHistory);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground">
            Welcome back, {profile?.name || "Athlete"}. Here is your current status.
          </p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => openDialog("workout")} className="gap-2">
            <Activity className="w-4 h-4" />
            Log Workout
          </Button>
          <Button onClick={() => openDialog("diet")} variant="secondary" className="gap-2">
            <Target className="w-4 h-4" />
            Log Diet
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Level {level}</CardTitle>
            <Trophy className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{xp} XP</div>
            <p className="text-xs text-muted-foreground mt-1">{nextLevelXp - xp} XP to level {level + 1}</p>
            <Progress value={progressPercent} className="mt-3" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Streak</CardTitle>
            <Flame className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{progress?.streak || 0} Days</div>
            <p className="text-xs text-muted-foreground mt-1">Resets after 4 missed days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Workouts</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {allHistory.filter((h: any) => h.type === "workout").length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Achievements</CardTitle>
            <AWARD_ICON className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{progress?.achievements?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Activity Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorWorkouts" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorDiet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 17%)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(215 20% 65%)" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(215 20% 65%)" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(222 47% 11%)",
                    border: "1px solid hsl(216 34% 17%)",
                    borderRadius: 8,
                    color: "hsl(210 40% 98%)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="workouts"
                  name="Workouts"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#colorWorkouts)"
                />
                <Area
                  type="monotone"
                  dataKey="diet"
                  name="Diet"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="url(#colorDiet)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {allHistory.slice(0, 5).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg group">
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-2 rounded-full ${
                        item.type === "workout"
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-green-500/10 text-green-500"
                      }`}
                    >
                      {item.type === "workout" ? (
                        <Activity className="w-4 h-4" />
                      ) : (
                        <Target className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium capitalize">{item.type}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(item.completedAt), "MMM d, h:mm a")}
                      </p>
                      {item.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5">{item.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="font-bold text-primary">+{item.xpGained} XP</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleRemoveEntry(i)}
                      title="Remove entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {allHistory.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No recent activity</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Latest Achievements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {progress?.achievements?.slice(0, 4).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-full bg-yellow-500/10 text-yellow-500">
                      <Trophy className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground truncate max-w-[180px]">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
              {(!progress?.achievements || progress.achievements.length === 0) && (
                <div className="text-center text-muted-foreground py-8">No achievements yet</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {logType === "workout" ? (
                <Activity className="w-5 h-5 text-blue-500" />
              ) : (
                <Target className="w-5 h-5 text-green-500" />
              )}
              Log {logType === "workout" ? "Workout" : "Diet"}
            </DialogTitle>
            <DialogDescription>
              {logType === "workout"
                ? "Record your workout session details."
                : "Record your diet/meal details."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {logType === "workout" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="beginTime">Start Time</Label>
                  <Input
                    id="beginTime"
                    type="time"
                    value={form.beginTime}
                    onChange={(e) => setForm((f) => ({ ...f, beginTime: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endTime">End Time</Label>
                  <Input
                    id="endTime"
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder={
                  logType === "workout"
                    ? "e.g. Bench press 4×8, felt strong..."
                    : "e.g. Chicken, rice, broccoli — 650 kcal..."
                }
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="resize-none"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmLog} disabled={logCompletion.isPending}>
              {logCompletion.isPending ? "Logging..." : "Confirm & Log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
