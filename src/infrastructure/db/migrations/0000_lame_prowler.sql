CREATE TABLE `interview_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`action_id` text NOT NULL,
	`action_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `interview_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_actions_session_action_uq` ON `interview_actions` (`session_id`,`action_id`);--> statement-breakpoint
CREATE TABLE `interview_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`question` text NOT NULL,
	`competency` text NOT NULL,
	`rationale` text NOT NULL,
	`clarification` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `interview_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_questions_session_sequence_uq` ON `interview_questions` (`session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `interview_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`target_role` text NOT NULL,
	`target_company` text,
	`interview_type` text NOT NULL,
	`difficulty` text NOT NULL,
	`language` text NOT NULL,
	`resume_text` text NOT NULL,
	`job_description` text NOT NULL,
	`question_count` integer NOT NULL,
	`status` text NOT NULL,
	`ai_provider` text,
	`ai_model` text,
	`question_plan_summary` text,
	`current_question_index` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`duration_seconds` integer,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `interview_sessions_status_idx` ON `interview_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `interview_sessions_created_at_idx` ON `interview_sessions` (`created_at`);--> statement-breakpoint
CREATE INDEX `interview_sessions_target_role_idx` ON `interview_sessions` (`target_role`);--> statement-breakpoint
CREATE TABLE `transcript_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`event_type` text NOT NULL,
	`text` text NOT NULL,
	`question_sequence` integer,
	`action_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `interview_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_items_session_sequence_uq` ON `transcript_items` (`session_id`,`sequence`);