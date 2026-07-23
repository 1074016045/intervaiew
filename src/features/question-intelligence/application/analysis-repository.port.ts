import type {
  AnalysisSessionDetailView,
  AnalysisSessionMode,
  AnalysisSessionStatus,
  AnalysisSessionView,
  TranscriptSegmentView,
} from "../domain/analysis-session";
import type { TranscriptChunk } from "../domain/transcript";

export type IngestFinalResult =
  | Readonly<{ kind: "created"; segment: TranscriptSegmentView }>
  | Readonly<{ kind: "duplicate"; segment: TranscriptSegmentView }>
  | Readonly<{ kind: "sequence-conflict" }>
  | Readonly<{ kind: "session-not-found" }>
  | Readonly<{ kind: "session-state-invalid" }>;

export type UpdateAnalysisSessionResult =
  | Readonly<{ kind: "updated"; session: AnalysisSessionView }>
  | Readonly<{ kind: "session-not-found" }>
  | Readonly<{ kind: "session-state-invalid" }>;

export type IngestUploadedFinalsResult =
  | Readonly<{
      kind: "created" | "duplicate";
      segments: ReadonlyArray<TranscriptSegmentView>;
    }>
  | Readonly<{ kind: "session-not-found" }>
  | Readonly<{ kind: "session-state-invalid" }>
  | Readonly<{ kind: "asset-not-found" }>
  | Readonly<{ kind: "asset-state-invalid" }>
  | Readonly<{ kind: "action-invalid" }>;

export interface AnalysisRepositoryPort {
  createSession(input: {
    title: string;
    mode: AnalysisSessionMode;
  }): AnalysisSessionView;
  getSession(id: string): AnalysisSessionDetailView | null;
  deleteSession(id: string): boolean;
  updateSessionStatus(
    id: string,
    status: AnalysisSessionStatus,
  ): UpdateAnalysisSessionResult;
  ingestFinalChunk(
    sessionId: string,
    chunk: TranscriptChunk,
  ): IngestFinalResult;
  ingestUploadedFinals(
    input: Readonly<{
      sessionId: string;
      assetId: string;
      actionId: string;
      providerLabel: string;
      speakerRole: "interviewer" | "candidate";
      chunks: ReadonlyArray<
        Readonly<{ text: string; startMs: number; endMs: number }>
      >;
      createdAt: number;
    }>,
  ): IngestUploadedFinalsResult;
}
