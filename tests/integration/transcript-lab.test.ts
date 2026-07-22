import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "@/infrastructure/db/client";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { AnalysisSessionService } from "@/features/question-intelligence/application/analysis-session-service";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import type { TranscriptChunk } from "@/features/question-intelligence/domain/transcript";

const migrationDirectory = resolve("src/infrastructure/db/migrations");

describe("Transcript Lab SQLite integration", () => {
  let directory: string;
  let sqlite: ReturnType<typeof createDatabase>["sqlite"];
  let repository: SqliteAnalysisRepository;
  let sessions: AnalysisSessionService;
  let ingestion: TranscriptIngestionService;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-transcript-lab-"));
    const connection = createDatabase(join(directory, "test.db"));
    sqlite = connection.sqlite;
    migrate(connection.db, { migrationsFolder: migrationDirectory });
    let nextId = 0;
    repository = new SqliteAnalysisRepository(
      connection.db,
      () => `stable-id-${nextId++}`,
      () => 1_700_000_000_000,
    );
    sessions = new AnalysisSessionService(repository);
    ingestion = new TranscriptIngestionService(repository);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function createSession() {
    return sessions.create({
      title: "Transcript study",
      mode: "transcript_lab",
    });
  }

  function finalChunk(
    sessionId: string,
    change?: Partial<TranscriptChunk>,
  ): TranscriptChunk {
    return {
      providerChunkId: "provider-0",
      sourceSessionId: sessionId,
      sequence: 0,
      speakerRole: "interviewer",
      text: "Tell me about a project you are proud of.",
      isFinal: true,
      startMs: 0,
      endMs: 1_600,
      createdAt: 1_700_000_000_100,
      ...change,
    };
  }

  it("creates and gets an analysis session without hidden fields", () => {
    const created = createSession();
    expect(created).toMatchObject({
      title: "Transcript study",
      mode: "transcript_lab",
      status: "draft",
    });
    expect(sessions.get(created.id)).toEqual({
      session: created,
      segments: [],
    });
  });

  it("deletes an analysis session idempotently", () => {
    const created = createSession();
    expect(sessions.delete(created.id)).toBe(true);
    expect(sessions.delete(created.id)).toBe(false);
  });

  it("writes a final transcript and activates a draft session", () => {
    const created = createSession();
    expect(ingestion.ingest(created.id, finalChunk(created.id))).toMatchObject({
      duplicated: false,
      segment: {
        sequence: 0,
        text: "Tell me about a project you are proud of.",
      },
    });
    expect(sessions.get(created.id).session.status).toBe("active");
    expect(sessions.get(created.id).segments).toHaveLength(1);
  });

  it("rejects interim transcript persistence", () => {
    const created = createSession();
    expect(() =>
      ingestion.ingest(created.id, finalChunk(created.id, { isFinal: false })),
    ).toThrow(/Only finalized/);
    expect(sessions.get(created.id).segments).toHaveLength(0);
  });

  it("returns duplicate final provider ids idempotently", () => {
    const created = createSession();
    const first = ingestion.ingest(created.id, finalChunk(created.id));
    const duplicate = ingestion.ingest(
      created.id,
      finalChunk(created.id, { text: "Retry body is ignored" }),
    );
    expect(duplicate).toEqual({ segment: first.segment, duplicated: true });
    expect(sessions.get(created.id).segments).toHaveLength(1);
  });

  it("rejects a sequence collision from a different provider id", () => {
    const created = createSession();
    ingestion.ingest(created.id, finalChunk(created.id));
    expect(() =>
      ingestion.ingest(
        created.id,
        finalChunk(created.id, { providerChunkId: "provider-conflict" }),
      ),
    ).toThrow(/already assigned/);
    expect(sessions.get(created.id).segments).toHaveLength(1);
  });

  it("cascades final segments when a session is deleted", () => {
    const created = createSession();
    ingestion.ingest(created.id, finalChunk(created.id));
    sessions.delete(created.id);
    const count = sqlite
      .prepare(
        "select count(*) as count from transcript_segments where analysis_session_id = ?",
      )
      .get(created.id) as { count: number };
    expect(count.count).toBe(0);
  });

  it("returns a stable not-found error", () => {
    expect(() => ingestion.ingest("missing", finalChunk("missing"))).toThrow(
      /could not be found/,
    );
    expect(() => sessions.get("missing")).toThrow(/could not be found/);
  });

  it("rejects writes in an invalid session state", () => {
    const created = createSession();
    sessions.updateStatus(created.id, { status: "cancelled" });
    expect(() => ingestion.ingest(created.id, finalChunk(created.id))).toThrow(
      /does not accept/,
    );
  });

  it("enables foreign keys and rejects orphan segments", () => {
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() =>
      sqlite
        .prepare(
          `insert into transcript_segments
          (id, analysis_session_id, provider_segment_id, sequence, speaker_role, text, start_ms, end_ms, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("orphan", "missing", "provider", 0, "unknown", "text", 0, 1, 1),
    ).toThrow(/FOREIGN KEY/);
  });

  it("migrates a fresh database with the new tables and indexes", () => {
    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as Array<{ name: string }>;
    const indexes = sqlite
      .prepare("select name from sqlite_master where type = 'index'")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(["analysis_sessions", "transcript_segments"]),
    );
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "transcript_segments_session_provider_uq",
        "transcript_segments_session_sequence_uq",
        "transcript_segments_session_order_idx",
      ]),
    );
  });
});

describe("v0.2 to Transcript Lab migration", () => {
  it("preserves v0.2 data while applying migration 0002", () => {
    const directory = mkdtempSync(join(tmpdir(), "intervaiew-v02-upgrade-"));
    const sqlite = new Database(join(directory, "upgrade.db"));
    sqlite.pragma("foreign_keys = ON");
    const apply = (name: string) =>
      sqlite.exec(
        readFileSync(resolve(migrationDirectory, name), "utf8").replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
    apply("0000_lame_prowler.sql");
    apply("0001_illegal_shockwave.sql");
    sqlite
      .prepare(
        `insert into interview_sessions
        (id,title,target_role,target_company,interview_type,difficulty,language,resume_text,job_description,question_count,status,current_question_index,created_at,updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "v02-session",
        "Existing v0.2 practice",
        "Engineer",
        null,
        "software-engineering",
        "mid-level",
        "English",
        "resume",
        "job",
        3,
        "draft",
        0,
        1,
        1,
      );
    apply("0002_elite_shocker.sql");
    expect(
      sqlite
        .prepare("select title from interview_sessions where id = ?")
        .get("v02-session"),
    ).toEqual({ title: "Existing v0.2 practice" });
    expect(
      sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'analysis_sessions'",
        )
        .get(),
    ).toEqual({ name: "analysis_sessions" });
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
