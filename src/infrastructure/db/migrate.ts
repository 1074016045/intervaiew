import "dotenv/config";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve(
  process.env.DATABASE_PATH ?? "./data/intervaiew.db",
);
mkdirSync(dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
migrate(drizzle(sqlite), {
  migrationsFolder: resolve("src/infrastructure/db/migrations"),
});
sqlite.close();
console.log("Database migrations applied successfully.");
