import type { TranscriptSegmentView } from "../domain/analysis-session";
import {
  immutableCandidate,
  type QuestionCandidate,
} from "../domain/question-boundary";

export type CandidateBuilderInput = Readonly<{
  analysisSessionId: string;
  segments: ReadonlyArray<TranscriptSegmentView>;
  assignedSegmentIds: ReadonlySet<string>;
  previousCandidate: QuestionCandidate | null;
  now: number;
  createId: () => string;
}>;

export class QuestionCandidateBuilder {
  build(input: CandidateBuilderInput): QuestionCandidate | null {
    const eligible = [...input.segments]
      .filter(
        (segment) =>
          segment.analysisSessionId === input.analysisSessionId &&
          segment.speakerRole === "interviewer" &&
          !input.assignedSegmentIds.has(segment.id),
      )
      .sort((left, right) => left.sequence - right.sequence);
    const seen = new Set<string>();
    const segments = eligible.filter((segment) => {
      if (seen.has(segment.id)) return false;
      seen.add(segment.id);
      return true;
    });
    if (!segments.length) return null;

    const segmentIds = segments.map((segment) => segment.id);
    const previous = input.previousCandidate;
    const sameSegments =
      previous?.status === "active" &&
      previous.segmentIds.length === segmentIds.length &&
      previous.segmentIds.every((id, index) => id === segmentIds[index]);
    const first = segments[0];
    const last = segments[segments.length - 1];
    const createdAt =
      previous?.status === "active" ? previous.createdAt : input.now;
    return immutableCandidate({
      id: previous?.status === "active" ? previous.id : input.createId(),
      analysisSessionId: input.analysisSessionId,
      revision:
        sameSegments && previous
          ? previous.revision
          : (previous?.revision ?? 0) + 1,
      text: segments.map((segment) => segment.text.trim()).join(" "),
      segmentIds,
      firstSequence: first.sequence,
      lastSequence: last.sequence,
      speakerRole: "interviewer",
      startedAtMs: first.startMs,
      endedAtMs: last.endMs,
      pauseAfterMs: Math.max(0, Math.floor(input.now - last.createdAt)),
      status: "active",
      createdAt,
      updatedAt: input.now,
    });
  }
}
