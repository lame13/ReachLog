import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import { bootstrapDatabase } from "./bootstrap";
import * as schema from "./schema";

declare global {
  var __reachlogSqlite: Database.Database | undefined;
  var __reachlogDb:
    | ReturnType<typeof drizzle<typeof schema>>
    | undefined;
}

export function getSqlite() {
  if (globalThis.__reachlogSqlite) {
    return globalThis.__reachlogSqlite;
  }

  const dbPath = env.DATABASE_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("busy_timeout = 10000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  bootstrapDatabase(sqlite);

  globalThis.__reachlogSqlite = sqlite;
  return sqlite;
}

export function getDb() {
  if (globalThis.__reachlogDb) {
    return globalThis.__reachlogDb;
  }

  const db = drizzle(getSqlite(), { schema });
  globalThis.__reachlogDb = db;
  return db;
}
