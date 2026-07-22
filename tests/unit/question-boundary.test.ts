import { describe, expect, it } from "vitest";
import { DeterministicQuestionBoundaryDetector } from "@/features/question-intelligence/application/deterministic-question-boundary-detector";
import { HybridQuestionBoundaryDetector } from "@/features/question-intelligence/application/hybrid-question-boundary-detector";
import { QuestionCandidateBuilder } from "@/features/question-intelligence/application/question-candidate-builder";
import {
  boundaryDecisionSchema,
  immutableCandidate,
  questionBoundaryPauseConfigSchema,
  questionCandidateSchema,
} from "@/features/question-intelligence/domain/question-boundary";
import type { TranscriptSegmentView } from "@/features/question-intelligence/domain/analysis-session";
import { FakeSemanticQuestionBoundaryProvider } from "@/features/question-intelligence/infrastructure/fake/fake-semantic-question-boundary-provider";

const pause = { shortPauseMs: 500, mediumPauseMs: 1400, longPauseMs: 3000 };
let id = 0;

function candidate(
  text: string,
  pauseAfterMs = 700,
  revision = 1,
  candidateId = "candidate-1",
) {
  return immutableCandidate({
    id: candidateId,
    analysisSessionId: "session-1",
    revision,
    text,
    segmentIds: [`segment-${revision}`],
    firstSequence: revision - 1,
    lastSequence: revision - 1,
    speakerRole: "interviewer",
    startedAtMs: 0,
    endedAtMs: 100,
    pauseAfterMs,
    status: "active",
    createdAt: 1000,
    updatedAt: 1000,
  });
}

function hybrid(provider = new FakeSemanticQuestionBoundaryProvider()) {
  return new HybridQuestionBoundaryDetector(
    new DeterministicQuestionBoundaryDetector(),
    provider,
    pause,
    () => `decision-${id++}`,
    () => 2000,
  );
}

function segment(
  sequence: number,
  text: string,
  speakerRole: TranscriptSegmentView["speakerRole"] = "interviewer",
): TranscriptSegmentView {
  return Object.freeze({
    id: `segment-${sequence}`,
    analysisSessionId: "session-1",
    providerSegmentId: `provider-${sequence}`,
    sequence,
    speakerRole,
    text,
    startMs: sequence * 100,
    endMs: sequence * 100 + 50,
    createdAt: 1000 + sequence * 100,
  });
}

describe("DeterministicQuestionBoundaryDetector", () => {
  const detector = new DeterministicQuestionBoundaryDetector();

  it("recognizes a complete Chinese question without a question mark", () => {
    expect(
      detector.detect(candidate("你为什么选择数据科学")).classification,
    ).toBe("complete");
  });

  it("recognizes a complete spoken English question without a question mark", () => {
    expect(
      detector.detect(candidate("Tell me about a project you are proud of"))
        .classification,
    ).toBe("complete");
  });

  it("rejects a Chinese connector ending", () => {
    expect(
      detector.detect(candidate("请介绍你的项目，以及")).classification,
    ).toBe("incomplete");
  });

  it("rejects an English connector ending", () => {
    expect(
      detector.detect(candidate("Tell me about your project and"))
        .classification,
    ).toBe("incomplete");
  });

  it("does not let a question mark override an incomplete ending", () => {
    expect(
      detector.detect(candidate("Tell me about and?")).classification,
    ).toBe("incomplete");
  });

  it("recognizes task-style short questions", () => {
    expect(detector.detect(candidate("Design a cache")).classification).toBe(
      "complete",
    );
  });

  it("recognizes Chinese task-style questions", () => {
    expect(
      detector.detect(candidate("请估算伦敦每天的咖啡销量")).classification,
    ).toBe("complete");
  });

  it("marks punctuation-only text invalid", () => {
    expect(detector.detect(candidate("？？？")).validContent).toBe(false);
  });

  it("marks connector-only text invalid", () => {
    expect(detector.detect(candidate("For example")).validContent).toBe(false);
  });

  it("returns immutable signals", () => {
    const result = detector.detect(candidate("Why this role"));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.signals)).toBe(true);
  });
});

