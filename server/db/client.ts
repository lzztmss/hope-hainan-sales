import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;
export type DbTransaction = AppDatabase;

export interface DbClient {
  db: AppDatabase;
  raw: Database.Database;
  withTransaction: <T>(fn: (tx: DbTransaction) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

export type DatabaseClient = DbClient;

const databasePath = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error("SQLITE_PATH 未配置");
  if (normalized === ":memory:") return normalized;
  return resolve(normalized.replace(/^file:/, ""));
};

export const createDatabaseClient = (pathValue: string): DbClient => {
  const path = databasePath(pathValue);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 5000");
  raw.pragma("synchronous = NORMAL");
  const db = drizzle(raw, { schema });
  return {
    db,
    raw,
    withTransaction: async (fn) => {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(db);
        raw.exec("COMMIT");
        return result;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    close: async () => {
      raw.close();
    },
  };
};
