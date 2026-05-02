import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  numeric,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  name: text("name").notNull(),
  age: integer("age"),
  weightKg: numeric("weight_kg", { precision: 5, scale: 2 }),
  heightCm: numeric("height_cm", { precision: 5, scale: 2 }),
  goal: text("goal").notNull(),
  allergies: jsonb("allergies")
    .$type<string[]>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  preferences: jsonb("preferences")
    .$type<string[]>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  budgetPerWeek: numeric("budget_per_week", { precision: 8, scale: 2 }),
  availableDays: jsonb("available_days")
    .$type<string[]>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  sessionDurationMin: integer("session_duration_min"),
  equipment: jsonb("equipment")
    .$type<string[]>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  injuries: jsonb("injuries")
    .$type<string[]>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  mode: text("mode").notNull().default("auto"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const dietPlans = pgTable("diet_plans", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  meals: jsonb("meals").notNull(),
  dailyCalories: integer("daily_calories").notNull(),
  macros: jsonb("macros").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workoutPlans = pgTable("workout_plans", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  sessions: jsonb("sessions").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const schedules = pgTable("schedules", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  events: jsonb("events").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const progress = pgTable("progress", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  xp: integer("xp").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  level: integer("level").notNull().default(1),
  history: jsonb("history")
    .$type<CompletionEvent[]>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  lastLoggedAt: timestamp("last_logged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CompletionEvent = {
  type: "workout" | "diet";
  completedAt: string;
  xpGained: number;
  notes?: string;
};
