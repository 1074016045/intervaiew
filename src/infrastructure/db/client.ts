import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getServerEnv } from "../env/server-env";
import { schema } from "./schema";

export function createDatabase(path: string) {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

type DatabaseConnection = ReturnType<typeof createDatabase>;
let connection: DatabaseConnection | undefined;
export function getDatabase(): DatabaseConnection {
  connection ??= createDatabase(getServerEnv().DATABASE_PATH);
  return connection;
}

export function resetDatabaseForTests() {
  connection?.sqlite.close();
  connection = undefined;
}
