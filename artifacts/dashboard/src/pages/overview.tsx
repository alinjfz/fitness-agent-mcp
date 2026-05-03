import { useState, useEffect } from "react";
import { useGetState, useLogCompletion, useGetHistory } from "@workspace/api-client-react";
import { USER_ID, BASE_PATH } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Activity, Flame, Trophy, Target, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format, subDays, startOfWeek, endOfWeek } from "date-fns";
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { useQueryClient } from "@tanstack/react-query";

const AWARD_ICON = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="6" />
    <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
  </svg>
);

type LogType = "workout" | "diet";
interface LogForm { notes: string; beginTime: string; endTime: string; }
interface EditForm { notes: string; index: number; }

function buildWeeklyBars(history: Array<{ type: string; completedAt: string; xpGained?: number }>) {
  const weeks: Record<string, { label: string; workouts: number; diet: number; xp: number }> = {};
  const now = new Date();

  for (let w = 7; w >= 0; w--) {
    const weekStart = startOfWeek(subDays(now, w * 7), { weekStartsOn: 1 });
    const key = format(weekStart, "MMM d");
    weeks[key] = { label: key, workouts: 0, diet: 0, xp: 0 };
  }

  for (const item of history) {
    const d = new Date(item.completedAt);
    const ws = startOfWeek(d, { weekStartsOn: 1 });
    const key = format(ws, "MMM d");
    if (weeks[key]) {
      if (item.type === "workout") weeks[key].workouts++;
      else weeks[key].diet++;
      weeks[key].xp += item.xpGained ?? 0;
    }
  }

  return Object.values(weeks);
}

function buildDailyXP(history: Array<{ completedAt: string; xpGained?: number }>) {
  const days: Record<string, { label: string; xp: number; cumulative: number }> = {};
  const now = new Date();

  for (let i = 13; i >= 0; i--) {
    const key = format(subDays(now, i), "MMM d");
    days[key] = { label: key, xp: 0, cumulative: 0 };
  }

  for (const item of history) {
    const key = format(new Date(item.completedAt), "MMM d");
    if (days[key]) days[key].xp += item.xpGained ?? 0;
  }

  let cum = 0;
  for (const d of Object.values(days)) {
    cum += d.xp;
    d.cumulative = cum;
  }

  return Object.values(days);
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
};

