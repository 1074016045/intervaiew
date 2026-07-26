import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDatabaseBackup } from "@/infrastructure/db/maintenance/backup-service";
import {
  BACKUP_USAGE,
  RESTORE_USAGE,
  VALIDATE_USAGE,
  runBackupCli,
  runRestoreCli,
  runValidateBackupCli,
  type CliIo,
} from "@/infrastructure/db/maintenance/maintenance-cli";
import {
  createMigratedDatabase,
  readMarkerIds,
  removeTemporaryDirectory,
  temporaryDatabaseDirectory,
} from "../helpers/database-maintenance";

const projectRoot = resolve(".");

describe("database maintenance CLI", () => {
  let directory: string;
  let sourcePath: string;
  let backupDirectory: string;
  let output: string[];
  let errors: string[];
  let io: CliIo;

  function runScript(
    script: string,
    arguments_: string[],
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          join(projectRoot, "node_modules/tsx/dist/loader.mjs"),
          join(projectRoot, script),
          ...arguments_,
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            DATABASE_PATH: sourcePath,
            HOME: join(directory, "isolated-home"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => resolveResult({ code, stdout, stderr }));
    });
  }

  beforeEach(() => {
    directory = temporaryDatabaseDirectory();
    sourcePath = join(directory, "private-source-path.db");
    backupDirectory = join(directory, "backups");
    const database = createMigratedDatabase(
      sourcePath,
      "never-print-sensitive-row-content",
    );
    database.close();
    output = [];
    errors = [];
    io = {
      out: (message) => output.push(message),
      error: (message) => errors.push(message),
    };
  });

  afterEach(() => removeTemporaryDirectory(directory));

  it("restores the existing backup text output contract", async () => {
    expect(
      await runBackupCli(
        [
          "--database",
          sourcePath,
          "--output-dir",
          backupDirectory,
          "--name",
          "cli-backup",
        ],
        io,
      ),
    ).toBe(0);
    expect(existsSync(join(backupDirectory, "cli-backup.sqlite"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(backupDirectory, "cli-backup.manifest.json"), "utf8"),
    );
    expect(output).toEqual([
      "Backup created: cli-backup.sqlite",
      `Bytes: ${manifest.databaseBytes}`,
      `SHA-256: ${manifest.databaseSha256}`,
      "Validation: valid",
    ]);
    expect(errors).toEqual([]);
  });

  it("validates successfully and emits bounded JSON only", async () => {
    const backup = await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name: "json-backup",
    });
    expect(
      await runValidateBackupCli(
        ["--manifest", backup.manifestPath, "--json"],
        io,
      ),
    ).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toEqual({
      valid: true,
      formatVersion: 1,
      databaseBytes: backup.manifest.databaseBytes,
      databaseSha256: backup.manifest.databaseSha256,
      migrationCount: 7,
    });
    expect(output[0]).not.toContain(backup.manifestPath);
    expect(errors).toEqual([]);
  });

  it("restores the existing validation text output contract", async () => {
    const backup = await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name: "text-validation-backup",
    });
    expect(
      await runValidateBackupCli(["--manifest", backup.manifestPath], io),
    ).toBe(0);
    expect(output).toEqual([
      "Backup valid: text-validation-backup.manifest.json",
      `Bytes: ${backup.manifest.databaseBytes}`,
      `SHA-256: ${backup.manifest.databaseSha256}`,
      `Migrations: ${backup.manifest.migrationCount}`,
    ]);
    expect(errors).toEqual([]);
  });

  it("returns nonzero JSON for invalid validation without stderr mixing", async () => {
    expect(
      await runValidateBackupCli(
        ["--manifest", join(directory, "missing.json"), "--json"],
        io,
      ),
    ).toBe(1);
    expect(JSON.parse(output[0])).toMatchObject({ valid: false });
    expect(errors).toEqual([]);
    expect(output[0].length).toBeLessThan(300);
  });

  it("keeps JSON output valid even when strict argument parsing fails", async () => {
    expect(await runValidateBackupCli(["--json", "--unknown"], io)).toBe(1);
    expect(JSON.parse(output[0])).toMatchObject({ valid: false });
    expect(errors).toEqual([]);
  });

  it("performs dry-run and create-new restore with correct status codes", async () => {
    const backup = await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name: "restore-source",
    });
    const destination = join(directory, "restored", "database.db");
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
    expect(existsSync(destination)).toBe(false);
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
    expect(readMarkerIds(destination)).toEqual([
      "never-print-sensitive-row-content",
    ]);
  });

  it("reports the retained pre-restore backup by its safe name", async () => {
    const selected = await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name: "replacement-source",
    });
    const preRestoreDirectory = join(directory, "pre-restore-backups");
    expect(
      await runRestoreCli(
        [
          "--manifest",
          selected.manifestPath,
          "--database",
          sourcePath,
          "--replace",
          "--confirm-offline",
          "--pre-restore-backup-dir",
          preRestoreDirectory,
        ],
        io,
      ),
    ).toBe(0);
    expect(output[0]).toBe("Database replaced safely.");
    expect(output[1]).toMatch(
      /^Pre-restore backup: [A-Za-z0-9][A-Za-z0-9_-]{0,79}$/,
    );
    const retainedName = output[1].slice("Pre-restore backup: ".length);
    expect(readdirSync(preRestoreDirectory).sort()).toEqual([
      `${retainedName}.manifest.json`,
      `${retainedName}.sqlite`,
    ]);
    expect(output.slice(2)).toEqual([
      "Restore validation: valid",
      "Migrations were not run. Run pnpm db:migrate separately only for an intentional upgrade.",
    ]);
  });

  it.each([
    [runBackupCli, ["--unknown"]],
    [runBackupCli, ["--name"]],
    [runValidateBackupCli, []],
    [runValidateBackupCli, ["positional"]],
    [runRestoreCli, ["--manifest", "x", "--manifest", "y"]],
  ] as const)(
    "returns nonzero for invalid arguments",
    async (run, arguments_) => {
      expect(await run(arguments_, io)).toBe(1);
      expect(errors).toHaveLength(1);
      expect(errors[0].length).toBeLessThan(300);
      expect(errors[0]).not.toContain(sourcePath);
    },
  );

  it("prints safe bounded help for all commands", async () => {
    expect(await runBackupCli(["--help"], io)).toBe(0);
    expect(await runValidateBackupCli(["--help"], io)).toBe(0);
    expect(await runRestoreCli(["--help"], io)).toBe(0);
    expect(output).toEqual([BACKUP_USAGE, VALIDATE_USAGE, RESTORE_USAGE]);
    expect(output.join("\n")).not.toContain(sourcePath);
    expect(output.join("\n").length).toBeLessThan(2_000);
  });

  it("refuses write restore without the operator assertion", async () => {
    const backup = await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name: "offline-check",
    });
    const destination = join(directory, "refused.db");
    expect(
      await runRestoreCli(
        ["--manifest", backup.manifestPath, "--database", destination],
        io,
      ),
    ).toBe(1);
    expect(existsSync(destination)).toBe(false);
    expect(errors.join("\n")).toContain("--confirm-offline");
  });

  it("runs the real backup entry point with isolated cwd and environment", async () => {
    const subprocessBackups = join(directory, "subprocess-backups");
    const result = await runScript("scripts/database-backup.ts", [
      "--output-dir",
      subprocessBackups,
      "--name",
      "subprocess-backup",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({
      event: "maintenance.backup.completed",
      operation: "backup",
      outcome: "succeeded",
    });
    expect(result.stderr).not.toContain(sourcePath);
    expect(result.stderr).not.toContain("never-print-sensitive-row-content");
    expect(result.stderr).not.toContain("subprocess-backup");
    expect(result.stdout).not.toContain(sourcePath);
    expect(result.stdout).not.toContain("never-print-sensitive-row-content");
    expect(
      existsSync(join(subprocessBackups, "subprocess-backup.sqlite")),
    ).toBe(true);
    const subprocessManifest = JSON.parse(
      readFileSync(
        join(subprocessBackups, "subprocess-backup.manifest.json"),
        "utf8",
      ),
    );
    expect(result.stderr).not.toContain(subprocessManifest.databaseSha256);
    expect(existsSync(join(directory, "data", "intervaiew.db"))).toBe(false);
  });

  it("keeps real JSON CLI errors path-free and machine-readable", async () => {
    const sentinelPath = join(
      directory,
      "ABSOLUTE-PRIVATE-SENTINEL",
      "missing.manifest.json",
    );
    const result = await runScript("scripts/database-backup-validate.ts", [
      "--manifest",
      sentinelPath,
      "--json",
    ]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      event: "maintenance.validation.failed",
      operation: "validation",
      outcome: "failed",
    });
    expect(result.stderr).not.toContain(sentinelPath);
    expect(result.stderr).not.toContain(directory);
    expect(JSON.parse(result.stdout)).toMatchObject({ valid: false });
    expect(result.stdout).not.toContain(sentinelPath);
    expect(result.stdout).not.toContain(directory);
    expect(result.stdout.length).toBeLessThan(300);
  });
});
