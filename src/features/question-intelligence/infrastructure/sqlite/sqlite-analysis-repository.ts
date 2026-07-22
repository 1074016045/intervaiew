import "server-only";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  AnalysisRepositoryPort,
  IngestFinalResult,
  UpdateAnalysisSessionResult,
} from "../../application/analysis-repository.port";
import type {
  AnalysisSessionMode,
  AnalysisSessionStatus,
  AnalysisSessionView,
  TranscriptSegmentView,
} from "../../domain/analysis-session";
import type { TranscriptChunk } from "../../domain/transcript";
import { getDatabase } from "@/infrastructure/db/client";
import {
  analysisSessions,
  schema,
  transcriptSegments,
} from "@/infrastructure/db/schema";

type AnalysisDatabase = BetterSQLite3Database<typeof schema>;

const allowedTransitions: Readonly<
  Record<AnalysisSessionStatus, ReadonlySet<AnalysisSessionStatus>>
> = {
  draft: new Set(["active", "cancelled"]),
  active: new Set(["paused", "completed", "cancelled", "failed"]),
  paused: new Set(["active", "completed", "cancelled", "failed"]),
  completed: new Set(["active"]),
  cancelled: new Set(),
  failed: new Set(["active"]),
};

export class SqliteAnalysisRepository implements AnalysisRepositoryPort {
  constructor(
    private readonly db: AnalysisDatabase = getDatabase().db,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  createSession(input: { title: string; mode: AnalysisSessionMode }) {
    return this.db.transaction((tx) => {
      const now = this.now();
      const session = {
        id: this.createId(),
        title: input.title,
        mode: input.mode,
        status: "draft" as const,
        startedAt: null,
        endedAt: null,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };
      tx.insert(analysisSessions).values(session).run();
      return this.sessionView(session);
    });
  }

  getSession(id: string) {
    const session = this.db
      .select()
      .from(analysisSessions)
      .where(eq(analysisSessions.id, id))
      .get();
    if (!session) return null;
    const segments = this.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.analysisSessionId, id))
      .orderBy(transcriptSegments.sequence)
      .all()
      .map((segment) => this.segmentView(segment));
    return Object.freeze({
      session: this.sessionView(session),
      segments: Object.freeze(segments),
    });
  }

  deleteSession(id: string) {
    return this.db.transaction((tx) => {
      const existing = tx
        .select({ id: analysisSessions.id })
        .from(analysisSessions)
        .where(eq(analysisSessions.id, id))
        .get();
      if (!existing) return false;
      tx.delete(analysisSessions).where(eq(analysisSessions.id, id)).run();
      return true;
    });
  }

  updateSessionStatus(
    id: string,
    status: AnalysisSessionStatus,
  ): UpdateAnalysisSessionResult {
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(analysisSessions)
        .where(eq(analysisSessions.id, id))
        .get();
      if (!existing) return { kind: "session-not-found" } as const;
      if (
        existing.status !== status &&
        !allowedTransitions[existing.status].has(status)
      )
        return { kind: "session-state-invalid" } as const;
      const now = new Date(this.now());
      tx.update(analysisSessions)
        .set({
          status,
          startedAt:
            status === "active"
              ? (existing.startedAt ?? now)
              : existing.startedAt,
          endedAt:
            status === "completed" ||
            status === "cancelled" ||
            status === "failed"
              ? now
              : status === "active"
                ? null
                : existing.endedAt,
          updatedAt: now,
        })
        .where(eq(analysisSessions.id, id))
        .run();
      const updated = tx
        .select()
        .from(analysisSessions)
        .where(eq(analysisSessions.id, id))
        .get();
      if (!updated) return { kind: "session-not-found" } as const;
      return { kind: "updated", session: this.sessionView(updated) } as const;
    });
  }

  ingestFinalChunk(
    sessionId: string,
    chunk: TranscriptChunk,
  ): IngestFinalResult {
    return this.db.transaction((tx) => {
      const session = tx
        .select()
        .from(analysisSessions)
        .where(eq(analysisSessions.id, sessionId))
        .get();
      if (!session) return { kind: "session-not-found" } as const;
      const duplicate = tx
        .select()
        .from(transcriptSegments)
        .where(
          and(
            eq(transcriptSegments.analysisSessionId, sessionId),
            eq(transcriptSegments.providerSegmentId, chunk.providerChunkId),
          ),
        )
        .get();
      if (duplicate)
        return {
          kind: "duplicate",
          segment: this.segmentView(duplicate),
        } as const;
      if (
        session.status !== "draft" &&
        session.status !== "active" &&
        session.status !== "paused"
      )
        return { kind: "session-state-invalid" } as const;
      const sequenceConflict = tx
        .select({ id: transcriptSegments.id })
        .from(transcriptSegments)
        .where(
          and(
            eq(transcriptSegments.analysisSessionId, sessionId),
            eq(transcriptSegments.sequence, chunk.sequence),
          ),
        )
        .get();
      if (sequenceConflict) return { kind: "sequence-conflict" } as const;
      const segment = {
        id: this.createId(),
        analysisSessionId: sessionId,
        providerSegmentId: chunk.providerChunkId,
        sequence: chunk.sequence,
        speakerRole: chunk.speakerRole,
        text: chunk.text,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        createdAt: new Date(chunk.createdAt),
      };
      tx.insert(transcriptSegments).values(segment).run();
      if (session.status === "draft") {
        const now = new Date(this.now());
        tx.update(analysisSessions)
          .set({
            status: "active",
            startedAt: session.startedAt ?? now,
            updatedAt: now,
          })
          .where(eq(analysisSessions.id, sessionId))
          .run();
      }
      return {
        kind: "created",
        segment: this.segmentView(segment),
      } as const;
    });
  }

  private sessionView(session: typeof analysisSessions.$inferSelect) {
    return Object.freeze({
      id: session.id,
      title: session.title,
      mode: session.mode,
      status: session.status,
      startedAt: session.startedAt?.getTime() ?? null,
      endedAt: session.endedAt?.getTime() ?? null,
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime(),
    }) satisfies AnalysisSessionView;
  }

  private segmentView(segment: typeof transcriptSegments.$inferSelect) {
    return Object.freeze({
      id: segment.id,
      analysisSessionId: segment.analysisSessionId,
      providerSegmentId: segment.providerSegmentId,
      sequence: segment.sequence,
      speakerRole: segment.speakerRole,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      createdAt: segment.createdAt.getTime(),
    }) satisfies TranscriptSegmentView;
  }
}
