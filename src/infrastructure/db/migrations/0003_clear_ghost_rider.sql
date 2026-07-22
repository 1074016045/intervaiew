CREATE TABLE `boundary_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_revision` integer NOT NULL,
	`status` text NOT NULL,
	`should_finalize` integer NOT NULL,
	`confidence` integer NOT NULL,
	`reason_code` text NOT NULL,
	`decided_by` text NOT NULL,
	`semantic_provider_used` integer NOT NULL,
	`action_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `question_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "boundary_decisions_confidence_ck" CHECK("boundary_decisions"."confidence" >= 0 and "boundary_decisions"."confidence" <= 10000)
);
--> statement-breakpoint
CREATE INDEX `boundary_decisions_session_created_idx` ON `boundary_decisions` (`analysis_session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `boundary_decisions_candidate_revision_idx` ON `boundary_decisions` (`candidate_id`,`candidate_revision`);--> statement-breakpoint
CREATE TABLE `finalized_question_segments` (
	`finalized_question_id` text NOT NULL,
	`transcript_segment_id` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`finalized_question_id`) REFERENCES `finalized_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transcript_segment_id`) REFERENCES `transcript_segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finalized_question_segments_question_segment_uq` ON `finalized_question_segments` (`finalized_question_id`,`transcript_segment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finalized_question_segments_question_sequence_uq` ON `finalized_question_segments` (`finalized_question_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `finalized_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`text` text NOT NULL,
	`first_sequence` integer NOT NULL,
	`last_sequence` integer NOT NULL,
	`boundary_decision_id` text NOT NULL,
	`revision` integer NOT NULL,
	`finalized_at` integer NOT NULL,
	`undone_at` integer,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`boundary_decision_id`) REFERENCES `boundary_decisions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "finalized_questions_revision_ck" CHECK("finalized_questions"."revision" > 0),
	CONSTRAINT "finalized_questions_sequence_ck" CHECK("finalized_questions"."first_sequence" >= 0 and "finalized_questions"."last_sequence" >= "finalized_questions"."first_sequence")
);
--> statement-breakpoint
CREATE INDEX `finalized_questions_session_sequence_idx` ON `finalized_questions` (`analysis_session_id`,`first_sequence`);--> statement-breakpoint
CREATE TABLE `question_boundary_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`action_id` text NOT NULL,
	`action_type` text NOT NULL,
	`target_question_id` text,
	`result_entity_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_boundary_actions_session_action_uq` ON `question_boundary_actions` (`analysis_session_id`,`action_id`);--> statement-breakpoint
CREATE TABLE `question_candidate_segments` (
	`candidate_id` text NOT NULL,
	`transcript_segment_id` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `question_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transcript_segment_id`) REFERENCES `transcript_segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_candidate_segments_candidate_segment_uq` ON `question_candidate_segments` (`candidate_id`,`transcript_segment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_candidate_segments_candidate_sequence_uq` ON `question_candidate_segments` (`candidate_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `question_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`revision` integer NOT NULL,
	`text` text NOT NULL,
	`first_sequence` integer NOT NULL,
	`last_sequence` integer NOT NULL,
	`speaker_role` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`ended_at_ms` integer NOT NULL,
	`pause_after_ms` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_candidates_revision_ck" CHECK("question_candidates"."revision" > 0),
	CONSTRAINT "question_candidates_sequence_ck" CHECK("question_candidates"."first_sequence" >= 0 and "question_candidates"."last_sequence" >= "question_candidates"."first_sequence"),
	CONSTRAINT "question_candidates_timing_ck" CHECK("question_candidates"."started_at_ms" >= 0 and "question_candidates"."ended_at_ms" >= "question_candidates"."started_at_ms" and "question_candidates"."pause_after_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX `question_candidates_session_status_idx` ON `question_candidates` (`analysis_session_id`,`status`);