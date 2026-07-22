import { DeterministicQuestionUnderstander } from "../src/features/question-intelligence/application/deterministic-question-understander";
import { HybridQuestionUnderstander } from "../src/features/question-intelligence/application/hybrid-question-understander";
import { questionUnderstandingFixtures } from "../src/features/question-intelligence/evaluation/question-understanding-fixtures";
import { FakeQuestionUnderstandingProvider } from "../src/features/question-intelligence/infrastructure/fake/fake-question-understanding-provider";

async function main() {
  const fake = new FakeQuestionUnderstandingProvider();
  const hybrid = new HybridQuestionUnderstander(new DeterministicQuestionUnderstander(), fake);
  let familyCorrect = 0, modeCorrect = 0, clarificationCorrect = 0, tp = 0, fp = 0, fn = 0;
  const mismatches: string[] = [];
  for (const fixture of questionUnderstandingFixtures) {
    const result = await hybrid.analyze(fixture.text);
    const mismatch: string[] = [];
    if (result.questionFamily === fixture.expectedFamily) familyCorrect += 1; else mismatch.push("family");
    if (result.expectedAnswerMode === fixture.expectedMode) modeCorrect += 1; else mismatch.push("mode");
    if (result.requiresClarification === fixture.expectedClarification) clarificationCorrect += 1; else mismatch.push("clarification");
    const expected = new Set(fixture.expectedDimensions), actual = new Set(result.requestedDimensions);
    for (const dimension of actual) {
      if (expected.has(dimension)) tp += 1;
      else fp += 1;
    }
    for (const dimension of expected) if (!actual.has(dimension)) fn += 1;
    if (mismatch.length) mismatches.push(`${fixture.id}(${mismatch.join("+")})`);
  }
  const total = questionUnderstandingFixtures.length;
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
  console.log(`fixture count: ${total}`);
  console.log(`family accuracy: ${pct(familyCorrect / total)}`);
  console.log(`answer-mode accuracy: ${pct(modeCorrect / total)}`);
  console.log(`dimension micro precision: ${pct(precision)}`);
  console.log(`dimension micro recall: ${pct(recall)}`);
  console.log(`dimension micro F1: ${pct(f1)}`);
  console.log(`clarification accuracy: ${pct(clarificationCorrect / total)}`);
  console.log(`semantic-provider usage count: ${fake.callCount}`);
  console.log(`mismatched fixture IDs: [${mismatches.join(", ")}]`);
}
void main();
