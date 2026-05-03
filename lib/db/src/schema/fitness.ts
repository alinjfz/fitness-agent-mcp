import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";

export const userProfiles = sqliteTable("user_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  name: text("name").notNull(),
  age: integer("age"),
  weightKg: real("weight_kg"),
  heightCm: real("height_cm"),
  goal: text("goal").notNull(),
  allergies: text("allergies", { mode: "json" }).$type<string[]>().$defaultFn(() => []).notNull(),
  preferences: text("preferences", { mode: "json" }).$type<string[]>().$defaultFn(() => []).notNull(),
  budgetPerWeek: real("budget_per_week"),
  availableDays: text("available_days", { mode: "json" }).$type<string[]>().$defaultFn(() => []).notNull(),
  sessionDurationMin: integer("session_duration_min"),
  equipment: text("equipment", { mode: "json" }).$type<string[]>().$defaultFn(() => []).notNull(),
  injuries: text("injuries", { mode: "json" }).$type<string[]>().$defaultFn(() => []).notNull(),
  mode: text("mode").notNull().default("auto"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const dietPlans = sqliteTable("diet_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  meals: text("meals", { mode: "json" }).notNull(),
  dailyCalories: integer("daily_calories").notNull(),
  macros: text("macros", { mode: "json" }).notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const workoutPlans = sqliteTable("workout_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  sessions: text("sessions", { mode: "json" }).notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  events: text("events", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const progress = sqliteTable("progress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  xp: integer("xp").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  level: integer("level").notNull().default(1),
  history: text("history", { mode: "json" }).$type<CompletionEvent[]>().$defaultFn(() => []).notNull(),
  achievements: text("achievements", { mode: "json" }).$type<Achievement[]>().$defaultFn(() => []).notNull(),
  reminders: text("reminders", { mode: "json" }).$type<Reminder[]>().$defaultFn(() => []).notNull(),
  lastLoggedAt: integer("last_logged_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export type CompletionEvent = {
  type: "workout" | "diet";
  completedAt: string;
  xpGained: number;
  notes?: string;
};

export type Achievement = {
  id: string;
  name: string;
  description: string;
  earnedAt: string;
  xpBonus: number;
};

export type Reminder = {
  id: string;
  message: string;
  type: "missed_workout" | "missed_diet" | "weekly_report" | "plan_renewal";
  createdAt: string;
  read: boolean;
};
