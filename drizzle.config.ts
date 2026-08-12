import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/db/schema.ts",
  out: "./drizzle-sqlite",
  dbCredentials: {
    url: process.env.SQLITE_PATH ?? "./data/app.sqlite",
  },
});
