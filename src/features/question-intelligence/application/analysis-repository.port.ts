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
}
