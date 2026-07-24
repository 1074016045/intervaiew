import {
  extensionOf,
  isSupportedAudioType,
  isValidAudioSignature,
  normalizeDisplayFilename,
  type UploadedAudioAssetView,
  type UploadedAudioStoredAsset,
  uploadedAudioActionSchema,
  uploadAudioMetadataSchema,
} from "../domain/uploaded-audio";
import { UploadedAudioError } from "../domain/uploaded-audio-error";
import type { TranscriptionJobQueuePort } from "./transcription-job-queue.port";
import type { UploadedAudioRepositoryPort } from "./uploaded-audio-repository.port";
import type { UploadedAudioStoragePort } from "./uploaded-audio-storage.port";

function publicAsset(asset: UploadedAudioStoredAsset): UploadedAudioAssetView;
function publicAsset(asset: null): null;
function publicAsset(asset: UploadedAudioStoredAsset | null) {
  if (!asset) return null;
  const { relativePath, ...view } = asset;
  void relativePath;
  return Object.freeze(view);
}

export class UploadedAudioService {
  constructor(
    private readonly repository: UploadedAudioRepositoryPort,
    private readonly storage: UploadedAudioStoragePort,
    private readonly jobQueue: TranscriptionJobQueuePort,
    private readonly maximumBytes: number,
    private readonly workerAvailable = true,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  list(sessionId: string) {
    const result = this.repository.list(sessionId);
    if (result.kind === "session-not-found")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_SESSION_NOT_FOUND",
        "The analysis session could not be found.",
      );
    return result.assets;
  }

