import { useGetState } from "@workspace/api-client-react";
import { USER_ID } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Plan() {
  const { data, isLoading } = useGetState(USER_ID);

  if (isLoading) return <div className="p-8">Loading...</div>;

  const { workoutPlan, dietPlan } = data || {};

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">Your Plan</h2>
        <p className="text-muted-foreground">Current workout and diet regimens.</p>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <h3 className="text-2xl font-semibold">Workout Plan</h3>
          {workoutPlan?.sessions?.map((session: any, i: number) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">{session.day} - {session.name}</CardTitle>
                  <span className="text-sm text-muted-foreground">{session.durationMin} min</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {session.exercises?.map((ex: any, j: number) => (
                    <div key={j} className="flex justify-between items-center text-sm border-b pb-2 last:border-0 last:pb-0">
                      <span className="font-medium">{ex.name}</span>
                      <span className="text-muted-foreground">{ex.sets} sets × {ex.reps} reps</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
          {(!workoutPlan || !workoutPlan.sessions?.length) && (
            <div className="text-muted-foreground">No workout plan set.</div>
          )}
        </div>

        <div className="space-y-6">
          <h3 className="text-2xl font-semibold">Diet Plan</h3>
          {dietPlan && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-6">
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">{dietPlan.dailyCalories}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">kcal</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{dietPlan.macros?.proteinG}g</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Protein</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{dietPlan.macros?.carbsG}g</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Carbs</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{dietPlan.macros?.fatG}g</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Fat</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          <div className="space-y-4">
            {dietPlan?.meals?.map((meal: any, i: number) => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-lg">{meal.name}</CardTitle>
                    <span className="text-sm font-medium">{meal.calories} kcal</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground mb-3">
                    {meal.protein}g P • {meal.carbs}g C • {meal.fat}g F
                  </div>
                  <ul className="text-sm space-y-1">
                    {meal.ingredients?.map((ing: string, j: number) => (
                      <li key={j} className="flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-primary" />
                        {ing}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          {(!dietPlan || !dietPlan.meals?.length) && (
            <div className="text-muted-foreground">No diet plan set.</div>
          )}
        </div>
      </div>
    </div>
  );
}