import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "@/infrastructure/db/client";
import {
  analysisSessions,
  transcriptSegments,
  uploadedAudioAssets,
  uploadedAudioTranscriptionJobs,
} from "@/infrastructure/db/schema";
import { AnalysisSessionService } from "@/features/question-intelligence/application/analysis-session-service";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { SqliteTranscriptionJobQueue } from "@/features/uploaded-audio/infrastructure/sqlite/sqlite-transcription-job-queue";
import { eq } from "drizzle-orm";

const migrationsFolder = resolve("src/infrastructure/db/migrations");

function uuid(counter: number) {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

describe("uploaded-audio atomic job completion", () => {
  let directory: string;
  let connection: ReturnType<typeof createDatabase>;
  let queue: SqliteTranscriptionJobQueue;
  let ingestion: TranscriptIngestionService;
  let sessions: AnalysisSessionService;
  let nextId: number;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-job-completion-"));
    connection = createDatabase(join(directory, "test.db"));
    migrate(connection.db, { migrationsFolder });
    nextId = 1;
    const analysis = new SqliteAnalysisRepository(
      connection.db,
      () => uuid(nextId++),
      () => 3_000,
    );
    sessions = new AnalysisSessionService(analysis);
    ingestion = new TranscriptIngestionService(analysis);
    queue = new SqliteTranscriptionJobQueue(connection.db, () => uuid(nextId++));
  });

  afterEach(() => {
    connection.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function seedAndClaim(role: "interviewer" | "candidate" = "interviewer") {
    const session = sessions.create({ title: "Completion", mode: "transcript_lab" });
    const assetId = uuid(100);
    const actionId = uuid(101);
    const jobId = uuid(102);
    connection.db.insert(uploadedAudioAssets).values({
      id: assetId,
      analysisSessionId: session.id,
      speakerRole: role,
      originalFilename: "practice.wav",
      mimeType: "audio/wav",
      byteSize: 44,
      sha256: "a".repeat(64),
      relativePath: `${session.id}/${assetId}.wav`,
      status: "uploaded",
      providerLabel: null,
      transcriptSegmentCount: 0,
      errorCode: null,
      completedAt: null,
      failedAt: null,
      createdAt: new Date(1_000),
      updatedAt: new Date(1_000),
    }).run();
    expect(
      queue.enqueue({
        id: jobId,
        analysisSessionId: session.id,
        assetId,
        actionId,
        maximumAttempts: 3,
        now: 2_000,
      }).kind,
    ).toBe("created");
    const job = queue.claimNext({
      now: 2_100,
      leaseToken: "lease-current",
      leaseDurationMs: 10_000,
    });
    expect(job).not.toBeNull();
    return { actionId, assetId, job: job!, jobId, session };
  }

  function completionInput(
    seeded: ReturnType<typeof seedAndClaim>,
    speakerRole: "interviewer" | "candidate" = "interviewer",
  ) {
    return {
      jobId: seeded.jobId,
      leaseToken: seeded.job.leaseToken,
      assetId: seeded.assetId,
      actionId: seeded.actionId,
      providerLabel: "deterministic-test-provider",
      speakerRole,
      chunks: [{ text: "Final practice transcript.", startMs: 0, endMs: 500 }],
      createdAt: 2_500,
    } as const;
  }

  function state(seeded: ReturnType<typeof seedAndClaim>) {
    return {
      session: connection.db.select().from(analysisSessions).where(
        eq(analysisSessions.id, seeded.session.id),
      ).get()!,
      asset: connection.db.select().from(uploadedAudioAssets).where(
        eq(uploadedAudioAssets.id, seeded.assetId),
      ).get()!,
      job: connection.db.select().from(uploadedAudioTranscriptionJobs).where(
        eq(uploadedAudioTranscriptionJobs.id, seeded.jobId),
      ).get()!,
      segments: connection.db.select().from(transcriptSegments).where(
        eq(transcriptSegments.analysisSessionId, seeded.session.id),
      ).all(),
    };
  }

  it("rejects a caller role that mismatches the authoritative audio asset and rolls back all writes", () => {
    const seeded = seedAndClaim("interviewer");
    expect(() =>
      ingestion.ingestUploadedAudio(
        seeded.session.id,
        completionInput(seeded, "candidate"),
      ),
    ).toThrow(/source was invalid/);
    expect(state(seeded)).toMatchObject({
      session: { status: "draft" },
      asset: { status: "transcribing", transcriptSegmentCount: 0 },
      job: { status: "running", leaseToken: "lease-current" },
      segments: [],
    });
  });

  it("returns a matching completed job duplicate idempotently", () => {
    const seeded = seedAndClaim();
    const input = completionInput(seeded);
    expect(ingestion.ingestUploadedAudio(seeded.session.id, input).kind).toBe(
      "created",
    );
    expect(ingestion.ingestUploadedAudio(seeded.session.id, input).kind).toBe(
      "duplicate",
    );
    expect(state(seeded)).toMatchObject({
      session: { status: "active" },
      asset: { status: "completed", transcriptSegmentCount: 1 },
      job: { status: "completed", leaseToken: null },
      segments: [{ text: "Final practice transcript." }],
    });
  });

  it("rejects a running job with matching preexisting segments without transitions", () => {
    const seeded = seedAndClaim();
    connection.db.insert(transcriptSegments).values({
      id: uuid(200),
      analysisSessionId: seeded.session.id,
      providerSegmentId: `uploaded:${seeded.assetId}:0`,
      sequence: 0,
      speakerRole: "interviewer",
      text: "Final practice transcript.",
      startMs: 0,
      endMs: 500,
      sourceUploadedAudioAssetId: seeded.assetId,
      createdAt: new Date(2_500),
    }).run();
    expect(() =>
      ingestion.ingestUploadedAudio(seeded.session.id, completionInput(seeded)),
    ).toThrow(/source was invalid/);
    expect(state(seeded)).toMatchObject({
      session: { status: "draft" },
      asset: { status: "transcribing", transcriptSegmentCount: 0 },
      job: { status: "running", leaseToken: "lease-current" },
      segments: [{ id: uuid(200) }],
    });
  });

  it("rejects a cancelled job with preexisting segments without transitions", () => {
    const seeded = seedAndClaim();
    connection.sqlite.prepare(
      `update uploaded_audio_transcription_jobs
       set status = 'cancelled', lease_token = null, lease_expires_at = null,
           cancelled_at = 2200, safe_error_code = 'CANCELLED', updated_at = 2200
       where id = ?`,
    ).run(seeded.jobId);
    connection.db.insert(transcriptSegments).values({
      id: uuid(201),
      analysisSessionId: seeded.session.id,
      providerSegmentId: `uploaded:${seeded.assetId}:0`,
      sequence: 0,
      speakerRole: "interviewer",
      text: "Final practice transcript.",
      startMs: 0,
      endMs: 500,
      sourceUploadedAudioAssetId: seeded.assetId,
      createdAt: new Date(2_500),
    }).run();
    expect(() =>
      ingestion.ingestUploadedAudio(seeded.session.id, completionInput(seeded)),
    ).toThrow(/source was invalid/);
    expect(state(seeded)).toMatchObject({
      session: { status: "draft" },
      asset: { status: "transcribing", transcriptSegmentCount: 0 },
      job: { status: "cancelled", leaseToken: null },
      segments: [{ id: uuid(201) }],
    });
  });

  it("rolls back transcript and session writes when a guarded asset update affects zero rows", () => {
    const seeded = seedAndClaim();
    connection.sqlite.exec(
      `create trigger ignore_uploaded_audio_completion
       before update of status on uploaded_audio_assets
       when new.status = 'completed'
       begin select raise(ignore); end`,
    );
    expect(() =>
      ingestion.ingestUploadedAudio(seeded.session.id, completionInput(seeded)),
    ).toThrow(/asset was not completed/);
    expect(state(seeded)).toMatchObject({
      session: { status: "draft" },
      asset: { status: "transcribing", transcriptSegmentCount: 0 },
      job: { status: "running" },
      segments: [],
    });
  });

  it("treats a stale completion lease as a safe no-op", () => {
    const seeded = seedAndClaim();
    const input = { ...completionInput(seeded), leaseToken: "lease-stale" };
    expect(() => ingestion.ingestUploadedAudio(seeded.session.id, input)).toThrow(
      /source was invalid/,
    );
    expect(state(seeded)).toMatchObject({
      session: { status: "draft" },
      asset: { status: "transcribing" },
      job: { status: "running", leaseToken: "lease-current" },
      segments: [],
    });
  });
});
