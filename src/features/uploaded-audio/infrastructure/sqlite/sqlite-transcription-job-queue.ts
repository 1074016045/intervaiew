import "server-only";
import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  ClaimedTranscriptionJob,
  TranscriptionJob,
  TranscriptionJobQueuePort,
} from "../../application/transcription-job-queue.port";
import type { PublicTranscriptionJobSummary } from "../../domain/uploaded-audio";
import { getDatabase } from "@/infrastructure/db/client";
import {
  analysisSessions,
  schema,
  uploadedAudioActions,
  uploadedAudioAssets,
  uploadedAudioDeletionBatches,
  uploadedAudioTranscriptionJobs,
} from "@/infrastructure/db/schema";

type QueueDatabase = BetterSQLite3Database<typeof schema>;
const acceptedSessionStatuses = new Set(["draft", "active", "paused"]);

export class SqliteTranscriptionJobQueue implements TranscriptionJobQueuePort {
  constructor(
    private readonly db: QueueDatabase = getDatabase().db,
    private readonly createReceiptId: () => string = () => crypto.randomUUID(),
  ) {}

  enqueue(input: Parameters<TranscriptionJobQueuePort["enqueue"]>[0]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return this.enqueueOnce(input);
      } catch (error) {
        if (!this.isExpectedRaceError(error))
          throw new Error("The transcription job could not be persisted safely.");
        if (attempt === 2)
          return { kind: "temporarily-unavailable" } as const;
      }
    }
    return { kind: "temporarily-unavailable" } as const;
  }

  private enqueueOnce(
    input: Parameters<TranscriptionJobQueuePort["enqueue"]>[0],
  ) {
    return this.db.transaction((tx) => {
      const session = tx
        .select({ status: analysisSessions.status })
        .from(analysisSessions)
        .where(eq(analysisSessions.id, input.analysisSessionId))
        .get();
      if (!session) return { kind: "session-not-found" } as const;

      const asset = tx
        .select({ id: uploadedAudioAssets.id, status: uploadedAudioAssets.status })
        .from(uploadedAudioAssets)
        .where(
          and(
            eq(uploadedAudioAssets.analysisSessionId, input.analysisSessionId),
            eq(uploadedAudioAssets.id, input.assetId),
          ),
        )
        .get();
      if (!asset) return { kind: "asset-not-found" } as const;

      const receipt = tx
        .select()
        .from(uploadedAudioActions)
        .where(
          and(
            eq(uploadedAudioActions.analysisSessionId, input.analysisSessionId),
            eq(uploadedAudioActions.actionId, input.actionId),
          ),
        )
        .get();
      if (receipt) {
        if (receipt.actionType !== "transcribe" || receipt.assetId !== input.assetId)
          return { kind: "action-conflict" } as const;
        const existingJob = tx
          .select()
          .from(uploadedAudioTranscriptionJobs)
          .where(
            and(
              eq(
                uploadedAudioTranscriptionJobs.analysisSessionId,
                input.analysisSessionId,
              ),
              eq(uploadedAudioTranscriptionJobs.actionId, input.actionId),
              eq(uploadedAudioTranscriptionJobs.assetId, input.assetId),
            ),
          )
          .get();
        return existingJob
          ? ({ kind: "duplicate", job: this.publicJob(existingJob) } as const)
          : ({ kind: "legacy-action" } as const);
      }

      const deletingSession = tx
        .select({ id: uploadedAudioDeletionBatches.id })
        .from(uploadedAudioDeletionBatches)
        .where(
          and(
            eq(
              uploadedAudioDeletionBatches.analysisSessionId,
              input.analysisSessionId,
            ),
            eq(uploadedAudioDeletionBatches.scope, "session"),
            inArray(uploadedAudioDeletionBatches.status, [
              "planned",
              "metadata_deleted",
            ]),
          ),
        )
        .get();
      if (deletingSession) return { kind: "session-deleting" } as const;
      if (!acceptedSessionStatuses.has(session.status))
        return { kind: "session-invalid" } as const;
      if (asset.status === "completed") return { kind: "asset-completed" } as const;
      if (asset.status === "deleting") return { kind: "asset-deleting" } as const;

      const active = tx
        .select({ id: uploadedAudioTranscriptionJobs.id })
        .from(uploadedAudioTranscriptionJobs)
        .where(
          and(
            eq(uploadedAudioTranscriptionJobs.assetId, input.assetId),
            inArray(uploadedAudioTranscriptionJobs.status, ["queued", "running"]),
          ),
        )
        .get();
      if (active) return { kind: "active-job-conflict" } as const;

      const now = new Date(input.now);
      tx.insert(uploadedAudioActions)
        .values({
          id: this.createReceiptId(),
          analysisSessionId: input.analysisSessionId,
          actionId: input.actionId,
          actionType: "transcribe",
          assetId: input.assetId,
          createdAt: now,
        })
        .run();
      const job = {
        id: input.id,
        analysisSessionId: input.analysisSessionId,
        assetId: input.assetId,
        actionId: input.actionId,
        status: "queued" as const,
        attemptCount: 0,
        maximumAttempts: input.maximumAttempts,
        availableAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        safeErrorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(uploadedAudioTranscriptionJobs).values(job).run();
      return { kind: "created", job: this.publicJob(job) } as const;
    }, { behavior: "immediate" });
  }

  recoverExpired(input: Parameters<TranscriptionJobQueuePort["recoverExpired"]>[0]) {
    return this.db.transaction((tx) => {
      const expired = tx
        .select()
        .from(uploadedAudioTranscriptionJobs)
        .where(
          and(
            eq(uploadedAudioTranscriptionJobs.status, "running"),
            lte(uploadedAudioTranscriptionJobs.leaseExpiresAt, new Date(input.now)),
          ),
        )
        .orderBy(
          asc(uploadedAudioTranscriptionJobs.leaseExpiresAt),
          asc(uploadedAudioTranscriptionJobs.id),
        )
        .limit(Math.max(0, Math.min(25, input.limit)))
        .all();
      const now = new Date(input.now);
      let recovered = 0;
      for (const job of expired) {
        const exhausted = job.attemptCount >= job.maximumAttempts;
        const transitioned = tx
          .update(uploadedAudioTranscriptionJobs)
          .set(
            exhausted
              ? {
                  status: "failed",
                  leaseToken: null,
                  leaseExpiresAt: null,
                  failedAt: now,
                  safeErrorCode: "UPLOADED_AUDIO_LEASE_EXPIRED",
                  updatedAt: now,
                }
              : {
                  status: "queued",
                  availableAt: now,
                  leaseToken: null,
                  leaseExpiresAt: null,
                  safeErrorCode: "UPLOADED_AUDIO_LEASE_EXPIRED",
                  updatedAt: now,
                },
          )
          .where(
            and(
              eq(uploadedAudioTranscriptionJobs.id, job.id),
              eq(uploadedAudioTranscriptionJobs.status, "running"),
              eq(uploadedAudioTranscriptionJobs.leaseToken, job.leaseToken!),
              lte(uploadedAudioTranscriptionJobs.leaseExpiresAt, now),
            ),
          )
          .run();
        if (transitioned.changes !== 1) continue;
        recovered += 1;
        this.markAssetFailed(
          tx,
          job.assetId,
          now,
          "UPLOADED_AUDIO_LEASE_EXPIRED",
        );
      }
      return recovered;
    }, { behavior: "immediate" });
  }

  claimNext(input: Parameters<TranscriptionJobQueuePort["claimNext"]>[0]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return this.claimNextOnce(input);
      } catch (error) {
        if (!this.isBusyError(error))
          throw new Error("The transcription job could not be claimed safely.");
        if (attempt === 2) return null;
      }
    }
    return null;
  }

  private claimNextOnce(
    input: Parameters<TranscriptionJobQueuePort["claimNext"]>[0],
  ) {
    return this.db.transaction((tx): ClaimedTranscriptionJob | null => {
      const candidates = tx
        .select({
          job: uploadedAudioTranscriptionJobs,
          asset: uploadedAudioAssets,
          sessionStatus: analysisSessions.status,
        })
        .from(uploadedAudioTranscriptionJobs)
        .innerJoin(
          uploadedAudioAssets,
          and(
            eq(uploadedAudioAssets.id, uploadedAudioTranscriptionJobs.assetId),
            eq(
              uploadedAudioAssets.analysisSessionId,
              uploadedAudioTranscriptionJobs.analysisSessionId,
            ),
          ),
        )
        .innerJoin(
          analysisSessions,
          eq(analysisSessions.id, uploadedAudioTranscriptionJobs.analysisSessionId),
        )
        .where(
          and(
            eq(uploadedAudioTranscriptionJobs.status, "queued"),
            lte(uploadedAudioTranscriptionJobs.availableAt, new Date(input.now)),
          ),
        )
        .orderBy(
          asc(uploadedAudioTranscriptionJobs.availableAt),
          asc(uploadedAudioTranscriptionJobs.createdAt),
          asc(uploadedAudioTranscriptionJobs.id),
        )
        .limit(25)
        .all();
      const now = new Date(input.now);
      for (const candidate of candidates) {
        const deletingSession = tx
          .select({ id: uploadedAudioDeletionBatches.id })
          .from(uploadedAudioDeletionBatches)
          .where(
            and(
              eq(
                uploadedAudioDeletionBatches.analysisSessionId,
                candidate.job.analysisSessionId,
              ),
              eq(uploadedAudioDeletionBatches.scope, "session"),
              inArray(uploadedAudioDeletionBatches.status, [
                "planned",
                "metadata_deleted",
              ]),
            ),
          )
          .get();
        if (
          deletingSession ||
          !acceptedSessionStatuses.has(candidate.sessionStatus) ||
          candidate.asset.status === "completed" ||
          candidate.asset.status === "deleting"
        ) {
          const safeErrorCode = deletingSession
            ? "UPLOADED_AUDIO_SESSION_DELETING"
            : "UPLOADED_AUDIO_JOB_STATE_INVALID";
          const invalidated = tx
            .update(uploadedAudioTranscriptionJobs)
            .set({
              status: "failed",
              leaseToken: null,
              leaseExpiresAt: null,
              failedAt: now,
              safeErrorCode,
              updatedAt: now,
            })
            .where(
              and(
                eq(uploadedAudioTranscriptionJobs.id, candidate.job.id),
                eq(uploadedAudioTranscriptionJobs.status, "queued"),
              ),
            )
            .run();
          if (invalidated.changes !== 1) continue;
          this.markAssetFailed(tx, candidate.asset.id, now, safeErrorCode);
          continue;
        }

        const leaseExpiresAt = new Date(input.now + input.leaseDurationMs);
        const transitioned = tx
          .update(uploadedAudioTranscriptionJobs)
          .set({
            status: "running",
            attemptCount: sql`${uploadedAudioTranscriptionJobs.attemptCount} + 1`,
            leaseToken: input.leaseToken,
            leaseExpiresAt,
            startedAt: now,
            safeErrorCode: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(uploadedAudioTranscriptionJobs.id, candidate.job.id),
              eq(uploadedAudioTranscriptionJobs.status, "queued"),
              lte(uploadedAudioTranscriptionJobs.availableAt, now),
              sql`${uploadedAudioTranscriptionJobs.attemptCount} < ${uploadedAudioTranscriptionJobs.maximumAttempts}`,
            ),
          )
          .run();
        if (transitioned.changes !== 1) continue;
        const assetTransition = tx
          .update(uploadedAudioAssets)
          .set({ status: "transcribing", updatedAt: now })
          .where(
            and(
              eq(uploadedAudioAssets.id, candidate.asset.id),
              ne(uploadedAudioAssets.status, "completed"),
              ne(uploadedAudioAssets.status, "deleting"),
            ),
          )
          .run();
        if (assetTransition.changes !== 1)
          throw new Error("The claimed transcription asset did not transition.");
        const claimed = tx
          .select()
          .from(uploadedAudioTranscriptionJobs)
          .where(eq(uploadedAudioTranscriptionJobs.id, candidate.job.id))
          .get();
        if (!claimed?.leaseToken || !claimed.leaseExpiresAt)
          throw new Error("The claimed transcription job was not restored.");
        return Object.freeze({
          ...this.job(claimed),
          status: "running" as const,
          leaseToken: claimed.leaseToken,
          leaseExpiresAt: claimed.leaseExpiresAt.getTime(),
          relativePath: candidate.asset.relativePath,
          mimeType: candidate.asset.mimeType,
          speakerRole: candidate.asset.speakerRole,
        });
      }
      return null;
    }, { behavior: "immediate" });
  }

  fail(input: Parameters<TranscriptionJobQueuePort["fail"]>[0]) {
    return this.db.transaction((tx) => {
      const job = tx
        .select()
        .from(uploadedAudioTranscriptionJobs)
        .where(eq(uploadedAudioTranscriptionJobs.id, input.jobId))
        .get();
      if (!job) return { kind: "not-found" } as const;
      if (
        job.status !== "running" ||
        job.leaseToken !== input.leaseToken ||
        !job.leaseExpiresAt ||
        job.leaseExpiresAt.getTime() <= input.now
      )
        return { kind: "stale" } as const;
      const now = new Date(input.now);
      const safeErrorCode = (input.safeErrorCode || "UPLOADED_AUDIO_TRANSCRIPTION_FAILED").slice(0, 80);
      const retry = input.retryAt !== null && job.attemptCount < job.maximumAttempts;
      const transitioned = tx
        .update(uploadedAudioTranscriptionJobs)
        .set(
          retry
            ? {
                status: "queued",
                availableAt: new Date(input.retryAt!),
                leaseToken: null,
                leaseExpiresAt: null,
                safeErrorCode,
                updatedAt: now,
              }
            : {
                status: "failed",
                leaseToken: null,
                leaseExpiresAt: null,
                failedAt: now,
                safeErrorCode,
                updatedAt: now,
              },
        )
        .where(
          and(
            eq(uploadedAudioTranscriptionJobs.id, input.jobId),
            eq(uploadedAudioTranscriptionJobs.status, "running"),
            eq(uploadedAudioTranscriptionJobs.leaseToken, input.leaseToken),
            sql`${uploadedAudioTranscriptionJobs.leaseExpiresAt} > ${input.now}`,
          ),
        )
        .run();
      if (transitioned.changes !== 1) return { kind: "stale" } as const;
      this.markAssetFailed(tx, job.assetId, now, safeErrorCode);
      const updated = tx
        .select()
        .from(uploadedAudioTranscriptionJobs)
        .where(eq(uploadedAudioTranscriptionJobs.id, input.jobId))
        .get();
      if (!updated) return { kind: "not-found" } as const;
      return { kind: "updated", job: this.job(updated) } as const;
    }, { behavior: "immediate" });
  }

  private markAssetFailed(
    tx: Parameters<Parameters<QueueDatabase["transaction"]>[0]>[0],
    assetId: string,
    now: Date,
    errorCode: string,
  ) {
    const asset = tx
      .select({ status: uploadedAudioAssets.status })
      .from(uploadedAudioAssets)
      .where(eq(uploadedAudioAssets.id, assetId))
      .get();
    if (!asset)
      throw new Error("The transcription failure asset was not found.");
    if (asset.status === "completed" || asset.status === "deleting") return;
    const transitioned = tx
      .update(uploadedAudioAssets)
      .set({
        status: "failed",
        errorCode: errorCode.slice(0, 80),
        failedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(uploadedAudioAssets.id, assetId),
          ne(uploadedAudioAssets.status, "completed"),
          ne(uploadedAudioAssets.status, "deleting"),
        ),
      )
      .run();
    if (transitioned.changes !== 1)
      throw new Error("The transcription failure asset was not updated.");
  }

  private sqliteCode(error: unknown) {
    return typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
      ? error.code
      : "";
  }

  private isBusyError(error: unknown) {
    return this.sqliteCode(error).startsWith("SQLITE_BUSY");
  }

  private isExpectedRaceError(error: unknown) {
    const code = this.sqliteCode(error);
    return code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_CONSTRAINT");
  }

  private job(row: typeof uploadedAudioTranscriptionJobs.$inferSelect): TranscriptionJob {
    return Object.freeze({
      id: row.id,
      analysisSessionId: row.analysisSessionId,
      assetId: row.assetId,
      actionId: row.actionId,
      status: row.status,
      attemptCount: row.attemptCount,
      maximumAttempts: row.maximumAttempts,
      availableAt: row.availableAt.getTime(),
      leaseToken: row.leaseToken,
      leaseExpiresAt: row.leaseExpiresAt?.getTime() ?? null,
      startedAt: row.startedAt?.getTime() ?? null,
      completedAt: row.completedAt?.getTime() ?? null,
      failedAt: row.failedAt?.getTime() ?? null,
      cancelledAt: row.cancelledAt?.getTime() ?? null,
      safeErrorCode: row.safeErrorCode,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    });
  }

  private publicJob(
    row: typeof uploadedAudioTranscriptionJobs.$inferSelect,
  ): PublicTranscriptionJobSummary {
    const job = this.job(row);
    return Object.freeze({
      id: job.id,
      status: job.status,
      attemptCount: job.attemptCount,
      maximumAttempts: job.maximumAttempts,
      availableAt: job.availableAt,
      safeErrorCode: job.safeErrorCode,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      failedAt: job.failedAt,
      cancelledAt: job.cancelledAt,
    });
  }
}
