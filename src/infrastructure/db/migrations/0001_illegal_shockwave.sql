CREATE TABLE `realtime_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`voice` text NOT NULL,
	`status` text NOT NULL,
	`recording_consent` integer DEFAULT false NOT NULL,
	`connected_at` integer,
	`disconnected_at` integer,
	`ended_at` integer,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `interview_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `realtime_attempts_session_idx` ON `realtime_attempts` (`session_id`);--> statement-breakpoint
CREATE INDEX `realtime_attempts_status_idx` ON `realtime_attempts` (`status`);--> statement-breakpoint
CREATE TABLE `recording_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`realtime_attempt_id` text NOT NULL,
	`track_role` text NOT NULL,
	`relative_path` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`duration_ms` integer,
	`start_offset_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `interview_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`realtime_attempt_id`) REFERENCES `realtime_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recording_assets_session_idx` ON `recording_assets` (`session_id`);--> statement-breakpoint
CREATE INDEX `recording_assets_attempt_idx` ON `recording_assets` (`realtime_attempt_id`);--> statement-breakpoint
ALTER TABLE `transcript_items` ADD `provider_item_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_items_session_provider_item_uq` ON `transcript_items` (`session_id`,`provider_item_id`);