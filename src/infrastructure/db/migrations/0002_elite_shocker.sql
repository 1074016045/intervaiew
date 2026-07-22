CREATE TABLE `analysis_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analysis_sessions_status_idx` ON `analysis_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `analysis_sessions_created_at_idx` ON `analysis_sessions` (`created_at`);--> statement-breakpoint
CREATE TABLE `transcript_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`provider_segment_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`speaker_role` text NOT NULL,
	`text` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_segments_session_provider_uq` ON `transcript_segments` (`analysis_session_id`,`provider_segment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_segments_session_sequence_uq` ON `transcript_segments` (`analysis_session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `transcript_segments_session_order_idx` ON `transcript_segments` (`analysis_session_id`,`sequence`);