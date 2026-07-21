import "server-only";
import { and, eq } from "drizzle-orm";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import { realtimeAttempts } from "@/infrastructure/db/schema";
import { getDatabase } from "@/infrastructure/db/client";
import type { AppDatabase } from "./interview.repository";

export class RealtimeRepository {
  constructor(private readonly db: AppDatabase = getDatabase().db) {}

  createAttempt(input: {
    sessionId: string;
    provider: "openai" | "fake";
    model: string;
    voice: string;
  }) {
    const now = new Date();
    const attempt = {
      id: crypto.randomUUID(),
      ...input,
      status: "connecting" as const,
      recordingConsent: false,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(realtimeAttempts).values(attempt).run();
    return attempt;
  }

  listAttempts(sessionId: string) {
    return this.db
      .select()
      .from(realtimeAttempts)
      .where(eq(realtimeAttempts.sessionId, sessionId))
      .orderBy(realtimeAttempts.createdAt)
      .all();
  }

  markDisconnected(sessionId: string, attemptId: string) {
    const now = new Date();
    const result = this.db
      .update(realtimeAttempts)
      .set({ status: "disconnected", disconnectedAt: now, updatedAt: now })
      .where(
        and(
          eq(realtimeAttempts.sessionId, sessionId),
          eq(realtimeAttempts.id, attemptId),
        ),
      )
      .run();
    if (!result.changes)
      throw new InterviewDomainError(
        "REALTIME_ATTEMPT_NOT_FOUND",
        "The voice connection attempt could not be found.",
      );
  }
}
