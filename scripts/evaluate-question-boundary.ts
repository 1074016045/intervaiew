import { DeterministicQuestionBoundaryDetector } from "../src/features/question-intelligence/application/deterministic-question-boundary-detector";
import { HybridQuestionBoundaryDetector } from "../src/features/question-intelligence/application/hybrid-question-boundary-detector";
import { immutableCandidate } from "../src/features/question-intelligence/domain/question-boundary";
import { boundaryEvaluationFixtures } from "../src/features/question-intelligence/evaluation/boundary-fixtures";
import { FakeSemanticQuestionBoundaryProvider } from "../src/features/question-intelligence/infrastructure/fake/fake-semantic-question-boundary-provider";

async function main() {
  const deterministic = new DeterministicQuestionBoundaryDetector();
  const semantic = new FakeSemanticQuestionBoundaryProvider();
  let nextId = 0;
  const hybrid = new HybridQuestionBoundaryDetector(
    deterministic,
    semantic,
    { shortPauseMs: 500, mediumPauseMs: 1400, longPauseMs: 3000 },
    () => `evaluation-decision-${nextId++}`,
    () => 1_700_000_000_000,
  );

  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];

  for (const [index, fixture] of boundaryEvaluationFixtures.entries()) {
    let predicted = false;
    if (fixture.speakerRole === "interviewer" && fixture.text.trim()) {
      const candidate = immutableCandidate({
        id: `evaluation-candidate-${index}`,
        analysisSessionId: "evaluation-session",
        revision: 1,
        text: fixture.text,
        segmentIds: [`evaluation-segment-${index}`],
        firstSequence: index,
        lastSequence: index,
        speakerRole: "interviewer",
        startedAtMs: index * 1000,
        endedAtMs: index * 1000 + 500,
        pauseAfterMs: fixture.pauseAfterMs,
        status: "active",
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      });
      predicted = (await hybrid.evaluate(candidate)).shouldFinalize;
    }
    if (predicted && fixture.expectedFinalize) truePositive += 1;
    else if (!predicted && !fixture.expectedFinalize) trueNegative += 1;
    else if (predicted) {
      falsePositive += 1;
      falsePositives.push(fixture.id);
    } else {
      falseNegative += 1;
      falseNegatives.push(fixture.id);
    }
  }

  const total = boundaryEvaluationFixtures.length;
  const predictedFinalize = truePositive + falsePositive;
  const expectedFinalize = truePositive + falseNegative;
  const accuracy = (truePositive + trueNegative) / total;
  const precision = predictedFinalize ? truePositive / predictedFinalize : 0;
  const recall = expectedFinalize ? truePositive / expectedFinalize : 0;
  const f1 =
    precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const percentage = (value: number) => `${(value * 100).toFixed(2)}%`;

  console.log(`fixture count: ${total}`);
  console.log(`expected finalize: ${expectedFinalize}`);
  console.log(`predicted finalize: ${predictedFinalize}`);
  console.log(`accuracy: ${percentage(accuracy)}`);
  console.log(`precision: ${percentage(precision)}`);
  console.log(`recall: ${percentage(recall)}`);
  console.log(`F1: ${percentage(f1)}`);
  console.log(
    `false positives: ${falsePositive} [${falsePositives.join(", ")}]`,
  );
  console.log(
    `false negatives: ${falseNegative} [${falseNegatives.join(", ")}]`,
  );

  hybrid.dispose();
  if (falsePositive || falseNegative) process.exitCode = 1;
}

void main();
