import { defineConfig } from "drizzle-kit";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "fitness.db");

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "sqlite",
  dbCredentials: { url: DB_PATH },
});
