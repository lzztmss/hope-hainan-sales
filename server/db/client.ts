import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema.js";

export type AppDatabase = PostgresJsDatabase<typeof schema>;
export type DbTransaction = Parameters<
  Parameters<AppDatabase["transaction"]>[0]
>[0];

export interface DbClient {
  db: AppDatabase;
  sql: Sql;
  withTransaction: <T>(fn: (tx: DbTransaction) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

export type DatabaseClient = DbClient;

export const createDatabaseClient = (databaseUrl: string): DbClient => {
  const sql = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    withTransaction: (fn) => db.transaction(fn),
    close: () => sql.end(),
  };
};
