import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_BACKUP_RETENTION_DIRECTORY,
  DEFAULT_BACKUP_RETENTION_KEEP_LATEST,
  DEFAULT_BACKUP_RETENTION_MAX_AGE_DAYS,
  MAX_BACKUP_RETENTION_AGE_DAYS,
  MAX_BACKUP_RETENTION_KEEP_LATEST,
  parseBackupRetentionConfig,
} from "@/infrastructure/db/maintenance/maintenance-config";
import { runRetentionCli } from "@/infrastructure/db/maintenance/retention-cli";
import { selectBackupRetentionCandidates } from "@/infrastructure/db/maintenance/retention-policy";
import { calculateBackupPairByteTotal } from "@/infrastructure/db/maintenance/retention-service";
import {
  removeTemporaryDirectory,
  temporaryDatabaseDirectory,
} from "../helpers/database-maintenance";

describe("backup retention configuration, arguments, and policy", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0))
      removeTemporaryDirectory(directory);
  });

  function temporaryBackupDirectory(): string {
    const root = temporaryDatabaseDirectory();
    directories.push(root);
    const directory = join(root, "isolated-backups");
    mkdirSync(directory);
    return directory;
  }

  it("uses conservative defaults without performing background work", () => {
    expect(parseBackupRetentionConfig({})).toEqual({
      directory: DEFAULT_BACKUP_RETENTION_DIRECTORY,
      maxAgeDays: DEFAULT_BACKUP_RETENTION_MAX_AGE_DAYS,
      keepLatest: DEFAULT_BACKUP_RETENTION_KEEP_LATEST,
    });
  });

  it("gives CLI overrides precedence over environment values", () => {
    expect(
      parseBackupRetentionConfig(
        {
          BACKUP_RETENTION_DIRECTORY: "environment-directory",
          BACKUP_RETENTION_MAX_AGE_DAYS: "20",
          BACKUP_RETENTION_KEEP_LATEST: "2",
        },
        { directory: "cli-directory", maxAgeDays: "40", keepLatest: "4" },
      ),
    ).toEqual({
      directory: "cli-directory",
      maxAgeDays: 40,
      keepLatest: 4,
    });
  });

  it.each(["", "0", "-1", "+1", "1.5", " 1", "1 ", "1e2", "NaN"])(
    "rejects a non-strict positive max age: %s",
    (value) => {
      expect(() =>
        parseBackupRetentionConfig({
          BACKUP_RETENTION_MAX_AGE_DAYS: value,
        }),
      ).toThrow(/configuration is invalid/);
    },
  );

  it.each(["0", "-1", "1.5", "01"])(
    "rejects keep-latest values below or outside strict integer syntax: %s",
    (value) => {
      expect(() =>
        parseBackupRetentionConfig({ BACKUP_RETENTION_KEEP_LATEST: value }),
      ).toThrow(/configuration is invalid/);
    },
  );

  it("enforces documented upper bounds", () => {
    expect(
      parseBackupRetentionConfig({
        BACKUP_RETENTION_MAX_AGE_DAYS: String(MAX_BACKUP_RETENTION_AGE_DAYS),
        BACKUP_RETENTION_KEEP_LATEST: String(MAX_BACKUP_RETENTION_KEEP_LATEST),
      }),
    ).toMatchObject({
      maxAgeDays: MAX_BACKUP_RETENTION_AGE_DAYS,
      keepLatest: MAX_BACKUP_RETENTION_KEEP_LATEST,
    });
    expect(() =>
      parseBackupRetentionConfig({
        BACKUP_RETENTION_MAX_AGE_DAYS: String(
          MAX_BACKUP_RETENTION_AGE_DAYS + 1,
        ),
      }),
    ).toThrow();
    expect(() =>
      parseBackupRetentionConfig({
        BACKUP_RETENTION_KEEP_LATEST: String(
          MAX_BACKUP_RETENTION_KEEP_LATEST + 1,
        ),
      }),
    ).toThrow();
  });

  it("uses manifest age with an exclusive cutoff and deterministic ties", () => {
    const now = new Date("2026-07-26T00:00:00.000Z");
    const candidate = (createdAt: string, tieBreaker: string) => ({
      createdAt,
      tieBreaker,
    });
    const immediatelyBefore = candidate("2026-06-26T00:00:00.001Z", "before");
    const exactlyAt = candidate("2026-06-26T00:00:00.000Z", "exact");
    const immediatelyAfter = candidate("2026-06-25T23:59:59.999Z", "after");
    const tiedA = candidate("2026-06-01T00:00:00.000Z", "a");
    const tiedB = candidate("2026-06-01T00:00:00.000Z", "b");
    const selected = selectBackupRetentionCandidates(
      [immediatelyBefore, exactlyAt, immediatelyAfter, tiedA, tiedB],
      { maxAgeDays: 30, keepLatest: 1, now },
    );
    expect(selected.retainedByKeepLatest).toEqual([immediatelyBefore]);
    expect(selected.retainedByAge).toEqual([exactlyAt]);
    expect(selected.eligible).toEqual([immediatelyAfter, tiedB, tiedA]);
  });

  it("uses exact descending code-unit ordering for retention ties", () => {
    const createdAt = "2020-01-01T00:00:00.000Z";
    const candidates = ["A", "a", "0", "-", "_"].map((tieBreaker) => ({
      createdAt,
      tieBreaker,
    }));
    const selected = selectBackupRetentionCandidates(candidates, {
      maxAgeDays: 1,
      keepLatest: 1,
      now: new Date("2026-07-26T00:00:00.000Z"),
    });
    expect([...selected.retainedByKeepLatest, ...selected.eligible]).toEqual([
      candidates[1],
      candidates[4],
      candidates[0],
      candidates[2],
      candidates[3],
    ]);
  });

  it("rejects retention byte aggregation beyond the safe-integer boundary", () => {
    expect(
      calculateBackupPairByteTotal([
        { databaseBytes: Number.MAX_SAFE_INTEGER - 1, manifestBytes: 1 },
      ]),
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(() =>
      calculateBackupPairByteTotal([
        { databaseBytes: Number.MAX_SAFE_INTEGER, manifestBytes: 1 },
      ]),
    ).toThrow(/byte totals exceed the supported safe range/);
  });

  it("protects keep-latest even when every valid pair is old", () => {
    const candidates = [1, 2, 3, 4].map((day) => ({
      createdAt: `2020-01-0${day}T00:00:00.000Z`,
      tieBreaker: String(day),
    }));
    const selected = selectBackupRetentionCandidates(candidates, {
      maxAgeDays: 1,
      keepLatest: 3,
      now: new Date("2026-07-26T00:00:00.000Z"),
    });
    expect(selected.retainedByKeepLatest).toHaveLength(3);
    expect(selected.eligible).toEqual([candidates[0]]);
  });

  it("defaults to dry-run and supports bounded JSON output", async () => {
    const directory = temporaryBackupDirectory();
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runRetentionCli(
      ["--json"],
      {
        out: (value) => output.push(value),
        error: (value) => errors.push(value),
      },
      { BACKUP_RETENTION_DIRECTORY: directory },
    );
    expect(exitCode).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({
      formatVersion: 1,
      mode: "dry_run",
      status: "ok",
    });
    expect(errors).toEqual([]);
  });

  it.each([
    ["unknown option", ["--unknown"]],
    ["repeated option", ["--dry-run", "--dry-run"]],
    ["conflicting modes", ["--dry-run", "--apply", "--confirm-delete"]],
    ["apply without confirmation", ["--apply"]],
    ["confirmation without apply", ["--confirm-delete"]],
  ] as const)("rejects %s", async (_label, arguments_) => {
    const directory = temporaryBackupDirectory();
    const output: string[] = [];
    const errors: string[] = [];
    expect(
      await runRetentionCli(
        arguments_,
        {
          out: (value) => output.push(value),
          error: (value) => errors.push(value),
        },
        { BACKUP_RETENTION_DIRECTORY: directory },
      ),
    ).toBe(1);
    expect(output).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].length).toBeLessThan(300);
    expect(errors[0]).not.toContain(directory);
  });

  it("keeps JSON parse errors as exactly one JSON stdout value", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    expect(
      await runRetentionCli(["--json", "--unknown"], {
        out: (value) => output.push(value),
        error: (value) => errors.push(value),
      }),
    ).toBe(1);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({
      formatVersion: 1,
      status: "error",
    });
    expect(errors).toEqual([]);
  });
});
