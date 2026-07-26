import { describe, expect, it } from "vitest";
import {
  BACKUP_APPLICATION,
  BACKUP_FORMAT_VERSION,
  isSafeBackupDatabaseFile,
  isSafeBackupName,
  parseBackupManifest,
  parseBackupManifestJson,
} from "@/infrastructure/db/maintenance/backup-manifest";
import { parseStrictArguments } from "@/infrastructure/db/maintenance/cli-arguments";

const valid = {
  formatVersion: BACKUP_FORMAT_VERSION,
  application: BACKUP_APPLICATION,
  createdAt: "2026-07-25T01:02:03.004Z",
  databaseFile: "intervaiew-safe.sqlite",
  databaseBytes: 4096,
  databaseSha256: "a".repeat(64),
  sqliteUserVersion: 0,
  migrationCount: 7,
  latestMigrationHash: "b".repeat(64),
};

describe("database backup manifest", () => {
  it("accepts the strict version-one shape", () => {
    expect(parseBackupManifest(valid)).toEqual(valid);
  });

  it.each([
    ["unknown property", { ...valid, extra: true }],
    ["future version", { ...valid, formatVersion: 2 }],
    ["wrong application", { ...valid, application: "another-app" }],
    ["non-UTC timestamp", { ...valid, createdAt: "2026-07-25" }],
    ["negative bytes", { ...valid, databaseBytes: -1 }],
    [
      "unsafe integer bytes",
      { ...valid, databaseBytes: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ["fractional migration count", { ...valid, migrationCount: 1.5 }],
    ["negative user version", { ...valid, sqliteUserVersion: -1 }],
    [
      "timestamp with an offset",
      { ...valid, createdAt: "2026-07-25T09:02:03.004+08:00" },
    ],
    [
      "impossible timestamp",
      { ...valid, createdAt: "2026-02-30T01:02:03.004Z" },
    ],
    ["uppercase hash", { ...valid, databaseSha256: "A".repeat(64) }],
    ["short hash", { ...valid, latestMigrationHash: "abc" }],
  ])("rejects %s", (_label, input) => {
    expect(() => parseBackupManifest(input)).toThrow(/manifest is invalid/i);
  });

  it("maps malformed JSON to a bounded error", () => {
    expect(() => parseBackupManifestJson("{".repeat(20))).toThrow(
      "Backup manifest JSON is invalid.",
    );
  });

  it.each([
    "../escape.sqlite",
    "..\\database.sqlite",
    "/absolute.sqlite",
    "C:\\absolute.sqlite",
    "\\\\server\\share\\database.sqlite",
    "file:///database.sqlite",
    "%2e%2e%2fdatabase.sqlite",
    "folder∕database.sqlite",
    " database.sqlite",
    "database.sqlite ",
    ".",
    "..",
    "CON.sqlite",
    "aux.sqlite",
    "https:backup.sqlite",
    "bad..name.sqlite",
    "folder/file.sqlite",
    "folder\\file.sqlite",
    "nul\0file.sqlite",
  ])("rejects unsafe database filename %s", (name) => {
    expect(isSafeBackupDatabaseFile(name)).toBe(false);
  });

  it.each(["backup", "intervaiew-20260725T010203Z-a1b2c3d4", "safe_name-01"])(
    "accepts safe backup name %s",
    (name) => {
      expect(isSafeBackupName(name)).toBe(true);
    },
  );

  it.each(["../x", "x.y", "x/y", "x\\y", "", "a".repeat(81)])(
    "rejects unsafe backup name %s",
    (name) => expect(isSafeBackupName(name)).toBe(false),
  );
});

describe("database maintenance CLI argument parser", () => {
  const definitions = [
    { name: "manifest", kind: "value" as const },
    { name: "dry-run", kind: "flag" as const },
  ];

  it("parses values and flags without evaluating input", () => {
    expect(
      parseStrictArguments(
        ["--manifest", "$(not-executed)", "--dry-run"],
        definitions,
      ),
    ).toEqual({ manifest: "$(not-executed)", "dry-run": true });
  });

  it.each([
    ["unknown", ["--wat"]],
    ["duplicate", ["--dry-run", "--dry-run"]],
    ["missing value", ["--manifest"]],
    ["positional", ["file.json"]],
    ["equals syntax", ["--manifest=file.json"]],
    ["value beginning with an option", ["--manifest", "--dry-run"]],
    ["flag value", ["--dry-run", "true"]],
    ["empty value", ["--manifest", ""]],
  ])("rejects %s arguments", (_label, arguments_) => {
    expect(() => parseStrictArguments(arguments_, definitions)).toThrow();
  });
});
