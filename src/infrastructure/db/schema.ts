import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
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

export const schema = {
  interviewSessions,
  interviewQuestions,
  transcriptItems,
  interviewActions,
  realtimeAttempts,
  recordingAssets,
};
