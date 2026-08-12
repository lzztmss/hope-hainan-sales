import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createDatabaseClient } from "./client.js";

const defaultMigrationsFolder = resolve(process.cwd(), "drizzle-sqlite");

export const migrateDatabase = async (
  sqlitePath: string,
  migrationsFolder = process.env.MIGRATIONS_DIR ?? defaultMigrationsFolder,
): Promise<void> => {
  const client = createDatabaseClient(sqlitePath);
  try {
    migrate(client.db, { migrationsFolder });
  } finally {
    await client.close();
  }
};

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (invokedPath === import.meta.url) {
  const sqlitePath = process.env.SQLITE_PATH;
  if (!sqlitePath) {
    throw new Error("SQLITE_PATH 未配置");
  }
  await migrateDatabase(sqlitePath);
}
