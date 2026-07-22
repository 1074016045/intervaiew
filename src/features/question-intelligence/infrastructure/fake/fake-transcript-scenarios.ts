import type { TranscriptChunk } from "../../domain/transcript";

export type FakeTranscriptScenarioEvent =
  | Readonly<{ atMs: number; type: "transcript"; chunk: TranscriptChunk }>
  | Readonly<{
      atMs: number;
      type: "failure";
      code: string;
      message: string;
    }>;

function chunk(
  sessionId: string,
  runId: string,
  sequence: number,
  text: string,
  isFinal: boolean,
  startMs: number,
  endMs: number,
  createdAt: number,
): TranscriptChunk {
  return {
    providerChunkId: `fake-${runId}-${sequence}`,
    sourceSessionId: sessionId,
    sequence,
    speakerRole: "interviewer",
    text,
    isFinal,
    startMs,
    endMs,
    createdAt,
  };
}

export function createTranscriptLabScenario(input: {
  sessionId: string;
  runId: string;
  sequenceOffset: number;
  createdAt: number;
}): ReadonlyArray<FakeTranscriptScenarioEvent> {
  const { sessionId, runId, sequenceOffset, createdAt } = input;
  return Object.freeze([
    {
      atMs: 100,
      type: "transcript",
      chunk: chunk(
        sessionId,
        runId,
        sequenceOffset,
        "Tell me about",
        false,
        0,
        400,
        createdAt + 100,
      ),
    },
    {
      atMs: 250,
      type: "transcript",
      chunk: chunk(
        sessionId,
        runId,
        sequenceOffset,
        "Tell me about a project",
        false,
        0,
        850,
        createdAt + 250,
      ),
    },
    {
      atMs: 450,
      type: "transcript",
      chunk: chunk(
        sessionId,
        runId,
        sequenceOffset,
        "Tell me about a project you are proud of.",
        true,
        0,
        1_600,
        createdAt + 450,
      ),
    },
    {
      atMs: 1_500,
      type: "transcript",
      chunk: chunk(
        sessionId,
        runId,
        sequenceOffset + 1,
        "What was your",
        false,
        1_700,
        2_100,
        createdAt + 1_500,
      ),
    },
    {
      atMs: 2_400,
      type: "transcript",
      chunk: chunk(
        sessionId,
        runId,
        sequenceOffset + 1,
        "What was your specific contribution?",
        true,
        1_700,
        2_900,
        createdAt + 2_400,
      ),
    },
    {
      atMs: 2_700,
      type: "transcript",
      chunk: chunk(
        sessionId,
        runId,
        sequenceOffset + 2,
        "This trailing interim stays local",
        false,
        3_000,
        3_400,
        createdAt + 2_700,
      ),
    },
  ] satisfies ReadonlyArray<FakeTranscriptScenarioEvent>);
}

export function createTranscriptUnitScenario(input: {
  sessionId: string;
  createdAt: number;
}): ReadonlyArray<FakeTranscriptScenarioEvent> {
  const first = chunk(
    input.sessionId,
    "unit",
    0,
    "First final",
    true,
    0,
    100,
    input.createdAt + 20,
  );
  return Object.freeze([
    { atMs: 20, type: "transcript", chunk: first },
    { atMs: 30, type: "transcript", chunk: first },
    {
      atMs: 40,
      type: "transcript",
      chunk: {
        ...first,
        providerChunkId: "fake-unit-sequence-conflict",
        text: "Conflicting final",
        createdAt: input.createdAt + 40,
      },
    },
    {
      atMs: 50,
      type: "transcript",
      chunk: {
        ...first,
        providerChunkId: "fake-unit-out-of-order",
        sequence: 2,
        text: "Out of order final",
        createdAt: input.createdAt + 50,
      },
    },
    {
      atMs: 55,
      type: "transcript",
      chunk: {
        ...first,
        providerChunkId: "fake-unit-late-sequence",
        sequence: 1,
        text: "Late final after sequence two",
        createdAt: input.createdAt + 55,
      },
    },
    {
      atMs: 60,
      type: "failure",
      code: "FAKE_TRANSCRIPT_FAILURE",
      message: "The fake transcript stream failed safely.",
    },
  ] satisfies ReadonlyArray<FakeTranscriptScenarioEvent>);
}