describe("HybridQuestionBoundaryDetector", () => {
  it("waits on a short pause without semantic work", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider();
    const decision = await hybrid(provider).evaluate(
      candidate("Why this role", 200),
    );
    expect(decision.reasonCode).toBe("short_pause");
    expect(provider.callCount).toBe(0);
  });

  it("uses semantic for a medium-pause gray zone", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider();
    const decision = await hybrid(provider).evaluate(
      candidate("Your approach to production incidents", 1600),
    );
    expect(decision.semanticProviderUsed).toBe(true);
    expect(provider.callCount).toBe(1);
  });

  it("does not use semantic for high-confidence complete text", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider();
    expect(
      (await hybrid(provider).evaluate(candidate("Why this role", 1600)))
        .shouldFinalize,
    ).toBe(true);
    expect(provider.callCount).toBe(0);
  });

  it("does not use semantic for high-confidence incomplete text", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider();
    expect(
      (await hybrid(provider).evaluate(candidate("Tell me more and", 1600)))
        .shouldFinalize,
    ).toBe(false);
    expect(provider.callCount).toBe(0);
  });

  it("forces valid content at a long pause", async () => {
    expect(
      (
        await hybrid().evaluate(
          candidate("A detailed production incident response", 3000),
        )
      ).reasonCode,
    ).toBe("long_pause_forced");
  });

  it("does not force a pure connector at a long pause", async () => {
    expect(
      (await hybrid().evaluate(candidate("然后", 4000))).shouldFinalize,
    ).toBe(false);
  });

  it("accepts a semantic complete result", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider({
      decide: () => ({
        complete: true,
        confidence: 0.81,
        reasonCode: "medium_pause_semantic_complete",
        normalizedQuestion: "A production incident response?",
      }),
    });
    expect(
      (
        await hybrid(provider).evaluate(
          candidate("A production incident response", 1600),
        )
      ).shouldFinalize,
    ).toBe(true);
  });

  it("accepts a semantic incomplete result", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider({
      decide: () => ({
        complete: false,
        confidence: 0.72,
        reasonCode: "medium_pause_semantic_incomplete",
        normalizedQuestion: null,
      }),
    });
    expect(
      (
        await hybrid(provider).evaluate(
          candidate("A production incident response", 1600),
        )
      ).shouldFinalize,
    ).toBe(false);
  });

  it("falls back to waiting after semantic failure", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider({ fail: true });
    expect(
      (
        await hybrid(provider).evaluate(
          candidate("A production incident response", 1600),
        )
      ).reasonCode,
    ).toBe("semantic_failed_fallback_wait");
  });

  it("falls back to finalize near the long threshold", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider({ fail: true });
    expect(
      (
        await hybrid(provider).evaluate(
          candidate("A production incident response", 2700),
        )
      ).reasonCode,
    ).toBe("semantic_failed_fallback_finalize");
  });

  it("supersedes a stale semantic response when revision changes", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider({ delayMs: 20 });
    const detector = hybrid(provider);
    const stale = detector.evaluate(
      candidate("A production response plan", 1600, 1),
    );
    const current = detector.evaluate(
      candidate("A production response plan updated", 1600, 2),
    );
    expect((await stale).reasonCode).toBe("stale_revision");
    expect((await current).candidateRevision).toBe(2);
  });

  it("cleans up by aborting pending semantic work on dispose", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider({ delayMs: 50 });
    const detector = hybrid(provider);
    const pending = detector.evaluate(
      candidate("A production response plan", 1600),
    );
    detector.dispose();
    expect((await pending).status).toBe("superseded");
  });

  it("caches semantic work for one candidate revision", async () => {
    const provider = new FakeSemanticQuestionBoundaryProvider();
    const detector = hybrid(provider);
    const value = candidate("A production response plan", 1600);
    await detector.evaluate(value);
    await detector.evaluate(value);
    expect(provider.callCount).toBe(1);
  });
});

describe("QuestionCandidateBuilder and boundary schemas", () => {
  const builder = new QuestionCandidateBuilder();
  const build = (
    segments: ReadonlyArray<TranscriptSegmentView>,
    previousCandidate: ReturnType<typeof candidate> | null = null,
  ) =>
    builder.build({
      analysisSessionId: "session-1",
      segments,
      assignedSegmentIds: new Set(),
      previousCandidate,
      now: 2000,
      createId: () => "built-candidate",
    });

  it("increments revision when a final segment arrives", () => {
    const first = build([segment(0, "Tell me about")]);
    const second = build(
      [segment(0, "Tell me about"), segment(1, "your project")],
      first,
    );
    expect(second).toMatchObject({ id: first?.id, revision: 2 });
  });

  it("deduplicates repeated segment ids", () => {
    expect(
      build([segment(0, "Why this role"), segment(0, "Why this role")])
        ?.segmentIds,
    ).toEqual(["segment-0"]);
  });

  it("excludes candidate-role segments", () => {
    expect(build([segment(0, "Candidate answer", "candidate")])).toBeNull();
  });

  it("excludes unknown-role segments", () => {
    expect(build([segment(0, "Unknown speech", "unknown")])).toBeNull();
  });

  it("orders final segments by sequence", () => {
    expect(
      build([segment(2, "third"), segment(0, "first"), segment(1, "second")])
        ?.text,
    ).toBe("first second third");
  });

  it("preserves source segment traceability", () => {
    expect(build([segment(1, "one"), segment(2, "two")])?.segmentIds).toEqual([
      "segment-1",
      "segment-2",
    ]);
  });

  it("does not reopen assigned segments", () => {
    expect(
      builder.build({
        analysisSessionId: "session-1",
        segments: [segment(0, "first"), segment(1, "second")],
        assignedSegmentIds: new Set(["segment-0"]),
        previousCandidate: null,
        now: 2000,
        createId: () => "built-candidate",
      })?.text,
    ).toBe("second");
  });

  it("returns deeply immutable candidate arrays", () => {
    const built = build([segment(0, "Why this role")]);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built?.segmentIds)).toBe(true);
  });

  it("rejects invalid confidence", () => {
    expect(() =>
      boundaryDecisionSchema.parse({
        id: "d",
        analysisSessionId: "s",
        candidateId: "c",
        candidateRevision: 1,
        status: "waiting",
        shouldFinalize: false,
        confidence: 1.1,
        reasonCode: "short_pause",
        decidedBy: "deterministic",
        semanticProviderUsed: false,
        actionId: null,
        createdAt: 1,
      }),
    ).toThrow();
  });

  it("rejects invalid pause configuration", () => {
    expect(() =>
      questionBoundaryPauseConfigSchema.parse({
        shortPauseMs: 1400,
        mediumPauseMs: 500,
        longPauseMs: 3000,
      }),
    ).toThrow();
  });

  it("rejects duplicate candidate segment ids", () => {
    expect(() =>
      questionCandidateSchema.parse({
        ...candidate("Why this role"),
        segmentIds: ["same", "same"],
      }),
    ).toThrow();
  });
});
