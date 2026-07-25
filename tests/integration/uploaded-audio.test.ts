import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "@/infrastructure/db/client";
import { AnalysisSessionService } from "@/features/question-intelligence/application/analysis-session-service";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { UploadedAudioService } from "@/features/uploaded-audio/application/uploaded-audio-service";
import type { UploadedAudioStoragePort } from "@/features/uploaded-audio/application/uploaded-audio-storage.port";
import { FakeAudioTranscriptionProvider } from "@/features/uploaded-audio/infrastructure/fake/fake-audio-transcription-provider";
import { FilesystemUploadedAudioStorage } from "@/features/uploaded-audio/infrastructure/filesystem/filesystem-uploaded-audio-storage";
import { SqliteUploadedAudioRepository } from "@/features/uploaded-audio/infrastructure/sqlite/sqlite-uploaded-audio-repository";
import { SqliteTranscriptionJobQueue } from "@/features/uploaded-audio/infrastructure/sqlite/sqlite-transcription-job-queue";
import { UploadedAudioTranscriptionWorker } from "@/features/uploaded-audio/application/uploaded-audio-transcription-worker";

const migrationsFolder = resolve("src/infrastructure/db/migrations");

function uuid(counter: number) {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function wavBytes(size = 44) {
  const bytes = new Uint8Array(Math.max(size, 44));
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

class FailureInjectingStorage implements UploadedAudioStoragePort {
  stageCalls = 0;
  finalizeCalls = 0;
  rollbackCalls = 0;

  constructor(
    private readonly delegate: UploadedAudioStoragePort,
    private readonly failures: Readonly<{
      stageAt?: number;
      finalizeAt?: number;
      rollbackAt?: number;
    }>,
  ) {}

  write(input: Parameters<UploadedAudioStoragePort["write"]>[0]) {
    return this.delegate.write(input);
  }
  read(relativePath: string) {
    return this.delegate.read(relativePath);
  }
  delete(relativePath: string) {
    return this.delegate.delete(relativePath);
  }
  createTombstoneRelativePath(sessionId: string, fileId: string) {
    return this.delegate.createTombstoneRelativePath(sessionId, fileId);
  }
  stageDelete(originalRelativePath: string, tombstoneRelativePath: string) {
    this.stageCalls += 1;
    if (this.stageCalls === this.failures.stageAt)
      return Promise.reject(new Error("injected stage rename failure"));
    return this.delegate.stageDelete(
      originalRelativePath,
      tombstoneRelativePath,
    );
  }
  finalizeDelete(tombstoneRelativePath: string) {
    this.finalizeCalls += 1;
    if (this.finalizeCalls === this.failures.finalizeAt)
      return Promise.reject(new Error("injected final unlink failure"));
    return this.delegate.finalizeDelete(tombstoneRelativePath);
  }
  rollbackDelete(originalRelativePath: string, tombstoneRelativePath: string) {
    this.rollbackCalls += 1;
    if (this.rollbackCalls === this.failures.rollbackAt)
      return Promise.reject(new Error("injected rollback failure"));
    return this.delegate.rollbackDelete(
      originalRelativePath,
      tombstoneRelativePath,
    );
  }
}

describe("Uploaded Audio SQLite/filesystem integration", () => {
  let directory: string;
  let databasePath: string;
  let audioRoot: string;
  let sqlite: ReturnType<typeof createDatabase>["sqlite"];
  let db: ReturnType<typeof createDatabase>["db"];
  let sessions: AnalysisSessionService;
  let analysisRepository: SqliteAnalysisRepository;
  let repository: SqliteUploadedAudioRepository;
  let queue: SqliteTranscriptionJobQueue;
  let provider: FakeAudioTranscriptionProvider;
  let storage: FilesystemUploadedAudioStorage;
  let service: UploadedAudioService;
  let nextId: number;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-uploaded-audio-"));
    databasePath = join(directory, "test.db");
    audioRoot = join(directory, "audio");
    const connection = createDatabase(databasePath);
    sqlite = connection.sqlite;
    db = connection.db;
    migrate(connection.db, { migrationsFolder });
    nextId = 1;
    const createId = () => uuid(nextId++);
    analysisRepository = new SqliteAnalysisRepository(
      connection.db,
      createId,
      () => 1_700_000_000_000,
    );
    repository = new SqliteUploadedAudioRepository(
      connection.db,
      createId,
      () => 1_700_000_000_000,
    );
    queue = new SqliteTranscriptionJobQueue(connection.db);
    provider = new FakeAudioTranscriptionProvider();
    storage = new FilesystemUploadedAudioStorage(audioRoot);
    sessions = new AnalysisSessionService(analysisRepository);
    service = new UploadedAudioService(
      repository,
      storage,
      queue,
      1_024,
      true,
      createId,
      () => 1_700_000_000_100,
    );
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function createSession(title = "Uploaded audio practice") {
    return sessions.create({ title, mode: "transcript_lab" });
  }

  function upload(sessionId: string, actionId = uuid(900)) {
    const bytes = wavBytes();
    return service.upload(
      sessionId,
      {
        actionId,
        speakerRole: "interviewer",
        originalFilename: "../../user-selected.wav",
        mimeType: "audio/wav",
        byteSize: bytes.byteLength,
      },
      bytes,
    );
  }

  function createService(
    repositoryOverride: SqliteUploadedAudioRepository = repository,
    storageOverride: UploadedAudioStoragePort = storage,
    analysisOverride: SqliteAnalysisRepository = analysisRepository,
  ) {
    void analysisOverride;
    return new UploadedAudioService(
      repositoryOverride,
      storageOverride,
      queue,
      1_024,
      true,
      () => uuid(nextId++),
      () => 1_700_000_000_100,
    );
  }

  function sessionFiles(sessionId: string) {
    const directoryPath = join(audioRoot, sessionId);
    return existsSync(directoryPath) ? readdirSync(directoryPath) : [];
  }

  async function runWorker(
    analysisOverride: SqliteAnalysisRepository = analysisRepository,
    storageOverride: UploadedAudioStoragePort = storage,
  ) {
    const worker = new UploadedAudioTranscriptionWorker(
      queue,
      storageOverride,
      provider,
      new TranscriptIngestionService(analysisOverride),
      () => 1_700_000_000_100,
      () => uuid(nextId++),
    );
    return worker.runOneIteration();
  }

  function failTranscription(
    sessionId: string,
    assetId: string,
    actionId: string,
    errorCode = "INJECTED_TRANSCRIPTION_FAILURE",
  ) {
    return repository.failTranscription({
      sessionId,
      assetId,
      actionId,
      providerLabel: "failure-test-provider",
      errorCode,
    });
  }

  it("migrates the new metadata/action tables and source link", () => {
    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as Array<{ name: string }>;
    const columns = sqlite
      .prepare("pragma table_info(transcript_segments)")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "uploaded_audio_assets",
        "uploaded_audio_actions",
        "uploaded_audio_deletion_batches",
        "uploaded_audio_deletion_files",
      ]),
    );
    expect(columns.map((row) => row.name)).toContain(
      "source_uploaded_audio_asset_id",
    );
    const indexes = sqlite
      .prepare("pragma index_list(transcript_segments)")
      .all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toContain(
      "transcript_segments_uploaded_audio_asset_idx",
    );
  });

  it("enforces uploaded-audio role, status, action, and deletion checks", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    expect(() =>
      sqlite
        .prepare("update uploaded_audio_assets set speaker_role = 'unknown'")
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      sqlite
        .prepare("update uploaded_audio_assets set status = 'unknown'")
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      sqlite
        .prepare("update uploaded_audio_actions set action_type = 'unknown'")
        .run(),
    ).toThrow(/CHECK constraint failed/);

    await service.delete(session.id, uploaded.asset!.id, {
      actionId: uuid(949),
    });
    expect(() =>
      sqlite
        .prepare(
          "update uploaded_audio_deletion_batches set status = 'unknown'",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      sqlite
        .prepare(
          "update uploaded_audio_deletion_files set original_relative_path = tombstone_relative_path",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("stores safe metadata in SQLite and bytes only outside SQLite", async () => {
    const session = createSession();
    const result = await upload(session.id);
    expect(result.duplicated).toBe(false);
    expect(result.asset).toMatchObject({
      speakerRole: "interviewer",
      originalFilename: ".._.._user-selected.wav",
      status: "uploaded",
    });
    const stored = repository.get(session.id, result.asset!.id)!;
    expect(stored.relativePath).not.toContain("user-selected");
    expect(stored.relativePath).not.toContain("..");
    expect(readFileSync(join(audioRoot, stored.relativePath))).toEqual(
      Buffer.from(wavBytes()),
    );
    const columnTypes = sqlite
      .prepare("pragma table_info(uploaded_audio_assets)")
      .all() as Array<{ type: string }>;
    expect(columnTypes.some((column) => column.type === "BLOB")).toBe(false);
    expect(sessions.get(session.id).segments).toHaveLength(0);
    expect(provider.attemptCount(result.asset!.id)).toBe(0);
  });

  it("makes duplicate upload and transcription action IDs idempotent", async () => {
    const session = createSession();
    const uploadAction = uuid(901);
    const first = await upload(session.id, uploadAction);
    const duplicate = await upload(session.id, uploadAction);
    expect(duplicate).toMatchObject({
      duplicated: true,
      asset: { id: first.asset!.id },
    });
    expect(readdirSync(join(audioRoot, session.id))).toHaveLength(1);

    const transcribeAction = uuid(902);
    const transcribed = await service.transcribe(session.id, first.asset!.id, {
      actionId: transcribeAction,
    });
    await runWorker();
    const repeated = await service.transcribe(session.id, first.asset!.id, {
      actionId: transcribeAction,
    });
    expect(transcribed.job.status).toBe("queued");
    expect(repeated).toMatchObject({
      duplicated: true,
      job: { status: "completed" },
    });
    expect(provider.attemptCount(first.asset!.id)).toBe(1);
    expect(sessions.get(session.id).segments).toHaveLength(2);
  });

  it("ingests only explicit finalized provider chunks with the declared role", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    expect(sessions.get(session.id).segments).toHaveLength(0);
    await service.transcribe(session.id, uploaded.asset!.id, {
      actionId: uuid(903),
    });
    await runWorker();
    const segments = sessions.get(session.id).segments;
    expect(segments).toHaveLength(2);
    expect(
      segments.every((segment) => segment.speakerRole === "interviewer"),
    ).toBe(true);
    expect(segments.every((segment) => segment.text.length > 0)).toBe(true);
    const linked = sqlite
      .prepare(
        "select source_uploaded_audio_asset_id as assetId from transcript_segments order by sequence",
      )
      .all() as Array<{ assetId: string | null }>;
    expect(linked.every((row) => row.assetId === uploaded.asset!.id)).toBe(
      true,
    );
  });

  it("applies candidate role consistently", async () => {
    const session = createSession();
    const bytes = wavBytes();
    const uploaded = await service.upload(
      session.id,
      {
        actionId: uuid(904),
        speakerRole: "candidate",
        originalFilename: "candidate.wav",
        mimeType: "audio/wav",
        byteSize: bytes.byteLength,
      },
      bytes,
    );
    await service.transcribe(session.id, uploaded.asset!.id, {
      actionId: uuid(905),
    });
    await runWorker();
    expect(sessions.get(session.id).segments).toMatchObject([
      { speakerRole: "candidate" },
    ]);
  });

  it("records safe failure and supports retry with a new action", async () => {
    const session = createSession();
    provider = new FakeAudioTranscriptionProvider("once-per-asset");
    service = new UploadedAudioService(
      repository,
      new FilesystemUploadedAudioStorage(audioRoot),
      queue,
      1_024,
      true,
      () => uuid(nextId++),
      () => 1_700_000_000_100,
    );
    const uploaded = await upload(session.id);
    const actionId = uuid(906);
    await service.transcribe(session.id, uploaded.asset!.id, { actionId });
    await runWorker();
    expect(repository.get(session.id, uploaded.asset!.id)).toMatchObject({
      status: "failed",
      errorCode: "UPLOADED_AUDIO_PROVIDER_TEMPORARY",
    });
    expect(sessions.get(session.id).segments).toHaveLength(0);
    await expect(
      service.transcribe(session.id, uploaded.asset!.id, { actionId: uuid(907) }),
    ).rejects.toThrow(/queued or running/);
    await expect(
      service.transcribe(session.id, uploaded.asset!.id, { actionId }),
    ).resolves.toMatchObject({ duplicated: true, job: { status: "queued" } });
  });

  it("allows only the current transcribing action to transition to failed", async () => {
    const session = createSession();

    const untouched = await upload(session.id, uuid(930));
    expect(
      failTranscription(session.id, untouched.asset!.id, uuid(931)),
    ).toMatchObject({ status: "uploaded", errorCode: null });

    const failing = await upload(session.id, uuid(932));
    const firstAction = uuid(933);
    expect(
      repository.beginTranscription(session.id, failing.asset!.id, firstAction)
        .kind,
    ).toBe("ready");
    expect(
      failTranscription(session.id, failing.asset!.id, uuid(934)),
    ).toMatchObject({ status: "transcribing", errorCode: null });
    expect(
      failTranscription(session.id, failing.asset!.id, firstAction),
    ).toMatchObject({
      status: "failed",
      errorCode: "INJECTED_TRANSCRIPTION_FAILURE",
    });
    expect(
      failTranscription(
        session.id,
        failing.asset!.id,
        firstAction,
        "STALE_FAILURE_MUST_NOT_REPLACE",
      ),
    ).toMatchObject({
      status: "failed",
      errorCode: "INJECTED_TRANSCRIPTION_FAILURE",
    });

    const retryAction = uuid(935);
    expect(
      repository.beginTranscription(session.id, failing.asset!.id, retryAction)
        .kind,
    ).toBe("ready");
    expect(
      failTranscription(
        session.id,
        failing.asset!.id,
        firstAction,
        "STALE_RETRY_FAILURE",
      ),
    ).toMatchObject({ status: "transcribing", errorCode: null });
    expect(
      failTranscription(session.id, failing.asset!.id, retryAction),
    ).toMatchObject({ status: "failed" });

    const completed = await upload(session.id, uuid(936));
    const completedAction = uuid(937);
    await service.transcribe(session.id, completed.asset!.id, {
      actionId: completedAction,
    });
    await runWorker();
    expect(
      failTranscription(session.id, completed.asset!.id, completedAction),
    ).toMatchObject({ status: "completed", errorCode: null });

    const deleting = await upload(session.id, uuid(938));
    const deletingTranscribeAction = uuid(939);
    expect(
      repository.beginTranscription(
        session.id,
        deleting.asset!.id,
        deletingTranscribeAction,
      ).kind,
    ).toBe("ready");
    failTranscription(session.id, deleting.asset!.id, deletingTranscribeAction);
    const deletion = repository.beginAssetDeletion({
      sessionId: session.id,
      assetId: deleting.asset!.id,
      actionId: uuid(940),
      batchId: uuid(941),
      fileId: uuid(942),
      tombstoneRelativePath: storage.createTombstoneRelativePath(
        session.id,
        uuid(942),
      ),
    });
    expect(deletion.kind).toBe("ready");
    expect(
      failTranscription(
        session.id,
        deleting.asset!.id,
        deletingTranscribeAction,
      ),
    ).toMatchObject({ status: "deleting" });
  });

  it("rolls back both segments and completion when the former commit boundary fails", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    const failingAnalysis = new SqliteAnalysisRepository(
      db,
      () => uuid(nextId++),
      () => 1_700_000_000_000,
      () => {
        throw new Error("injected between segment insert and asset completion");
      },
    );
    const failingService = createService(repository, storage, failingAnalysis);
    await failingService.transcribe(session.id, uploaded.asset!.id, {
      actionId: uuid(950),
    });
    await runWorker(failingAnalysis);
    expect(sessions.get(session.id).segments).toHaveLength(0);
    expect(sessions.get(session.id).session.status).toBe("draft");
    expect(repository.get(session.id, uploaded.asset!.id)).toMatchObject({
      status: "failed",
      transcriptSegmentCount: 0,
      completedAt: null,
    });

    await service.transcribe(session.id, uploaded.asset!.id, {
      actionId: uuid(951),
    });
    await runWorker();
    expect(sessions.get(session.id).segments).toHaveLength(2);
    expect(repository.get(session.id, uploaded.asset!.id)?.status).toBe(
      "completed",
    );
  });

  it("isolates assets by analysis-session ownership", async () => {
    const owner = createSession("Owner");
    const other = createSession("Other");
    const uploaded = await upload(owner.id);
    await expect(
      service.transcribe(other.id, uploaded.asset!.id, { actionId: uuid(908) }),
    ).rejects.toThrow(/could not be found/);
    expect(repository.get(other.id, uploaded.asset!.id)).toBeNull();
  });

  it("deletes bytes and metadata but preserves committed transcript segments", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    const stored = repository.get(session.id, uploaded.asset!.id)!;
    await service.transcribe(session.id, uploaded.asset!.id, {
      actionId: uuid(909),
    });
    await runWorker();
    const result = await service.delete(session.id, uploaded.asset!.id, {
      actionId: uuid(910),
    });
    expect(result.deleted).toBe(true);
    expect(repository.get(session.id, uploaded.asset!.id)).toBeNull();
    expect(existsSync(join(audioRoot, stored.relativePath))).toBe(false);
    expect(sessions.get(session.id).segments).toHaveLength(2);
    const links = sqlite
      .prepare(
        "select source_uploaded_audio_asset_id as assetId from transcript_segments",
      )
      .all() as Array<{ assetId: string | null }>;
    expect(links.every((row) => row.assetId === null)).toBe(true);
    await expect(
      service.delete(session.id, uploaded.asset!.id, { actionId: uuid(910) }),
    ).resolves.toEqual({ deleted: true, duplicated: true });
  });

  it("rejects empty, oversized, unsupported, and mismatched audio", async () => {
    const session = createSession();
    const base = {
      actionId: uuid(911),
      speakerRole: "interviewer",
      originalFilename: "audio.wav",
      mimeType: "audio/wav",
    } as const;
    await expect(
      service.upload(session.id, { ...base, byteSize: 0 }, new Uint8Array()),
    ).rejects.toThrow();
    const oversized = wavBytes(1_025);
    await expect(
      service.upload(
        session.id,
        { ...base, actionId: uuid(912), byteSize: oversized.byteLength },
        oversized,
      ),
    ).rejects.toThrow(/size limit/);
    await expect(
      service.upload(
        session.id,
        {
          ...base,
          actionId: uuid(913),
          originalFilename: "audio.exe",
          byteSize: 44,
        },
        wavBytes(),
      ),
    ).rejects.toThrow(/not supported/);
    await expect(
      service.upload(
        session.id,
        { ...base, actionId: uuid(914), byteSize: 44 },
        new Uint8Array(44),
      ),
    ).rejects.toThrow(/does not match/);
  });

  it("rejects a symlink session directory and compensates rejected persistence", async () => {
    const session = createSession();
    mkdirSync(audioRoot, { recursive: true });
    const outside = join(directory, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(audioRoot, session.id));
    await expect(upload(session.id)).rejects.toThrow(/rejected/);
    expect(readdirSync(outside)).toHaveLength(0);

    rmSync(join(audioRoot, session.id));
    const failingRepository = new Proxy(repository, {
      get(target, property, receiver) {
        if (property === "create")
          return () => {
            throw new Error("database persistence failed");
          };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const compensating = new UploadedAudioService(
      failingRepository,
      new FilesystemUploadedAudioStorage(audioRoot),
      queue,
      1_024,
      true,
      () => uuid(nextId++),
    );
    await expect(
      compensating.upload(
        session.id,
        {
          actionId: uuid(915),
          speakerRole: "interviewer",
          originalFilename: "audio.wav",
          mimeType: "audio/wav",
          byteSize: 44,
        },
        wavBytes(),
      ),
    ).rejects.toThrow(/database persistence failed/);
    expect(readdirSync(join(audioRoot, session.id))).toHaveLength(0);
  });

  it("rejects and compensates upload after session deletion is planned", async () => {
    const session = createSession();
    const original = await upload(session.id, uuid(943));
    const stored = repository.get(session.id, original.asset!.id)!;
    const batchId = uuid(944);
    const fileId = uuid(945);
    const deletionAction = `session-delete:${session.id}`;
    const beginning = repository.beginSessionDeletion({
      sessionId: session.id,
      actionId: deletionAction,
      batchId,
      files: [
        {
          id: fileId,
          assetId: stored.id,
          originalRelativePath: stored.relativePath,
          tombstoneRelativePath: storage.createTombstoneRelativePath(
            session.id,
            fileId,
          ),
        },
      ],
    });
    expect(beginning).toMatchObject({
      kind: "ready",
      plan: { id: batchId, status: "planned", files: [{ assetId: stored.id }] },
    });
    const originalPlan = repository.getDeletionPlan(batchId);
    const uploadAction = uuid(946);

    await expect(upload(session.id, uploadAction)).rejects.toThrow(
      /cannot be added while the analysis session is being deleted/,
    );
    expect(repository.listStoredForSession(session.id)).toHaveLength(1);
    expect(
      sqlite
        .prepare(
          "select count(*) as count from uploaded_audio_actions where analysis_session_id = ? and action_id = ?",
        )
        .get(session.id, uploadAction),
    ).toEqual({ count: 0 });
    expect(sessionFiles(session.id)).toEqual([
      stored.relativePath.split("/").at(-1),
    ]);
    expect(repository.getDeletionPlan(batchId)).toEqual(originalPlan);

    await expect(service.deleteSession(session.id)).resolves.toBe(true);
    expect(sessionFiles(session.id)).toEqual([]);
  });

  it("retries an asset deletion after a stage rename failure", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    const stored = repository.get(session.id, uploaded.asset!.id)!;
    const actionId = uuid(916);
    const failingStorage = new FailureInjectingStorage(storage, { stageAt: 1 });
    const retrying = createService(repository, failingStorage);

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, { actionId }),
    ).rejects.toThrow(/remains retryable/);
    expect(repository.get(session.id, uploaded.asset!.id)).toMatchObject({
      status: "deleting",
    });
    expect(existsSync(join(audioRoot, stored.relativePath))).toBe(true);
    await expect(
      retrying.transcribe(session.id, uploaded.asset!.id, {
        actionId: uuid(999),
      }),
    ).rejects.toThrow(/deletion is in progress/);
    await expect(retrying.deleteSession(session.id)).rejects.toThrow(
      /could not be created safely/,
    );

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, { actionId }),
    ).resolves.toEqual({ deleted: true, duplicated: true });
    expect(repository.get(session.id, uploaded.asset!.id)).toBeNull();
    expect(sessionFiles(session.id)).toEqual([]);
  });

  it("allows only the owning delete action to resume an active batch", async () => {
    const session = createSession();
    const uploaded = await upload(session.id, uuid(947));
    const originalAction = uuid(948);
    const unrelatedAction = uuid(949);
    const failingStorage = new FailureInjectingStorage(storage, { stageAt: 1 });
    const retrying = createService(repository, failingStorage);

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, {
        actionId: originalAction,
      }),
    ).rejects.toThrow(/remains retryable/);
    const originalBatch = sqlite
      .prepare(
        "select id from uploaded_audio_deletion_batches where analysis_session_id = ? and action_id = ?",
      )
      .get(session.id, originalAction) as { id: string };
    const originalPlan = repository.getDeletionPlan(originalBatch.id);

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, {
        actionId: unrelatedAction,
      }),
    ).rejects.toThrow(/already used by another uploaded-audio action/);
    expect(repository.getDeletionPlan(originalBatch.id)).toEqual(originalPlan);
    expect(
      sqlite
        .prepare(
          "select count(*) as count from uploaded_audio_deletion_batches where analysis_session_id = ?",
        )
        .get(session.id),
    ).toEqual({ count: 1 });

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, {
        actionId: originalAction,
      }),
    ).resolves.toEqual({ deleted: true, duplicated: true });
    expect(repository.getDeletionPlan(originalBatch.id)?.status).toBe(
      "completed",
    );
  });

  it("rejects repository completion from planned deletion states", async () => {
    const firstSession = createSession("First planned deletion");
    const first = await upload(firstSession.id, uuid(950));
    const firstStored = repository.get(firstSession.id, first.asset!.id)!;
    const firstFileId = uuid(951);
    const firstBeginning = repository.beginAssetDeletion({
      sessionId: firstSession.id,
      assetId: firstStored.id,
      actionId: uuid(952),
      batchId: uuid(953),
      fileId: firstFileId,
      tombstoneRelativePath: storage.createTombstoneRelativePath(
        firstSession.id,
        firstFileId,
      ),
    });
    if (firstBeginning.kind !== "ready")
      throw new Error("Expected the first deletion plan.");

    const secondSession = createSession("Second planned deletion");
    const second = await upload(secondSession.id, uuid(954));
    const secondStored = repository.get(secondSession.id, second.asset!.id)!;
    const secondFileId = uuid(955);
    const secondBeginning = repository.beginAssetDeletion({
      sessionId: secondSession.id,
      assetId: secondStored.id,
      actionId: uuid(956),
      batchId: uuid(957),
      fileId: secondFileId,
      tombstoneRelativePath: storage.createTombstoneRelativePath(
        secondSession.id,
        secondFileId,
      ),
    });
    if (secondBeginning.kind !== "ready")
      throw new Error("Expected the second deletion plan.");

    await expect(
      Promise.resolve().then(() =>
        repository.markDeletionFileCompleted(
          firstBeginning.plan.id,
          firstFileId,
        ),
      ),
    ).rejects.toThrow(/not ready for completion/);
    await expect(
      Promise.resolve().then(() =>
        repository.completeDeletion(firstBeginning.plan.id),
      ),
    ).rejects.toThrow(/not ready for completion/);
    await expect(
      Promise.resolve().then(() =>
        repository.markDeletionFileCompleted(
          firstBeginning.plan.id,
          secondFileId,
        ),
      ),
    ).rejects.toThrow(/does not belong/);

    const zeroFileSession = createSession("Zero-file planned deletion");
    const zeroFileBeginning = repository.beginSessionDeletion({
      sessionId: zeroFileSession.id,
      actionId: `session-delete:${zeroFileSession.id}`,
      batchId: uuid(958),
      files: [],
    });
    if (zeroFileBeginning.kind !== "ready")
      throw new Error("Expected the zero-file deletion plan.");
    expect(() =>
      repository.completeDeletion(zeroFileBeginning.plan.id),
    ).toThrow(/not ready for completion/);
  });

  it("guards metadata-deleted file and batch completion idempotently", async () => {
    const session = createSession("Completion transition guards");
    const first = await upload(session.id, uuid(959));
    const second = await upload(session.id, uuid(960));
    const assets = [first, second].map((result) =>
      repository.get(session.id, result.asset!.id)!,
    );
    const files = assets.map((asset, index) => {
      const id = uuid(961 + index);
      return {
        id,
        assetId: asset.id,
        originalRelativePath: asset.relativePath,
        tombstoneRelativePath: storage.createTombstoneRelativePath(
          session.id,
          id,
        ),
      };
    });
    const beginning = repository.beginSessionDeletion({
      sessionId: session.id,
      actionId: `session-delete:${session.id}`,
      batchId: uuid(963),
      files,
    });
    if (beginning.kind !== "ready")
      throw new Error("Expected the session deletion plan.");
    for (const file of beginning.plan.files)
      await storage.stageDelete(
        file.originalRelativePath,
        file.tombstoneRelativePath,
      );
    const metadataDeleted = repository.deleteAuthoritativeMetadata(
      beginning.plan.id,
    );
    expect(metadataDeleted).toMatchObject({
      status: "metadata_deleted",
      files: [{ status: "metadata_deleted" }, { status: "metadata_deleted" }],
    });

    const [firstFile, secondFile] = metadataDeleted.files;
    if (!firstFile || !secondFile)
      throw new Error("Expected two deletion files.");
    await storage.finalizeDelete(firstFile.tombstoneRelativePath);
    expect(
      repository.markDeletionFileCompleted(metadataDeleted.id, firstFile.id)
        .files[0]?.status,
    ).toBe("completed");
    expect(() => repository.completeDeletion(metadataDeleted.id)).toThrow(
      /files remain incomplete/,
    );

    await storage.finalizeDelete(secondFile.tombstoneRelativePath);
    repository.markDeletionFileCompleted(metadataDeleted.id, secondFile.id);
    expect(repository.completeDeletion(metadataDeleted.id).status).toBe(
      "completed",
    );
    expect(
      repository.markDeletionFileCompleted(metadataDeleted.id, firstFile.id)
        .files,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstFile.id, status: "completed" }),
      ]),
    );
    expect(repository.completeDeletion(metadataDeleted.id).status).toBe(
      "completed",
    );
  });

  it("restores original bytes after metadata deletion failure and retries", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    const stored = repository.get(session.id, uploaded.asset!.id)!;
    const actionId = uuid(917);
    let failMetadata = true;
    const failingRepository = new Proxy(repository, {
      get(target, property, receiver) {
        if (property === "deleteAuthoritativeMetadata")
          return (batchId: string) => {
            if (failMetadata) {
              failMetadata = false;
              throw new Error("metadata deletion failed");
            }
            return target.deleteAuthoritativeMetadata(batchId);
          };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const compensating = createService(failingRepository);
    await expect(
      compensating.delete(session.id, uploaded.asset!.id, {
        actionId,
      }),
    ).rejects.toThrow(/metadata deletion failed/);
    expect(repository.get(session.id, uploaded.asset!.id)).not.toBeNull();
    expect(existsSync(join(audioRoot, stored.relativePath))).toBe(true);

    await expect(
      compensating.delete(session.id, uploaded.asset!.id, { actionId }),
    ).resolves.toEqual({ deleted: true, duplicated: true });
    expect(repository.get(session.id, uploaded.asset!.id)).toBeNull();
    expect(sessionFiles(session.id)).toEqual([]);
  });

  it("keeps a durable tombstone after final unlink failure and retries", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    const actionId = uuid(918);
    const failingStorage = new FailureInjectingStorage(storage, {
      finalizeAt: 1,
    });
    const retrying = createService(repository, failingStorage);

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, { actionId }),
    ).rejects.toThrow(/remains retryable/);
    expect(repository.get(session.id, uploaded.asset!.id)).toBeNull();
    expect(sessionFiles(session.id)).toEqual([
      expect.stringMatching(/\.delete$/u),
    ]);
    const batch = sqlite
      .prepare(
        "select id, status from uploaded_audio_deletion_batches where action_id = ?",
      )
      .get(actionId) as { id: string; status: string };
    expect(batch.status).toBe("metadata_deleted");

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, { actionId }),
    ).resolves.toEqual({ deleted: true, duplicated: true });
    expect(repository.getDeletionPlan(batch.id)?.status).toBe("completed");
    expect(sessionFiles(session.id)).toEqual([]);
  });

  it("retains a retry path when rollback itself fails", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    const actionId = uuid(919);
    let failMetadata = true;
    const failingRepository = new Proxy(repository, {
      get(target, property, receiver) {
        if (property === "deleteAuthoritativeMetadata")
          return (batchId: string) => {
            if (failMetadata) {
              failMetadata = false;
              throw new Error("metadata deletion failed");
            }
            return target.deleteAuthoritativeMetadata(batchId);
          };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failingStorage = new FailureInjectingStorage(storage, {
      rollbackAt: 1,
    });
    const retrying = createService(failingRepository, failingStorage);

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, { actionId }),
    ).rejects.toThrow(/rollback is incomplete/);
    expect(repository.get(session.id, uploaded.asset!.id)).toMatchObject({
      status: "deleting",
    });
    expect(sessionFiles(session.id)).toEqual([
      expect.stringMatching(/\.delete$/u),
    ]);

    await expect(
      retrying.delete(session.id, uploaded.asset!.id, { actionId }),
    ).resolves.toEqual({ deleted: true, duplicated: true });
    expect(repository.get(session.id, uploaded.asset!.id)).toBeNull();
    expect(sessionFiles(session.id)).toEqual([]);
  });

  it("cancels queued transcription when deletion wins", async () => {
    const session = createSession();
    const uploaded = await upload(session.id);
    await service.transcribe(session.id, uploaded.asset!.id, {
      actionId: uuid(920),
    });
    await expect(
      service.delete(session.id, uploaded.asset!.id, { actionId: uuid(921) }),
    ).resolves.toEqual({ deleted: true, duplicated: false });
    expect(repository.get(session.id, uploaded.asset!.id)).toBeNull();
    expect(await runWorker()).toBe(false);
  });

  it("rolls back every staged file after a multi-asset session failure", async () => {
    const session = createSession();
    const first = await upload(session.id, uuid(922));
    const second = await upload(session.id, uuid(923));
    const paths = [first, second].map(
      (result) => repository.get(session.id, result.asset!.id)!.relativePath,
    );
    const failingStorage = new FailureInjectingStorage(storage, { stageAt: 2 });
    const retrying = createService(repository, failingStorage);

    await expect(retrying.deleteSession(session.id)).rejects.toThrow(
      /remains retryable/,
    );
    expect(sessions.get(session.id).session.id).toBe(session.id);
    expect(paths.every((path) => existsSync(join(audioRoot, path)))).toBe(true);
    expect(
      sessionFiles(session.id).every((name) => !name.endsWith(".delete")),
    ).toBe(true);

    await expect(retrying.deleteSession(session.id)).resolves.toBe(true);
    expect(() => sessions.get(session.id)).toThrow(/could not be found/);
    expect(sessionFiles(session.id)).toEqual([]);
  });

  it("rolls back all session files after database deletion failure and retries", async () => {
    const session = createSession();
    await upload(session.id, uuid(924));
    await upload(session.id, uuid(925));
    let failMetadata = true;
    const failingRepository = new Proxy(repository, {
      get(target, property, receiver) {
        if (property === "deleteAuthoritativeMetadata")
          return (batchId: string) => {
            if (failMetadata) {
              failMetadata = false;
              throw new Error("session database deletion failed");
            }
            return target.deleteAuthoritativeMetadata(batchId);
          };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const retrying = createService(failingRepository);

    await expect(retrying.deleteSession(session.id)).rejects.toThrow(
      /session database deletion failed/,
    );
    expect(repository.listStoredForSession(session.id)).toHaveLength(2);
    expect(
      sessionFiles(session.id).filter((name) => !name.endsWith(".delete")),
    ).toHaveLength(2);

    await expect(retrying.deleteSession(session.id)).resolves.toBe(true);
    expect(repository.listStoredForSession(session.id)).toHaveLength(0);
    expect(sessionFiles(session.id)).toEqual([]);
  });

  it("finishes session cleanup after the database row is already deleted", async () => {
    const session = createSession();
    await upload(session.id, uuid(926));
    await upload(session.id, uuid(927));
    const failingStorage = new FailureInjectingStorage(storage, {
      finalizeAt: 1,
    });
    const retrying = createService(repository, failingStorage);

    await expect(retrying.deleteSession(session.id)).rejects.toThrow(
      /remains retryable/,
    );
    expect(() => sessions.get(session.id)).toThrow(/could not be found/);
    expect(sessionFiles(session.id)).toEqual([
      expect.stringMatching(/\.delete$/u),
    ]);
    const durableBatch = sqlite
      .prepare(
        "select status from uploaded_audio_deletion_batches where analysis_session_id = ?",
      )
      .get(session.id) as { status: string };
    expect(durableBatch.status).toBe("metadata_deleted");

    await expect(retrying.deleteSession(session.id)).resolves.toBe(true);
    expect(sessionFiles(session.id)).toEqual([]);
    await expect(retrying.deleteSession(session.id)).resolves.toBe(false);
  });
});
