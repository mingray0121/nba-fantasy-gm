import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Locally, read DATABASE_URL from .env.local (on Vercel it comes from the project's env vars).
if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
