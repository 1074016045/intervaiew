import "server-only";
import { and, eq } from "drizzle-orm";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import {
  interviewSessions,
  realtimeAttempts,
  recordingAssets,
} from "@/infrastructure/db/schema";
import { getDatabase } from "@/infrastructure/db/client";
import type { AppDatabase } from "./interview.repository";
import type { RecordingTrackRole } from "@/features/recording/domain/recording-asset";

export class RecordingRepository {
  constructor(private readonly db: AppDatabase = getDatabase().db) {}

  verifySessionAttempt(sessionId: string, attemptId: string) {
    const session = this.db
      .select({ id: interviewSessions.id })
      .from(interviewSessions)
      .where(eq(interviewSessions.id, sessionId))
      .get();
    const attempt = this.db
      .select({ id: realtimeAttempts.id })
      .from(realtimeAttempts)
      .where(
        and(
          eq(realtimeAttempts.id, attemptId),
          eq(realtimeAttempts.sessionId, sessionId),
        ),
      )
      .get();
    if (!session || !attempt)
      throw new InterviewDomainError(
        "REALTIME_ATTEMPT_NOT_FOUND",
        "The voice connection attempt could not be found.",
      );
  }

  create(input: {
    sessionId: string;
    realtimeAttemptId: string;
    trackRole: RecordingTrackRole;
    relativePath: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    durationMs: number | null;
    startOffsetMs: number;
  }) {
    const asset = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: new Date(),
    };
    this.db.insert(recordingAssets).values(asset).run();
    return asset;
  }

  list(sessionId: string) {
    return this.db
      .select()
      .from(recordingAssets)
      .where(eq(recordingAssets.sessionId, sessionId))
      .orderBy(recordingAssets.createdAt)
      .all();
  }

  get(sessionId: string, assetId: string) {
    return (
      this.db
        .select()
        .from(recordingAssets)
        .where(
          and(
            eq(recordingAssets.sessionId, sessionId),
            eq(recordingAssets.id, assetId),
          ),
        )
        .get() ?? null
    );
  }

  delete(sessionId: string, assetId: string) {
    return this.db
      .delete(recordingAssets)
      .where(
        and(
          eq(recordingAssets.sessionId, sessionId),
          eq(recordingAssets.id, assetId),
        ),
      )
      .run().changes;
  }
}