export default function Overview() {
  const { data: state, isLoading, refetch } = useGetState(USER_ID);
  const { data: historyData, refetch: refetchHistory } = useGetHistory(USER_ID, { page: 1, limit: 500 });
  const logCompletion = useLogCompletion();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [logType, setLogType] = useState<LogType>("workout");
  const [form, setForm] = useState<LogForm>({ notes: "", beginTime: "", endTime: "" });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({ notes: "", index: -1 });

  const [seeded, setSeeded] = useState(() => !!localStorage.getItem("historySeeded"));

  useEffect(() => {
    if (!seeded) {
      fetch(`${BASE_PATH}api/debug/seed-history/${USER_ID}`, { method: "POST" })
        .then(() => {
          localStorage.setItem("historySeeded", "1");
          setSeeded(true);
          refetch();
          refetchHistory();
          queryClient.invalidateQueries();
        })
        .catch(() => {});
    }
  }, []);

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!state) return <div className="p-8">Failed to load state</div>;

  const { progress, profile } = state;
  const xp = progress?.xp || 0;
  const nextLevelXp = progress?.xpToNextLevel || 1000;
  const level = progress?.level || 1;
  const progressPercent = Math.min(100, Math.max(0, (xp / nextLevelXp) * 100));

  const allHistory = historyData?.history ?? progress?.history ?? [];

  const openDialog = (type: LogType) => {
    setLogType(type);
    const hhmm = format(new Date(), "HH:mm");
    setForm({ notes: "", beginTime: hhmm, endTime: hhmm });
    setDialogOpen(true);
  };

  const handleConfirmLog = () => {
    const parts = [
      form.beginTime ? `Start: ${form.beginTime}` : "",
      form.endTime ? `End: ${form.endTime}` : "",
      form.notes,
    ].filter(Boolean);
    const notes = parts.join(" | ");

    logCompletion.mutate(
      { data: { userId: USER_ID, type: logType, notes: notes || undefined } },
      {
        onSuccess: (res) => {
          toast({ title: "Logged!", description: `+${res.xpGained} XP earned.` });
          setDialogOpen(false);
          refetch();
          refetchHistory();
        },
        onError: () => toast({ title: "Failed to log", variant: "destructive" }),
      }
    );
  };

  const handleRemoveEntry = async (index: number) => {
    try {
      const res = await fetch(`${BASE_PATH}api/log-completion/${USER_ID}/${index}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Entry removed" });
      refetch();
      refetchHistory();
    } catch {
      toast({ title: "Failed to remove entry", variant: "destructive" });
    }
  };

  const openEdit = (index: number, notes: string) => {
    setEditForm({ index, notes: notes ?? "" });
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    try {
      const res = await fetch(`${BASE_PATH}api/log-completion/${USER_ID}/${editForm.index}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: editForm.notes }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Entry updated" });
      setEditOpen(false);
      refetch();
      refetchHistory();
    } catch {
      toast({ title: "Failed to update entry", variant: "destructive" });
    }
  };

  const weeklyData = buildWeeklyBars(allHistory);
  const dailyXpData = buildDailyXP(allHistory);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground">Welcome back, {profile?.name || "Athlete"}.</p>
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

      {/* Stats row */}
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

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weekly Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="workouts" name="Workouts" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="diet" name="Diet" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">XP Earned (last 14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dailyXpData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="xp" name="XP / day" stroke="#e11d48" strokeWidth={2} dot={{ r: 3, fill: "#e11d48" }} />
                <Line type="monotone" dataKey="cumulative" name="Cumulative XP" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity + achievements */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {allHistory.slice(0, 6).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg group">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${item.type === "workout" ? "bg-blue-500/10 text-blue-500" : "bg-green-500/10 text-green-500"}`}>
                      {item.type === "workout" ? <Activity className="w-4 h-4" /> : <Target className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="font-medium capitalize">{item.type}</p>
                      <p className="text-sm text-muted-foreground">{format(new Date(item.completedAt), "MMM d, h:mm a")}</p>
                      {item.notes && <p className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">{item.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="font-bold text-primary">+{item.xpGained} XP</div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(i, item.notes ?? "")} title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleRemoveEntry(i)} title="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
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
                <div key={i} className="flex items-center gap-4 p-4 border rounded-lg">
                  <div className="p-2 rounded-full bg-yellow-500/10 text-yellow-500">
                    <Trophy className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground truncate max-w-[180px]">{item.description}</p>
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

      {/* Log dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {logType === "workout" ? <Activity className="w-5 h-5 text-blue-500" /> : <Target className="w-5 h-5 text-green-500" />}
              Log {logType === "workout" ? "Workout" : "Diet"}
            </DialogTitle>
            <DialogDescription>
              {logType === "workout" ? "Record your workout session." : "Record your meal or diet session."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="beginTime">Start Time</Label>
                <Input id="beginTime" type="time" value={form.beginTime} onChange={(e) => setForm((f) => ({ ...f, beginTime: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End Time</Label>
                <Input id="endTime" type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder={logType === "workout" ? "e.g. Bench press 4×8, felt strong..." : "e.g. Chicken, rice, broccoli — 650 kcal..."}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="resize-none"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmLog} disabled={logCompletion.isPending}>
              {logCompletion.isPending ? "Logging..." : "Confirm & Log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              Edit Entry
            </DialogTitle>
            <DialogDescription>Update the notes for this activity.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="editNotes">Notes</Label>
            <Textarea
              id="editNotes"
              value={editForm.notes}
              onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
              className="resize-none"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
