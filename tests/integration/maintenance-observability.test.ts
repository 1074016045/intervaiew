import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDatabaseBackup } from "@/infrastructure/db/maintenance/backup-service";
import {
  runBackupCli,
  runRestoreCli,
  runValidateBackupCli,
  type CliIo,
} from "@/infrastructure/db/maintenance/maintenance-cli";
import { runOperationsStatusCli } from "@/infrastructure/db/maintenance/operations-status-cli";
import { runRetentionCli } from "@/infrastructure/db/maintenance/retention-cli";
import {
  createOperationalEventLogger,
  maintenanceEventNames,
  type OperationalEventInput,
} from "@/infrastructure/logging/safe-operational-event";
import {
  createMigratedDatabase,
  removeTemporaryDirectory,
  temporaryDatabaseDirectory,
} from "../helpers/database-maintenance";

describe("maintenance operational events and output stream separation", () => {
  let root: string;
  let sourcePath: string;
  let backupDirectory: string;
  let output: string[];
  let errors: string[];
  let eventLines: string[];
  let io: CliIo;

  beforeEach(() => {
    root = temporaryDatabaseDirectory();
    sourcePath = join(root, "private-database-name.db");
    backupDirectory = join(root, "private-backup-directory");
    mkdirSync(backupDirectory);
    const database = createMigratedDatabase(
      sourcePath,
      "injected-sensitive-session-and-content",
    );
    database.close();
    output = [];
    errors = [];
    eventLines = [];
    io = {
      out: (value) => output.push(value),
      error: (value) => errors.push(value),
      event: createOperationalEventLogger(
        (line) => eventLines.push(line),
        () => new Date("2026-07-26T00:00:00.000Z"),
      ),
    };
  });

  afterEach(() => removeTemporaryDirectory(root));

  function parsedEvents() {
    return eventLines.map((line) => {
      expect(line.endsWith("\n")).toBe(true);
      expect(line.slice(0, -1)).not.toContain("\n");
      return JSON.parse(line) as Record<string, unknown>;
    });
  }

  function expectContentFree(value: string) {
    for (const prohibited of [
      root,
      "private-database-name.db",
      "private-backup-directory",
      "private-backup-name",
      "validation-private-name",
      "restore-private-name",
      "retention-private-name",
      "injected-sensitive-session-and-content",
      "injected-private-error",
      "sha256",
      "select ",
      "stack",
      "cause",
    ])
      expect(value.toLowerCase()).not.toContain(prohibited.toLowerCase());
  }

  it("emits exactly allowlisted fields as one newline-delimited JSON event", () => {
    const logger = createOperationalEventLogger(
      (line) => eventLines.push(line),
      () => new Date("2026-07-26T01:02:03.004Z"),
    );
    const input: OperationalEventInput = {
      level: "info",
      event: "maintenance.retention.completed",
      operation: "retention",
      outcome: "dry_run_succeeded",
      durationMs: 4,
      scannedEntryCount: 2,
      validPairCount: 1,
    };
    expect(logger.emit(input)).toBe(true);
    expect(parsedEvents()).toEqual([
      {
        formatVersion: 1,
        timestamp: "2026-07-26T01:02:03.004Z",
        ...input,
      },
    ]);
  });

  it("rejects unknown runtime fields and invalid or unbounded values", () => {
    const logger = createOperationalEventLogger((line) =>
      eventLines.push(line),
    );
    expect(
      logger.emit({
        level: "error",
        event: "maintenance.backup.failed",
        operation: "backup",
        outcome: "failed",
        durationMs: 0,
        // @ts-expect-error Unknown event context is intentionally impossible.
        path: "/private/path",
      }),
    ).toBe(false);
    expect(
      logger.emit({
        level: "error",
        event: "maintenance.backup.failed",
        operation: "backup",
        outcome: "failed",
        durationMs: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false);
    expect(
      logger.emit({
        level: "info",
        event: "maintenance.backup.completed",
        operation: "backup",
        outcome: "succeeded",
        durationMs: 0,
        databaseByteCount: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBe(false);
    expect(
      logger.emit({
        level: "info",
        event: "maintenance.retention.completed",
        operation: "retention",
        outcome: "succeeded",
        durationMs: 0,
        eligibleByteCount: Number.POSITIVE_INFINITY,
        deletedByteCount: -1,
      }),
    ).toBe(false);
    expect(eventLines).toEqual([]);
  });

  it("never serializes Error, cause, stack, or an injected sensitive string", () => {
    const logger = createOperationalEventLogger((line) =>
      eventLines.push(line),
    );
    const error = new Error("injected-private-error", {
      cause: new Error("private-cause"),
    });
    expect(
      logger.emit({
        level: "error",
        event: "maintenance.validation.failed",
        operation: "validation",
        outcome: "failed",
        errorCode: "BACKUP_DATABASE_INVALID",
        durationMs: 1,
        // @ts-expect-error Raw errors are intentionally impossible.
        error,
      }),
    ).toBe(false);
    expect(eventLines).toEqual([]);
  });

  it("contains only closed event names", () => {
    expect(new Set(maintenanceEventNames).size).toBe(
      maintenanceEventNames.length,
    );
    expect(maintenanceEventNames).toEqual([
      "maintenance.backup.completed",
      "maintenance.backup.failed",
      "maintenance.validation.completed",
      "maintenance.validation.failed",
      "maintenance.restore.dry_run_completed",
      "maintenance.restore.completed",
      "maintenance.restore.failed",
      "maintenance.retention.completed",
      "maintenance.retention.failed",
      "maintenance.status.completed",
      "maintenance.status.failed",
    ]);
  });

  it("emits bounded backup success and failure events", async () => {
    expect(
      await runBackupCli(
        [
          "--database",
          sourcePath,
          "--output-dir",
          backupDirectory,
          "--name",
          "private-backup-name",
        ],
        io,
      ),
    ).toBe(0);
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.backup.completed",
      operation: "backup",
      outcome: "succeeded",
    });
    const manifest = JSON.parse(
      readFileSync(
        join(backupDirectory, "private-backup-name.manifest.json"),
        "utf8",
      ),
    );
    expect(output.join("\n")).toContain("private-backup-name.sqlite");
    expect(output.join("\n")).toContain(manifest.databaseSha256);
    expectContentFree(eventLines.join(""));
    expect(eventLines.join("")).not.toContain(manifest.databaseSha256);
    eventLines.length = 0;
    expect(
      await runBackupCli(["--database", join(root, "missing-private.db")], io),
    ).toBe(1);
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.backup.failed",
      outcome: "failed",
      errorCode: "BACKUP_SOURCE_MISSING",
    });
    expectContentFree(eventLines.join(""));
  });

  it("emits validation success/failure while JSON stdout stays one valid value", async () => {
    const backup = await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name: "validation-private-name",
    });
    expect(
      await runValidateBackupCli(
        ["--manifest", backup.manifestPath, "--json"],
        io,
      ),
    ).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({ valid: true });
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.validation.completed",
    });
    expect(JSON.parse(output[0])).toMatchObject({
      databaseSha256: backup.manifest.databaseSha256,
    });
    expectContentFree(eventLines.join(""));
    expect(eventLines.join("")).not.toContain(backup.manifest.databaseSha256);
    output.length = 0;
    eventLines.length = 0;
    expect(
      await runValidateBackupCli(
        ["--manifest", join(root, "missing-private.json"), "--json"],
        io,
      ),
    ).toBe(1);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({ valid: false });
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.validation.failed",
    });
    expectContentFree(eventLines.join(""));
  });

  it("emits restore dry-run, success, and failure events", async () => {
    const backup = await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name: "restore-private-name",
    });
    const destination = join(root, "restored-private.db");
    expect(
      await runRestoreCli(
        [
          "--manifest",
          backup.manifestPath,
          "--database",
          destination,
          "--dry-run",
        ],
        io,
      ),
    ).toBe(0);
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.restore.dry_run_completed",
      outcome: "dry_run_succeeded",
    });
    eventLines.length = 0;
    expect(
      await runRestoreCli(
        [
          "--manifest",
          backup.manifestPath,
          "--database",
          destination,
          "--confirm-offline",
        ],
        io,
      ),
    ).toBe(0);
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.restore.completed",
      outcome: "succeeded",
    });
    eventLines.length = 0;
    expect(
      await runRestoreCli(
        ["--manifest", backup.manifestPath, "--database", destination],
        io,
      ),
    ).toBe(1);
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.restore.failed",
      outcome: "failed",
    });
    expectContentFree(eventLines.join(""));
  });

  it("emits retention dry-run, apply, and failure events with clean JSON stdout", async () => {
    await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name: "retention-private-name",
      now: new Date("2020-01-01T00:00:00.000Z"),
    });
    const environment = { BACKUP_RETENTION_DIRECTORY: backupDirectory };
    expect(
      await runRetentionCli(["--dry-run", "--json"], io, environment),
    ).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({ mode: "dry_run" });
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.retention.completed",
      outcome: "dry_run_succeeded",
    });
    output.length = 0;
    eventLines.length = 0;
    expect(
      await runRetentionCli(
        ["--apply", "--confirm-delete", "--keep-latest", "1", "--json"],
        io,
        environment,
      ),
    ).toBe(0);
    expect(output).toHaveLength(1);
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.retention.completed",
      outcome: "succeeded",
    });
    output.length = 0;
    eventLines.length = 0;
    expect(await runRetentionCli(["--apply", "--json"], io, environment)).toBe(
      1,
    );
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({ status: "error" });
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.retention.failed",
      outcome: "failed",
    });
    expectContentFree(eventLines.join(""));
  });

  it("emits status success/failure events while keeping JSON stdout parseable", async () => {
    expect(
      await runOperationsStatusCli(
        [
          "--database",
          sourcePath,
          "--backup-directory",
          backupDirectory,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({ status: "ok" });
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.status.completed",
    });
    output.length = 0;
    eventLines.length = 0;
    expect(
      await runOperationsStatusCli(
        [
          "--database",
          join(root, "missing-private.db"),
          "--backup-directory",
          backupDirectory,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({ status: "degraded" });
    expect(parsedEvents()[0]).toMatchObject({
      event: "maintenance.status.failed",
      outcome: "degraded",
    });
    expectContentFree(eventLines.join(""));
  });

  it("makes logger write failure unable to change command success or failure semantics", async () => {
    const failedLogger = createOperationalEventLogger(() => {
      throw new Error("logger-injected-private-error");
    });
    const failedIo: CliIo = { ...io, event: failedLogger };
    expect(
      await runBackupCli(
        [
          "--database",
          sourcePath,
          "--output-dir",
          backupDirectory,
          "--name",
          "logger-failure-backup",
        ],
        failedIo,
      ),
    ).toBe(0);
    expect(
      await runBackupCli(
        ["--database", join(root, "missing-private.db")],
        failedIo,
      ),
    ).toBe(1);
  });
});
