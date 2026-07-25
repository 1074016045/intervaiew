import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export const migrationsFolder = resolve("src/infrastructure/db/migrations");

export function temporaryDatabaseDirectory(): string {
  return mkdtempSync(join(tmpdir(), "intervaiew-maintenance-"));
}

export function removeTemporaryDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

export function createMigratedDatabase(
  databasePath: string,
  marker?: string,
): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  migrate(drizzle(database), { migrationsFolder });
  if (marker)
    database
      .prepare(
        `insert into analysis_sessions
          (id, title, mode, status, created_at, updated_at)
         values (?, ?, 'transcript_lab', 'draft', ?, ?)`,
      )
      .run(marker, marker, 1_700_000_000_000, 1_700_000_000_000);
  return database;
}

export function readMarkerIds(databasePath: string): string[] {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return (
      database
        .prepare("select id from analysis_sessions order by id")
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
  } finally {
    database.close();
  }
}
