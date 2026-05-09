import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/modules/core/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? ".data/app.sqlite"
  }
});
