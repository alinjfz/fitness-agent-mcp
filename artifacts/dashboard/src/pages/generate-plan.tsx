import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { USER_ID, BASE_PATH } from "@/lib/constants";
import {
  ChevronRight,
  ChevronLeft,
  Dumbbell,
  Salad,
  Sparkles,
  Check,
  X,
  Loader2,
  Target,
  Calendar,
  Utensils,
  ListChecks,
} from "lucide-react";

type Step = "basics" | "workout" | "diet" | "plantype" | "generating" | "preview";
type Goal = "lose_weight" | "build_muscle" | "maintain" | "improve_endurance";
type PlanType = "workout" | "diet" | "both";

const GOALS: { value: Goal; label: string; desc: string }[] = [
  { value: "lose_weight", label: "Lose Weight", desc: "Calorie deficit + cardio focus" },
  { value: "build_muscle", label: "Build Muscle", desc: "Hypertrophy training + protein surplus" },
  { value: "maintain", label: "Maintain", desc: "Balanced training at TDEE" },
  { value: "improve_endurance", label: "Improve Endurance", desc: "Cardio-heavy, high-carb fueling" },
];

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const EQUIPMENT_OPTIONS = [
  "Barbell", "Dumbbells", "Kettlebells", "Pull-up bar",
  "Resistance bands", "Cable machine", "Smith machine",
  "Treadmill", "Stationary bike", "Rowing machine", "Bodyweight only",
];

const STEPS: { id: Step; label: string; icon: React.ElementType }[] = [
  { id: "basics", label: "Basics", icon: Target },
  { id: "workout", label: "Workout", icon: Dumbbell },
  { id: "diet", label: "Diet", icon: Utensils },
  { id: "plantype", label: "Plan Type", icon: ListChecks },
];

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}

