import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  BeginDeletionResult,
  BeginTranscriptionResult,
  CreateUploadedAudioResult,
  UploadedAudioRepositoryPort,
} from "../../application/uploaded-audio-repository.port";
import type { UploadedAudioStoredAsset } from "../../domain/uploaded-audio";
import { getDatabase } from "@/infrastructure/db/client";
import {
  analysisSessions,
  schema,
  uploadedAudioActions,
  uploadedAudioAssets,
  uploadedAudioDeletionBatches,
  uploadedAudioDeletionFiles,
  uploadedAudioTranscriptionJobs,
} from "@/infrastructure/db/schema";

type UploadedAudioDatabase = BetterSQLite3Database<typeof schema>;

const acceptedSessionStatuses = new Set(["draft", "active", "paused"]);

export class SqliteUploadedAudioRepository implements UploadedAudioRepositoryPort {
  constructor(
    private readonly db: UploadedAudioDatabase = getDatabase().db,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  list(sessionId: string) {
    const session = this.db
      .select({ id: analysisSessions.id })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, sessionId))
      .get();
    if (!session) return { kind: "session-not-found" } as const;
    return {
      kind: "found",
      assets: Object.freeze(
        this.db
          .select()
          .from(uploadedAudioAssets)
          .where(eq(uploadedAudioAssets.analysisSessionId, sessionId))
          .orderBy(uploadedAudioAssets.createdAt)
          .all()
          .map((asset) => {
            const latestJob = this.db
              .select()
              .from(uploadedAudioTranscriptionJobs)
              .where(
                and(
                  eq(uploadedAudioTranscriptionJobs.analysisSessionId, sessionId),
                  eq(uploadedAudioTranscriptionJobs.assetId, asset.id),
                ),
              )
              .orderBy(
                desc(uploadedAudioTranscriptionJobs.createdAt),
                desc(uploadedAudioTranscriptionJobs.id),
              )
              .get();
            return this.publicView(asset, latestJob);
          }),
      ),
    } as const;
  }

  get(sessionId: string, assetId: string) {
    const asset = this.db
      .select()
      .from(uploadedAudioAssets)
      .where(
        and(
          eq(uploadedAudioAssets.analysisSessionId, sessionId),
          eq(uploadedAudioAssets.id, assetId),
        ),
      )
      .get();
    return asset ? this.storedView(asset) : null;
  }

  listStoredForSession(sessionId: string) {
    return Object.freeze(
      this.db
        .select()
        .from(uploadedAudioAssets)
        .where(eq(uploadedAudioAssets.analysisSessionId, sessionId))
        .orderBy(uploadedAudioAssets.createdAt)
        .all()
        .map((asset) => this.storedView(asset)),
    );
  }

  create(
    input: Parameters<UploadedAudioRepositoryPort["create"]>[0],
  ): CreateUploadedAudioResult {
    return this.db.transaction((tx) => {
      const activeSessionDeletion = tx
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
      if (activeSessionDeletion) return { kind: "session-deleting" } as const;
      const session = tx
        .select({ status: analysisSessions.status })
        .from(analysisSessions)
        .where(eq(analysisSessions.id, input.analysisSessionId))
        .get();
      if (!session) return { kind: "session-not-found" } as const;
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
        if (receipt.actionType !== "upload")
          return { kind: "action-conflict" } as const;
        const asset = tx
          .select()
          .from(uploadedAudioAssets)
          .where(eq(uploadedAudioAssets.id, receipt.assetId))
          .get();
        return {
          kind: "duplicate",
          asset: asset ? this.storedView(asset) : null,
        } as const;
      }
      if (!acceptedSessionStatuses.has(session.status))
        return { kind: "session-invalid" } as const;
      const now = new Date(this.now());
      const asset = {
        id: input.id,
        analysisSessionId: input.analysisSessionId,
        speakerRole: input.speakerRole,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        relativePath: input.relativePath,
        status: "uploaded" as const,
        providerLabel: null,
        transcriptSegmentCount: 0,
        errorCode: null,
        completedAt: null,
        failedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(uploadedAudioAssets).values(asset).run();
      tx.insert(uploadedAudioActions)
        .values({
          id: this.createId(),
          analysisSessionId: input.analysisSessionId,
          actionId: input.actionId,
          actionType: "upload",
          assetId: input.id,
          createdAt: now,
        })
        .run();
      return { kind: "created", asset: this.storedView(asset) } as const;
    });
  }

  beginTranscription(
    sessionId: string,
    assetId: string,
    actionId: string,
  ): BeginTranscriptionResult {
    return this.db.transaction((tx) => {
      const session = tx
        .select({ status: analysisSessions.status })
        .from(analysisSessions)
        .where(eq(analysisSessions.id, sessionId))
        .get();
      if (!session) return { kind: "session-not-found" } as const;
      const receipt = tx
        .select()
        .from(uploadedAudioActions)
        .where(
          and(
            eq(uploadedAudioActions.analysisSessionId, sessionId),
            eq(uploadedAudioActions.actionId, actionId),
          ),
        )
        .get();
      const asset = tx
        .select()
        .from(uploadedAudioAssets)
        .where(
          and(
            eq(uploadedAudioAssets.analysisSessionId, sessionId),
            eq(uploadedAudioAssets.id, assetId),
          ),
        )
        .get();
      if (receipt) {
        if (receipt.actionType !== "transcribe" || receipt.assetId !== assetId)
          return { kind: "action-conflict" } as const;
        return asset
          ? ({ kind: "duplicate", asset: this.storedView(asset) } as const)
          : ({ kind: "asset-not-found" } as const);
      }
      if (!asset) return { kind: "asset-not-found" } as const;
      if (!acceptedSessionStatuses.has(session.status))
        return { kind: "session-invalid" } as const;
      if (asset.status === "transcribing" || asset.status === "deleting")
        return { kind: "busy" } as const;
      const now = new Date(this.now());
      tx.insert(uploadedAudioActions)
        .values({
          id: this.createId(),
          analysisSessionId: sessionId,
          actionId,
          actionType: "transcribe",
          assetId,
          createdAt: now,
        })
        .run();
      if (asset.status === "completed")
        return { kind: "completed", asset: this.storedView(asset) } as const;
      tx.update(uploadedAudioAssets)
        .set({
          status: "transcribing",
          errorCode: null,
          failedAt: null,
          updatedAt: now,
        })
        .where(eq(uploadedAudioAssets.id, assetId))
        .run();
      return {
        kind: "ready",
        asset: this.storedView({
          ...asset,
          status: "transcribing",
          errorCode: null,
          failedAt: null,
          updatedAt: now,
        }),
      } as const;
    });
  }

  failTranscription(
    input: Parameters<UploadedAudioRepositoryPort["failTranscription"]>[0],
  ) {
    return this.db.transaction((tx) => {
      const now = new Date(this.now());
      const asset = tx
        .select()
        .from(uploadedAudioAssets)
        .where(
          and(
            eq(uploadedAudioAssets.analysisSessionId, input.sessionId),
            eq(uploadedAudioAssets.id, input.assetId),
          ),
        )
        .get();
      if (!asset) throw new Error("Uploaded audio failure lost its asset.");
      if (asset.status !== "transcribing") return this.storedView(asset);
      const latestAction = tx
        .select({
          actionId: uploadedAudioActions.actionId,
          actionType: uploadedAudioActions.actionType,
          assetId: uploadedAudioActions.assetId,
        })
        .from(uploadedAudioActions)
        .where(
          and(
            eq(uploadedAudioActions.analysisSessionId, input.sessionId),
            eq(uploadedAudioActions.assetId, input.assetId),
            eq(uploadedAudioActions.actionType, "transcribe"),
          ),
        )
        .orderBy(desc(sql`rowid`))
        .get();
      if (
        !latestAction ||
        latestAction.actionId !== input.actionId ||
        latestAction.actionType !== "transcribe" ||
        latestAction.assetId !== input.assetId
      )
        return this.storedView(asset);
      const transitioned = tx
        .update(uploadedAudioAssets)
        .set({
          status: "failed",
          providerLabel: input.providerLabel,
          errorCode: input.errorCode.slice(0, 80),
          completedAt: null,
          failedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(uploadedAudioAssets.analysisSessionId, input.sessionId),
            eq(uploadedAudioAssets.id, input.assetId),
            eq(uploadedAudioAssets.status, "transcribing"),
          ),
        )
        .run();
      if (transitioned.changes !== 1) {
        const current = tx
          .select()
          .from(uploadedAudioAssets)
          .where(
            and(
              eq(uploadedAudioAssets.analysisSessionId, input.sessionId),
              eq(uploadedAudioAssets.id, input.assetId),
            ),
          )
          .get();
        if (!current) throw new Error("Uploaded audio failure lost its asset.");
        return this.storedView(current);
      }
      const failed = tx
        .select()
        .from(uploadedAudioAssets)
        .where(eq(uploadedAudioAssets.id, input.assetId))
        .get();
      if (!failed) throw new Error("Uploaded audio failure lost its asset.");
      return this.storedView(failed);
    });
  }

  beginAssetDeletion(
    input: Parameters<UploadedAudioRepositoryPort["beginAssetDeletion"]>[0],
  ): BeginDeletionResult {
    const result = this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(uploadedAudioDeletionBatches)
        .where(
          and(
            eq(uploadedAudioDeletionBatches.analysisSessionId, input.sessionId),
            eq(uploadedAudioDeletionBatches.actionId, input.actionId),
          ),
        )
        .get();
      if (existing)
        return existing.scope === "asset" &&
          existing.targetAssetId === input.assetId
          ? ({ kind: "duplicate", batchId: existing.id } as const)
          : ({ kind: "action-conflict" } as const);
      const session = tx
        .select({ id: analysisSessions.id })
        .from(analysisSessions)
        .where(eq(analysisSessions.id, input.sessionId))
        .get();
      if (!session) return { kind: "session-not-found" } as const;
      const asset = tx
        .select()
        .from(uploadedAudioAssets)
        .where(
          and(
            eq(uploadedAudioAssets.analysisSessionId, input.sessionId),
            eq(uploadedAudioAssets.id, input.assetId),
          ),
        )
        .get();
      if (!asset) return { kind: "asset-not-found" } as const;
      if (asset.status === "deleting") {
        const activeBatch = tx
          .select()
          .from(uploadedAudioDeletionBatches)
          .where(
            and(
              eq(
                uploadedAudioDeletionBatches.analysisSessionId,
                input.sessionId,
              ),
              eq(uploadedAudioDeletionBatches.scope, "asset"),
              eq(uploadedAudioDeletionBatches.targetAssetId, input.assetId),
            ),
          )
          .all()
          .find((batch) => batch.status !== "completed");
        return activeBatch
          ? activeBatch.actionId === input.actionId
            ? ({ kind: "duplicate", batchId: activeBatch.id } as const)
            : ({ kind: "action-conflict" } as const)
          : ({ kind: "action-conflict" } as const);
      }
      const receipt = tx
        .select()
        .from(uploadedAudioActions)
        .where(
          and(
            eq(uploadedAudioActions.analysisSessionId, input.sessionId),
            eq(uploadedAudioActions.actionId, input.actionId),
          ),
        )
        .get();
      if (receipt) return { kind: "action-conflict" } as const;
      const now = new Date(this.now());
      tx.insert(uploadedAudioActions)
        .values({
          id: this.createId(),
          analysisSessionId: input.sessionId,
          actionId: input.actionId,
          actionType: "delete",
          assetId: input.assetId,
          createdAt: now,
        })
        .run();
      tx.insert(uploadedAudioDeletionBatches)
        .values({
          id: input.batchId,
          analysisSessionId: input.sessionId,
          actionId: input.actionId,
          scope: "asset",
          targetAssetId: input.assetId,
          status: "planned",
          errorCode: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        })
        .run();
      tx.insert(uploadedAudioDeletionFiles)
        .values({
          id: input.fileId,
          batchId: input.batchId,
          assetId: input.assetId,
          originalRelativePath: asset.relativePath,
          tombstoneRelativePath: input.tombstoneRelativePath,
          status: "planned",
          errorCode: null,
          updatedAt: now,
        })
        .run();
      const activeJobs = tx
        .select({ id: uploadedAudioTranscriptionJobs.id })
        .from(uploadedAudioTranscriptionJobs)
        .where(
          and(
            eq(uploadedAudioTranscriptionJobs.assetId, input.assetId),
            inArray(uploadedAudioTranscriptionJobs.status, ["queued", "running"]),
          ),
        )
        .all();
      const cancelledJobs = tx
        .update(uploadedAudioTranscriptionJobs)
        .set({
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          cancelledAt: now,
          safeErrorCode: "UPLOADED_AUDIO_ASSET_DELETED",
          updatedAt: sql`max(${uploadedAudioTranscriptionJobs.updatedAt}, ${now.getTime()})`,
        })
        .where(
          and(
            eq(uploadedAudioTranscriptionJobs.assetId, input.assetId),
            inArray(uploadedAudioTranscriptionJobs.status, ["queued", "running"]),
          ),
        )
        .run();
      if (cancelledJobs.changes !== activeJobs.length)
        throw new Error("Active transcription jobs were not cancelled.");
      const deletingAsset = tx
        .update(uploadedAudioAssets)
        .set({ status: "deleting", updatedAt: now })
        .where(
          and(
            eq(uploadedAudioAssets.id, input.assetId),
            ne(uploadedAudioAssets.status, "deleting"),
          ),
        )
        .run();
      if (deletingAsset.changes !== 1)
        throw new Error("The uploaded-audio asset was not marked deleting.");
      return { kind: "ready", batchId: input.batchId } as const;
    });
    if (result.kind !== "ready" && result.kind !== "duplicate") return result;
    const plan = this.getDeletionPlan(result.batchId);
    if (!plan) throw new Error("Uploaded-audio deletion plan was lost.");
    return { kind: result.kind, plan } as const;
  }

  beginSessionDeletion(
    input: Parameters<UploadedAudioRepositoryPort["beginSessionDeletion"]>[0],
  ): BeginDeletionResult {
    const result = this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(uploadedAudioDeletionBatches)
        .where(
          and(
            eq(uploadedAudioDeletionBatches.analysisSessionId, input.sessionId),
            eq(uploadedAudioDeletionBatches.actionId, input.actionId),
          ),
        )
        .get();
      if (existing)
        return existing.scope === "session"
          ? ({ kind: "duplicate", batchId: existing.id } as const)
          : ({ kind: "action-conflict" } as const);
      const session = tx
        .select({ id: analysisSessions.id })
        .from(analysisSessions)
        .where(eq(analysisSessions.id, input.sessionId))
        .get();
      if (!session) return { kind: "session-not-found" } as const;
      const assets = tx
        .select()
        .from(uploadedAudioAssets)
        .where(eq(uploadedAudioAssets.analysisSessionId, input.sessionId))
        .all();
      if (assets.some((asset) => asset.status === "deleting"))
        return { kind: "action-conflict" } as const;
      const supplied = new Map(input.files.map((file) => [file.assetId, file]));
      if (
        assets.length !== supplied.size ||
        assets.some(
          (asset) =>
            supplied.get(asset.id)?.originalRelativePath !== asset.relativePath,
        )
      )
        return { kind: "action-conflict" } as const;
      const now = new Date(this.now());
      tx.insert(uploadedAudioDeletionBatches)
        .values({
          id: input.batchId,
          analysisSessionId: input.sessionId,
          actionId: input.actionId,
          scope: "session",
          targetAssetId: null,
          status: "planned",
          errorCode: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        })
        .run();
      if (input.files.length)
        tx.insert(uploadedAudioDeletionFiles)
          .values(
            input.files.map((file) => ({
              ...file,
              batchId: input.batchId,
              status: "planned" as const,
              errorCode: null,
              updatedAt: now,
            })),
          )
          .run();
      const activeJobs = tx
        .select({ id: uploadedAudioTranscriptionJobs.id })
        .from(uploadedAudioTranscriptionJobs)
        .where(
          and(
            eq(
              uploadedAudioTranscriptionJobs.analysisSessionId,
              input.sessionId,
            ),
            inArray(uploadedAudioTranscriptionJobs.status, ["queued", "running"]),
          ),
        )
        .all();
      const cancelledJobs = tx
        .update(uploadedAudioTranscriptionJobs)
        .set({
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          cancelledAt: now,
          safeErrorCode: "UPLOADED_AUDIO_SESSION_DELETED",
          updatedAt: sql`max(${uploadedAudioTranscriptionJobs.updatedAt}, ${now.getTime()})`,
        })
        .where(
          and(
            eq(
              uploadedAudioTranscriptionJobs.analysisSessionId,
              input.sessionId,
            ),
            inArray(uploadedAudioTranscriptionJobs.status, ["queued", "running"]),
          ),
        )
        .run();
      if (cancelledJobs.changes !== activeJobs.length)
        throw new Error("Active transcription jobs were not cancelled.");
      if (assets.length) {
        const deletingAssets = tx
          .update(uploadedAudioAssets)
          .set({ status: "deleting", updatedAt: now })
          .where(
            inArray(
              uploadedAudioAssets.id,
              assets.map((asset) => asset.id),
            ),
          )
          .run();
        if (deletingAssets.changes !== assets.length)
          throw new Error("Uploaded-audio assets were not marked deleting.");
      }
      return { kind: "ready", batchId: input.batchId } as const;
    });
    if (result.kind !== "ready" && result.kind !== "duplicate") return result;
    const plan = this.getDeletionPlan(result.batchId);
    if (!plan) throw new Error("Uploaded-audio deletion plan was lost.");
    return { kind: result.kind, plan } as const;
  }

  getDeletionPlan(batchId: string) {
    const batch = this.db
      .select()
      .from(uploadedAudioDeletionBatches)
      .where(eq(uploadedAudioDeletionBatches.id, batchId))
      .get();
    if (!batch) return null;
    const files = this.db
      .select()
      .from(uploadedAudioDeletionFiles)
      .where(eq(uploadedAudioDeletionFiles.batchId, batchId))
      .orderBy(uploadedAudioDeletionFiles.id)
      .all();
    return this.deletionPlanView(batch, files);
  }

  deleteAuthoritativeMetadata(batchId: string) {
    this.db.transaction((tx) => {
      const batch = tx
        .select()
        .from(uploadedAudioDeletionBatches)
        .where(eq(uploadedAudioDeletionBatches.id, batchId))
        .get();
      if (!batch)
        throw new Error("Uploaded-audio deletion plan was not found.");
      if (batch.status !== "planned") return;
      if (batch.scope === "asset" && batch.targetAssetId) {
        const deleted = tx
          .delete(uploadedAudioAssets)
          .where(
            and(
              eq(
                uploadedAudioAssets.analysisSessionId,
                batch.analysisSessionId,
              ),
              eq(uploadedAudioAssets.id, batch.targetAssetId),
              eq(uploadedAudioAssets.status, "deleting"),
            ),
          )
          .run();
        if (deleted.changes !== 1)
          throw new Error(
            "Uploaded-audio asset metadata was not deleted authoritatively.",
          );
      }
      if (batch.scope === "session") {
        const deleted = tx
          .delete(analysisSessions)
          .where(eq(analysisSessions.id, batch.analysisSessionId))
          .run();
        if (deleted.changes !== 1)
          throw new Error(
            "Analysis-session metadata was not deleted authoritatively.",
          );
      }
      const now = new Date(this.now());
      tx.update(uploadedAudioDeletionFiles)
        .set({ status: "metadata_deleted", errorCode: null, updatedAt: now })
        .where(eq(uploadedAudioDeletionFiles.batchId, batchId))
        .run();
      tx.update(uploadedAudioDeletionBatches)
        .set({ status: "metadata_deleted", errorCode: null, updatedAt: now })
        .where(eq(uploadedAudioDeletionBatches.id, batchId))
        .run();
    });
    const plan = this.getDeletionPlan(batchId);
    if (!plan) throw new Error("Uploaded-audio deletion plan was lost.");
    return plan;
  }

  markDeletionFileCompleted(batchId: string, fileId: string) {
    this.db.transaction((tx) => {
      const batch = tx
        .select()
        .from(uploadedAudioDeletionBatches)
        .where(eq(uploadedAudioDeletionBatches.id, batchId))
        .get();
      if (!batch)
        throw new Error("Uploaded-audio deletion plan was not found.");
      const file = tx
        .select()
        .from(uploadedAudioDeletionFiles)
        .where(eq(uploadedAudioDeletionFiles.id, fileId))
        .get();
      if (!file) throw new Error("Uploaded-audio deletion file was not found.");
      if (file.batchId !== batchId)
        throw new Error(
          "Uploaded-audio deletion file does not belong to that plan.",
        );
      if (file.status === "completed") return;
      if (
        batch.status !== "metadata_deleted" ||
        file.status !== "metadata_deleted"
      )
        throw new Error(
          "Uploaded-audio deletion file is not ready for completion.",
        );
      const transitioned = tx
        .update(uploadedAudioDeletionFiles)
        .set({
          status: "completed",
          errorCode: null,
          updatedAt: new Date(this.now()),
        })
        .where(
          and(
            eq(uploadedAudioDeletionFiles.batchId, batchId),
            eq(uploadedAudioDeletionFiles.id, fileId),
            eq(uploadedAudioDeletionFiles.status, "metadata_deleted"),
          ),
        )
        .run();
      if (transitioned.changes !== 1)
        throw new Error(
          "Uploaded-audio deletion file transition was not applied.",
        );
    });
    const plan = this.getDeletionPlan(batchId);
    if (!plan) throw new Error("Uploaded-audio deletion plan was lost.");
    return plan;
  }

  completeDeletion(batchId: string) {
    this.db.transaction((tx) => {
      const batch = tx
        .select()
        .from(uploadedAudioDeletionBatches)
        .where(eq(uploadedAudioDeletionBatches.id, batchId))
        .get();
      if (!batch)
        throw new Error("Uploaded-audio deletion plan was not found.");
      if (batch.status === "completed") return;
      if (batch.status !== "metadata_deleted")
        throw new Error(
          "Uploaded-audio deletion plan is not ready for completion.",
        );
      const incomplete = tx
        .select({ id: uploadedAudioDeletionFiles.id })
        .from(uploadedAudioDeletionFiles)
        .where(
          and(
            eq(uploadedAudioDeletionFiles.batchId, batchId),
            inArray(uploadedAudioDeletionFiles.status, [
              "planned",
              "metadata_deleted",
            ]),
          ),
        )
        .get();
      if (incomplete)
        throw new Error("Uploaded-audio deletion files remain incomplete.");
      const now = new Date(this.now());
      const transitioned = tx
        .update(uploadedAudioDeletionBatches)
        .set({
          status: "completed",
          errorCode: null,
          updatedAt: now,
          completedAt: now,
        })
        .where(
          and(
            eq(uploadedAudioDeletionBatches.id, batchId),
            eq(uploadedAudioDeletionBatches.status, "metadata_deleted"),
          ),
        )
        .run();
      if (transitioned.changes !== 1)
        throw new Error(
          "Uploaded-audio deletion plan transition was not applied.",
        );
    });
    const plan = this.getDeletionPlan(batchId);
    if (!plan) throw new Error("Uploaded-audio deletion plan was lost.");
    return plan;
  }

  recordDeletionError(
    batchId: string,
    fileId: string | null,
    errorCode: string,
  ) {
    const safeCode = errorCode.slice(0, 80);
    const now = new Date(this.now());
    this.db
      .update(uploadedAudioDeletionBatches)
      .set({ errorCode: safeCode, updatedAt: now })
      .where(eq(uploadedAudioDeletionBatches.id, batchId))
      .run();
    if (fileId)
      this.db
        .update(uploadedAudioDeletionFiles)
        .set({ errorCode: safeCode, updatedAt: now })
        .where(
          and(
            eq(uploadedAudioDeletionFiles.batchId, batchId),
            eq(uploadedAudioDeletionFiles.id, fileId),
          ),
        )
        .run();
  }

  private deletionPlanView(
    batch: typeof uploadedAudioDeletionBatches.$inferSelect,
    files: ReadonlyArray<typeof uploadedAudioDeletionFiles.$inferSelect>,
  ) {
    return Object.freeze({
      id: batch.id,
      analysisSessionId: batch.analysisSessionId,
      actionId: batch.actionId,
      scope: batch.scope,
      targetAssetId: batch.targetAssetId,
      status: batch.status,
      errorCode: batch.errorCode,
      files: Object.freeze(
        files.map((file) =>
          Object.freeze({
            id: file.id,
            assetId: file.assetId,
            originalRelativePath: file.originalRelativePath,
            tombstoneRelativePath: file.tombstoneRelativePath,
            status: file.status,
            errorCode: file.errorCode,
          }),
        ),
      ),
    });
  }

  private publicView(
    asset: typeof uploadedAudioAssets.$inferSelect,
    latestJob?: typeof uploadedAudioTranscriptionJobs.$inferSelect,
  ) {
    const { relativePath, ...view } = this.storedView(asset);
    void relativePath;
    return Object.freeze({
      ...view,
      latestJob: latestJob
        ? Object.freeze({
            id: latestJob.id,
            status: latestJob.status,
            attemptCount: latestJob.attemptCount,
            maximumAttempts: latestJob.maximumAttempts,
            availableAt: latestJob.availableAt.getTime(),
            safeErrorCode: latestJob.safeErrorCode,
            createdAt: latestJob.createdAt.getTime(),
            updatedAt: latestJob.updatedAt.getTime(),
            completedAt: latestJob.completedAt?.getTime() ?? null,
            failedAt: latestJob.failedAt?.getTime() ?? null,
            cancelledAt: latestJob.cancelledAt?.getTime() ?? null,
          })
        : null,
    });
  }

  private storedView(
    asset: typeof uploadedAudioAssets.$inferSelect,
  ): UploadedAudioStoredAsset {
    return Object.freeze({
      id: asset.id,
      analysisSessionId: asset.analysisSessionId,
      speakerRole: asset.speakerRole,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
      relativePath: asset.relativePath,
      status: asset.status,
      providerLabel: asset.providerLabel,
      transcriptSegmentCount: asset.transcriptSegmentCount,
      errorCode: asset.errorCode,
      completedAt: asset.completedAt?.getTime() ?? null,
      failedAt: asset.failedAt?.getTime() ?? null,
      createdAt: asset.createdAt.getTime(),
      updatedAt: asset.updatedAt.getTime(),
      latestJob: null,
    });
  }
}
