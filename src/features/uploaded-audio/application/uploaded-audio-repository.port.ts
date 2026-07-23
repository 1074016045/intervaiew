import type {
  UploadedAudioAssetView,
  UploadedAudioDeletionScope,
  UploadedAudioDeletionStatus,
  UploadedAudioSpeakerRole,
  UploadedAudioStoredAsset,
} from "../domain/uploaded-audio";

export type CreateUploadedAudioResult =
  | Readonly<{ kind: "created"; asset: UploadedAudioStoredAsset }>
  | Readonly<{
      kind: "duplicate";
      asset: UploadedAudioStoredAsset | null;
    }>
  | Readonly<{ kind: "session-not-found" }>
  | Readonly<{ kind: "session-invalid" }>
  | Readonly<{ kind: "session-deleting" }>
  | Readonly<{ kind: "action-conflict" }>;

export type BeginTranscriptionResult =
  | Readonly<{ kind: "ready"; asset: UploadedAudioStoredAsset }>
  | Readonly<{
      kind: "duplicate" | "completed";
      asset: UploadedAudioStoredAsset;
    }>
  | Readonly<{ kind: "busy" }>
  | Readonly<{ kind: "asset-not-found" }>
  | Readonly<{ kind: "session-not-found" }>
  | Readonly<{ kind: "session-invalid" }>
  | Readonly<{ kind: "action-conflict" }>;

export type UploadedAudioDeletionFile = Readonly<{
  id: string;
  assetId: string;
  originalRelativePath: string;
  tombstoneRelativePath: string;
  status: UploadedAudioDeletionStatus;
  errorCode: string | null;
}>;

export type UploadedAudioDeletionPlan = Readonly<{
  id: string;
  analysisSessionId: string;
  actionId: string;
  scope: UploadedAudioDeletionScope;
  targetAssetId: string | null;
  status: UploadedAudioDeletionStatus;
  errorCode: string | null;
  files: ReadonlyArray<UploadedAudioDeletionFile>;
}>;

export type BeginDeletionResult =
  | Readonly<{
      kind: "ready" | "duplicate";
      plan: UploadedAudioDeletionPlan;
    }>
  | Readonly<{ kind: "asset-not-found" }>
  | Readonly<{ kind: "session-not-found" }>
  | Readonly<{ kind: "transcription-active" }>
  | Readonly<{ kind: "action-conflict" }>;

export interface UploadedAudioRepositoryPort {
  list(
    sessionId: string,
  ):
    | Readonly<{ kind: "found"; assets: ReadonlyArray<UploadedAudioAssetView> }>
    | Readonly<{ kind: "session-not-found" }>;
  get(sessionId: string, assetId: string): UploadedAudioStoredAsset | null;
  listStoredForSession(
    sessionId: string,
  ): ReadonlyArray<UploadedAudioStoredAsset>;
  create(
    input: Readonly<{
      id: string;
      analysisSessionId: string;
      actionId: string;
      speakerRole: UploadedAudioSpeakerRole;
      originalFilename: string;
      mimeType: string;
      byteSize: number;
      sha256: string;
      relativePath: string;
    }>,
  ): CreateUploadedAudioResult;
  beginTranscription(
    sessionId: string,
    assetId: string,
    actionId: string,
  ): BeginTranscriptionResult;
  failTranscription(
    input: Readonly<{
      sessionId: string;
      assetId: string;
      actionId: string;
      providerLabel: string;
      errorCode: string;
    }>,
  ): UploadedAudioStoredAsset;
  beginAssetDeletion(
    input: Readonly<{
      sessionId: string;
      assetId: string;
      actionId: string;
      batchId: string;
      fileId: string;
      tombstoneRelativePath: string;
    }>,
  ): BeginDeletionResult;
  beginSessionDeletion(
    input: Readonly<{
      sessionId: string;
      actionId: string;
      batchId: string;
      files: ReadonlyArray<
        Readonly<{
          id: string;
          assetId: string;
          originalRelativePath: string;
          tombstoneRelativePath: string;
        }>
      >;
    }>,
  ): BeginDeletionResult;
  getDeletionPlan(batchId: string): UploadedAudioDeletionPlan | null;
  deleteAuthoritativeMetadata(batchId: string): UploadedAudioDeletionPlan;
  markDeletionFileCompleted(
    batchId: string,
    fileId: string,
  ): UploadedAudioDeletionPlan;
  completeDeletion(batchId: string): UploadedAudioDeletionPlan;
  recordDeletionError(
    batchId: string,
    fileId: string | null,
    errorCode: string,
  ): void;
}