  async upload(sessionId: string, metadataInput: unknown, bytes: Uint8Array) {
    const metadata = uploadAudioMetadataSchema.parse(metadataInput);
    if (
      metadata.byteSize !== bytes.byteLength ||
      !metadata.byteSize ||
      metadata.byteSize > this.maximumBytes
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_SIZE_INVALID",
        "The audio file is empty or exceeds the configured size limit.",
      );
    if (!isSupportedAudioType(metadata.originalFilename, metadata.mimeType))
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_TYPE_UNSUPPORTED",
        "This audio file type and extension are not supported.",
      );
    if (!isValidAudioSignature(metadata.mimeType, bytes))
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_CONTENT_INVALID",
        "The audio file content does not match its declared type.",
      );

    const assetId = this.createId();
    const stored = await this.storage.write({
      analysisSessionId: sessionId,
      assetId,
      extension: extensionOf(metadata.originalFilename),
      bytes,
    });
    try {
      const result = this.repository.create({
        id: assetId,
        analysisSessionId: sessionId,
        actionId: metadata.actionId,
        speakerRole: metadata.speakerRole,
        originalFilename: normalizeDisplayFilename(metadata.originalFilename),
        mimeType: metadata.mimeType,
        byteSize: metadata.byteSize,
        sha256: stored.sha256,
        relativePath: stored.relativePath,
      });
      if (result.kind !== "created")
        await this.storage.delete(stored.relativePath);
      if (result.kind === "session-not-found")
        throw new UploadedAudioError(
          "UPLOADED_AUDIO_SESSION_NOT_FOUND",
          "The analysis session could not be found.",
        );
      if (result.kind === "session-invalid")
        throw new UploadedAudioError(
          "UPLOADED_AUDIO_SESSION_INVALID",
          "The analysis session does not accept uploaded audio.",
        );
      if (result.kind === "session-deleting")
        throw new UploadedAudioError(
          "UPLOADED_AUDIO_DELETION_BUSY",
          "Uploaded audio cannot be added while the analysis session is being deleted.",
        );
      if (result.kind === "action-conflict")
        throw new UploadedAudioError(
          "UPLOADED_AUDIO_ACTION_DUPLICATE",
          "That action ID is already used by another uploaded-audio action.",
        );
      return {
        asset: result.asset ? publicAsset(result.asset) : null,
        duplicated: result.kind === "duplicate",
      } as const;
    } catch (error) {
      await this.storage.delete(stored.relativePath).catch(() => undefined);
      throw error;
    }
  }

  async transcribe(sessionId: string, assetId: string, input: unknown) {
    const { actionId } = uploadedAudioActionSchema.parse(input);
    if (!this.workerAvailable)
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_WORKER_UNAVAILABLE",
        "Uploaded-audio transcription processing is unavailable on this server.",
      );
    let result;
    try {
      result = this.jobQueue.enqueue({
        id: this.createId(),
        analysisSessionId: sessionId,
        assetId,
        actionId,
        maximumAttempts: 3,
        now: this.now(),
      });
    } catch {
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_TRANSCRIPTION_FAILED",
        "The transcription job could not be queued safely.",
      );
    }
    if (result.kind === "asset-not-found")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_NOT_FOUND",
        "The uploaded audio asset could not be found.",
      );
    if (result.kind === "session-not-found")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_SESSION_NOT_FOUND",
        "The analysis session could not be found.",
      );
    if (result.kind === "session-invalid")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_SESSION_INVALID",
        "The analysis session does not accept transcription.",
      );
    if (result.kind === "action-conflict")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_ACTION_DUPLICATE",
        "That action ID is already used by another uploaded-audio action.",
      );
    if (
      result.kind === "active-job-conflict" ||
      result.kind === "temporarily-unavailable"
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_TRANSCRIPTION_BUSY",
        "This audio asset already has queued or running transcription work.",
      );
    if (result.kind === "legacy-action")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_TRANSCRIPTION_LEGACY_ACTION",
        "That legacy transcription action has no job. Retry with a new action ID.",
      );
    if (result.kind === "asset-completed")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_TRANSCRIPTION_BUSY",
        "Completed audio cannot be transcribed again.",
      );
    if (result.kind === "asset-deleting" || result.kind === "session-deleting")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_DELETION_BUSY",
        "Uploaded audio cannot be transcribed while deletion is in progress.",
      );
    if (result.kind !== "created" && result.kind !== "duplicate")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_TRANSCRIPTION_FAILED",
        "The transcription job could not be queued safely.",
      );
    return {
      job: result.job,
      duplicated: result.kind === "duplicate",
      terminal:
        result.job.status === "completed" ||
        result.job.status === "failed" ||
        result.job.status === "cancelled",
    } as const;
  }

  async delete(sessionId: string, assetId: string, input: unknown) {
    const { actionId } = uploadedAudioActionSchema.parse(input);
    const batchId = this.createId();
    const fileId = this.createId();
    const beginning = this.repository.beginAssetDeletion({
      sessionId,
      assetId,
      actionId,
      batchId,
      fileId,
      tombstoneRelativePath: this.storage.createTombstoneRelativePath(
        sessionId,
        fileId,
      ),
    });
    if (beginning.kind === "session-not-found")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_SESSION_NOT_FOUND",
        "The analysis session could not be found.",
      );
    if (beginning.kind === "asset-not-found")
      return { deleted: false, duplicated: false } as const;
    if (beginning.kind === "transcription-active")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_DELETION_BUSY",
        "Audio deletion is unavailable while transcription is active.",
      );
    if (beginning.kind === "action-conflict")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_ACTION_DUPLICATE",
        "That action ID is already used by another uploaded-audio action.",
      );
    await this.executeDeletion(beginning.plan);
    return {
      deleted: true,
      duplicated: beginning.kind === "duplicate",
    } as const;
  }

  async deleteSession(sessionId: string) {
    const actionId = `session-delete:${sessionId}`;
    const assets = this.repository.listStoredForSession(sessionId);
    const files = assets.map((asset) => {
      const id = this.createId();
      return {
        id,
        assetId: asset.id,
        originalRelativePath: asset.relativePath,
        tombstoneRelativePath: this.storage.createTombstoneRelativePath(
          sessionId,
          id,
        ),
      };
    });
    const beginning = this.repository.beginSessionDeletion({
      sessionId,
      actionId,
      batchId: this.createId(),
      files,
    });
    if (beginning.kind === "session-not-found") return false;
    if (beginning.kind === "transcription-active")
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_DELETION_BUSY",
        "The analysis session cannot be deleted during transcription.",
      );
    if (
      beginning.kind === "action-conflict" ||
      beginning.kind === "asset-not-found"
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_DELETION_INCOMPLETE",
        "The analysis-session deletion plan could not be created safely.",
      );
    const wasIncomplete = beginning.plan.status !== "completed";
    await this.executeDeletion(beginning.plan);
    return beginning.kind === "ready" || wasIncomplete;
  }

  private async executeDeletion(
    initialPlan: import("./uploaded-audio-repository.port").UploadedAudioDeletionPlan,
  ) {
    let plan = initialPlan;
    if (plan.status === "completed") return;
    if (plan.status === "planned") {
      try {
        for (const file of plan.files)
          if (file.status === "planned")
            await this.storage.stageDelete(
              file.originalRelativePath,
              file.tombstoneRelativePath,
            );
      } catch {
        try {
          await this.rollbackPlannedDeletion(plan);
        } catch {
          this.recordDeletionErrorSafely(
            plan.id,
            null,
            "UPLOADED_AUDIO_DELETE_ROLLBACK_FAILED",
          );
          throw new UploadedAudioError(
            "UPLOADED_AUDIO_DELETION_INCOMPLETE",
            "Audio deletion rollback is incomplete but remains retryable.",
          );
        }
        this.recordDeletionErrorSafely(
          plan.id,
          null,
          "UPLOADED_AUDIO_DELETE_STAGE_FAILED",
        );
        throw new UploadedAudioError(
          "UPLOADED_AUDIO_DELETION_INCOMPLETE",
          "Audio deletion staging failed safely and remains retryable.",
        );
      }
      try {
        plan = this.repository.deleteAuthoritativeMetadata(plan.id);
      } catch (error) {
        try {
          await this.rollbackPlannedDeletion(plan);
        } catch {
          this.recordDeletionErrorSafely(
            plan.id,
            null,
            "UPLOADED_AUDIO_DELETE_ROLLBACK_FAILED",
          );
          throw new UploadedAudioError(
            "UPLOADED_AUDIO_DELETION_INCOMPLETE",
            "Audio deletion rollback is incomplete but remains retryable.",
          );
        }
        this.recordDeletionErrorSafely(
          plan.id,
          null,
          "UPLOADED_AUDIO_DELETE_DATABASE_FAILED",
        );
        throw error;
      }
    }
    let finalizationFailed = false;
    for (const file of plan.files) {
      if (file.status === "completed") continue;
      try {
        await this.storage.finalizeDelete(file.tombstoneRelativePath);
        plan = this.repository.markDeletionFileCompleted(plan.id, file.id);
      } catch {
        finalizationFailed = true;
        this.recordDeletionErrorSafely(
          plan.id,
          file.id,
          "UPLOADED_AUDIO_DELETE_FINALIZE_FAILED",
        );
      }
    }
    if (finalizationFailed)
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_DELETION_INCOMPLETE",
        "Audio deletion is incomplete but remains retryable.",
      );
    this.repository.completeDeletion(plan.id);
  }

  private async rollbackPlannedDeletion(
    plan: import("./uploaded-audio-repository.port").UploadedAudioDeletionPlan,
  ) {
    let rollbackError: unknown;
    for (const file of [...plan.files].reverse())
      try {
        await this.storage.rollbackDelete(
          file.originalRelativePath,
          file.tombstoneRelativePath,
        );
      } catch (error) {
        rollbackError ??= error;
      }
    if (rollbackError) throw rollbackError;
  }

  private recordDeletionErrorSafely(
    batchId: string,
    fileId: string | null,
    errorCode: string,
  ) {
    try {
      this.repository.recordDeletionError(batchId, fileId, errorCode);
    } catch {
      // The durable plan remains authoritative and can still be retried.
    }
  }
}
