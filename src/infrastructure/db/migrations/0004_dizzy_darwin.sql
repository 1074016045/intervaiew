CREATE TABLE `question_understanding_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`action_id` text NOT NULL,
	`finalized_question_id` text NOT NULL,
	`result_understanding_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finalized_question_id`) REFERENCES `finalized_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_understanding_id`) REFERENCES `question_understandings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_understanding_actions_session_action_uq` ON `question_understanding_actions` (`analysis_session_id`,`action_id`);--> statement-breakpoint
CREATE TABLE `question_understanding_clarifications` (
	`understanding_id` text NOT NULL,
	`reason` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`understanding_id`) REFERENCES `question_understandings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_understanding_clarifications_sequence_ck" CHECK("question_understanding_clarifications"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_understanding_clarifications_sequence_uq` ON `question_understanding_clarifications` (`understanding_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_understanding_clarifications_reason_uq` ON `question_understanding_clarifications` (`understanding_id`,`reason`);--> statement-breakpoint
CREATE TABLE `question_understanding_constraints` (
	`understanding_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`source_text` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`understanding_id`) REFERENCES `question_understandings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_understanding_constraints_sequence_ck" CHECK("question_understanding_constraints"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_understanding_constraints_sequence_uq` ON `question_understanding_constraints` (`understanding_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `question_understanding_dimensions` (
	`understanding_id` text NOT NULL,
	`dimension` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`understanding_id`) REFERENCES `question_understandings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_understanding_dimensions_sequence_ck" CHECK("question_understanding_dimensions"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_understanding_dimensions_sequence_uq` ON `question_understanding_dimensions` (`understanding_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_understanding_dimensions_value_uq` ON `question_understanding_dimensions` (`understanding_id`,`dimension`);--> statement-breakpoint
CREATE TABLE `question_understanding_focus_terms` (
	`understanding_id` text NOT NULL,
	`normalized` text NOT NULL,
	`source_text` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`understanding_id`) REFERENCES `question_understandings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_understanding_focus_terms_sequence_ck" CHECK("question_understanding_focus_terms"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_understanding_focus_terms_sequence_uq` ON `question_understanding_focus_terms` (`understanding_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_understanding_focus_terms_normalized_uq` ON `question_understanding_focus_terms` (`understanding_id`,`normalized`);--> statement-breakpoint
CREATE TABLE `question_understandings` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`finalized_question_id` text NOT NULL,
	`finalized_question_revision` integer NOT NULL,
	`source_boundary_decision_id` text NOT NULL,
	`understanding_revision` integer NOT NULL,
	`language` text NOT NULL,
	`question_family` text NOT NULL,
	`expected_answer_mode` text NOT NULL,
	`requires_clarification` integer NOT NULL,
	`confidence` integer NOT NULL,
	`decided_by` text NOT NULL,
	`semantic_provider_used` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finalized_question_id`) REFERENCES `finalized_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_boundary_decision_id`) REFERENCES `boundary_decisions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_understandings_finalized_revision_ck" CHECK("question_understandings"."finalized_question_revision" > 0),
	CONSTRAINT "question_understandings_revision_ck" CHECK("question_understandings"."understanding_revision" > 0),
	CONSTRAINT "question_understandings_confidence_ck" CHECK("question_understandings"."confidence" >= 0 and "question_understandings"."confidence" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_understandings_question_revision_uq` ON `question_understandings` (`finalized_question_id`,`finalized_question_revision`);--> statement-breakpoint
CREATE INDEX `question_understandings_session_question_idx` ON `question_understandings` (`analysis_session_id`,`finalized_question_id`);