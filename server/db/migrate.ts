import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const defaultMigrationsFolder = resolve(process.cwd(), "drizzle");

export const migrateDatabase = async (
  databaseUrl: string,
  migrationsFolder = process.env.MIGRATIONS_DIR ?? defaultMigrationsFolder,
): Promise<void> => {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
};

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (invokedPath === import.meta.url) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置");
  }
  await migrateDatabase(databaseUrl);
}
