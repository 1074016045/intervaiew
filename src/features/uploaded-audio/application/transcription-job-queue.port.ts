import type {
  PublicTranscriptionJobSummary,
  TranscriptionJobStatus,
  UploadedAudioSpeakerRole,
} from "../domain/uploaded-audio";

export type TranscriptionJob = Readonly<{
  id: string;
  analysisSessionId: string;
  assetId: string;
  actionId: string;
  status: TranscriptionJobStatus;
  attemptCount: number;
  maximumAttempts: number;
  availableAt: number;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  failedAt: number | null;
  cancelledAt: number | null;
  safeErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}>;

export type ClaimedTranscriptionJob = TranscriptionJob &
  Readonly<{
    status: "running";
    leaseToken: string;
    leaseExpiresAt: number;
    relativePath: string;
    mimeType: string;
    speakerRole: UploadedAudioSpeakerRole;
  }>;

export type EnqueueTranscriptionJobResult =
  | Readonly<{
      kind: "created" | "duplicate";
      job: PublicTranscriptionJobSummary;
    }>
  | Readonly<{ kind: "session-not-found" | "asset-not-found" }>
  | Readonly<{
      kind:
        | "session-invalid"
        | "session-deleting"
        | "asset-completed"
        | "asset-deleting"
        | "action-conflict"
        | "active-job-conflict"
        | "temporarily-unavailable"
        | "legacy-action";
    }>;

export type FinishTranscriptionJobResult =
  | Readonly<{ kind: "updated"; job: TranscriptionJob }>
  | Readonly<{ kind: "stale" | "not-found" }>;

export interface TranscriptionJobQueuePort {
  enqueue(input: Readonly<{
    id: string;
    analysisSessionId: string;
    assetId: string;
    actionId: string;
    maximumAttempts: number;
    now: number;
  }>): EnqueueTranscriptionJobResult;
  recoverExpired(input: Readonly<{ now: number; limit: number }>): number;
  claimNext(input: Readonly<{
    now: number;
    leaseToken: string;
    leaseDurationMs: number;
  }>): ClaimedTranscriptionJob | null;
  fail(input: Readonly<{
    jobId: string;
    leaseToken: string;
    now: number;
    safeErrorCode: string;
    retryAt: number | null;
  }>): FinishTranscriptionJobResult;
}
