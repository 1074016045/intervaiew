import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  interviewDifficulties,
  interviewLanguages,
  interviewStatuses,
  interviewTypes,
} from "@/features/interviews/domain/interview.types";
import {
  transcriptEventTypes,
  transcriptRoles,
  transcriptSources,
} from "@/features/transcript/domain/transcript-item";
import { realtimeAttemptStatuses } from "@/features/realtime/domain/realtime-attempt";
import { recordingTrackRoles } from "@/features/recording/domain/recording-asset";
import {
  analysisSessionModes,
  analysisSessionStatuses,
} from "@/features/question-intelligence/domain/analysis-session";
import { transcriptSpeakerRoles } from "@/features/question-intelligence/domain/transcript";
import {
  boundaryDecisionReasonCodes,
  boundaryDecisionSources,
  boundaryDecisionStatuses,
  questionCandidateStatuses,
} from "@/features/question-intelligence/domain/question-boundary";
import { questionBoundaryActionTypes } from "@/features/question-intelligence/application/question-boundary-repository.port";

export const interviewSessions = sqliteTable(
  "interview_sessions",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    targetRole: text("target_role").notNull(),
    targetCompany: text("target_company"),
    interviewType: text("interview_type", { enum: interviewTypes }).notNull(),
    difficulty: text("difficulty", { enum: interviewDifficulties }).notNull(),
    language: text("language", { enum: interviewLanguages }).notNull(),
    resumeText: text("resume_text").notNull(),
    jobDescription: text("job_description").notNull(),
    questionCount: integer("question_count").notNull(),
    status: text("status", { enum: interviewStatuses }).notNull(),
    aiProvider: text("ai_provider", { enum: ["mock", "deepseek", "openai"] }),
    aiModel: text("ai_model"),
    questionPlanSummary: text("question_plan_summary"),
    currentQuestionIndex: integer("current_question_index")
      .notNull()
      .default(0),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    durationSeconds: integer("duration_seconds"),
    failureCode: text("failure_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("interview_sessions_status_idx").on(table.status),
    index("interview_sessions_created_at_idx").on(table.createdAt),
    index("interview_sessions_target_role_idx").on(table.targetRole),
  ],
);

export const interviewQuestions = sqliteTable(
  "interview_questions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    question: text("question").notNull(),
    competency: text("competency").notNull(),
    rationale: text("rationale").notNull(),
    clarification: text("clarification"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("interview_questions_session_sequence_uq").on(
      table.sessionId,
      table.sequence,
    ),
  ],
);

export const transcriptItems = sqliteTable(
  "transcript_items",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: text("role", { enum: transcriptRoles }).notNull(),
    source: text("source", { enum: transcriptSources }).notNull(),
    eventType: text("event_type", { enum: transcriptEventTypes }).notNull(),
    text: text("text").notNull(),
    questionSequence: integer("question_sequence"),
    actionId: text("action_id"),
    providerItemId: text("provider_item_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("transcript_items_session_sequence_uq").on(
      table.sessionId,
      table.sequence,
    ),
    uniqueIndex("transcript_items_session_provider_item_uq").on(
      table.sessionId,
      table.providerItemId,
    ),
  ],
);

export const realtimeAttempts = sqliteTable(
  "realtime_attempts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["openai", "fake"] }).notNull(),
    model: text("model").notNull(),
    voice: text("voice").notNull(),
    status: text("status", { enum: realtimeAttemptStatuses }).notNull(),
    recordingConsent: integer("recording_consent", { mode: "boolean" })
      .notNull()
      .default(false),
    connectedAt: integer("connected_at", { mode: "timestamp_ms" }),
    disconnectedAt: integer("disconnected_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    failureCode: text("failure_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("realtime_attempts_session_idx").on(table.sessionId),
    index("realtime_attempts_status_idx").on(table.status),
  ],
);

export const recordingAssets = sqliteTable(
  "recording_assets",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    realtimeAttemptId: text("realtime_attempt_id")
      .notNull()
      .references(() => realtimeAttempts.id, { onDelete: "cascade" }),
    trackRole: text("track_role", { enum: recordingTrackRoles }).notNull(),
    relativePath: text("relative_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    durationMs: integer("duration_ms"),
    startOffsetMs: integer("start_offset_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("recording_assets_session_idx").on(table.sessionId),
    index("recording_assets_attempt_idx").on(table.realtimeAttemptId),
  ],
);

export const interviewActions = sqliteTable(
  "interview_actions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    actionId: text("action_id").notNull(),
    actionType: text("action_type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("interview_actions_session_action_uq").on(
      table.sessionId,
      table.actionId,
    ),
  ],
);

export const analysisSessions = sqliteTable(
  "analysis_sessions",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    mode: text("mode", { enum: analysisSessionModes }).notNull(),
    status: text("status", { enum: analysisSessionStatuses }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("analysis_sessions_status_idx").on(table.status),
    index("analysis_sessions_created_at_idx").on(table.createdAt),
  ],
);

