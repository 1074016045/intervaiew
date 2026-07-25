import { describe, expect, it } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const sourceMigrations = resolve("src/infrastructure/db/migrations");

type Journal = Readonly<{
  version: string;
  dialect: string;
  entries: ReadonlyArray<
    Readonly<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>
  >;
}>;

function prepareMigrationRunner(folder: string, maximumIndex: number) {
  const journal = JSON.parse(
    readFileSync(join(sourceMigrations, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const entries = journal.entries.filter((entry) => entry.idx <= maximumIndex);
  mkdirSync(join(folder, "meta"), { recursive: true });
  for (const entry of entries)
    copyFileSync(
      join(sourceMigrations, `${entry.tag}.sql`),
      join(folder, `${entry.tag}.sql`),
    );
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
}

describe("Uploaded Audio transcription migration", () => {
  it("upgrades representative 0005 data through 0006 idempotently", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "intervaiew-uploaded-audio-migration-"),
    );
    const migrationsFolder = join(directory, "migrations");
    let sqlite: Database.Database | undefined;
    try {
      prepareMigrationRunner(migrationsFolder, 5);
      sqlite = new Database(join(directory, "upgrade.db"));
      sqlite.pragma("foreign_keys = ON");
      const database = drizzle(sqlite);
      migrate(database, { migrationsFolder });

      const sessionId = "migration-session";
      const uploadedId = "asset-uploaded";
      const completedId = "asset-completed";
      const failedId = "asset-failed";
      const transcribingId = "asset-transcribing";
      const seed = sqlite.transaction(() => {
        sqlite!
          .prepare(
            `insert into analysis_sessions
              (id, title, mode, status, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?)`,
          )
          .run(sessionId, "Legacy uploaded audio", "transcript_lab", "active", 1_700_000_000_000, 1_700_000_000_000);
        const insertAsset = sqlite!.prepare(
          `insert into uploaded_audio_assets
            (id, analysis_session_id, speaker_role, original_filename, mime_type,
             byte_size, sha256, relative_path, status, provider_label,
             transcript_segment_count, error_code, completed_at, failed_at,
             created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        insertAsset.run(
          uploadedId,
          sessionId,
          "interviewer",
          "uploaded.wav",
          "audio/wav",
          44,
          "a".repeat(64),
          `${sessionId}/${uploadedId}.wav`,
          "uploaded",
          null,
          0,
          null,
          null,
          null,
          1_700_000_000_001,
          1_700_000_000_001,
        );
        insertAsset.run(
          completedId,
          sessionId,
          "candidate",
          "completed.wav",
          "audio/wav",
          44,
          "b".repeat(64),
          `${sessionId}/${completedId}.wav`,
          "completed",
          "legacy-fake",
          1,
          null,
          1_700_000_001_000,
          null,
          1_700_000_000_002,
          1_700_000_001_000,
        );
        insertAsset.run(
          failedId,
          sessionId,
          "interviewer",
          "failed.wav",
          "audio/wav",
          44,
          "c".repeat(64),
          `${sessionId}/${failedId}.wav`,
          "failed",
          null,
          0,
          "UPLOADED_AUDIO_TRANSCRIPTION_FAILED",
          null,
          1_700_000_002_000,
          1_700_000_000_003,
          1_700_000_002_000,
        );
        insertAsset.run(
          transcribingId,
          sessionId,
          "candidate",
          "transcribing.wav",
          "audio/wav",
          44,
          "d".repeat(64),
          `${sessionId}/${transcribingId}.wav`,
          "transcribing",
          null,
          0,
          null,
          null,
          null,
          1_700_000_000_004,
          1_700_000_000_004,
        );
        sqlite!
          .prepare(
            `insert into transcript_segments
              (id, analysis_session_id, provider_segment_id, sequence,
               speaker_role, text, start_ms, end_ms,
               source_uploaded_audio_asset_id, created_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "legacy-segment",
            sessionId,
            "legacy-provider-segment",
            0,
            "candidate",
            "Persisted legacy transcript content",
            0,
            1_000,
            completedId,
            1_700_000_001_000,
          );
        sqlite!
          .prepare(
            `insert into uploaded_audio_actions
              (id, analysis_session_id, action_id, action_type, asset_id, created_at)
             values (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "legacy-action-receipt",
            sessionId,
            "10000000-0000-4000-8000-000000000099",
            "transcribe",
            transcribingId,
            1_700_000_000_500,
          );
      });
      seed();

      const migrationStartedAt = Date.now();
      prepareMigrationRunner(migrationsFolder, 6);
      migrate(database, { migrationsFolder });
      const migrationFinishedAt = Date.now();

      expect(
        sqlite
          .prepare(
            "select name from sqlite_master where type = 'table' and name = ?",
          )
          .get("uploaded_audio_transcription_jobs"),
      ).toEqual({ name: "uploaded_audio_transcription_jobs" });
      expect(
        (
          sqlite
            .prepare("pragma table_info(uploaded_audio_transcription_jobs)")
            .all() as Array<{ name: string }>
        ).map((column) => column.name),
      ).toEqual([
        "id",
        "analysis_session_id",
        "asset_id",
        "action_id",
        "status",
        "attempt_count",
        "maximum_attempts",
        "available_at",
        "lease_token",
        "lease_expires_at",
        "started_at",
        "completed_at",
        "failed_at",
        "cancelled_at",
        "safe_error_code",
        "created_at",
        "updated_at",
      ]);

      const foreignKeys = sqlite
        .prepare("pragma foreign_key_list(uploaded_audio_transcription_jobs)")
        .all() as Array<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_delete: string;
      }>;
      expect(
        foreignKeys.map((key) => ({
          table: key.table,
          from: key.from,
          to: key.to,
          onDelete: key.on_delete,
        })),
      ).toEqual(
        expect.arrayContaining([
          {
            table: "analysis_sessions",
            from: "analysis_session_id",
            to: "id",
            onDelete: "CASCADE",
          },
          {
            table: "uploaded_audio_assets",
            from: "asset_id",
            to: "id",
            onDelete: "CASCADE",
          },
          {
            table: "uploaded_audio_actions",
            from: "analysis_session_id",
            to: "analysis_session_id",
            onDelete: "CASCADE",
          },
          {
            table: "uploaded_audio_actions",
            from: "action_id",
            to: "action_id",
            onDelete: "CASCADE",
          },
          {
            table: "uploaded_audio_actions",
            from: "asset_id",
            to: "asset_id",
            onDelete: "CASCADE",
          },
        ]),
      );
      const indexes = sqlite
        .prepare("pragma index_list(uploaded_audio_transcription_jobs)")
        .all() as Array<{ name: string; unique: number; partial: number }>;
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "uploaded_audio_transcription_jobs_session_action_uq",
            unique: 1,
          }),
          expect.objectContaining({
            name: "uploaded_audio_transcription_jobs_active_asset_uq",
            unique: 1,
            partial: 1,
          }),
          expect.objectContaining({
            name: "uploaded_audio_transcription_jobs_claim_idx",
          }),
          expect.objectContaining({
            name: "uploaded_audio_transcription_jobs_expired_lease_idx",
          }),
          expect.objectContaining({
            name: "uploaded_audio_transcription_jobs_session_asset_latest_idx",
          }),
          expect.objectContaining({
            name: "uploaded_audio_transcription_jobs_lease_token_uq",
            unique: 1,
            partial: 1,
          }),
        ]),
      );
      expect(
        sqlite
          .prepare(
            "select name from sqlite_master where type = 'index' and name = ?",
          )
          .get("uploaded_audio_actions_session_action_asset_uq"),
      ).toEqual({ name: "uploaded_audio_actions_session_action_asset_uq" });
      expect(
        sqlite
          .prepare(
            "select count(*) as count from uploaded_audio_transcription_jobs",
          )
          .get(),
      ).toEqual({ count: 0 });

      const assets = sqlite
        .prepare(
          `select id, status, error_code as errorCode, failed_at as failedAt,
                  updated_at as updatedAt
             from uploaded_audio_assets
            order by id`,
        )
        .all() as Array<{
        id: string;
        status: string;
        errorCode: string | null;
        failedAt: number | null;
        updatedAt: number;
      }>;
      expect(assets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: uploadedId, status: "uploaded" }),
          expect.objectContaining({ id: completedId, status: "completed" }),
          expect.objectContaining({ id: failedId, status: "failed" }),
          expect.objectContaining({
            id: transcribingId,
            status: "failed",
            errorCode: "UPLOADED_AUDIO_TRANSCRIPTION_INTERRUPTED",
          }),
        ]),
      );
      const interrupted = assets.find((asset) => asset.id === transcribingId)!;
      expect(Number.isInteger(interrupted.failedAt)).toBe(true);
      expect(Number.isInteger(interrupted.updatedAt)).toBe(true);
      expect(interrupted.failedAt).toBe(interrupted.updatedAt);
      expect(interrupted.failedAt).toBeGreaterThanOrEqual(migrationStartedAt);
      expect(interrupted.failedAt).toBeLessThanOrEqual(migrationFinishedAt);

      expect(
        sqlite
          .prepare(
            `select s.text, s.source_uploaded_audio_asset_id as sourceAssetId,
                    a.status as sourceStatus
               from transcript_segments s
               join uploaded_audio_assets a
                 on a.id = s.source_uploaded_audio_asset_id
              where s.id = ?`,
          )
          .get("legacy-segment"),
      ).toEqual({
        text: "Persisted legacy transcript content",
        sourceAssetId: completedId,
        sourceStatus: "completed",
      });
      expect(sqlite.prepare("pragma foreign_key_check").all()).toEqual([]);
      expect(
        sqlite
          .prepare(
            `select id, action_type as actionType, asset_id as assetId
               from uploaded_audio_actions where id = ?`,
          )
          .get("legacy-action-receipt"),
      ).toEqual({
        id: "legacy-action-receipt",
        actionType: "transcribe",
        assetId: transcribingId,
      });

      const beforeSecondRun = sqlite
        .prepare(
          `select status, error_code as errorCode, failed_at as failedAt,
                  updated_at as updatedAt
             from uploaded_audio_assets where id = ?`,
        )
        .get(transcribingId);
      migrate(database, { migrationsFolder });
      expect(
        sqlite
          .prepare(
            `select status, error_code as errorCode, failed_at as failedAt,
                    updated_at as updatedAt
               from uploaded_audio_assets where id = ?`,
          )
          .get(transcribingId),
      ).toEqual(beforeSecondRun);
      expect(
        sqlite
          .prepare(
            "select count(*) as count from uploaded_audio_transcription_jobs",
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      try {
        if (sqlite?.open) sqlite.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });
});
