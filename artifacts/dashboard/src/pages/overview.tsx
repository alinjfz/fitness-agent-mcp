import { useGetState, useLogCompletion } from "@workspace/api-client-react";
import { USER_ID } from "@/lib/constants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Activity, Flame, Trophy, Target, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function Overview() {
  const { data: state, isLoading, refetch } = useGetState(USER_ID);
  const logCompletion = useLogCompletion();
  const { toast } = useToast();

  if (isLoading) {
    return <div className="p-8">Loading...</div>;
  }

  if (!state) {
    return <div className="p-8">Failed to load state</div>;
  }

  const { progress, profile } = state;
  const xp = progress?.xp || 0;
  const nextLevelXp = progress?.xpToNextLevel || 1000;
  const level = progress?.level || 1;
  const progressPercent = Math.min(100, Math.max(0, (xp / nextLevelXp) * 100));

  const handleLog = (type: "workout" | "diet") => {
    logCompletion.mutate({ data: { userId: USER_ID, type } }, {
      onSuccess: (res) => {
        toast({
          title: "Activity Logged",
          description: `You earned ${res.xpGained} XP!`,
        });
        refetch();
      },
      onError: () => {
        toast({
          title: "Failed to log activity",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground">Welcome back, {profile?.name || "Athlete"}. Here is your current status.</p>
        </div>
        <div className="flex gap-4">
          <Button onClick={() => handleLog("workout")} className="gap-2">
            <Activity className="w-4 h-4" />
            Log Workout
          </Button>
          <Button onClick={() => handleLog("diet")} variant="secondary" className="gap-2">
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
            <p className="text-xs text-muted-foreground mt-1">
              {nextLevelXp - xp} XP to level {level + 1}
            </p>
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
            <p className="text-xs text-muted-foreground mt-1">Keep it up!</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Workouts</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {progress?.history?.filter(h => h.type === "workout").length || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Achievements</CardTitle>
            <Award className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{progress?.achievements?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {progress?.history?.slice(0, 5).map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${item.type === 'workout' ? 'bg-blue-500/10 text-blue-500' : 'bg-green-500/10 text-green-500'}`}>
                      {item.type === 'workout' ? <Activity className="w-4 h-4" /> : <Target className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="font-medium capitalize">{item.type}</p>
                      <p className="text-sm text-muted-foreground">{format(new Date(item.completedAt), "MMM d, h:mm a")}</p>
                    </div>
                  </div>
                  <div className="font-bold text-primary">+{item.xpGained} XP</div>
                </div>
              ))}
              {(!progress?.history || progress.history.length === 0) && (
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
              {progress?.achievements?.slice(0, 4).map((item, i) => (
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
    </div>
  );
}

function Award(props: any) {
  return <svg
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
}