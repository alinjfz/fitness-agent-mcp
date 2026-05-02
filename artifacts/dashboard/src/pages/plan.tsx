import { useState } from "react";
import { useGetState } from "@workspace/api-client-react";
import { USER_ID, BASE_PATH } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Check, X, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Plan() {
  const { data, isLoading, refetch } = useGetState(USER_ID);
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  if (isLoading) return <div className="p-8">Loading...</div>;

  const { workoutPlan, dietPlan } = data || {};

  const startEdit = () => {
    setDraft({
      workoutPlan: JSON.parse(JSON.stringify(workoutPlan || { sessions: [] })),
      dietPlan: JSON.parse(JSON.stringify(dietPlan || { dailyCalories: 0, macros: { proteinG: 0, carbsG: 0, fatG: 0 }, meals: [] })),
    });
    setEditMode(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditMode(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await fetch(`${BASE_PATH}api/normalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: USER_ID,
          workoutPlan: draft.workoutPlan,
          dietPlan: draft.dietPlan,
        }),
      });
      toast({ title: "Plan saved!" });
      setEditMode(false);
      setDraft(null);
      refetch();
    } catch {
      toast({ title: "Failed to save plan", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const wp = editMode ? draft.workoutPlan : workoutPlan;
  const dp = editMode ? draft.dietPlan : dietPlan;

  const updateSession = (si: number, field: string, value: any) => {
    const sessions = [...draft.workoutPlan.sessions];
    sessions[si] = { ...sessions[si], [field]: value };
    setDraft((d: any) => ({ ...d, workoutPlan: { ...d.workoutPlan, sessions } }));
  };

  const updateExercise = (si: number, ei: number, field: string, value: any) => {
    const sessions = [...draft.workoutPlan.sessions];
    const exercises = [...(sessions[si].exercises || [])];
    exercises[ei] = { ...exercises[ei], [field]: value };
    sessions[si] = { ...sessions[si], exercises };
    setDraft((d: any) => ({ ...d, workoutPlan: { ...d.workoutPlan, sessions } }));
  };

  const addExercise = (si: number) => {
    const sessions = [...draft.workoutPlan.sessions];
    sessions[si] = {
      ...sessions[si],
      exercises: [...(sessions[si].exercises || []), { name: "New Exercise", sets: 3, reps: 10 }],
    };
    setDraft((d: any) => ({ ...d, workoutPlan: { ...d.workoutPlan, sessions } }));
  };

  const removeExercise = (si: number, ei: number) => {
    const sessions = [...draft.workoutPlan.sessions];
    sessions[si] = { ...sessions[si], exercises: sessions[si].exercises.filter((_: any, i: number) => i !== ei) };
    setDraft((d: any) => ({ ...d, workoutPlan: { ...d.workoutPlan, sessions } }));
  };

  const updateMacro = (field: string, value: any) => {
    setDraft((d: any) => ({ ...d, dietPlan: { ...d.dietPlan, macros: { ...d.dietPlan.macros, [field]: Number(value) } } }));
  };

  const updateMeal = (mi: number, field: string, value: any) => {
    const meals = [...draft.dietPlan.meals];
    meals[mi] = { ...meals[mi], [field]: value };
    setDraft((d: any) => ({ ...d, dietPlan: { ...d.dietPlan, meals } }));
  };

  const removeMeal = (mi: number) => {
    setDraft((d: any) => ({ ...d, dietPlan: { ...d.dietPlan, meals: d.dietPlan.meals.filter((_: any, i: number) => i !== mi) } }));
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Your Plan</h2>
          <p className="text-muted-foreground">Current workout and diet regimens.</p>
        </div>
        {!editMode ? (
          <Button onClick={startEdit} variant="outline" className="gap-2">
            <Pencil className="w-4 h-4" />
            Edit Plan
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={cancelEdit} className="gap-2">
              <X className="w-4 h-4" />
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving} className="gap-2">
              <Check className="w-4 h-4" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <h3 className="text-2xl font-semibold">Workout Plan</h3>
          {wp?.sessions?.map((session: any, si: number) => (
            <Card key={si}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center gap-3">
                  {editMode ? (
                    <div className="flex gap-2 flex-1">
                      <Input
                        value={session.day}
                        onChange={(e) => updateSession(si, "day", e.target.value)}
                        className="w-24 h-8 text-sm"
                        placeholder="Day"
                      />
                      <Input
                        value={session.name}
                        onChange={(e) => updateSession(si, "name", e.target.value)}
                        className="flex-1 h-8 text-sm"
                        placeholder="Session name"
                      />
                    </div>
                  ) : (
                    <CardTitle className="text-lg">{session.day} - {session.name}</CardTitle>
                  )}
                  {editMode ? (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={session.durationMin}
                        onChange={(e) => updateSession(si, "durationMin", Number(e.target.value))}
                        className="w-16 h-8 text-sm"
                        placeholder="Min"
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">min</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">{session.durationMin} min</span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {session.exercises?.map((ex: any, ei: number) => (
                    <div key={ei} className="flex justify-between items-center text-sm border-b pb-2 last:border-0 last:pb-0 gap-2">
                      {editMode ? (
                        <>
                          <Input
                            value={ex.name}
                            onChange={(e) => updateExercise(si, ei, "name", e.target.value)}
                            className="flex-1 h-7 text-sm"
                            placeholder="Exercise"
                          />
                          <Input
                            type="number"
                            value={ex.sets}
                            onChange={(e) => updateExercise(si, ei, "sets", Number(e.target.value))}
                            className="w-14 h-7 text-sm"
                            placeholder="Sets"
                          />
                          <span className="text-muted-foreground text-xs">×</span>
                          <Input
                            type="number"
                            value={ex.reps}
                            onChange={(e) => updateExercise(si, ei, "reps", Number(e.target.value))}
                            className="w-14 h-7 text-sm"
                            placeholder="Reps"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeExercise(si, ei)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{ex.name}</span>
                          <span className="text-muted-foreground">{ex.sets} sets × {ex.reps} reps</span>
                        </>
                      )}
                    </div>
                  ))}
                  {editMode && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full gap-1 text-muted-foreground mt-1 h-7"
                      onClick={() => addExercise(si)}
                    >
                      <Plus className="w-3 h-3" />
                      Add Exercise
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {(!wp || !wp.sessions?.length) && (
            <div className="text-muted-foreground">No workout plan set.</div>
          )}
        </div>

        <div className="space-y-6">
          <h3 className="text-2xl font-semibold">Diet Plan</h3>
          {dp && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-6">
                {editMode ? (
                  <div className="grid grid-cols-4 gap-3 text-center">
                    {[
                      { label: "kcal", key: "dailyCalories", parent: "root" },
                      { label: "Protein g", key: "proteinG", parent: "macros" },
                      { label: "Carbs g", key: "carbsG", parent: "macros" },
                      { label: "Fat g", key: "fatG", parent: "macros" },
                    ].map(({ label, key, parent }) => (
                      <div key={key}>
                        <Input
                          type="number"
                          value={parent === "root" ? draft.dietPlan.dailyCalories : draft.dietPlan.macros[key]}
                          onChange={(e) =>
                            parent === "root"
                              ? setDraft((d: any) => ({ ...d, dietPlan: { ...d.dietPlan, dailyCalories: Number(e.target.value) } }))
                              : updateMacro(key, e.target.value)
                          }
                          className="text-center h-9"
                        />
                        <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold">{dp.dailyCalories}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">kcal</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{dp.macros?.proteinG}g</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">Protein</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{dp.macros?.carbsG}g</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">Carbs</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{dp.macros?.fatG}g</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">Fat</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            {dp?.meals?.map((meal: any, mi: number) => (
              <Card key={mi}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center gap-2">
                    {editMode ? (
                      <>
                        <Input
                          value={meal.name}
                          onChange={(e) => updateMeal(mi, "name", e.target.value)}
                          className="flex-1 h-8 text-sm font-medium"
                        />
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={meal.calories}
                            onChange={(e) => updateMeal(mi, "calories", Number(e.target.value))}
                            className="w-20 h-8 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">kcal</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeMeal(mi)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <CardTitle className="text-lg">{meal.name}</CardTitle>
                        <span className="text-sm font-medium">{meal.calories} kcal</span>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {editMode ? (
                    <div className="flex gap-2 text-sm">
                      {[
                        { label: "P g", key: "protein" },
                        { label: "C g", key: "carbs" },
                        { label: "F g", key: "fat" },
                      ].map(({ label, key }) => (
                        <div key={key} className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={meal[key]}
                            onChange={(e) => updateMeal(mi, key, Number(e.target.value))}
                            className="w-16 h-7 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">{label}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground mb-3">
                      {meal.protein}g P • {meal.carbs}g C • {meal.fat}g F
                    </div>
                  )}
                  {!editMode && (
                    <ul className="text-sm space-y-1">
                      {meal.ingredients?.map((ing: string, j: number) => (
                        <li key={j} className="flex items-center gap-2">
                          <div className="w-1 h-1 rounded-full bg-primary" />
                          {ing}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
            {editMode && (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() =>
                  setDraft((d: any) => ({
                    ...d,
                    dietPlan: {
                      ...d.dietPlan,
                      meals: [...(d.dietPlan.meals || []), { name: "New Meal", calories: 0, protein: 0, carbs: 0, fat: 0, ingredients: [] }],
                    },
                  }))
                }
              >
                <Plus className="w-4 h-4" />
                Add Meal
              </Button>
            )}
          </div>
          {(!dp || !dp.meals?.length) && !editMode && (
            <div className="text-muted-foreground">No diet plan set.</div>
          )}
        </div>
      </div>
    </div>
  );
}
