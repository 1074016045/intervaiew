import { z } from "zod";

export const transcriptSpeakerRoles = [
  "interviewer",
  "candidate",
  "unknown",
] as const;

export type TranscriptSpeakerRole = (typeof transcriptSpeakerRoles)[number];

export const transcriptStreamStates = [
  "idle",
  "starting",
  "streaming",
  "paused",
  "stopped",
  "failed",
] as const;

export type TranscriptStreamState = (typeof transcriptStreamStates)[number];

const epochMillisecondsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(8_640_000_000_000_000);

export const transcriptChunkSchema = z
  .object({
    providerChunkId: z.string().trim().min(1).max(200),
    sourceSessionId: z.string().trim().min(1).max(200),
    sequence: z.number().int().nonnegative(),
    speakerRole: z.enum(transcriptSpeakerRoles),
    text: z.string().trim().min(1).max(20_000),
    isFinal: z.boolean(),
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().nonnegative(),
    createdAt: epochMillisecondsSchema,
  })
  .strict()
  .refine((value) => value.endMs >= value.startMs, {
    message: "endMs must be greater than or equal to startMs.",
    path: ["endMs"],
  });

export type TranscriptChunk = z.infer<typeof transcriptChunkSchema>;

export type TranscriptBufferSnapshot = Readonly<{
  finalizedText: string;
  interimText: string;
  recentFinalChunks: ReadonlyArray<Readonly<TranscriptChunk>>;
  lastActivityAt: number | null;
  latestSequence: number | null;
  state: TranscriptStreamState;
}>;

export function immutableTranscriptChunk(
  chunk: TranscriptChunk,
): Readonly<TranscriptChunk> {
  return Object.freeze({ ...chunk });
}