function TagInput({ tags, onChange, placeholder }: TagInputProps) {
  const [input, setInput] = useState("");

  const add = () => {
    const v = input.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!input.trim()}>
          Add
        </Button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1">
              {tag}
              <button
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GeneratePlan() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("basics");

  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [goal, setGoal] = useState<Goal>("build_muscle");

  const [availableDays, setAvailableDays] = useState<string[]>(["monday", "wednesday", "friday"]);
  const [sessionDurationMin, setSessionDurationMin] = useState("60");
  const [equipment, setEquipment] = useState<string[]>(["Dumbbells", "Barbell"]);
  const [injuries, setInjuries] = useState<string[]>([]);

  const [allergies, setAllergies] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<string[]>([]);
  const [budgetPerWeek, setBudgetPerWeek] = useState("");

  const [planType, setPlanType] = useState<PlanType>("both");

  const [generatedWorkout, setGeneratedWorkout] = useState<any>(null);
  const [generatedDiet, setGeneratedDiet] = useState<any>(null);

  const stepOrder: Step[] = ["basics", "workout", "diet", "plantype", "generating", "preview"];
  const currentIdx = stepOrder.indexOf(step);

  const toggleDay = (day: string) =>
    setAvailableDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);

  const toggleEquipment = (eq: string) =>
    setEquipment((prev) => prev.includes(eq) ? prev.filter((e) => e !== eq) : [...prev, eq]);

  const canNext = () => {
    if (step === "basics") return name.trim().length > 0 && goal;
    if (step === "workout") return availableDays.length > 0;
    return true;
  };

  const next = async () => {
    if (step === "plantype") {
      await generate();
    } else {
      const idx = stepOrder.indexOf(step);
      setStep(stepOrder[idx + 1]);
    }
  };

  const back = () => {
    const idx = stepOrder.indexOf(step);
    if (idx > 0) setStep(stepOrder[idx - 1]);
  };

  const generate = async () => {
    setStep("generating");
    try {
      await fetch(`${BASE_PATH}api/profile/${USER_ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "Alex Rivera",
          age: age ? Number(age) : undefined,
          weightKg: weightKg ? Number(weightKg) : undefined,
          goal,
          allergies,
          preferences,
          budgetPerWeek: budgetPerWeek ? Number(budgetPerWeek) : undefined,
          availableDays,
          sessionDurationMin: sessionDurationMin ? Number(sessionDurationMin) : 60,
          equipment,
          injuries,
          mode: "auto",
        }),
      });

      const results: { workout?: any; diet?: any } = {};

      if (planType === "workout" || planType === "both") {
        const r = await fetch(`${BASE_PATH}api/generate-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: USER_ID, type: "workout" }),
        });
        const data = await r.json();
        results.workout = data.plan;
      }

      if (planType === "diet" || planType === "both") {
        const r = await fetch(`${BASE_PATH}api/generate-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: USER_ID, type: "diet" }),
        });
        const data = await r.json();
        results.diet = data.plan;
      }

      setGeneratedWorkout(results.workout ?? null);
      setGeneratedDiet(results.diet ?? null);
      setStep("preview");
    } catch {
      toast({ title: "Generation failed", description: "Could not reach the API. Please try again.", variant: "destructive" });
      setStep("plantype");
    }
  };

  const applyPlan = async () => {
    await queryClient.invalidateQueries();
    toast({ title: "Plan applied!", description: "Your new plan is live on the dashboard." });
    navigate("/plan");
  };

  const progressSteps = STEPS;
  const activeProgressIdx = progressSteps.findIndex((s) => s.id === step);

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Sparkles className="w-7 h-7 text-primary" />
          Generate Your Plan
        </h2>
        <p className="text-muted-foreground mt-1">Answer a few questions and AI will craft a personalised fitness and diet plan for you.</p>
      </header>

      {step !== "generating" && step !== "preview" && (
        <div className="flex items-center gap-0">
          {progressSteps.map((s, i) => {
            const done = i < activeProgressIdx;
            const active = i === activeProgressIdx;
            return (
              <div key={s.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors",
                      done ? "bg-primary border-primary text-primary-foreground" :
                      active ? "border-primary text-primary bg-primary/10" :
                      "border-border text-muted-foreground"
                    )}
                  >
                    {done ? <Check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
                  </div>
                  <span className={cn("text-xs hidden sm:block", active ? "text-foreground font-medium" : "text-muted-foreground")}>
                    {s.label}
                  </span>
                </div>
                {i < progressSteps.length - 1 && (
                  <div className={cn("flex-1 h-0.5 mx-2 mb-4", i < activeProgressIdx ? "bg-primary" : "bg-border")} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {step === "basics" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Target className="w-5 h-5 text-primary" /> About You</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1 space-y-2">
                <Label>Your Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" />
              </div>
              <div className="space-y-2">
                <Label>Age</Label>
                <Input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="28" min={10} max={100} />
              </div>
              <div className="space-y-2">
                <Label>Weight (kg)</Label>
                <Input type="number" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="75" min={30} max={300} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>What's your primary fitness goal?</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                {GOALS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGoal(g.value)}
                    className={cn(
                      "flex flex-col items-start text-left p-4 rounded-lg border-2 transition-colors",
                      goal === g.value ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground"
                    )}
                  >
                    <span className="font-semibold text-sm">{g.label}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">{g.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "workout" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Dumbbell className="w-5 h-5 text-primary" /> Workout Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Which days can you train?</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-sm font-medium border-2 capitalize transition-colors",
                      availableDays.includes(day)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    )}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
              {availableDays.length === 0 && <p className="text-xs text-destructive">Select at least one day</p>}
            </div>

            <div className="space-y-2">
              <Label>Session length (minutes): <span className="text-primary font-semibold">{sessionDurationMin}</span></Label>
              <input
                type="range"
                min={20}
                max={120}
                step={5}
                value={sessionDurationMin}
                onChange={(e) => setSessionDurationMin(e.target.value)}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>20 min</span><span>120 min</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Available equipment</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {EQUIPMENT_OPTIONS.map((eq) => (
                  <button
                    key={eq}
                    type="button"
                    onClick={() => toggleEquipment(eq)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      equipment.includes(eq)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    )}
                  >
                    {eq}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Any injuries or limitations? <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <TagInput tags={injuries} onChange={setInjuries} placeholder="e.g. lower back pain, bad knees…" />
            </div>
          </CardContent>
        </Card>
      )}

      {step === "diet" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Utensils className="w-5 h-5 text-primary" /> Diet Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Any food allergies? <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <TagInput tags={allergies} onChange={setAllergies} placeholder="e.g. gluten, dairy, peanuts…" />
            </div>

            <div className="space-y-2">
              <Label>Foods you enjoy <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <TagInput tags={preferences} onChange={setPreferences} placeholder="e.g. chicken, oats, avocado…" />
            </div>

            <div className="space-y-2">
              <Label>Weekly food budget (USD) <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                type="number"
                value={budgetPerWeek}
                onChange={(e) => setBudgetPerWeek(e.target.value)}
                placeholder="e.g. 80"
                className="max-w-xs"
                min={0}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {step === "plantype" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ListChecks className="w-5 h-5 text-primary" /> What would you like to generate?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { value: "both" as PlanType, label: "Both Plans", desc: "Workout + Diet", icon: Sparkles },
                { value: "workout" as PlanType, label: "Workout Only", desc: "Training schedule", icon: Dumbbell },
                { value: "diet" as PlanType, label: "Diet Only", desc: "Meal plan", icon: Salad },
              ].map(({ value, label, desc, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPlanType(value)}
                  className={cn(
                    "flex flex-col items-center text-center gap-3 p-6 rounded-xl border-2 transition-colors",
                    planType === value ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground"
                  )}
                >
                  <Icon className={cn("w-8 h-8", planType === value ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <div className="font-semibold">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                  {planType === value && <Check className="w-4 h-4 text-primary" />}
                </button>
              ))}
            </div>

            <div className="mt-6 p-4 rounded-lg bg-muted/40 text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Ready to generate your plan</p>
              <p>Goal: <span className="text-foreground capitalize">{goal.replace("_", " ")}</span></p>
              <p>Training: <span className="text-foreground">{availableDays.map((d) => d.slice(0, 3)).join(", ")} · {sessionDurationMin} min sessions</span></p>
              {equipment.length > 0 && <p>Equipment: <span className="text-foreground">{equipment.slice(0, 3).join(", ")}{equipment.length > 3 ? ` +${equipment.length - 3} more` : ""}</span></p>}
              {allergies.length > 0 && <p>Allergies avoided: <span className="text-foreground">{allergies.join(", ")}</span></p>}
            </div>
          </CardContent>
        </Card>
      )}

      {step === "generating" && (
        <div className="flex flex-col items-center justify-center py-24 gap-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <Sparkles className="w-8 h-8 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-xl font-semibold">Generating your personalised plan…</p>
            <p className="text-muted-foreground text-sm">Our AI is crafting workouts and meals tailored to your profile.</p>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold">Your Plan is Ready</h3>
              <p className="text-muted-foreground text-sm">Review it below, then apply it to your dashboard.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep("plantype")}>
                Regenerate
              </Button>
              <Button onClick={applyPlan} className="gap-2">
                <Check className="w-4 h-4" />
                Apply to Dashboard
              </Button>
            </div>
          </div>

          {generatedWorkout && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Dumbbell className="w-5 h-5 text-primary" /> Workout Plan
                </CardTitle>
                {generatedWorkout.notes && <p className="text-sm text-muted-foreground mt-1">{generatedWorkout.notes}</p>}
              </CardHeader>
              <CardContent className="space-y-4">
                {generatedWorkout.sessions?.map((session: any, i: number) => (
                  <div key={i} className="border border-border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="capitalize font-semibold text-primary">{session.day}</span>
                        <span className="mx-2 text-muted-foreground">·</span>
                        <span className="font-medium">{session.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{session.durationMin} min</span>
                    </div>
                    <div className="space-y-1.5">
                      {session.exercises?.map((ex: any, j: number) => (
                        <div key={j} className="flex justify-between text-sm text-muted-foreground pl-2 border-l-2 border-border">
                          <span className="text-foreground">{ex.name}</span>
                          <span>{ex.sets} × {ex.reps} reps{ex.restSec ? ` · ${ex.restSec}s rest` : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {generatedDiet && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Salad className="w-5 h-5 text-primary" /> Diet Plan
                </CardTitle>
                {generatedDiet.notes && <p className="text-sm text-muted-foreground mt-1">{generatedDiet.notes}</p>}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-4 gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20 text-center">
                  <div>
                    <div className="text-2xl font-bold">{generatedDiet.dailyCalories}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">kcal</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{generatedDiet.macros?.proteinG}g</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Protein</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{generatedDiet.macros?.carbsG}g</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Carbs</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{generatedDiet.macros?.fatG}g</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Fat</div>
                  </div>
                </div>

                {generatedDiet.meals?.map((meal: any, i: number) => (
                  <div key={i} className="border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {meal.time && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{meal.time}</span>}
                        <span className="font-semibold">{meal.name}</span>
                      </div>
                      <span className="text-sm font-medium">{meal.calories} kcal</span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      {meal.protein}g P · {meal.carbs}g C · {meal.fat}g F
                    </div>
                    {meal.ingredients?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {meal.ingredients.map((ing: string, j: number) => (
                          <span key={j} className="text-xs bg-muted px-2 py-0.5 rounded">{ing}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="flex justify-center">
            <Button onClick={applyPlan} size="lg" className="gap-2 px-8">
              <Check className="w-5 h-5" />
              Apply to Dashboard
            </Button>
          </div>
        </div>
      )}

      {step !== "generating" && step !== "preview" && (
        <div className="flex justify-between pt-2">
          <Button
            variant="outline"
            onClick={back}
            disabled={currentIdx === 0}
            className="gap-2"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <Button onClick={next} disabled={!canNext()} className="gap-2">
            {step === "plantype" ? (
              <><Sparkles className="w-4 h-4" /> Generate Plan</>
            ) : (
              <>Next <ChevronRight className="w-4 h-4" /></>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
