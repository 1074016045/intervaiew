import { describe, expect, it } from "vitest";
import { DeterministicQuestionUnderstander } from "@/features/question-intelligence/application/deterministic-question-understander";
import { HybridQuestionUnderstander } from "@/features/question-intelligence/application/hybrid-question-understander";
import { questionUnderstandingAnalysisSchema, questionUnderstandingSchema, validateUnderstandingTraceability } from "@/features/question-intelligence/domain/question-understanding";
import { FakeQuestionUnderstandingProvider } from "@/features/question-intelligence/infrastructure/fake/fake-question-understanding-provider";

const deterministic = new DeterministicQuestionUnderstander();
const validAnalysis = { language: "en", questionFamily: "behavioral", expectedAnswerMode: "narrative", requestedDimensions: ["context", "actions"], explicitConstraints: [], focusTerms: [], requiresClarification: false, clarificationReasons: ["none"], confidence: .9, decidedBy: "deterministic", semanticProviderUsed: false, status: "completed" } as const;

describe("Question Understanding schemas", () => {
  it("rejects unknown analysis fields", () => expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, answer: "forbidden" })).toThrow());
  it("rejects unknown identity fields", () => expect(() => questionUnderstandingSchema.parse({ ...validAnalysis, id: "u", analysisSessionId: "s", finalizedQuestionId: "q", finalizedQuestionRevision: 1, sourceBoundaryDecisionId: "d", understandingRevision: 1, createdAt: 1, updatedAt: 1, reasoning: "hidden" })).toThrow());
  it("rejects duplicate dimensions", () => expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, requestedDimensions: ["context", "context"] })).toThrow(/unique/u));
  it("requires contiguous child sequences", () => expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, explicitConstraints: [{ kind: "count", value: "three", sourceText: "three", sequence: 2 }] })).toThrow(/contiguous/u));
  it("enforces false clarification invariants", () => expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, clarificationReasons: ["ambiguous_subject"] })).toThrow());
  it("enforces true clarification invariants", () => expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, requiresClarification: true, clarificationReasons: ["none"] })).toThrow());
  it("rejects non-finite and out-of-range confidence", () => {
    expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, confidence: Number.NaN })).toThrow();
    expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, confidence: 1.01 })).toThrow();
  });
  it.each([
    ["deterministic", false],
    ["fake_semantic", true],
    ["hybrid", true],
  ] as const)("accepts decidedBy=%s with semanticProviderUsed=%s", (decidedBy, semanticProviderUsed) => {
    expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, decidedBy, semanticProviderUsed })).not.toThrow();
  });
  it.each([
    ["deterministic", true],
    ["fake_semantic", false],
    ["hybrid", false],
  ] as const)("rejects decidedBy=%s with semanticProviderUsed=%s", (decidedBy, semanticProviderUsed) => {
    expect(() => questionUnderstandingAnalysisSchema.parse({ ...validAnalysis, decidedBy, semanticProviderUsed })).toThrow(/decision source/u);
  });
  it("validates source traceability", () => expect(() => validateUnderstandingTraceability("using Python", { explicitConstraints: [{ sourceText: "Java" }], focusTerms: [] })).toThrow(/SOURCE_MISMATCH/u));
});

describe("DeterministicQuestionUnderstander", () => {
  it.each([
    ["Tell me about a time you failed and recovered.", "behavioral", "en"],
    ["介绍一个项目并说明你的职责。", "project_experience", "zh"],
    ["Explain how caching works.", "technical_concept", "en"],
    ["设计一个可扩展且安全的系统。", "system_design", "zh"],
    ["使用 Python 实现一个算法。", "coding", "mixed"],
    ["计算概率并说明假设。", "quantitative", "zh"],
  ] as const)("classifies %s", (text, family, language) => expect(deterministic.analyze(text)).toMatchObject({ questionFamily: family, language }));

  it("orders and deduplicates dimensions by the closed vocabulary", () => {
    const result = deterministic.analyze("Tell me about a time with impact, actions, impact, and testing.");
    expect(result.requestedDimensions).toEqual(["context", "challenge", "actions", "outcome", "impact", "lessons", "testing"]);
  });
  it("extracts ordered traceable constraints and focus terms", () => {
    const text = "In two minutes, give me three reasons using Python.";
    const result = deterministic.analyze(text);
    expect(result.explicitConstraints.map((item) => item.kind)).toEqual(["time_limit", "count", "technology"]);
    expect(result.focusTerms).toMatchObject([{ normalized: "python", sourceText: "Python", sequence: 1 }]);
    validateUnderstandingTraceability(text, result);
  });
  it("detects multiple questions and unclear references", () => {
    expect(deterministic.analyze("Explain caching? Then design a cache?")).toMatchObject({ expectedAnswerMode: "mixed", requiresClarification: true, clarificationReasons: ["multiple_questions"] });
    expect(deterministic.analyze("What about that?").clarificationReasons).toContain("unclear_reference");
  });
});

describe("HybridQuestionUnderstander", () => {
  it("bypasses fake semantic for high confidence", async () => {
    const fake = new FakeQuestionUnderstandingProvider();
    const result = await new HybridQuestionUnderstander(deterministic, fake).analyze("Implement an algorithm using Python.");
    expect(result.semanticProviderUsed).toBe(false); expect(fake.callCount).toBe(0);
  });
  it("uses fake semantic for a gray zone", async () => {
    const fake = new FakeQuestionUnderstandingProvider();
    const result = await new HybridQuestionUnderstander(deterministic, fake).analyze("How are you today?");
    expect(result).toMatchObject({ decidedBy: "fake_semantic", semanticProviderUsed: true }); expect(fake.callCount).toBe(1);
  });
  it("returns a bounded deterministic hybrid fallback", async () => {
    const fake = new FakeQuestionUnderstandingProvider({ fail: true });
    const result = await new HybridQuestionUnderstander(deterministic, fake).analyze("How are you today?");
    expect(result).toMatchObject({ decidedBy: "hybrid", semanticProviderUsed: true, status: "completed" }); expect(result.confidence).toBeLessThanOrEqual(.65);
  });
});
