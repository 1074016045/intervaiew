import { z } from "zod";

export const analysisSessionModes = [
  "transcript_lab",
  "uploaded_audio",
  "microphone",
  "shared_audio",
] as const;
export type AnalysisSessionMode = (typeof analysisSessionModes)[number];

export const analysisSessionStatuses = [
  "draft",
  "active",
  "paused",
  "completed",
  "cancelled",
  "failed",
] as const;
export type AnalysisSessionStatus = (typeof analysisSessionStatuses)[number];

export const createAnalysisSessionSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    mode: z.literal("transcript_lab"),
  })
  .strict();

export const updateAnalysisSessionStatusSchema = z
  .object({ status: z.enum(analysisSessionStatuses) })
  .strict();

export type AnalysisSessionView = Readonly<{
  id: string;
  title: string;
  mode: AnalysisSessionMode;
  status: AnalysisSessionStatus;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}>;

export type TranscriptSegmentView = Readonly<{
  id: string;
  analysisSessionId: string;
  providerSegmentId: string;
  sequence: number;
  speakerRole: "interviewer" | "candidate" | "unknown";
  text: string;
  startMs: number;
  endMs: number;
  createdAt: number;
}>;

export type AnalysisSessionDetailView = Readonly<{
  session: AnalysisSessionView;
  segments: ReadonlyArray<TranscriptSegmentView>;
}>;