export const transcriptSegments = sqliteTable(
  "transcript_segments",
  {
    id: text("id").primaryKey(),
    analysisSessionId: text("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    providerSegmentId: text("provider_segment_id").notNull(),
    sequence: integer("sequence").notNull(),
    speakerRole: text("speaker_role", {
      enum: transcriptSpeakerRoles,
    }).notNull(),
    text: text("text").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("transcript_segments_session_provider_uq").on(
      table.analysisSessionId,
      table.providerSegmentId,
    ),
    uniqueIndex("transcript_segments_session_sequence_uq").on(
      table.analysisSessionId,
      table.sequence,
    ),
    index("transcript_segments_session_order_idx").on(
      table.analysisSessionId,
      table.sequence,
    ),
  ],
);

export const questionCandidates = sqliteTable(
  "question_candidates",
  {
    id: text("id").primaryKey(),
    analysisSessionId: text("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    text: text("text").notNull(),
    firstSequence: integer("first_sequence").notNull(),
    lastSequence: integer("last_sequence").notNull(),
    speakerRole: text("speaker_role", { enum: ["interviewer"] }).notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    endedAtMs: integer("ended_at_ms").notNull(),
    pauseAfterMs: integer("pause_after_ms").notNull(),
    status: text("status", { enum: questionCandidateStatuses }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("question_candidates_session_status_idx").on(
      table.analysisSessionId,
      table.status,
    ),
    check("question_candidates_revision_ck", sql`${table.revision} > 0`),
    check(
      "question_candidates_sequence_ck",
      sql`${table.firstSequence} >= 0 and ${table.lastSequence} >= ${table.firstSequence}`,
    ),
    check(
      "question_candidates_timing_ck",
      sql`${table.startedAtMs} >= 0 and ${table.endedAtMs} >= ${table.startedAtMs} and ${table.pauseAfterMs} >= 0`,
    ),
  ],
);

export const questionCandidateSegments = sqliteTable(
  "question_candidate_segments",
  {
    candidateId: text("candidate_id")
      .notNull()
      .references(() => questionCandidates.id, { onDelete: "cascade" }),
    transcriptSegmentId: text("transcript_segment_id")
      .notNull()
      .references(() => transcriptSegments.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
  },
  (table) => [
    uniqueIndex("question_candidate_segments_candidate_segment_uq").on(
      table.candidateId,
      table.transcriptSegmentId,
    ),
    uniqueIndex("question_candidate_segments_candidate_sequence_uq").on(
      table.candidateId,
      table.sequence,
    ),
  ],
);

export const boundaryDecisions = sqliteTable(
  "boundary_decisions",
  {
    id: text("id").primaryKey(),
    analysisSessionId: text("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => questionCandidates.id, { onDelete: "cascade" }),
    candidateRevision: integer("candidate_revision").notNull(),
    status: text("status", { enum: boundaryDecisionStatuses }).notNull(),
    shouldFinalize: integer("should_finalize", { mode: "boolean" }).notNull(),
    confidence: integer("confidence").notNull(),
    reasonCode: text("reason_code", {
      enum: boundaryDecisionReasonCodes,
    }).notNull(),
    decidedBy: text("decided_by", { enum: boundaryDecisionSources }).notNull(),
    semanticProviderUsed: integer("semantic_provider_used", {
      mode: "boolean",
    }).notNull(),
    actionId: text("action_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("boundary_decisions_session_created_idx").on(
      table.analysisSessionId,
      table.createdAt,
    ),
    index("boundary_decisions_candidate_revision_idx").on(
      table.candidateId,
      table.candidateRevision,
    ),
    check(
      "boundary_decisions_confidence_ck",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 10000`,
    ),
  ],
);

export const finalizedQuestions = sqliteTable(
  "finalized_questions",
  {
    id: text("id").primaryKey(),
    analysisSessionId: text("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    firstSequence: integer("first_sequence").notNull(),
    lastSequence: integer("last_sequence").notNull(),
    boundaryDecisionId: text("boundary_decision_id")
      .notNull()
      .references(() => boundaryDecisions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    finalizedAt: integer("finalized_at", { mode: "timestamp_ms" }).notNull(),
    undoneAt: integer("undone_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("finalized_questions_session_sequence_idx").on(
      table.analysisSessionId,
      table.firstSequence,
    ),
    check("finalized_questions_revision_ck", sql`${table.revision} > 0`),
    check(
      "finalized_questions_sequence_ck",
      sql`${table.firstSequence} >= 0 and ${table.lastSequence} >= ${table.firstSequence}`,
    ),
  ],
);

export const finalizedQuestionSegments = sqliteTable(
  "finalized_question_segments",
  {
    finalizedQuestionId: text("finalized_question_id")
      .notNull()
      .references(() => finalizedQuestions.id, { onDelete: "cascade" }),
    transcriptSegmentId: text("transcript_segment_id")
      .notNull()
      .references(() => transcriptSegments.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
  },
  (table) => [
    uniqueIndex("finalized_question_segments_question_segment_uq").on(
      table.finalizedQuestionId,
      table.transcriptSegmentId,
    ),
    uniqueIndex("finalized_question_segments_question_sequence_uq").on(
      table.finalizedQuestionId,
      table.sequence,
    ),
  ],
);

export const questionBoundaryActions = sqliteTable(
  "question_boundary_actions",
  {
    id: text("id").primaryKey(),
    analysisSessionId: text("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    actionId: text("action_id").notNull(),
    actionType: text("action_type", {
      enum: questionBoundaryActionTypes,
    }).notNull(),
    targetQuestionId: text("target_question_id"),
    resultEntityId: text("result_entity_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("question_boundary_actions_session_action_uq").on(
      table.analysisSessionId,
      table.actionId,
    ),
  ],
);

export const schema = {
  interviewSessions,
  interviewQuestions,
  transcriptItems,
  interviewActions,
  realtimeAttempts,
  recordingAssets,
  analysisSessions,
  transcriptSegments,
  questionCandidates,
  questionCandidateSegments,
  boundaryDecisions,
  finalizedQuestions,
  finalizedQuestionSegments,
  questionBoundaryActions,
};
