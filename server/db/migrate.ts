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
    // SQLite ignores changes to foreign_keys while a transaction is active.
    // Drizzle wraps migrations in a transaction, so table-rebuild migrations
    // must disable enforcement before the migrator starts and validate the
    // resulting graph explicitly afterwards.
    client.raw.pragma("foreign_keys = OFF");
    migrate(client.db, { migrationsFolder });
    const violations = client.raw.pragma("foreign_key_check") as Array<{
      table: string;
      rowid: number | null;
      parent: string;
      fkid: number;
    }>;
    if (violations.length > 0) {
      const first = violations[0]!;
      throw new Error(
        `数据库迁移后外键校验失败：${first.table}[${first.rowid ?? "?"}] -> ${first.parent}`,
      );
    }
  } finally {
    client.raw.pragma("foreign_keys = ON");
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
